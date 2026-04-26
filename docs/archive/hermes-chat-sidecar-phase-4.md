# M-chat Hermes Chat Sidecar — Phase 4 completion notes

**Plan:** `docs/executing/hermes-chat-sidecar.md` §4 Phase 4.
**Date:** 2026-04-27.
**Scope:** Backend (Go) only. The agents service gains a `ChatWithAgent` domain method that proxies a single chat turn to the per-instance sidecar, reading the bearer token from Fly's app-secret store (rule §11 — never from Corellia's DB). No proto change, no FE change, no Fly push, no adapter image rebuild.

---

## What shipped

One new Go file, three modified Go files in the deploy package, two modified Go files in the agents package, no migration, no SQL, no proto. Strictly additive against M5 + Phase 3.

### New files

- **`backend/internal/agents/chat.go`** (~165 LOC) — `ChatWithAgent(ctx, instanceID, orgID, sessionID, message) (string, error)`. Sets the order of operations as the plan specifies: instance load with org-guard → `chat_enabled` gate → external-ref gate → secret-store read → URL build → bearer-attached POST → status-mapped sentinel return. Helper `chatURL(externalRef) (string, error)` builds `https://<app>.fly.dev/chat` per decision 12, mirroring the existing `logsURL` blueprint §11.1 trade-off (one Fly-shaped helper accepted in `agents/` for the small surface area; alternative would be widening every `DeployTarget` with a chat-URL method for one caller). Compile-time `var _ ChatHTTPClient = (*http.Client)(nil)` assertion catches future interface drift that would silently downgrade the default client.

### Modified files

- **`backend/internal/deploy/target.go`** — `DeployTarget` interface gains `GetAppSecret(ctx, externalRef, key) (string, error)`. Returns the plaintext value of an app-level secret previously set via `SetAppSecret`; stubs return `("", ErrNotImplemented)`. Doc-comment is explicit about the empty-but-no-error contract: "secret name registered, value not surfaced" — the same shape Fly's API produces when `showSecrets` is denied.
- **`backend/internal/deploy/fly.go`** — `flapsClient` interface widened with `GetAppSecrets(ctx, app, name string, version *uint64, showSecrets bool) (*fly.AppSecret, error)` (the upstream fly-go method, exact signature). New `(*FlyDeployTarget).GetAppSecret` parses external ref → app name, calls `flaps.GetAppSecrets(ctx, app, key, nil, true)`, returns `*sec.Value` (or empty string when `Value == nil`). Errors wrap with context but never include the secret value itself — the only redaction needed because the underlying flaps call already keeps the value off the error path.
- **`backend/internal/deploy/stubs.go`** — `LocalDeployTarget` + `AWSDeployTarget` each get `GetAppSecret` returning `("", ErrNotImplemented)`. Per blueprint §11.4: deferred targets are real interface implementations.
- **`backend/internal/deploy/fly_test.go`** — `flapsClientFake` gains `getSecretValues map[string]string`, `getSecretErr error`, and a `GetAppSecrets` method. Three new tests (`TestGetAppSecret_ReturnsValue`, `TestGetAppSecret_EmptyValueReturnsEmpty`, `TestGetAppSecret_BadExternalRef`) cover the projection, the value-not-surfaced path, and parse-failure-before-API-call invariants.
- **`backend/internal/agents/service.go`** — three new sentinels (`ErrChatDisabled`, `ErrChatUnreachable`, `ErrChatAuth`) with explicit Phase 5 sentinel-mapping comments. New exported `ChatHTTPClient` interface (`Do(*http.Request) (*http.Response, error)` — `*http.Client` satisfies it out of the box). New `ServiceOption` functional-option type plus `WithChatHTTPClient(c) ServiceOption`. `Service` struct gains `chatHTTP ChatHTTPClient`. `NewService` widens to `(...required four args, opts ...ServiceOption)` so existing four-arg call sites (cmd/api + ~25 test call sites) keep compiling — see "Plan deviations" §3 below.
- **`backend/internal/agents/service_test.go`** — `chatHTTPFake` (Do-shaped fake recording `lastReq` + scripted status/body/error). `fakeDeployTarget` gains `getAppSecretValues`, `getAppSecretErr`, `getAppSecretCalls` plus the `GetAppSecret` method. Eight new tests covering the full plan §4 Phase 4 contract:
  - `TestChatWithAgent_HappyPath` — happy path, asserts URL (`https://corellia-agent-chatdev.fly.dev/chat`), bearer header (`Bearer tok-from-fly`), `Content-Type: application/json`, content extraction, single GetAppSecret call, single chatHTTP.Do call.
  - `TestChatWithAgent_ChatDisabled` — `chat_enabled=false` → `ErrChatDisabled`; gate must precede secret read AND HTTP (zero calls to either).
  - `TestChatWithAgent_InstanceNotFound` — `pgx.ErrNoRows` on instance load → `ErrInstanceNotFound`.
  - `TestChatWithAgent_PendingNoExternalRef` — `chat_enabled=true` but `deploy_external_ref=nil` → `ErrInstanceNotFound` (pending row, no Fly app to talk to).
  - `TestChatWithAgent_SecretEmptyIsAuthFailure` — Fly returns secret name but no value → `ErrChatAuth` (treats drift between audit row and store as a Corellia-side bug).
  - `TestChatWithAgent_SecretReadError` — flaps returns 503 → `ErrChatUnreachable`.
  - `TestChatWithAgent_Sidecar401` — sidecar 401 → `ErrChatAuth` (token mismatch, Corellia-side drift).
  - `TestChatWithAgent_TransportError` — TCP `connection refused` → `ErrChatUnreachable`.
  - `TestChatWithAgent_Sidecar5xx` — sidecar 500 → `ErrChatUnreachable`.

`git diff --stat backend/internal/agents/ backend/internal/deploy/`: `+421 -3` across 6 files. `git status --short`: 6 modified Go files + 1 new Go file.

---

## How it diverged from the plan

Three deviations, each flagged at the moment of choice:

### 1. URL helper lives in `agents/`, not on `DeployTarget`

Plan §4 Phase 4 says "constructs the URL from `deploy_external_ref`" — silent on where. Two shapes:

- **(a)** `agents/chat.go::chatURL(externalRef)` — a small private helper, Fly-shaped, mirrors `logsURL`'s existing blueprint §11.1 trade-off documented in `service.go`.
- **(b)** Add `(DeployTarget).ChatURL(externalRef) (string, error)` to the interface — every implementation must declare it; `LocalDeployTarget`/`AWSDeployTarget` return `("", ErrNotImplemented)`; `*FlyDeployTarget` builds the Fly URL.

I went with (a). Reasons: (1) the `logsURL` precedent is established and the code-review comment in `service.go` (line 805–810) explicitly anticipates this — "v1.5 candidate: lift to `deploy.DeployTarget` interface"; doing so for two helpers (logsURL + chatURL) at once is the right time, not in the middle of Phase 4. (2) The chat URL is specifically tied to Fly's `<app>.fly.dev` DNS; abstracting it now would prefigure the v1.5 "second deploy target with a chat surface" decision that hasn't been made. (3) Adding a method to the interface forces the stubs' bodies to grow without earning their keep — the canonical "deferred features stub as real interface implementations" rule from blueprint §11.4 is about *deferred capabilities*, not about every helper that happens to look at an external ref. (4) Both helpers in one place (`logsURL` and `chatURL`) gives a future v1.5 lift one obvious target.

This is the strictly cleaner path. Phase 5's wizard / inspector edits don't touch this helper, so the deferral has zero cost.

### 2. Empty token surfaces as `ErrChatAuth`, not `ErrChatUnreachable`

Plan §4 Phase 4 documents the three sentinels but doesn't enumerate the empty-token case. Choices:

- **(a)** Treat as `ErrChatUnreachable` — secret store didn't surface the value, can't talk to sidecar.
- **(b)** Treat as `ErrChatAuth` — drift between Corellia's `secrets` audit row (says "we set this token") and what Fly returns ("name registered but value missing"). Same shape as the sidecar replying 401: "the token I have doesn't match what the sidecar expects".

I went with (b). Reasons: (1) `ErrChatUnreachable` semantic is "network / transport failure" — operator should retry; the empty-token case isn't transient. (2) The 401-from-sidecar path (which the plan does name) and the empty-token path have the same root cause — Corellia-side state-vs-secret-store drift — so they map to the same sentinel. (3) Phase 5 will route `ErrChatAuth` → Connect `Internal` (Corellia bug) and `ErrChatUnreachable` → `Unavailable` (transient/external); the empty-token case is unambiguously the former.

The doc comment on `ChatWithAgent` enumerates the case ("An empty token here means the secret was set without showSecrets surfacing — equivalent to 'drift between audit row and store'; treat as auth failure") so a future reader sees the rationale without reaching into the test.

### 3. `NewService` keeps four required args; chat collaborator opts in via functional option

Plan §4 Phase 4's "Files modified" lists `service.go` and `service_test.go` only — silent on whether the new HTTP collaborator becomes a constructor argument or arrives via setter, option, etc. Choices:

- **(a)** Add `chatHTTP ChatHTTPClient` as the 5th required arg of `NewService`. Forces every existing call site (cmd/api/main.go + ~25 test call sites) to update.
- **(b)** Keep `NewService` four-arg, add a `(*Service).SetChatHTTPClient(c)` setter for tests, default to `http.DefaultClient` constant-time. Mutable field shape; harder to reason about lifecycle.
- **(c)** Functional-option pattern: `NewService(four required args, opts ...ServiceOption)`. Existing four-arg calls keep compiling; `WithChatHTTPClient(c)` opts in for tests.

I went with (c). Reasons: (1) the change is strictly backward-compatible — the M5 four-arg contract is preserved verbatim, no test-suite churn. (2) Functional options are the idiomatic Go shape for "required collaborators + optional ones" — the same pattern the codebase will reach for again when M-tools / M-skills land their own per-feature collaborators. (3) The default — `&http.Client{Timeout: 60s}` — is sensible and bounded; no production caller has to think about it. (4) Tests can pass `WithChatHTTPClient(stub)` cleanly; the `chatHTTPFake` records `lastReq` for shape assertions without touching internal state.

Cmd/api wiring (`cmd/api/main.go:71`) is unchanged in this phase. Phase 5 may opt in a custom client (e.g. one that adds an outbound user-agent header) via `agents.WithChatHTTPClient(...)`, but the default is production-ready.

---

## What I deliberately did NOT do

- **Did not widen `cmd/smoke-deploy`.** The plan §4 Phase 4 exit gate references it ("Local `cmd/smoke-deploy` end-to-end: spawn chat-enabled agent → call `ChatWithAgent` directly from a one-off Go binary → assert non-empty response"), but smoke-deploy currently spawns with `DeployConfig{ChatEnabled: false}` (M5 default; the chat opt-in lands at the wizard in Phase 5). Adding a `--chat` flag + a one-off chat round-trip in this phase would prefigure Phase 5's wire surface; deferred. Operator-side smoke is owed before Phase 5 starts — see "Validation gates owed" below.
- **Did not add a `ChatHandler` Connect handler.** That's plan §4 Phase 5's job (proto change + handler + sentinel mapping). Phase 4's contract is purely "domain method that compiles, tests green, ready to be wired".
- **Did not change `respawnAgent`'s model-API-key re-supply path** (fleet.go:268–275). Carried over from the M5 0.10.0 "known pending work"; still v1.5. Out of scope for Phase 4.
- **Did not add a `Health()` HTTP-probe switch for chat-enabled instances.** That's plan §4 Phase 6's job. Phase 4 only adds the proxied chat path; the existing machine-state poll keeps running for both chat-enabled and chat-disabled instances.
- **Did not add request-body / response-body redaction beyond the bearer token.** The chat request body contains the user's free-text input and the response body contains the model's output — both are user-visible content already. The bearer token is the only sensitive datum, and it lives in `req.Header` memory only; never logged, never marshalled into a returned error, never included in a `slog` field. The transport-error log line (`agents: chat transport error`) carries the underlying `err` from `http.Client.Do` — Go's default `*url.Error` carries the URL and method, not the headers; safe.
- **Did not implement `/chat` streaming.** Anti-scope-creep §5: v1 is unary, v1.6 is streaming. Same posture as Phase 1.
- **Did not add per-message rate limiting / cost guards.** Plan §6 risk explicitly defers; whatever Fly's edge proxy gives us is the v1 ceiling.

---

## Validation gates met

- `cd backend && go vet ./...` clean.
- `cd backend && go build ./...` clean.
- `cd backend && go test ./...` — every package green (agents, deploy, httpsrv, users; cmd/api + cmd/smoke-deploy + adapters + auth + config + db + gen + organizations all `[no test files]`).
- `cd backend && go test ./internal/agents -run TestChat -v` — eight new ChatWithAgent tests pass; existing M-chat Phase 3 tests (`TestSpawn_ChatEnabled_PlumbsTokenAndSecrets`, `TestSpawn_ChatDisabled_OmitsChatPlumbing`) still pass.
- `cd backend && go test ./internal/deploy -run TestGetAppSecret -v` — three new GetAppSecret tests pass.
- Compile-time interface satisfaction: `var _ ChatHTTPClient = (*http.Client)(nil)` in `chat.go` catches any future interface drift that would silently downgrade the default client.
- Generated code (sqlc, buf) — untouched in this phase; CI's drift gate is unaffected.

---

## Validation gates owed (operator)

Phase 4's hard exit gate per plan §4:

```sh
# 1) Spawn a chat-enabled agent against the operator's Fly account
#    using the post-Phase-2 adapter image (locally built, not yet
#    GHCR-pushed; Phase 7's job).
#
#    Modify cmd/smoke-deploy or run a one-off binary that constructs:
#      DeployConfig{ChatEnabled: true, ...}
#
# 2) Once the agent reaches `running`, exercise ChatWithAgent from a
#    Go test binary or the existing smoke-deploy variant. Expected:
#    non-empty .content, single GetAppSecret call (cross-check via
#    fly logs of the BE process), bearer token attached to the
#    proxied request.
#
# 3) Verify the negative paths:
#      - flip the DB row's chat_enabled to FALSE → expect
#        ErrChatDisabled before any Fly call
#      - rotate the Fly app secret to a different value (via
#        `fly secrets set CORELLIA_SIDECAR_AUTH_TOKEN=other-value`),
#        retry → expect ErrChatAuth (sidecar 401)
#      - destroy the Fly app while the BE process is still running →
#        expect ErrChatUnreachable on the next chat call
```

The unit tests pin the `ChatWithAgent` shape at the service-method boundary; the operator-side smoke is what proves the end-to-end claim that Fly's `flaps.GetAppSecrets(showSecrets=true)` actually surfaces the token value at runtime against the operator's real Fly token scope (org-scoped per changelog 0.7.6) — a `403 Forbidden` from Fly here would be the most likely real-world failure mode, and the test is the cheapest way to surface it before Phase 5 starts.

If the Fly token scope does *not* permit `show_secrets=true` on app secrets, the fix is one of:
- Promote the chat token to a top-level Fly resource (e.g. a SecretKey, which `flaps_secretkeys.go` exposes — but the type is opinionated about cipher / mac semantics, not free-form bearer tokens; not a clean fit).
- Stop reading the token from Fly per-call: cache the token in the BE's process memory keyed by instance UUID (cleared on restart; refilled on first `ChatWithAgent` after the cold cache miss via Fly's secret API anyway, so doesn't actually help).
- Persist the token in `agent_instances.chat_sidecar_auth_token TEXT NULL` (a small migration). Documented as a Phase 4 follow-up — only earned if the operator-side smoke surfaces a Fly scope failure.

The DB-store fallback would be a deviation from rule §11; it would be acceptable because the chat token is **not** a deploy-target credential — it's an internal-to-Corellia auth token Corellia generates, used only to authenticate Corellia-to-its-own-sidecar. The blast radius if leaked is one agent's API quota. No operator-supplied PAT semantics. Plan §6 risk 3 (token leaks via logs) is unaffected.

---

## Design rationale worth keeping

- **`flaps.GetAppSecrets(ctx, app, name, nil, true)`, not `flaps.ListAppSecrets`.** The Get variant is single-secret; List would return every app secret (including `CORELLIA_MODEL_API_KEY`), wasting bandwidth and prefiguring access patterns we don't need. Both endpoints honour `show_secrets=true`; Get is the smaller-blast-radius choice.
- **`http.NewRequestWithContext`, not `http.NewRequest`.** The request inherits the caller's ctx, so a cancelled handler context cancels the in-flight chat call. The Go-default `http.Client.Timeout` (60s, set on the default client) acts as a *secondary* bound — if the caller's ctx has no deadline, the client timeout still kicks in. Belt-and-braces.
- **`io.LimitReader(resp.Body, 1<<20)` (1 MiB cap on response).** Sidecar responses are short text; a runaway response body shouldn't OOM the BE. Cap matches a sensible model-output ceiling without being so tight that legitimate replies clip. Operator can revisit the bound when v1.6 streaming makes the unary-cap obsolete.
- **`*http.Client` is the default `ChatHTTPClient`, but the interface is `Do`-shaped.** Tests don't see Go's `http.Client.Timeout`-driven Cancel semantics; they see whatever the fake's `Do` returns. This means tests don't accidentally exercise the timeout path. Real production flow exercises both.
- **Bearer header is `"Bearer "+token`, plain string concat.** Avoiding `fmt.Sprintf` keeps the token off the format-args slice (a hypothetical attacker hooking go-printf would see only the literal "Bearer "). Marginal; included because it costs nothing.
- **`Authorization` header is set on `req.Header`, not via `req.SetBasicAuth` or similar.** SetBasicAuth would marshal the token into `<base64(user:token)>` shape — wrong contract. Direct header set is the canonical bearer-auth shape.
- **`ServiceOption` slice instead of a separate `ServiceOptions` struct.** The variadic-functional pattern allows the option list to grow over milestones without struct churn at every call site. The alternative — a `*ServiceConfig` struct passed to `NewService` — would force every test to allocate a config object even when it has nothing to override. Functional options keep the boilerplate at zero for the canonical case.
- **`chatHTTPTimeout = 60 * time.Second` lives as a package-level constant.** Visible to readers; tunable in one place. Deliberately not exposed on `ServiceOption` — overriding the timeout would mean overriding the entire `*http.Client`, which `WithChatHTTPClient` already permits at a finer grain.
- **Empty-token surfaces as `ErrChatAuth` (deviation §2).** See the deviation block above. Operator-debugging signal: `ErrChatAuth` always means "Corellia-side state is wrong, not the user's fault" — never a transient. `ErrChatUnreachable` always means "retry might help".

---

## Next phase entry checkpoint

Phase 5 is **`ChatWithAgent` Connect RPC + handler + FE chat panel** (proto change + handler + FE component). The pieces Phase 4 leaves Phase 5:

- `agents.Service.ChatWithAgent(ctx, instanceID, orgID, sessionID, message) (string, error)` is ready to be called by the Connect handler.
- The three sentinels are pinned (`ErrChatDisabled`, `ErrChatUnreachable`, `ErrChatAuth`) with the Phase 5 sentinel-mapping table documented inline:
  - `ErrInstanceNotFound` → `connect.CodeNotFound`
  - `ErrChatDisabled` → `connect.CodeFailedPrecondition`
  - `ErrChatAuth` → `connect.CodeInternal`
  - `ErrChatUnreachable` → `connect.CodeUnavailable`
- The bearer-token / URL / proxy plumbing is fully encapsulated inside the service layer; the handler stays <30 lines per stack.md §11.9.
- The `secrets` table audit row (Phase 3) remains the source of "did Corellia ever set this token?" — Phase 5's UI can surface "chat configured at <created_at>" without touching the chat code path.

Phase 4 also leaves the operator-side validation gate (described above) as a hard prerequisite — Phase 5's FE work depends on the proxied chat call actually returning content from a real Fly secret, not just the unit-tested code path.

The boundary between Phase 4 and Phase 5 is clean: Phase 4 has zero proto / FE / SQL surface (one new Go file plus six surgical edits); Phase 5 has zero domain-method surface (it wires the existing `ChatWithAgent` to the wire). The two phases compose without rework.
