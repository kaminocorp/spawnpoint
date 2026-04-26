# M-chat Hermes Chat Sidecar — Phase 3 completion notes

**Plan:** `docs/executing/hermes-chat-sidecar.md` §4 Phase 3.
**Date:** 2026-04-27.
**Scope:** Backend (Go + SQL) only. The deploy-target machine config and the agents-service spawn flow now both honour `cfg.ChatEnabled`. No proto change, no FE change, no Fly push, no adapter image rebuild.

---

## What shipped

One new migration, two query edits, sqlc regeneration of three files, three Go source edits, and four new tests. Everything additive against M5 — chat-disabled spawns are byte-equivalent to the M5 wire shape.

### New files

- **`backend/migrations/20260427120000_chat_enabled.sql`** — single-column ADD on `agent_instances`: `chat_enabled BOOLEAN NOT NULL DEFAULT TRUE`. The DEFAULT TRUE choice matches plan decision 6 literally (deviation discussion in §"Plan deviations" below). `+goose Down` drops the column. No CHECK constraint — BOOLEAN's domain is its own constraint.

### Modified files

- **`backend/queries/agent_instances.sql`** — two surgical edits:
  - `InsertAgentInstance` widened from 8 to 9 columns; `chat_enabled` is now an explicit param ($9). Mirrors the M5 nine-deploy-config posture: DB DEFAULTs exist as a fallback, but every BE-driven spawn carries an explicit value through SpawnInput → DeployConfig → InsertAgentInstanceParams.
  - `GetAgentInstanceByID` projection grows by one field (`ai.chat_enabled`). Phase 4's `ChatWithAgent` will read this to surface `ErrChatDisabled` (Connect `FailedPrecondition`) when callers try to chat with an explicitly-disabled instance; Phase 6's `Health()` HTTP-probe switch reads it to decide between machine-state and HTTP probing. `ListAgentInstancesByOrg` is left untouched — Phase 5/6 widens it when the FE row card needs the field.
- **sqlc regeneration** — `internal/db/models.go`, `internal/db/agent_instances.sql.go`, `internal/db/querier.go`. `db.AgentInstance.ChatEnabled bool`, `db.InsertAgentInstanceParams.ChatEnabled bool`, `db.GetAgentInstanceByIDRow.ChatEnabled bool`. The `Querier` interface gains the widened `InsertAgentInstance` signature (one new struct field — same method name). Generated code is checked in per blueprint §11.7.
- **`backend/internal/deploy/types.go`** — `DeployConfig.ChatEnabled bool` added with a 23-line block comment explaining the runtime fan-out (services block, env vars, audit secret) and the deliberate no-WithDefaults treatment. Plan decision 6's "DEFAULT TRUE" semantics live at the migration layer; Go-side default is the zero `false`, and the wire/handler layer is the eventual source of truth (Phase 5).
- **`backend/internal/deploy/fly.go`**:
  - Two new package constants (`chatSidecarInternalPort = 8642`, `chatSidecarExternalPort = 443`) with comments anchoring them to blueprint §3.1 and plan decisions 4/12.
  - `machineConfigFor` widened: when `cfg.ChatEnabled` is true, the returned `*fly.MachineConfig` carries a single-element `Services` slice. Otherwise `Services` is nil (byte-equivalent to the M5 shape).
  - New helper `chatSidecarServices()` — returns the canonical `[]fly.MachineService{{Protocol: "tcp", InternalPort: 8642, Ports: [{Port: &443, Handlers: ["http", "tls"]}]}}` shape per plan decision 4. Lifted into its own helper rather than inlined so Phase 5+'s "toggle chat on a running agent" Update path can call it directly without duplicating the port + handler set.
- **`backend/internal/agents/service.go`**:
  - New imports: `crypto/rand`, `encoding/base64` for token generation.
  - Four new package constants: `envKeyChatEnabled`, `envKeySidecarAuthToken`, `chatEnabledEnvValueTrue`, `chatSidecarTokenBytes`. Pinned in `service.go` so the agents service is the single grep target for "what env vars does the chat sidecar consume?" — same posture as the existing `CORELLIA_MODEL_API_KEY` literal in the spec.Env map.
  - New helper `generateChatSidecarToken()` — 32 bytes from `crypto/rand` → 43-char `base64.RawURLEncoding`. Errors only on `rand.Read` failure, which is a system-state error and bubbles up as a spawn error (no half-spawned-without-token fallback).
  - `Spawn` flow widened in three places, all gated on `cfg.ChatEnabled`:
    1. **Pre-tx**: token generation. Must succeed before any DB write so the audit row inside the tx and the env-var injection outside the tx reference the same value.
    2. **Inside tx**: a second `InsertSecret` row writes the chat-token audit (key `CORELLIA_SIDECAR_AUTH_TOKEN`, opaque `storage_ref` of shape `<deploy-kind>:<instance-uuid>:CORELLIA_SIDECAR_AUTH_TOKEN`). Atomic with the model-key audit row and the instance insert — a tx rollback un-records all three together.
    3. **Outside tx**: the spec.Env map (rebuilt from a local `env` map literal) gets `CORELLIA_CHAT_ENABLED=true` and `CORELLIA_SIDECAR_AUTH_TOKEN=<token>` keys when chat is on. `FlyDeployTarget.Spawn`'s existing `for k, v := range spec.Env { f.flaps.SetAppSecret... }` loop persists them as Fly app secrets exactly the same way `CORELLIA_MODEL_API_KEY` is persisted today — no fly.go change needed for the env-var path.
  - `InsertAgentInstanceParams` call site gains `ChatEnabled: cfg.ChatEnabled` so the new column is written explicitly per the widened query.
- **`backend/internal/deploy/fly_test.go`** — two new tests (`TestMachineConfigFor_ChatDisabledOmitsServices`, `TestMachineConfigFor_ChatEnabledEmitsExactlyOneService`). The chat-enabled test asserts the full services-block shape: `Protocol == "tcp"`, `InternalPort == 8642`, exactly one `Ports` entry with `Port == 443` and both `"http"` + `"tls"` handlers.
- **`backend/internal/agents/service_test.go`** — two new tests (`TestSpawn_ChatEnabled_PlumbsTokenAndSecrets`, `TestSpawn_ChatDisabled_OmitsChatPlumbing`). Together they assert the full Phase 3 BE-side fan-out: chat-enabled spawn inserts 2 secret rows (model key + chat token); chat-disabled inserts 1; chat-enabled spec.Env carries both `CORELLIA_CHAT_ENABLED="true"` and a 43-char base64-RawURL `CORELLIA_SIDECAR_AUTH_TOKEN` that decodes to exactly 32 bytes; chat-disabled spec.Env carries neither key.

`git diff --stat backend/`: `+318 -15` across 9 files. `git status --short backend/`: 8 modified Go/SQL files + 1 new migration.

---

## How it diverged from the plan

Three deviations, each flagged at the moment of choice:

### 1. DEFAULT TRUE migration — followed plan literally despite a backfill consistency tension

Plan decision 6 states `chat_enabled BOOLEAN NOT NULL DEFAULT TRUE`. I followed it literally. The trade-off: existing M4/M5-era rows backfill to `TRUE` on this migration's UP, but their *deployed adapter image* is the pre-Phase-7 digest with no sidecar — so `ChatWithAgent` calls (Phase 4) would return `ErrChatUnreachable` (Connect `Unavailable`) until the operator destroy-and-respawns those agents to pick up the post-Phase-7 sidecar-capable digest.

Considered alternative: `DEFAULT FALSE`, which would keep existing rows in their pre-existing operational state ("no chat configured"). Rejected because:
1. Plan decision 6 is unambiguous — the author wrote DEFAULT TRUE explicitly.
2. The "wrong" state is observable, not destructive: operators see "chat unreachable" in the fleet view UI and respawn (which they'd be doing anyway per blueprint §5's "rolled forward explicitly" semantics).
3. v1.5's user-facing default is chat-on; the migration default now matches the eventual final-state intent.

The migration's `+goose Up` block carries a 30-line comment explaining the consistency window in detail so a future contributor reading the schema cold understands why DEFAULT TRUE coexists with BE-side explicit `false` writes during the Phase 3-to-Phase 5 gap.

### 2. `GetAgentInstanceByID` widened in Phase 3 (one phase early)

Plan §4 Phase 3's `Files modified` list covers types.go / fly.go / stubs.go / migration / queries (InsertAgentInstance only) / sqlc. It doesn't explicitly call out widening `GetAgentInstanceByID`. I widened it in this phase anyway because:
1. Phase 4's `ChatWithAgent` needs to read `chat_enabled` to surface `ErrChatDisabled`.
2. Phase 6's `Health()` HTTP-probe branch needs it too.
3. Both Phase 4 and Phase 6 are read-only consumers; landing the read-side projection in Phase 3 saves a Phase-4 sqlc churn and keeps Phase 4 a pure service-layer landing.

The widening is strictly additive (one column added to the SELECT projection, one field added to the sqlc-generated `GetAgentInstanceByIDRow`), no caller has to change because the M5 helpers (`deployConfigFromInstance`, `applyDeployConfigToInstance`) don't touch the new field.

### 3. `LocalDeployTarget` / `AWSDeployTarget` stubs needed no edit

Plan §4 Phase 3 says "stubs.go — `LocalDeployTarget` + `AWSDeployTarget` updated to accept the new field (no-op, they're `NotImplemented`)." But adding a field to `DeployConfig` is a *struct widening*, not a method-signature change — every method on the stubs already takes `DeployConfig` as an opaque value, so no signature edit is needed. The stubs continue to return `ErrNotImplemented` for every method without recompilation pressure. Plan's "updated to accept the new field" prose was likely speculative about an alternative shape (e.g., `DeployConfig.WithChat()` builder or a separate `Spawn(spec, cfg, chatEnabled bool)` arg), neither of which the implementation chose.

The shipped shape is strictly cleaner — the stubs file gets zero changes, the chat plumbing flows through the typed-struct field as a normal `DeployConfig` member.

---

## What I deliberately did NOT do

- **Did not widen `UpdateAgentDeployConfig` to include `chat_enabled`.** Plan §1 ("Toggling chat on a running agent (M5 deploy-config edit flow) works") implies this widening lands at some point, but Phase 3 is the *spawn-side* plumbing. Phase 5/7 is what wires the wizard + inspector toggle that calls `UpdateDeployConfig` with a flipped `ChatEnabled`. Widening Phase 3-side would be premature: no caller would exercise the new column, and the existing M5 `mergeMachineConfig` doesn't yet know how to add/remove `Services` on a running machine (services-block toggling is a Phase 5+ concern that needs a real Update-path implementation, not just a SQL surface).
- **Did not add `chat_enabled` to the bulk-update path.** Same rationale plus decision 8.4's "bulk-extending across a fleet creates surprise cost" applies analogously — bulk-toggling chat is the kind of fleet-wide change that's rarely the right action, and the per-instance UpdateAgentDeployConfig path (when it lands in Phase 5+) is the power-user surface.
- **Did not implement Phase 6's `Health()` HTTP-probe switch.** That's plan §4 Phase 6's job. Phase 3 only enables the *spawn* of chat-capable agents; the deployed sidecar's `/health` route is reachable today (once Phase 7 ships the new image) but `Health()` still polls Fly machine state.
- **Did not modify the `cmd/smoke-deploy` binary.** The plan §4 Phase 3 exit gate references it for an end-to-end check; the smoke-deploy CLI continues to spawn with the M5 default `DeployConfig{ChatEnabled: false}`, so its current behaviour is unchanged. An operator wanting a chat-enabled smoke would need to toggle a flag — out of Phase 3's source-only scope.
- **Did not run the migration against the dev DB.** Same posture as M5 Phase 1: the IPv6-only Direct Connection isn't reachable from the current shell; sqlc codegen doesn't need DB connectivity (it parses migration files locally per `sqlc.yaml`'s `schema: "migrations"`), so the regenerated tree is green without it. Operator owes the `goose up` / `down` / `up` round-trip against dev DB before Phase 4 starts.
- **Did not modify `mergeMachineConfig`.** Phase 3's spawn path emits the services block; the Update path's mergeMachineConfig still preserves `current.Services` from the live machine. This means a chat-disabled agent who later toggles to chat-enabled (Phase 5+) would NOT get a services block injected via Update — it would need a destroy+respawn. Documented here as a known Phase 5+ follow-up; not a Phase 3 bug.
- **Did not redact the bearer token in any log output.** The token is generated and held in a local string variable, written to the spec.Env map, and never logged from the service layer. The Fly secret-set path inside `FlyDeployTarget.Spawn` doesn't log values either (existing M4 posture). Phase 4's `ChatWithAgent` will need to attach the token to the proxied request — that's where redaction earns its place if/when the handler-layer error formatter chooses to surface request details.

---

## Validation gates met

- `cd backend && go vet ./...` clean.
- `cd backend && go build ./...` clean.
- `cd backend && go test ./internal/deploy ./internal/agents` — two packages green, including the four new tests.
- `cd backend && go test ./...` — every package green (ok at `agents`, `deploy`, `httpsrv`, `users`).
- `sqlc generate` clean (no errors, no warnings).
- Generated diff exactly: `db.AgentInstance` gains `ChatEnabled bool`; `InsertAgentInstanceParams` gains `ChatEnabled bool`; `GetAgentInstanceByIDRow` gains `ChatEnabled bool`; `Querier` interface signature unchanged (the method signature for `InsertAgentInstance` is keyed on the *struct* arg, which is widened in place). No spurious changes to other generated files.
- New tests pass:
  - `TestMachineConfigFor_ChatDisabledOmitsServices` ✓
  - `TestMachineConfigFor_ChatEnabledEmitsExactlyOneService` ✓
  - `TestSpawn_ChatEnabled_PlumbsTokenAndSecrets` ✓
  - `TestSpawn_ChatDisabled_OmitsChatPlumbing` ✓

---

## Validation gates owed (operator)

- **`goose up` against dev DB** — expects new migration to apply, every existing M4/M5 `agent_instances` row gains `chat_enabled = TRUE`, no errors.
- **`goose down` against dev DB** — expects column dropped cleanly.
- **`goose up` again** — idempotent re-up to confirm down really cleared state.
- **Local `cmd/smoke-deploy` end-to-end** (per plan §4 Phase 3 exit gate). Modify the smoke binary to take a `--chat` flag (or hard-code `ChatEnabled: true` in a one-off branch), spawn against the operator's Fly account using the post-Phase-2 adapter image (locally-built, not yet GHCR-pushed; Phase 7's job), then `curl https://corellia-agent-<uuid>.fly.dev/health` (no auth — sidecar exempts /health) and a chat round-trip with the bearer token (read from the operator's Fly secrets surface via `flyctl secrets list` for the test app). Same smoke with `ChatEnabled: false` should yield a Fly app with no `services`, no listener on `:443`, behaviour byte-equivalent to M4.

The operator-side smoke is what proves the end-to-end claim "spawning a chat-enabled agent emits the right Fly machine config" against a real Fly account; the unit tests prove the same claim at the `machineConfigFor` boundary.

---

## Design rationale worth keeping

- **Token generation outside the tx, audit row inside the tx.** The token is a local `string` variable held across the tx boundary. If the tx rolls back (e.g., constraint failure on `InsertSecret`), the token never reaches Fly's app-secrets store — the only place it would have been written. There's no "garbage token" cleanup needed because the token itself is a 32-byte random string with no external footprint until the post-tx `deployer.Spawn` call sets it as a Fly secret. If `crypto/rand.Read` itself fails (a vanishingly rare system-state error), the function returns before any DB write, so the spawn aborts cleanly with no audit row to clean up.
- **Single `for k, v := range spec.Env` loop in `FlyDeployTarget.Spawn` reused for all three env types.** Both `CORELLIA_MODEL_API_KEY` (M4) and `CORELLIA_SIDECAR_AUTH_TOKEN` (M-chat) are written to Fly's per-app secret store; `CORELLIA_CHAT_ENABLED` is non-secret config (literal `"true"`). The existing iteration loop treats them all uniformly as Fly app secrets. Why is that fine for the non-secret one? Because Fly app secrets are injected into the machine as env vars at boot, exactly the surface the entrypoint script reads. Putting `CORELLIA_CHAT_ENABLED` through Fly's secret store is functionally equivalent to setting it via machine config `Env`; the secret-store path is just a uniform plumbing convenience. The cost is one extra Fly API round-trip per spawn (negligible against the ~5s baseline cost of an app+machine create).
- **`chatEnabledEnvValueTrue` constant pinned at `"true"`.** The Phase 2 entrypoint.sh's literal-string match is the contract: any other value (including `True`, `1`, `"true "` with trailing space) takes the legacy `exec` branch. Pinning the producer-side string in a Go constant makes the contract observable to readers of `service.go`; the alternative (`fmt.Sprintf("%v", true) → "true"`) would coincidentally produce the right string today but rely on Go's stringification rules, which is a fragile coupling.
- **Post-tx `env` map rebuilt as a literal**, not appended-to in-place. Constructing a fresh `map[string]string{...}` and conditionally adding the chat keys is cleaner than `env := map[string]string{...}; if cfg.ChatEnabled { env["..."] = ... }` because the chat-disabled path emits exactly the M4-shape env map with no extra keys — the diff against the M4 baseline is byte-clean.
- **Token entropy of 32 bytes (43-char base64).** Plan decision 5 specifies "32-byte URL-safe random". `base64.RawURLEncoding` produces 4 chars per 3 bytes with no padding → 32 bytes encodes to exactly 43 chars. Below Fly's secret-value size limit (~64 KB) by orders of magnitude; long enough that brute force against the constant-time-compare bearer middleware is uneconomic at any plausible request rate. Using `RawURLEncoding` (no padding) over `URLEncoding` saves one `=` character and avoids any Fly URL-quoting surprises (the token doesn't appear in URLs, but the conservative choice is free here).
- **Two unit tests around `machineConfigFor` instead of widening the fakeflapsClient to capture LaunchMachineInput.** The fake currently discards `LaunchMachineInput` arg in its `Launch` method (line 103 of `fly_test.go`). Widening it would let us assert at the Spawn-level that the launched config carries services, but it would touch every existing Spawn test for no behaviour change. Testing `machineConfigFor` directly is strictly equivalent (it's the single grep target for "what shape goes on the wire") and keeps Phase 3's test footprint additive against the existing fly_test surface.

---

## Next phase entry checkpoint

Phase 4 is **`agents.ChatWithAgent` domain method + `Secret` lookup** (Go-only, no FE). The pieces Phase 3 leaves Phase 4:

- `db.AgentInstance.ChatEnabled` is readable via `GetAgentInstanceByID` → drives `ErrChatDisabled` (Connect `FailedPrecondition`).
- The `secrets` table now carries (or doesn't carry) a `CORELLIA_SIDECAR_AUTH_TOKEN` audit row per instance — Phase 4's secret lookup uses this to discover whether the token was ever provisioned, and (via `storage_ref` parse) which Fly app to read it from.
- `agent_instances.deploy_external_ref` already gives Phase 4 the URL host; combined with the path `/chat`, Phase 4 has everything it needs to construct the proxied call.

Phase 4 will also need `flaps.GetAppSecret` (or equivalent) to read the bearer token back out of Fly's secret store for proxying — that's the Fly-side surface widening Phase 4 owes. Not in scope for Phase 3.

The boundary between Phase 3 and Phase 4 is clean: Phase 3 owns spawn-side persistence + injection; Phase 4 owns runtime read-side + proxy. The two phases compose without rework.
