# Issue — Spawned Hermes agents land as `failed` because no long-lived process keeps the machine running

**Status:** diagnosed, awaiting fix
**Filed:** 2026-04-27
**Severity:** breaks the v1 demo path — every agent spawned through the wizard appears `failed` in the fleet view ~30s after deploy.
**Related:**
- `docs/executing/hermes-chat-sidecar.md` (the proper fix lives here — this issue is the operational forcing function for landing Phases 3–6 of that plan)
- `docs/changelog.md` §0.9.5 (the re-inspection that re-framed Hermes as `AIAgent` + FastAPI + CLI rather than "CLI-shaped only"), §0.5.0 §525 + §549 (the original superseded framing)
- `docs/blueprint.md` §3.1 (runtime contract — agent must expose `/health` + `/chat` over HTTP), §11.4 (deferred features stub as real interfaces — not as half-functional UI), §11.5 (no forking upstream)
- `adapters/hermes/entrypoint.sh:175` (the chat-disabled `exec` line that's the proximate cause), `adapters/hermes/Dockerfile` (image is built with the sidecar baked in but ungated)
- `backend/internal/deploy/fly.go` (`Spawn` does not set `CORELLIA_CHAT_ENABLED`, does not declare a `services` block, does not wire a per-instance auth token)

---

## 1. Observed behavior

Operator spawned `test-hermes-2` via the production spawn wizard at 2026-04-26T16:08:16Z. Fleet UI rendered the row as `failed` within ~30s. The Fly app and machine were created successfully; the failure surfaced *after* a clean machine boot.

Repro: any spawn through the production wizard against the current `adapters/hermes` image at digest `ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:4aefe3a2be26d4fe394038a38fa5e506f7d8ad6af5890321af4a9aa7bd3d7b08`.

## 2. Timeline (Fly + control-plane logs)

| Time (UTC)         | Source              | Event |
|--------------------|---------------------|---|
| 16:08:16           | control-plane (`corellia`) | `SpawnAgent` writes `agent_instances` row, calls Fly Machines API |
| 16:08:16           | Fly (`corellia-agent-5824fef7`) | Machine `08003d4a1e4d28` created in `sin`, `shared-cpu-1x:512MB` |
| 16:08:17           | control-plane | `SpawnAgent` RPC returns `200` in 8.5s |
| 16:10:40           | Fly runner | Image pull completes after 2m23s (cold pull, ~250MB) |
| 16:10:42           | Fly | Machine state → `started` |
| **16:11:06**       | Fly app | **`Main child exited normally with code: 0`** ← root cause |
| 16:11:07           | Fly runner | `machine exited with exit code 0, not restarting` |
| 16:11:07+          | control-plane | `Health()` poll observes machine in `stopped` state, marks instance `failed` |

Restart policy is `on-failure, max_retries=3` — exit code `0` is "success" from Fly's perspective, so no restart is attempted. This behavior is *correct* for Fly's contract.

## 3. Root cause

**There is no long-lived process holding PID 1 in the agent container.**

`adapters/hermes/entrypoint.sh:175` (the chat-disabled branch, which is the only branch reachable today):

```sh
exec /opt/hermes/docker/entrypoint.sh "$@"
```

That upstream entrypoint runs Hermes' default CMD, which under the pinned digest is a non-interactive `hermes` invocation — a CLI that runs to completion and exits cleanly when its work is done. There is no HTTP server, no event loop, no background worker keeping the process alive. Container PID 1 exits → machine stops → fleet view shows `failed`.

This is *exactly* the gap re-framed in changelog §0.9.5: Hermes 0.x ships an importable `AIAgent` class and a FastAPI dashboard, but the upstream entrypoint does not by default bring up an HTTP listener bound to the Fly machine's external port. The `Hermes Chat Sidecar` plan (`docs/executing/hermes-chat-sidecar.md`) is the closure path for this gap; it has shipped Phases 1–2 (sidecar source + Dockerfile bake-in) and is blocked on Phases 3–6 (BE plumbing + Health() probe + FE chat surface).

The fleet UI's `failed` badge is **semantically correct** per blueprint §3.1's runtime contract (an agent that does not expose `/health` over HTTP is not running by Corellia's definition). The bug is upstream of the badge: the spawn flow does not produce an agent that satisfies the contract.

## 4. Why no quick fix is acceptable

The temptations and why each violates an architecture rule or the spirit of the v1 product:

| Temptation | Violation |
|---|---|
| Hard-code `CORELLIA_CHAT_ENABLED=true` in `entrypoint.sh` | The chat surface still has no external route (no `services` block on the Fly machine config) and no per-instance auth token. The sidecar would bind `:8642` internally and be unreachable. Also collapses decision 6 of the sidecar plan ("chat-disabled instances start no sidecar process") into "always-on by hidden default", removing the operator's user-facing toggle. |
| Set `restart: always` in machine config | Hermes still exits 0 every ~25s; Fly would loop-restart the container indefinitely, which is observably worse (log noise, cost, no actual `/chat` surface). |
| Change the upstream CMD to `sleep infinity` (or similar) | Defeats the entire purpose of the agent. Sidesteps the runtime contract instead of satisfying it. |
| Mark machine-`stopped` as `running` in `Health()` | Lies on the fleet view. Removes the only signal the operator has that the agent is unreachable. Worse than the current `failed` badge, which is at least honest. |
| Switch `lifecycle_mode` to `idle-on-demand` | M5 already declares this mode "Coming when secure agent endpoints ship" (frontend disables the option with a tooltip — `frontend/src/components/fleet/deployment-config-form.tsx`). Picking it as a workaround for missing chat infrastructure inverts the dependency. |

The proper fix is the one the architecture has been pointed at since changelog §0.9.5: **finish the chat sidecar plan**.

## 5. Proper fix — finish `docs/executing/hermes-chat-sidecar.md` Phases 3–6

The sidecar source ships in the image *today* (verified via the `COPY sidecar/ /corellia/sidecar/` line in `adapters/hermes/Dockerfile` and the `python -m uvicorn` block in `entrypoint.sh:139–145`). What is missing is the BE/IaC/FE plumbing that **gates the sidecar on**, **routes external traffic to it**, and **probes its `/health` endpoint**.

The four remaining phases, copied from the sidecar plan with this issue's framing:

### Phase 3 — `FlyDeployTarget.Spawn` widening (the load-bearing fix)

`backend/internal/deploy/fly.go` `Spawn` must, when `chat_enabled` is true on the `DeployConfig`:

1. Generate a 32-byte URL-safe random token, write it as the Fly app secret `CORELLIA_SIDECAR_AUTH_TOKEN` (alongside today's `CORELLIA_MODEL_API_KEY` write).
2. Set `CORELLIA_CHAT_ENABLED=true` in the machine env (this is the gate that triggers the two-process supervisor in `entrypoint.sh:113`).
3. Declare a `services` block on the machine config: external `:443` (HTTPS, Fly-terminated) → internal `:8642` (uvicorn). Health-check field on the service points at `GET /health`.
4. Persist the token in our `Secret` table via the `storage_ref` pattern (rule §11 — never store the raw value).

### Phase 4 — `agents.ChatWithAgent` domain method + Connect handler

Domain method loads the per-instance bearer token from the `Secret` row, constructs the URL `https://<deploy_external_ref>.fly.dev/chat`, and proxies the FE's payload with the bearer attached. The Connect handler stays <30 lines per stack.md §11.9. New proto message + RPC; `pnpm proto:generate` regenerates both trees.

### Phase 5 — FE chat surface

A chat panel on the agent detail page (or fleet inspector — TBD per the sidecar plan's open Q3). Sends `POST /corellia.v1.AgentsService/ChatWithAgent` with `{ instance_id, session_id, message }`; renders `{ content }`. Reduced-motion fallback + auth error states.

### Phase 6 — `FlyDeployTarget.Health()` HTTP probe

Today `Health()` reads Fly machine state. Widen it to:

- If `chat_enabled` is true → `GET https://<external_ref>.fly.dev/health` with the bearer token; `200 ok` → `running`, anything else → `failed`.
- If `chat_enabled` is false → fall back to today's machine-state read (preserves backward-compat for any agent spawned pre-this-milestone).

This phase also closes the original bug: an agent that satisfies the runtime contract is observably `running` on the fleet view, no matter what the upstream CMD does in the background.

### Phase 7 — Integration smoke + adapter rebuild + GHCR push

Per the sidecar plan's existing Phase 7. Rebuild the adapter image (no source change required if Phases 1–2 are still byte-identical to what shipped), push to GHCR, bump `harness_adapters.adapter_image_ref` via migration. Smoke: spawn a test agent through the wizard with `chat_enabled=true`, verify the fleet row reaches `running` and stays there for ≥10 minutes, send a `/chat` round-trip from the FE.

## 6. Migration considerations

- **`agent_instances` already has the columns the sidecar plan needs** (the plan's decision 6 sets `chat_enabled BOOLEAN NOT NULL DEFAULT TRUE`, which is one new column added in Phase 3's migration).
- **Existing agents** (spawned pre-fix, including `test-hermes-2`) cannot be retroactively healed by Phase 3 — they have no `services` block on their Fly machine, no `CORELLIA_SIDECAR_AUTH_TOKEN` secret, and no `CORELLIA_CHAT_ENABLED=true` env. M5's `UpdateAgentDeployConfig` covers the live-update path on its own (the `services` block is one more knob in the machine config), but the simpler path for a pre-fix agent is to destroy + respawn under the new spawn flow. Acceptable for v1 given the small number of pre-fix instances.
- **The two pre-existing agents in `personal` org** (`corellia-agent-31bcbcaa`, `corellia-agent-5824fef7`) should be destroyed once the fix lands, not migrated — both are demo artifacts with no production value.

## 7. Out of scope for this issue

- Per-conversation ACL, per-message audit log, rate limiting beyond Fly's edge — covered by post-v1.5 audit pillar.
- Streaming chat (`POST /chat` is unary in v1) — v1.6 follow-up.
- `/tools/invoke` route on the sidecar — placeholder `501` per blueprint §3.1; tool governance is the v1.5 plan in `docs/executing/tools-governance.md`.
- Other deploy targets (`AWSDeployTarget`, `LocalDeployTarget` — both `NotImplemented` stubs today) — Phase 6's `Health()` widening is Fly-only; the stubs are unchanged.

## 8. Definition of done

- [ ] Spawn flow with `chat_enabled=true` (default-on) produces an agent that reaches `running` on the fleet view and stays there for ≥10 minutes uninterrupted.
- [ ] FE chat panel round-trips a `Hello` → `Hello back` exchange against the deployed agent.
- [ ] Spawn flow with `chat_enabled=false` produces an agent whose Fly machine has no `services` block, no inbound network exposure — and the fleet view's `Health()` for that instance falls back to machine-state polling (today's M4 behavior).
- [ ] `test-hermes-2` and the two demo-artifact agents in `personal` are destroyed.
- [ ] Adapter image rebuilt, pushed to GHCR, `harness_adapters.adapter_image_ref` bumped via migration.
- [ ] Changelog entry filed (supersedes 0.9.5's "this is a v1.5 follow-up" framing — the sidecar is now v1).
