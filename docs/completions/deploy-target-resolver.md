# Plan — Deploy target resolver indirection (M3.5)

**Status:** draft, awaiting approval
**Owner:** TBD
**Supersedes:** —
**Related:**
- `docs/executing/hermes-adapter-and-fly-wiring.md` (M3 — landed `internal/deploy/` package, `FlyDeployTarget`, `LocalDeployTarget` / `AWSDeployTarget` stubs, `httpsrv.Deps.DeployTargets` registry as a `map[string]deploy.DeployTarget`. This plan is a structural follow-up that does **not** change M3's behavior; it adds one indirection layer the M4 spawn handler will use)
- `docs/executing/spawn-flow.md` (M4 — first consumer of the resolver introduced here. M4's plan needs to read this one and adopt the resolver-based callsite pattern instead of `deps.DeployTargets["fly"]`)
- `docs/blueprint.md` §9 (`DeployTarget` table — the v1.5+ DB-row source of truth this resolver swap eventually fronts), §11.1 (no Fly outside `FlyDeployTarget` — preserved unchanged), §11.4 (deferred features stub as real interfaces; the resolver itself follows this — `StaticResolver` is the real interface, `DBResolver` is the v1.5 swap-in)
- `docs/stack.md` §8 (`FLY_API_TOKEN` / `FLY_ORG_SLUG` env vars; this plan annotates them as bootstrap state slated for v1.5 retirement, no behavior change)

---

## 1. Objective

Pre-pay one architectural move that buys cheap user-configurable deploy targets in v1.5+, **without** building user-configurability now.

Concretely, after this milestone lands:

1. A new exported type `deploy.Resolver` is the only sanctioned way handlers obtain a `DeployTarget`. Direct map indexing (`deps.DeployTargets["fly"]`) is closed off — `httpsrv.Deps` exposes a `DeployTargets deploy.Resolver` field, not the raw map.
2. The today-implementation `deploy.StaticResolver` wraps M3's process-global, env-var-bootstrapped registry. Behavior is byte-identical to today — same boot sequence, same env vars, same singleton `FlyDeployTarget` instance.
3. A new `deploy.FlyCredentials` struct replaces the loose `(token, orgSlug)` constructor pair. `NewFlyDeployTarget(ctx, FlyCredentials{...})` insulates future credential additions (e.g. `DefaultRegion`, `MaxConcurrentSpawns`) from constructor-signature ripples.
4. `config.Config.FlyAPIToken` and `FlyOrgSlug` carry a code comment marking them as **bootstrap state** — slated for retirement when v1.5 introduces DB-backed `deploy_targets` rows. Future readers know the lifecycle without reading this plan.
5. `internal/deploy/target_test.go` gains coverage for the resolver: `StaticResolver.For("fly")` returns the registered target; an unregistered kind returns a sentinel `ErrTargetNotConfigured`. Two cases, ~15 lines.

After this lands:

- M4's spawn handler is written against `resolver.For(ctx, kind)`, never `deps.DeployTargets[kind]`. The map disappears from handler code permanently.
- v1.5's user-config plan is a clean swap: `StaticResolver` → `DBResolver` (reads `deploy_targets` rows, decrypts credentials, constructs per-row `FlyDeployTarget` instances). Zero handler code changes — the interface is stable across the swap.
- The env-var retirement in v1.5 is a 4-line delete: two fields from `config.Config`, two lines from `.env.example`, one line from `cmd/api/main.go`'s resolver bootstrap (the `StaticResolver` constructor stops reading them). No migration story for callers because they never depended on the env vars in the first place.

The whole milestone is one new exported type (`Resolver`), one new struct (`FlyCredentials`), one constructor signature change with mechanical callsite updates, one `httpsrv.Deps` field type change, and one comment annotation in `config.go`. ~80 LOC across ~5 files. No new dependencies, no schema changes, no proto changes, no FE changes.

---

## 2. Decisions locked

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Resolver interface signature | **Single method `For(ctx context.Context, kind string) (DeployTarget, error)`** | Mirrors the existing `map[string]DeployTarget` lookup shape exactly, so the M4 callsite reads `resolver.For(ctx, kind)` instead of `deps.DeployTargets[kind]` — same mental model, one extra layer. Context is included even though `StaticResolver` ignores it; `DBResolver` will need it for the row fetch + decryption call. Single-method interface keeps `StaticResolver` and future `DBResolver` cheap to implement and easy to fake in tests |
| 2 | Resolver granularity (kind vs. row-id) | **Kind-keyed today, with a clear v1.5 widening note in the interface doc comment** — *not* row-id-keyed | Row-id resolution requires a `deploy_targets` table that doesn't exist yet (deferred to M4 per blueprint §9 and the M3 plan decision 21). Pre-designing for an interface shape ahead of its data model risks locking in the wrong abstraction. The doc comment makes the v1.5 widening explicit: `DBResolver` either widens the interface (`ForTarget(ctx, id uuid.UUID)`) or replaces it entirely. Both are valid; the decision lands when v1.5 actually has the data |
| 3 | Sentinel for unregistered kind | **New exported `deploy.ErrTargetNotConfigured`**, distinct from `ErrNotImplemented` | `ErrNotImplemented` means "this target type exists as a stub but its methods aren't built" (`LocalDeployTarget`, `AWSDeployTarget` per blueprint §11.4). `ErrTargetNotConfigured` means "the resolver has no entry for this kind" — different failure mode, different operator response (one is "this is a known feature gap"; the other is "your boot sequence forgot to register a target"). Conflating them would give M4's spawn handler a single ambiguous error to log and react to |
| 4 | `FlyCredentials` struct fields | **`APIToken string` + `OrgSlug string` only.** No `DefaultRegion`, no `MaxConcurrentSpawns`, no `Endpoint` override | Adding fields ahead of callers is forbidden by CLAUDE.md ("don't design for hypothetical future requirements"). The struct itself is the structural pre-payment — adding a field later is additive and doesn't break the constructor signature. Today's two fields match exactly what M3's `NewFlyDeployTarget` already takes; the struct is shape, not capability |
| 5 | `NewFlyDeployTarget` signature change | **Breaking: `NewFlyDeployTarget(ctx, FlyCredentials)` replaces `NewFlyDeployTarget(ctx, token, orgSlug)`.** Update the one callsite in `cmd/api/main.go` | The constructor has exactly one caller (verified by `grep -r NewFlyDeployTarget backend/`). A struct-based signature is unambiguously better than positional `(string, string)` for a future-extensible parameter set — and the cost of the migration is one callsite. No deprecation period, no shim function: just edit both sides in one commit |
| 6 | Where `StaticResolver` lives | **`internal/deploy/resolver.go`** as a new file, alongside `target.go` / `fly.go` / `stubs.go` | Resolver is a deploy-package concern (it returns `DeployTarget` values), not a wiring concern. Putting it in `internal/deploy/` means handlers import `deploy.Resolver` from the same package they import `deploy.DeployTarget` from — natural co-location. The `cmd/api/main.go` boot code constructs the `StaticResolver` from the env-var-built registry; the resolver type itself doesn't read env vars |
| 7 | `StaticResolver` constructor shape | **`deploy.NewStaticResolver(map[string]DeployTarget) *StaticResolver`** — accepts the map as a parameter | Matches M3's pattern: `cmd/api/main.go` builds the map from individual constructors, then hands it to the resolver. Keeps the resolver decoupled from the construction order of its members. Trivially fakeable in tests by passing `map[string]DeployTarget{"fly": &fakeTarget{}}` |
| 8 | `httpsrv.Deps` field change | **`DeployTargets deploy.Resolver`** (was `map[string]deploy.DeployTarget`). Same field name, narrower type | Field name preserved so the M3 plan's decision-30 ordering ("between `AgentsHandler` and `AllowedOrigin`") survives mechanically. Any future grep for `DeployTargets` lands on the same field. Swapping the type from `map` → `interface` is a single-line diff in `httpsrv/server.go`'s `Deps` struct definition |
| 9 | `config.go` annotation | **Three-line block comment above `FlyAPIToken` and `FlyOrgSlug`** marking them as bootstrap state, with a `// TODO(v1.5):` note pointing at the eventual retirement | Comments at the field declaration are the highest-visibility surface for "this is provisional" — every future config edit reads them. The `TODO(v1.5)` form is greppable; when v1.5 lands, the deletion is a `grep TODO(v1.5)` + 4-line edit |
| 10 | Test surface | **Two new cases in `target_test.go`**: `TestStaticResolver_KindRegistered` (returns the registered target) and `TestStaticResolver_KindUnregistered` (returns `ErrTargetNotConfigured`). No new test file | Resolver is ~15 lines of code; spinning up a new `resolver_test.go` for two cases is over-structured. Co-locating with the interface conformance tests in `target_test.go` matches the package's existing test layout. `fly_test.go` and `stubs_test.go` mentioned in M3 plan decision 29 stay separate per their existing topical scope |
| 11 | Changelog version bump | **0.5.x patch entry** under M3's 0.5.0 — *not* a 0.6.x M4 entry, *not* a separate minor version | This is a structural follow-up to M3's deploy package, not a product feature. Patch versioning matches the 0.3.x-after-0.3.0 precedent (M1 hardening was 0.3.1, not 0.4.0). The entry references this plan and notes "no behavior change; preparatory for v1.5 user-config" |

### Decisions deferred (revisit when named caller arrives)

- **`DBResolver` interface widening** (per-row vs. per-kind resolution) — deferred to v1.5 plan when `deploy_targets` schema is concrete
- **Credentials encryption strategy** (Supabase Vault vs. pgsodium vs. app-level libsodium) — deferred to v1.5 plan; this plan deliberately doesn't touch the question because v1.5 user-config is the *first* milestone with credentials at rest in the DB
- **Per-target rate limiting / spawn quotas** — deferred until at least one user has spawned enough agents to hit a Fly account limit
- **Resolver-level caching of `FlyDeployTarget` instances** (so `DBResolver` doesn't rebuild a `flaps.Client` per spawn) — premature without a measured spawn-rate problem; v1.5 plan revisits

---

## 3. Pre-work

Before starting Phase 1, confirm:

1. **M3 has merged** (or this plan rebases against the M3 branch). The M3 plan's decisions 21–23 establish the `httpsrv.Deps.DeployTargets` field and the `NewFlyDeployTarget(token, orgSlug)` constructor — both of which this plan modifies. Running this plan ahead of M3 would create merge conflicts with no user-visible benefit since there's no spawn handler yet to consume the resolver.
2. **No second `NewFlyDeployTarget` caller has crept in.** `grep -rn 'NewFlyDeployTarget' backend/` should return exactly two hits: the definition in `internal/deploy/fly.go` and the one call in `cmd/api/main.go`. Any third hit means the plan needs a Phase 5 to update it.
3. **No handler reads `deps.DeployTargets` directly yet.** `grep -rn 'DeployTargets\[' backend/internal/httpsrv/` should return zero hits. (M3 deliberately wires the field without consuming it; M4 is the first consumer.) If a hit appears, this plan adds a Phase 5 for that handler too.

---

## 4. Phases

### Phase 1 — `FlyCredentials` + constructor change

1. Define `FlyCredentials struct { APIToken, OrgSlug string }` in `internal/deploy/fly.go`, immediately above `FlyDeployTarget`.
2. Change `NewFlyDeployTarget(ctx context.Context, token, orgSlug string) (*FlyDeployTarget, error)` to `NewFlyDeployTarget(ctx context.Context, creds FlyCredentials) (*FlyDeployTarget, error)`. Body adapts trivially (`tokens.Parse(creds.APIToken)`, `orgSlug: creds.OrgSlug`).
3. Update the single callsite in `cmd/api/main.go:52`: `deploy.NewFlyDeployTarget(ctx, deploy.FlyCredentials{APIToken: cfg.FlyAPIToken, OrgSlug: cfg.FlyOrgSlug})`.
4. `cd backend && go build ./...` — must compile clean. `go vet ./...` clean. `go test ./internal/deploy/...` — existing tests should pass without modification (they don't construct a `FlyDeployTarget` directly).

### Phase 2 — `Resolver` interface + `StaticResolver` impl

1. Create `internal/deploy/resolver.go` with:
   - `ErrTargetNotConfigured = errors.New("deploy: target kind not configured")`
   - `Resolver` interface — single method `For(ctx context.Context, kind string) (DeployTarget, error)` with a doc comment explaining the v1.5 widening intent
   - `StaticResolver struct { targets map[string]DeployTarget }`
   - `NewStaticResolver(targets map[string]DeployTarget) *StaticResolver`
   - `func (r *StaticResolver) For(_ context.Context, kind string) (DeployTarget, error)` — map lookup, returns `ErrTargetNotConfigured` on miss
2. Add a compile-time assertion at the bottom: `var _ Resolver = (*StaticResolver)(nil)` (matches the pattern already in `target_test.go`).
3. Add the two test cases to `target_test.go` per decision 10.
4. `cd backend && go test ./internal/deploy/...` — both new cases pass.

### Phase 3 — `httpsrv.Deps` field type change + boot wiring

1. In `internal/httpsrv/server.go`'s `Deps` struct, change `DeployTargets map[string]deploy.DeployTarget` → `DeployTargets deploy.Resolver`. Field name and ordering preserved.
2. In `cmd/api/main.go`, after the existing map construction (`deployTargets := map[string]deploy.DeployTarget{...}`), add `deployResolver := deploy.NewStaticResolver(deployTargets)`. Pass `DeployTargets: deployResolver` into `httpsrv.New(httpsrv.Deps{...})`.
3. Keep the `slog.Info("deploy targets initialised", ...)` line — it logs from the map, not the resolver, so no change needed.
4. `cd backend && go build ./... && go vet ./... && go test ./...` all clean.

### Phase 4 — `config.go` annotation

1. Add a block comment above `FlyAPIToken` (lines ~31–32 of `internal/config/config.go`):
   ```go
   // FlyAPIToken / FlyOrgSlug are bootstrap credentials for the single
   // process-wide DeployTarget consumed by deploy.StaticResolver. They
   // are slated for retirement in v1.5, when DB-backed deploy_targets
   // rows replace this env-var bootstrap with per-org user-configurable
   // credentials. See docs/executing/deploy-target-resolver.md §1.
   // TODO(v1.5): delete these two fields when DBResolver lands.
   ```
2. No code change to either field — the annotation is the only delta.

### Phase 5 — Validation matrix + changelog

1. **Backend:** `cd backend && go vet ./... && go build ./... && go test ./...` — all clean. The deploy package's test count goes from N to N+2.
2. **Boot-time sanity:** `cd backend && air` — server boots, `slog.Info("deploy targets initialised", "kinds", "fly,local,aws", ...)` appears exactly as before. No behavior change observable from the outside.
3. **Grep for stale callsites:** `grep -rn 'DeployTargets\[' backend/` — zero hits. `grep -rn 'NewFlyDeployTarget(ctx, cfg\.' backend/` — zero hits (the old positional form is gone).
4. **Changelog:** add a 0.5.x entry under M3's 0.5.0 section. Body: short index of the five deltas (FlyCredentials struct, Resolver interface, StaticResolver impl, Deps field type narrowing, config comment), explicit "no behavior change" callout, link forward to the v1.5 user-config plan placeholder.
5. **No frontend changes, no migration changes, no proto changes** — `pnpm -C frontend build` and `goose status` should both report exactly the M3 baseline.

---

## 5. Out of scope (explicitly)

- **DB-backed `deploy_targets` rows** — v1.5 work. This plan does not touch the schema.
- **Encryption-at-rest for credentials** — v1.5 architectural decision. This plan keeps credentials in env vars only.
- **Settings UI for managing deploy targets** — v1.5 work. No FE changes here.
- **CRUD RPCs for deploy targets** (`CreateDeployTarget`, `ListDeployTargets`, etc.) — v1.5 work. No proto changes.
- **`DBResolver` implementation** — v1.5 work. The interface is established; the second implementation lands when its data model lands.
- **`FlyDeployTarget` instance caching strategy** — premature. `StaticResolver` returns the same singleton every call; `DBResolver`'s caching needs measurement, not speculation.
- **Multi-tenant isolation** (per-org Fly accounts) — naturally falls out of v1.5 + per-row credentials, not addressed here.
- **Per-target observability / metrics** — separate v1.5+ plan.

---

## 6. Risk register

| # | Risk | Mitigation |
|---|---|---|
| 1 | M4's spawn flow plan is drafted *before* this resolver lands and assumes the `map[string]DeployTarget` shape — then has to be rewritten | Surface this plan in the M4 plan's "Related" section as a hard prerequisite. M4's first phase reads `resolver.For(ctx, kind)`, never `deps.DeployTargets["fly"]` |
| 2 | A future contributor "simplifies" `StaticResolver` back to a raw map by deleting the indirection | The `// TODO(v1.5)` comment in `config.go` is the breadcrumb; the changelog entry is the architectural record. If the indirection survives until v1.5, its purpose becomes self-evident the moment `DBResolver` is introduced |
| 3 | The single-method interface `For(ctx, kind)` turns out to be the wrong shape when v1.5's data model lands (e.g. row-id resolution doesn't fit `kind string` cleanly) | Decision 2 explicitly anticipates this: v1.5 widens the interface (additive, safe) or replaces it entirely (one-time refactor of the M4 spawn handler's two callsites). Either is cheaper than today's `deps.DeployTargets["fly"]` direct map indexing being scattered across multiple handlers |
| 4 | Phase 1's breaking signature change ripples to a caller this plan didn't anticipate | Pre-work step 2 verifies via `grep -rn 'NewFlyDeployTarget' backend/` that exactly two hits exist (definition + one callsite). If a third appears between drafting and execution, add a Phase 1.5 to update it |
| 5 | The `httpsrv.Deps.DeployTargets` field type change (Phase 3) breaks an undocumented consumer | Pre-work step 3 verifies via `grep -rn 'DeployTargets\[' backend/internal/httpsrv/` zero direct map indexing exists. M3 wired the field without consumers; this is a clean window |

---

## 7. What this plan deliberately does *not* enable

This plan **does not** make Corellia user-configurable for deploy targets. After it lands, every spawned agent still goes to the single Fly account configured by `FLY_API_TOKEN` / `FLY_ORG_SLUG`. The whole purpose is to make the v1.5 user-config plan a clean swap rather than a refactor — by ensuring no handler ever depends on the static, env-var-bootstrapped registry shape.

If this plan succeeds and v1.5 is then deferred indefinitely, the cost paid is ~80 LOC of indirection and one extra interface in the `deploy` package. If v1.5 ships as planned, the indirection is exactly the seam the swap happens at, and zero handler code needs to change.
