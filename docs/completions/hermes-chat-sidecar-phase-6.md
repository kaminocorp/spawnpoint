# M-chat Hermes Chat Sidecar — Phase 6 completion notes

**Plan:** `docs/executing/hermes-chat-sidecar.md` §4 Phase 6.
**Date:** 2026-04-27.
**Scope:** Go backend only (deploy + agents packages) + sqlc regeneration + minor FE card badge. No proto change, no FE RPC change, no Fly push, no adapter image rebuild.

---

## What shipped

### `backend/internal/deploy/target.go`

- **`HealthHTTPClient` interface** — `Do(*http.Request) (*http.Response, error)`. Defined in the `deploy` package so `FlyDeployTarget` can hold it without importing `agents` — no import cycle. `*http.Client` satisfies it out of the box.
- **`DeployTarget.Health()` signature widened** to `Health(ctx context.Context, externalRef string, chatEnabled bool) (HealthStatus, error)`. Added `net/http` to imports.

### `backend/internal/deploy/fly.go`

- **`FlyDeployTarget` struct** gains `healthHTTP HealthHTTPClient` field.
- **`NewFlyDeployTarget`** sets `healthHTTP: &http.Client{Timeout: 10 * time.Second}` — bounded production client. 10s timeout is short enough to detect a non-responsive machine within a single `pollInterval` window (2s ticker, 10s HTTP timeout).
- **`Health()` implementation** refactored into three functions:
  - `Health(ctx, externalRef, chatEnabled bool)` — dispatcher: routes to `httpHealthProbe` or `machineStateHealth` based on `chatEnabled`.
  - `machineStateHealth(ctx, externalRef)` — the pre-M-chat Fly machine-state poll, extracted verbatim into its own method. Chat-disabled agents use this path; behavior is byte-equivalent to the pre-Phase-6 `Health()`.
  - `httpHealthProbe(ctx, externalRef)` — GET `https://<app>.fly.dev/health` (unauthenticated; the sidecar exempts `/health` from bearer auth per Phase 1's design). Response semantics:
    - Transport error → `HealthUnknown, nil` (keep polling; machine may still be starting)
    - Non-200 → `HealthFailed, nil`
    - 200 + `{"ok": true}` → `HealthStarted, nil`
    - 200 + `{"ok": false}` → `HealthStarting, nil` (hermes still booting; plan risk 7 grace period)
    - JSON parse failure → `HealthFailed, nil`
  - Added `encoding/json`, `io`, `net/http` to fly.go imports.

### `backend/internal/deploy/stubs.go`

- `LocalDeployTarget.Health()` and `AWSDeployTarget.Health()` signatures widened to `Health(ctx, externalRef, chatEnabled bool)`. Bodies unchanged — both return `(HealthUnknown, ErrNotImplemented)` per blueprint §11.4.

### `backend/internal/agents/service.go`

- **`pollHealth` signature** widened: `pollHealth(instanceID uuid.UUID, target deploy.DeployTarget, externalRef string, chatEnabled bool)`. The `probe` closure forwards `chatEnabled` to `target.Health(probeCtx, externalRef, chatEnabled)`.
- **`Spawn` call site** updated: `go s.pollHealth(instance.ID, deployer, result.ExternalRef, cfg.ChatEnabled)`.
- **`toProtoInstanceListRow`** gains `ChatEnabled: r.ChatEnabled` (now available after `ListAgentInstancesByOrgRow` was widened).

### `backend/internal/agents/fleet.go`

Six `pollHealth` call sites updated to pass `row.ChatEnabled` as the fourth argument. `row` is `db.GetAgentInstanceByIDRow` at all six sites, which has carried `ChatEnabled bool` since Phase 3's sqlc widening.

### `backend/cmd/smoke-deploy/main.go`

`target.Health(ctx, res.ExternalRef)` → `target.Health(ctx, res.ExternalRef, false)`. Smoke-deploy spawns chat-disabled agents; passing `false` preserves the existing machine-state poll behavior.

### `backend/internal/agents/service_test.go`

`fakeDeployTarget.Health` signature updated to `Health(_ context.Context, _ string, _ bool)`.

### `backend/queries/agent_instances.sql` + sqlc regen

`ListAgentInstancesByOrg` gains `ai.chat_enabled` in its SELECT projection. `sqlc generate` regenerated `internal/db/agent_instances.sql.go` and `internal/db/models.go` cleanly: `ListAgentInstancesByOrgRow.ChatEnabled bool` is now present and scanned.

### `backend/internal/deploy/fly_test.go`

Six new tests + an `httpClientFake` helper:

- **`httpClientFake`** — `HealthHTTPClient` fake; returns canned `(*http.Response, error)` pairs.
- **`fakeHTTPResp(status, body)`** — constructs a minimal `*http.Response` with `io.NopCloser(strings.NewReader(body))`.
- **`TestHealth_ChatDisabled_MachineStatePoll`** — 4 sub-cases (started / starting / failed / no machines); verifies the pre-M-chat path is unchanged when `chatEnabled=false`. `healthHTTP` is nil for all sub-cases — the machine-state path must not touch it.
- **`TestHealth_ChatEnabled_HttpOkTrue`** — `{"ok":true}` → `HealthStarted`.
- **`TestHealth_ChatEnabled_HttpOkFalse`** — `{"ok":false}` → `HealthStarting` (hermes still booting).
- **`TestHealth_ChatEnabled_Non200`** — 503 → `HealthFailed`.
- **`TestHealth_ChatEnabled_TransportError`** — TCP error → `HealthUnknown`, nil (keep polling).
- **`TestHealth_ChatEnabled_BadExternalRef`** — parse failure before HTTP call; `healthHTTP` is nil (must not be reached).

### Frontend — `agent-card.tsx`

Gallery cards now show a small `chat` badge (hairline border, `feature-adapter` palette tint, 9px mono) in the card header when `instance.chatEnabled` is true. This was the Phase 5 completion note's "Phase 6 scope: fleet gallery `chat_enabled` badge." The badge appears on the list path now that `ListAgentInstancesByOrg` returns `chat_enabled`.

### Frontend — `deployment-inspector.tsx`

Updated the `deploymentValuesFromInstance` comment: the `?? true` guard is now described as a TS strictness guard rather than a "Phase 6 pending" note, since the list query now carries the real value.

---

## How it diverged from the plan

### 1. Machine-state poll extracted into `machineStateHealth`, not inlined in `Health()`

Plan §4 Phase 6 says "`Health()` reads `chat_enabled`... When true: HTTP probe. When false: existing machine-state poll." The "inline" interpretation would put the branch inside the original `Health()` body. I extracted the machine-state logic into a named `machineStateHealth` method instead:

- The original body was 30+ LOC with the Fly-list loop and the `any()` helper; keeping it inline would make `Health()` ≥60 LOC.
- Named helpers are individually testable — `machineStateHealth` is exercised by `TestHealth_ChatDisabled_MachineStatePoll`, `httpHealthProbe` by the chat-enabled suite.
- Pattern is consistent with the Phase 4 `chatURL` / `chatSidecarServices` extraction philosophy.

### 2. `/health` probe is unauthenticated (plan text says "with the bearer token")

Plan §4 Phase 6 says "HTTP GET `/health` with the bearer token." The Phase 1 sidecar explicitly exempts `/health` from bearer auth: "deliberately unauthenticated (Fly health probes run without the token; an authenticated `/health` would either expose the token to Fly's edge or cause every probe to 401)." The HTTP probe therefore sends no `Authorization` header. The plan text appears to reference the bearer token as context for why Corellia can probe the sidecar in general, not as a requirement to send it on `/health` specifically.

### 3. `healthHTTP` is a field (not a constructor option)

Phase 4 used `ServiceOption` / `WithChatHTTPClient` for the agents service. For `FlyDeployTarget`, tests already construct the struct directly via `newFlyTargetForTest`, so a functional option would be consumed only in `NewFlyDeployTarget` (production) — no test benefit from the added indirection. Setting the field directly in `newFlyTargetForTest` is the simpler shape. `DefaultHealthHTTPClient` (originally drafted) was dropped in favor of the explicit `&http.Client{Timeout: 10 * time.Second}` literal in `NewFlyDeployTarget` — one fewer exported name, no behavioral difference.

---

## What I deliberately did NOT do

- **Did not implement the "requires respawn" warning in the inspector's `ChatEnabledField`.** Phase 5 completion notes flagged this as Phase 6 scope, but it requires knowing whether toggling `chat_enabled` forces a services-block change that `mergeMachineConfig` can't apply live. Since `UpdateAgentDeployConfig` doesn't yet toggle the services block, adding a gate in the inspector without a working backend path would be a "non-functional button" (blueprint §11.4 violation in spirit). Deferred to when `mergeMachineConfig` grows the services-block toggle.
- **Did not implement the `Health()` HTTP probe for the UpdateDeployConfig live-update path.** After a live `Update()` call (e.g., size change), the machine restarts and `pollHealth` fires again. For chat-enabled agents, `pollHealth` now correctly uses the HTTP probe via `row.ChatEnabled`. The inspector's respawn path (`respawnAgent`) similarly passes `row.ChatEnabled` to the fresh poll.
- **Did not update `Hermes-readiness gate in /health` (plan Phase 2 "known pending work").** The sidecar's `/health` currently answers immediately on sidecar startup (`{ok: true, hermes: "ready"}`) without actually probing whether Hermes is responsive. Phase 2's known pending item says this is Phase 6's concern. Since implementing it requires changing sidecar source and rebuilding the adapter image (Phase 7 job), the Phase 6 backend probe correctly interprets `{ok: false}` as "starting" and `{ok: true}` as "ready" — the distinction is semantically correct once Phase 7 ships the updated sidecar that actually pings Hermes before returning `ok: true`.

---

## Validation gates met

- `cd backend && go vet ./...` clean.
- `cd backend && go build ./...` clean.
- `cd backend && go test ./...` — all packages green. Six new tests in `deploy`, one signature fix in `agents`.
- `sqlc generate` clean; `ListAgentInstancesByOrgRow.ChatEnabled bool` present in generated code.
- `pnpm -C frontend type-check` clean.
- `pnpm -C frontend lint` clean.

---

## Validation gates owed (operator)

Phase 6's hard exit gate per plan §4:

```
1. Spawn a chat-enabled agent (wizard, "Enable chat" checked).
2. Once running, kill hermes inside the container:
     fly ssh console -a corellia-agent-<uuid> -C 'pkill -f hermes'
3. Within the next Corellia health-poll interval (~2s), the fleet view
   should flip the agent to "unhealthy" / failed.
   (The sidecar stays up but returns {ok: false} → HealthStarting →
    the poll continues; if hermes doesn't restart, the machine
    eventually reports "stopped" and the machine-state fallback kicks in.)

Note: This gate requires Phase 7's sidecar-capable adapter image
to be the live image. Against the pre-Phase-7 image (no sidecar),
the HTTP probe will get a transport error (no listener on :8642/
no :443 exposure) → HealthUnknown → pollHealth keeps ticking until
the machine-state path eventually returns HealthStarted.
```

---

## Next phase entry checkpoint

Phase 7 is the **adapter image rebuild + GHCR push + migration to bump `adapter_image_ref` + integration smoke**. All backend + frontend work for M-chat is now complete:

- Phase 3: schema (`chat_enabled` column) + spawn plumbing (sidecar token, env vars, services block)
- Phase 4: `ChatWithAgent` domain method + Fly secret read
- Phase 5: Connect RPC + handler + FE chat panel + fleet detail page + wizard checkbox
- Phase 6: `Health()` HTTP probe for chat-enabled instances + list query widened + fleet badge

Phase 7 is operator-collaboration: `docker buildx build && docker push` + `goose up` + end-to-end smoke proving the full Phases 1–7 stack works against a real Fly agent with the sidecar running.
