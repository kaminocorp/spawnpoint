# Plan — Hermes Chat Sidecar (M-chat)

**Status:** draft, awaiting approval
**Owner:** TBD
**Supersedes:** —
**Related:**
- `docs/blueprint.md` §3.1 (runtime contract — `/health` + `/chat` + future `/tools/invoke`), §3.2 (configuration contract — `CORELLIA_*` env vars), §7 (observability/memory integration patterns — Option A "sidecar container", Option D "adapter wrapper / entrypoint shim"; this plan composes A on top of D), §8 (Fly deployment topology — one `AgentInstance` = one Fly app = one Fly machine; this plan keeps the invariant by colocating the sidecar in the same machine), §11.1 (no Fly-specific code outside `FlyDeployTarget` — Phase 3 is the rule's smallest possible new surface), §11.3 (`CORELLIA_*` env vars are translated by adapters; the sidecar is *the adapter* in HTTP form), §11.4 (deferred features stub as real interfaces — applies to the chat-disabled lifecycle below), §11.5 (no forking upstream harnesses — sidecar is the canonical mechanism for adding capabilities)
- `docs/stack.md` §11 (handlers stay <30 lines, business logic in domain packages — applies to the new `/chat` Connect handler)
- `docs/changelog.md` §0.9.5 (the re-inspection that unblocked this plan; supersedes the M3 "Hermes is CLI-shaped" framing), §0.5.0 §525 + §549 (the original superseded framing), §0.7.0 (M4's `agent_instances` schema + the existing `Spawn`/`Health` shape this plan extends), §0.7.5 (the `Transactor` pattern — re-used for the per-instance auth-token write)
- `adapters/hermes/README.md` "Known limitations" §1 (current version, post-0.9.5; describes the upstream surface this plan layers on)
- `docs/executing/fleet-control.md` (M5; this plan composes with M5's `services`-block-aware machine config — see decision 8 below for the ordering note)

---

## 1. Objective

Add a **per-instance HTTP chat surface** to every deployed Hermes agent so Corellia operators can talk to their agents from the Corellia frontend, and so M4's `Health()` polling can probe a real `/health` endpoint instead of falling back to Fly machine state.

Concretely: the `Hermes Adapter` image gains a small Python FastAPI process that imports `AIAgent` from the upstream Hermes package and exposes:

- `POST /chat { session_id, message } → { content }` — OpenAI-shaped, multi-turn via session reuse
- `GET /health → { ok: true, hermes: "ready" }` — for Corellia's `Health()` poll and Fly's TCP/HTTP healthchecks

That sidecar runs in the **same Firecracker microVM** as the Hermes process, supervised by an extended `entrypoint.sh`. It binds to internal port `8642`; Fly's edge proxy routes external `:443` to it. Inbound requests must carry a `Bearer <token>` header matching a per-instance `CORELLIA_SIDECAR_AUTH_TOKEN` Fly app secret; without it the sidecar returns `401`.

Corellia's BE gains a `ChatWithAgent` Connect RPC that proxies the FE's chat input to the agent's sidecar URL with the per-instance bearer token attached. The FE gains a chat panel on the agent detail page (or `/spawn/[templateId]`'s post-deploy success state, TBD per Q3 below).

User-facing toggle: the spawn wizard's Step 4 (Deployment) gains a default-on **"Enable chat"** checkbox. When unchecked, the sidecar process is not started, the machine has no `services` block, and the chat UI surface is hidden in the fleet view for that instance — same column in the DB carries the boolean.

### What this plan is NOT

- **Not a /tools/invoke implementation.** Blueprint §3.1's third sub-endpoint is post-v1.5 work; the sidecar's HTTP shape leaves a placeholder route returning `501 Not Implemented`, but the Corellia-side proxy + UI for tool invocation is out of scope.
- **Not a streaming chat UI.** v1 of the chat sidecar is unary `POST /chat` with full-response replies. Server-sent events or WebSocket streaming is a v1.6 follow-up — the proto leaves a streaming variant unreserved (a future `streaming ChatWithAgent` method is a clean addition).
- **Not a multi-tenant chat surface.** Each Corellia operator who can see the agent in the fleet view can chat with it. There is no per-conversation ACL, no per-message audit log (audit pillar is post-v1.5), no rate limiting beyond what Fly's edge proxy provides.
- **Not a swap of the `Health()` strategy across all `DeployTarget`s.** This plan teaches `FlyDeployTarget.Health()` to *prefer* the `/health` HTTP probe when chat is enabled and *fall back* to machine-state when it isn't. Other deploy targets (AWS, Local — both `NotImplemented` stubs today) are unaffected.

---

## 2. Decisions locked

| # | Decision | Rationale |
|---|---|---|
| 1 | **Sidecar lives in the same container as `hermes`** (single-container, two-process supervision via the existing `entrypoint.sh`), not in a separate Fly process group | The sidecar is harness-specific (it imports `AIAgent` from the upstream Python package) and shares `$HERMES_HOME` with the Hermes process for session continuity (`hermes_state.SessionDB` lives there). Keeping them in one container means one image to digest-pin (per blueprint §11.2), one volume mount, one set of secrets. Fly's `[processes]` table would force two images and a network hop between the sidecar and the on-disk SQLite — strictly worse for this workload. The day Corellia ships a *Corellia-built* sidecar (e.g. an outbound network proxy, blueprint §7 Option B) that's harness-agnostic, *that* sidecar earns its own container. |
| 2 | **Sidecar imports `AIAgent` directly** (`from run_agent import AIAgent`), does not shell out to `hermes -z` per request | Per the 0.9.5 re-inspection: `AIAgent.chat(prompt) -> str` is importable and is exactly the surface used by `hermes -z` under the hood. Skipping subprocess saves one Python interpreter spin-up + one `load_config` + one provider-client init per turn (rough estimate: ~500ms-1.5s per request). Also lets a single `AIAgent` instance persist across turns inside a session, matching the upstream `gateway/run.py` pattern. Fallback strategy if `AIAgent` proves unsafe to reuse across turns: instantiate per request (still in-process, still no subprocess) — verified during Phase 1. |
| 3 | **Per-conversation `AIAgent` instance, keyed by `session_id`** | The sidecar holds `dict[session_id, AIAgent]`. Each `POST /chat` call looks up (or creates) the instance for that session id and calls `.chat(message)`. Hermes's own session state lives in `$HERMES_HOME/sessions/<session_id>.sqlite` and is durable across machine restarts (the volume persists). `session_id` is generated client-side (Corellia FE) as a UUID and passed on every request — the sidecar is stateless about which session ids exist (the SQLite is the source of truth). |
| 4 | **Sidecar binds `0.0.0.0:8642` (internal); Fly's `services` block exposes `:443` (external HTTPS) → `:8642` (internal HTTP)** | Internal HTTP is fine because Fly's edge handles TLS termination. Port `8642` is the convention for Hermes that already appears in `blueprint.md` §3.1; reusing it keeps the contract aligned across harnesses. |
| 5 | **Auth: per-instance `CORELLIA_SIDECAR_AUTH_TOKEN` (Fly app secret), checked on every request via `Authorization: Bearer <token>`** | Public `/chat` with no auth is a foot-gun (anyone with the URL could rack up the agent's model-API bill). The token is a 32-byte URL-safe random string generated at spawn time, written as a Fly app secret via the same `flaps.SetSecrets` call that sets `CORELLIA_MODEL_API_KEY`, and stored in our `Secret` table via the same `storage_ref`-pattern row (rule §11 "deploy-target credentials never live in Corellia's database" applies — the row references the secret store, doesn't carry the value). Corellia's BE reads it via the same `Secret` lookup it uses for the model API key, and attaches it to every proxied request. |
| 6 | **Chat-disabled instances start no sidecar process and declare no `services` block** | Per blueprint §11.4: deferred features stub as real interfaces. "Chat disabled" is a real configuration, not a fake button — the entrypoint script reads a `CORELLIA_CHAT_ENABLED` env var (set by `FlyDeployTarget.Spawn` from the wizard's checkbox), and only starts the sidecar process when it's `true`. When false, the machine has no inbound network exposure at all (matching today's posture for every existing agent). The DB column `chat_enabled BOOLEAN NOT NULL DEFAULT TRUE` makes the default explicit and lets fleet-view filter on it. |
| 7 | **`FlyDeployTarget.Health()` uses HTTP `/health` when chat is enabled, machine-state when it isn't** | The HTTP probe is strictly more informative (catches the case where the machine is `started` but `hermes` itself crashed inside the container). Falling back to machine-state for chat-disabled instances preserves backward-compatibility with M4's contract — no regression for existing agents that haven't been respawned post-this-milestone. |
| 8 | **This plan ships *after* M5 (fleet-control)** | M5 widens `DeployTarget` to support live-update of machine config (region, size, replicas, lifecycle). The chat sidecar's `services` block is one more knob in that machine config, and "toggle chat on a running agent" naturally composes with M5's `Update` method (live-applied with restart, since adding a service requires the machine to re-launch). Shipping chat-sidecar before M5 means re-spawning the agent to toggle chat on/off; shipping after M5 means a live update with ~5s downtime. The cost of waiting is worth the cleaner UX. |
| 9 | **Sidecar source lives at `adapters/hermes/sidecar/`, baked into the adapter image at build time** | Same source-tree posture as `entrypoint.sh` today. The sidecar dir contains `sidecar.py` (~200 LOC FastAPI app), `requirements.txt` (pin `fastapi` + `uvicorn` versions for reproducibility — both already present in the upstream image via the `[all]` extra, but pinning ours protects against an upstream extra-set change). Dockerfile gains one `COPY` line and one `RUN python -m venv /corellia/venv && /corellia/venv/bin/pip install -r /corellia/sidecar/requirements.txt` (or omits the venv if we trust the upstream `[all]` extra to keep the deps; verified during Phase 2). |
| 10 | **The sidecar lives inside the harness-specific adapter (`adapters/hermes/`)**, not as a Corellia-global helper | The sidecar's `from run_agent import AIAgent` line is Hermes-specific. When OpenClaw / Claude Agent SDK / DeepAgents land in v2+, each gets its *own* sidecar inside its *own* adapter directory, exposing the same `POST /chat` shape but importing whatever `<harness>` natively does. The contract (`/chat` JSON in/out + bearer auth) is universal; the implementation is per-harness. This mirrors today's env-var translation in `entrypoint.sh`. |
| 11 | **Corellia BE proxies the FE's chat call rather than the FE talking to the sidecar directly** | Three reasons: (a) the per-instance bearer token never leaves the BE — FE doesn't need to know it; (b) Corellia gets a single audit point for who chatted with what (post-v1.5 audit pillar consumes this); (c) CORS shapes are simpler when the FE only talks to the Corellia API origin, not to N agent URLs. The proxy is a thin Connect handler (<30 lines per stack.md §11.9) calling into a new `agents.ChatWithAgent` domain method. |
| 12 | **Default chat URL shape: `https://corellia-agent-<instance-uuid>.fly.dev/chat`** | Matches today's app-naming convention from M4. No custom DNS, no per-org domain — the URL is internal-to-Corellia anyway because the FE never sees it. The BE constructs it from the `agent_instances.deploy_external_ref` value already stored. |

---

## 3. Pre-work checklist

Verified before Phase 1 starts; cheap to discover late, expensive to discover mid-Phase-3.

- [ ] **Confirm `AIAgent` is safe to reuse across turns.** Read `gateway/session.py` end-to-end and verify the upstream pattern. If unsafe, decision 2's fallback (instantiate per request) becomes the primary strategy; phase 1's `dict[session_id, AIAgent]` collapses to `dict[session_id, str]` (just session ids) with `AIAgent` constructed inside each handler call.
- [ ] **Confirm `fastapi` + `uvicorn` are present in the upstream image at our pinned digest.** Likely yes (upstream Dockerfile installs `[all]` extra), verify via `docker run --rm --entrypoint /bin/sh nousresearch/hermes-agent@sha256:d4ee57f2… -c 'python -c "import fastapi; import uvicorn; print(fastapi.__version__, uvicorn.__version__)"'`. If missing, sidecar's `requirements.txt` pins them and Phase 2 adds `pip install` to Dockerfile.
- [ ] **Confirm `$HERMES_HOME/sessions/` is the SQLite location and is on the volume.** `docker run --rm --entrypoint /bin/sh nousresearch/hermes-agent@sha256:d4ee57f2… -c 'echo $HERMES_HOME; ls -la $HERMES_HOME 2>/dev/null'`. The `VOLUME` declaration in the upstream Dockerfile should cover the whole `$HERMES_HOME`.
- [ ] **Confirm Fly's `services` block syntax** for routing external `:443` to internal `:8642`. Reference `docs/refs/fly-commands.md` §"machines run --port" and the M5 plan's machine-config work; the `flaps.LaunchMachine` request shape includes a `services` array — verify Phase 3's struct emits the right shape.
- [ ] **Confirm `flaps.SetSecrets` accepts a new secret on a running machine without restarting it** (or accept that toggling chat on a running agent requires a machine restart, per decision 8).

---

## 4. Phasing

Seven phases, each with a hard exit gate. Phases run **in series**, not in parallel — same lesson as `post-0.2.6-roadmap.md` §1.

### Phase 1 — Sidecar source files (no Fly, no Corellia BE/FE changes)

**Goal:** A `sidecar.py` that runs locally against a fake `AIAgent` (or a real one with a model API key), and a smoke test that proves `POST /chat` round-trips.

**Files added:**
- `adapters/hermes/sidecar/sidecar.py` (~200 LOC, FastAPI app, `dict[session_id, AIAgent]`, bearer-token middleware, `/chat` + `/health` routes, `/tools/invoke` returning 501)
- `adapters/hermes/sidecar/requirements.txt` (pinned `fastapi` + `uvicorn`)
- `adapters/hermes/sidecar/README.md` (5-line "what this is + how to run locally" stub)
- `adapters/hermes/sidecar/smoke.sh` (POSIX shell, `docker run` the unmodified upstream Hermes image with the sidecar bind-mounted, curl `/chat` with a fake model API key, assert non-empty response)

**Files unchanged in this phase:** `Dockerfile`, `entrypoint.sh`, every Go file, every TS file, every migration. The sidecar lives in the source tree but the deployed image doesn't yet know about it.

**Exit gate:** `./adapters/hermes/sidecar/smoke.sh` passes locally with `OPENROUTER_API_KEY=…` set; sidecar returns valid OpenAI-shaped JSON; bearer-token middleware rejects requests without the header (HTTP 401).

### Phase 2 — Dockerfile + entrypoint integration (image rebuild, no Fly changes)

**Goal:** The adapter image bakes the sidecar in. Locally-built image starts both processes.

**Files modified:**
- `adapters/hermes/Dockerfile` — gains `COPY --chmod=0755 sidecar/ /corellia/sidecar/` and (if needed per pre-work check) `RUN /corellia/venv/bin/pip install -r /corellia/sidecar/requirements.txt`. Digest stays pinned to the existing upstream — no upstream bump.
- `adapters/hermes/entrypoint.sh` — extended from "exec hermes" to "if `CORELLIA_CHAT_ENABLED=true`, start uvicorn in the background, then exec hermes." Background uvicorn startup uses `&` + `wait` pattern so SIGTERM from Fly hits both processes (per the existing comment about PID 1 and `exec`).
- `adapters/hermes/README.md` — env-var table gains `CORELLIA_CHAT_ENABLED` + `CORELLIA_SIDECAR_AUTH_TOKEN` rows. Smoke section grows a "with chat enabled" variant.

**Exit gate:** Local `docker build && docker run -e CORELLIA_CHAT_ENABLED=true -e CORELLIA_SIDECAR_AUTH_TOKEN=... -e CORELLIA_MODEL_API_KEY=...` shows both processes running (`docker exec ... ps -ef`), `/health` returns 200 with `hermes: "ready"`, `/chat` round-trips. With `CORELLIA_CHAT_ENABLED=false` (or unset), only `hermes` runs, no listener on `:8642`. Image builds multi-arch via `docker buildx`.

### Phase 3 — `FlyDeployTarget` machine-config: services block + secret plumbing (Go-only, no FE)

**Goal:** Spawning a chat-enabled agent emits the right Fly machine config; spawning a chat-disabled agent emits today's exact shape.

**Files modified:**
- `backend/internal/deploy/fly.go` — `Spawn` extended to accept a `ChatEnabled bool` field on its `DeployConfig` argument (M5's struct widens cleanly to include it). When true: machine config gains `services: [{ports: [{port: 443, handlers: [http, tls]}], internal_port: 8642, protocol: "tcp"}]`; per-instance bearer token generated via `crypto/rand`, set as a Fly app secret via the existing `flaps.SetSecrets` call alongside `CORELLIA_MODEL_API_KEY`, written to the `Secret` table with `key_name = "CORELLIA_SIDECAR_AUTH_TOKEN"` via the existing `Transactor` pattern (changelog 0.7.5).
- `backend/internal/deploy/types.go` — `DeployConfig` gains `ChatEnabled bool`.
- `backend/internal/deploy/stubs.go` — `LocalDeployTarget` + `AWSDeployTarget` updated to accept the new field (no-op, they're `NotImplemented`).
- `backend/migrations/<next>_add_chat_enabled.sql` — `agent_instances` gains `chat_enabled BOOLEAN NOT NULL DEFAULT TRUE`.
- `backend/queries/agent_instances.sql` — `CreateAgentInstance` insert gains the column.
- `sqlc generate` regenerates `backend/internal/db/`.

**Exit gate:** `cd backend && go vet ./... && go test ./internal/deploy ./internal/agents` clean. Local `cmd/smoke-deploy` boots a chat-enabled Fly app, `curl https://corellia-agent-<uuid>.fly.dev/health` (with the bearer token) returns 200. Same smoke with `chat_enabled=false` yields a Fly app with no `services`, no listener; behaviour byte-equivalent to M4.

### Phase 4 — Corellia-side `agents.ChatWithAgent` domain method + `Secret` lookup (Go-only)

**Goal:** A typed Go method that takes an `AgentInstanceID` + a chat message, looks up the bearer token, calls the sidecar, returns the response.

**Files modified:**
- `backend/internal/agents/service.go` — new `ChatWithAgent(ctx, agentInstanceID, sessionID, message) (response string, err error)`. Loads the instance, loads the bearer-token secret via the existing `Secret` table lookup, constructs the URL from `deploy_external_ref`, makes an HTTP `POST` with `Authorization: Bearer <token>`, returns the response. Sentinel errors: `agents.ErrChatDisabled` (instance has `chat_enabled=false`), `agents.ErrChatUnreachable` (HTTP error from sidecar), `agents.ErrChatAuth` (sidecar returned 401 — implies secret-store drift).
- `backend/internal/agents/service_test.go` — table-driven tests with a `chatTransport` interface stub (so the HTTP call is fakeable); tests cover the three sentinels and the happy path.

**Exit gate:** `go test ./internal/agents -run TestChat` clean. Local `cmd/smoke-deploy` end-to-end: spawn chat-enabled agent → call `ChatWithAgent` directly from a one-off Go binary → assert non-empty response.

### Phase 5 — `ChatWithAgent` Connect RPC + handler + FE chat panel

**Goal:** End-to-end from the browser.

**Files modified:**
- `shared/proto/corellia/v1/agents.proto` — new `rpc ChatWithAgent(ChatWithAgentRequest) returns (ChatWithAgentResponse);` with `{instance_id, session_id, message}` → `{content}`. `pnpm proto:generate` regenerates both Go + TS.
- `backend/internal/httpsrv/handlers.go` (or equivalent) — new handler, <30 lines per stack.md §11.9: parse → call `agents.ChatWithAgent` → marshal → return. Sentinel-to-Connect-error mapping in `agentsErrToConnect`: `ErrChatDisabled` → `FailedPrecondition`, `ErrChatUnreachable` → `Unavailable`, `ErrChatAuth` → `Internal` (this is a Corellia-side bug, never the user's).
- `frontend/src/components/agents/chat-panel.tsx` (new) — chat panel with message list + input. `session_id` is a UUID stored in `sessionStorage` keyed by instance id (per-instance, per-tab, persisted across reloads in the same tab; cleared on tab close). Posts to `api.agents.chatWithAgent({...})`.
- `frontend/src/app/(app)/fleet/[id]/page.tsx` (new — assumes M5 ships an instance-detail page; if not, this plan adds it) — renders `<ChatPanel>` for chat-enabled instances; renders an `[ enable chat → ]` affordance for chat-disabled ones (clicking it goes to a deploy-config edit flow that M5 ships).
- `frontend/src/components/spawn/wizard.tsx` Step 4 — gains the `chat_enabled` checkbox (default-on, label "Enable chat"). The two new fields land alongside M5's region/size/volume/replicas inputs.

**Exit gate:** `pnpm -C frontend type-check && pnpm -C frontend lint` clean. Manual: spawn agent via wizard with chat enabled → land on fleet view → click into instance → chat with agent → see response. Same flow with chat-disabled → no chat panel, "enable chat" affordance instead.

### Phase 6 — `Health()` switches to HTTP probe for chat-enabled instances

**Goal:** Tighten the health signal.

**Files modified:**
- `backend/internal/deploy/fly.go` — `Health()` reads `agent_instances.chat_enabled` (passed in via the existing call site in `agents.Service`). When true: HTTP GET `/health` with the bearer token, return `Healthy` on 200, `Unhealthy` otherwise. When false: existing machine-state poll.
- `backend/internal/agents/service.go` — `getInstanceHealth` (or equivalent) passes the `chat_enabled` bool through.
- `backend/internal/deploy/fly_test.go` — table-driven cases for both branches.

**Exit gate:** `go test ./internal/deploy ./internal/agents` clean. Manual: spawn chat-enabled agent, kill `hermes` inside the container via `fly ssh console -C 'pkill hermes'`, observe Corellia's fleet view flip the agent to `unhealthy` within the next poll interval (sidecar returns 200 on `/health` only when `hermes` is responsive — Phase 1's `/health` impl pings `AIAgent.health()` or equivalent before returning).

### Phase 7 — Adapter image rebuild + GHCR push + migration to bump `adapter_image_ref` + integration smoke

**Goal:** The new adapter image is the deployed artefact.

**Operator-collaboration step:** `docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/kaminocorp/hermes-adapter:<new-tag> --push adapters/hermes`. New manifest-list digest captured.

**Files modified:**
- `backend/migrations/<next>_bump_hermes_adapter_for_chat.sql` — `UPDATE harness_adapters SET adapter_image_ref = '<new-digest>' WHERE harness_name = 'hermes';`. No change to `upstream_image_digest` (we're not bumping upstream — same `sha256:d4ee57f2…`).
- `adapters/hermes/README.md` — Pinning section updated to reference the new adapter digest. Smoke section updated to use the new image.
- `docs/changelog.md` — `0.10.0` entry covering Phases 1–7. Minor version (not patch): new product surface (chat in the FE), new RPC (`ChatWithAgent`), new schema column (`chat_enabled`), new adapter image, new env vars.

**Exit gate:** `goose -dir backend/migrations postgres "$DATABASE_URL_DIRECT" up` clean. Re-run `cmd/smoke-deploy` end-to-end with the BE pointing at prod DB, FE on local `pnpm dev`, spawn a chat-enabled agent, chat with it from the browser, destroy the agent, confirm Fly app is gone. M5's other flows (region change, resize, etc.) untouched.

---

## 5. Out-of-scope clarifications (anti-scope-creep)

- **Streaming chat (SSE / WebSocket).** v1.6 — proto leaves the streaming RPC method name unreserved.
- **Multi-user chat ACLs / per-message audit.** Audit pillar of the post-v1.5 roadmap.
- **`POST /tools/invoke` implementation.** Sidecar route returns 501; Corellia-side proxy + UI is post-v1.5 (couples to the Tools pillar of `governance-capabilities.md` §2 — execution plan: `docs/executing/tools-governance.md`).
- **Cross-harness chat.** OpenClaw / Claude Agent SDK / DeepAgents are `locked` in the spawn roster; their sidecars land when the harnesses do.
- **Sidecar-as-product.** Operators don't author or upload sidecars; the chat sidecar is part of the Corellia-shipped adapter image. User-defined sidecars are a v2+ concern.
- **Per-message rate limiting / cost guards.** Whatever Fly's edge proxy enforces. Per-agent budget controls land with the v1.5 model-gateway pillar (or after).
- **Chat history surfacing in Corellia's UI.** v1 of the chat panel shows the in-tab conversation only. Hermes's SQLite has the full history; surfacing it in the UI requires a new RPC and is a v1.6 follow-up.

---

## 6. Risk register

| # | Risk | Mitigation | Detection signal |
|---|---|---|---|
| 1 | **`AIAgent` is unsafe to reuse across turns** (state corruption, leaked file handles) | Pre-work check item 1 verifies. Fallback: per-request instantiation (decision 2) — strictly worse latency, still works | Phase 1 smoke shows hangs / crashes after the second turn in a session |
| 2 | **Upstream Hermes ships an `AIAgent` API change in v0.12.0** that breaks our import | Sidecar's `requirements.txt` doesn't pin `hermes-agent` itself (it's the base image). Upstream digest bumps go through the existing migration runbook in `adapters/hermes/README.md`; the sidecar gets re-tested against the new digest before the migration applies | Phase 7's integration smoke fails after a future digest bump |
| 3 | **Per-instance bearer token leaks via Fly logs / error messages** | Sidecar redacts `Authorization` from any log line. Corellia BE's `agentsErrToConnect` redacts the token from `ErrChatUnreachable` messages (same posture as M4 decision 25's Fly-API-error redaction) | Code review on Phase 1 + Phase 4 |
| 4 | **`CORELLIA_CHAT_ENABLED=false` agents accidentally start the sidecar anyway** because of a typo in the env-var check in `entrypoint.sh` | Phase 2's exit gate explicitly tests both branches. Default-deny on the `entrypoint.sh` check (any value other than literal `true` skips the sidecar) | Operator notices a chat-disabled agent has port 443 open |
| 5 | **Sidecar's `dict[session_id, AIAgent]` grows unbounded** (memory leak) | LRU cap (`functools.lru_cache` style) at 100 sessions per machine. On eviction, the `AIAgent` is GC'd; next request for that session id reconstructs from SQLite. Hermes's SQLite is the durable store; the in-memory dict is a perf cache | Sidecar OOM under sustained chat load — caught in Phase 1 smoke if we add a soak test |
| 6 | **Chat enabled on a non-chat-capable harness in v2** (when OpenClaw etc. arrive without their sidecars yet) | Spawn wizard's Step 4 reads `harness_adapters.supports_chat` (new column, default `FALSE`, `TRUE` for hermes seeded by the Phase 7 migration). Checkbox is hidden when `supports_chat=false` | Operator sees a chat checkbox for a harness that can't chat |
| 7 | **Health probe failures during Hermes's slow startup** falsely flip agents to `unhealthy` | `Health()` HTTP probe has a 30s warmup grace period after the machine reports `started` (matches the existing M4 pattern for the machine-state poll). Sidecar's `/health` returns `{ok: false, hermes: "starting"}` before Hermes is ready, distinct from `{ok: true, hermes: "ready"}` | Fleet view shows newly-spawned agents in `unhealthy` for 30+ seconds |

---

## 7. Open questions — to resolve before Phase 1

1. **Chat panel placement** — does the chat panel live on a new `/fleet/[id]` instance-detail page (which M5 may or may not ship), or on `/spawn/[templateId]`'s post-deploy success state, or both? Probably the instance-detail page; confirm with operator before Phase 5.
2. **Should the `Enable chat` checkbox in the wizard default to on or off?** Plan currently says default-on. Default-off is more conservative (chat is opt-in) but adds friction to the demo path. Operator call.
3. **Streaming readiness** — even though v1 is unary, should the FE chat component be authored with streaming-shaped state (so the v1.6 swap is a transport change, not a UI rewrite)? Probably yes; cheap to do early.
4. **Session-id lifecycle** — `sessionStorage`-keyed-per-tab is the plan. Should we also surface a "start new conversation" button that resets the session id? Probably yes.
5. **Hermes session deletion** — when an instance is destroyed, the volume goes with it (per M5 decision 8.5), so SQLite sessions die naturally. When chat is *toggled off* on a running instance, do we keep the SQLite (for re-enabling) or wipe it (privacy)? Probably keep, with a separate "wipe history" affordance.

---

## 8. Definition of done

- [ ] Chat-enabled agent spawned via the FE wizard exposes `https://<app>.fly.dev/chat` reachable only with the per-instance bearer token
- [ ] Operator can chat with the agent from the Corellia FE; multi-turn conversations thread correctly via `session_id`
- [ ] Chat-disabled agent has byte-equivalent runtime to a pre-this-milestone agent (no sidecar, no `services`, no listener)
- [ ] Toggling chat on a running agent (M5 deploy-config edit flow) works; brief restart, ~5s downtime, no data loss
- [ ] `Health()` HTTP probe replaces machine-state probe for chat-enabled instances; chat-disabled instances unchanged
- [ ] Per-instance bearer token never appears in logs, error messages, or any client-visible surface
- [ ] `cd backend && go vet ./... && go test ./...` clean; `pnpm -C frontend type-check && pnpm -C frontend lint && pnpm -C frontend build` clean
- [ ] Adapter image rebuilt, pushed to GHCR, `harness_adapters.adapter_image_ref` migrated; smoke proves end-to-end
- [ ] `docs/changelog.md` 0.10.0 entry filed; `adapters/hermes/README.md` pinning + smoke sections updated to the new digest; `docs/blueprints/adapter-image-blueprint.md` (lines 90, 420, 570), `docs/refs/fly-commands.md` (line 216), and `adapters/hermes/smoke.sh` (line 12) reconciled to match the post-sidecar reality (these were left alone by 0.9.5 specifically so this milestone could clean them up in one pass)
