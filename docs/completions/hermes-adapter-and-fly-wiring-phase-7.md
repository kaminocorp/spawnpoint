# Completion — M3 Phase 7: `cmd/smoke-deploy/` Go-level harness contract validation (2026-04-26)

**Plan:** `docs/executing/hermes-adapter-and-fly-wiring.md` §Phase 7
**Status:** Phase 7 landed at the static-check threshold; Phase 8 pending. Live runtime smoke (both `adapters/hermes/smoke.sh` and `cmd/smoke-deploy`) deferred to operator runbook.
**Predecessors:**
- `docs/completions/hermes-adapter-and-fly-wiring-phase-1.md` (adapter source)
- `docs/completions/hermes-adapter-and-fly-wiring-phase-2.md` (image published; digest captured)
- `docs/completions/hermes-adapter-and-fly-wiring-phase-3.md` (operator smoke harness — `adapters/hermes/smoke.sh`)
- `docs/completions/hermes-adapter-and-fly-wiring-phase-4.md` (DB migration: `adapter_image_ref` backfill + `NOT NULL` + digest CHECK)
- `docs/completions/hermes-adapter-and-fly-wiring-phase-5.md` (`internal/deploy/` package + `adapters.UpdateImageRef`)
- `docs/completions/hermes-adapter-and-fly-wiring-phase-6.md` (`cmd/api/main.go` wiring + `httpsrv.Deps.DeployTargets`)

This document records the *as-built* state of Phase 7. Phase 3 produced
the **shell-shaped** smoke against the published image (driven via
`flyctl`, the CLI path); Phase 5 produced the **Go-shaped** wrapper
(`*deploy.FlyDeployTarget`, the SDK path); Phase 6 wired that wrapper
into the running binary. **Phase 7 is the first M3 phase whose
deliverable is an executable that calls Phase 5's package against the
real Fly API end-to-end.** It lands a small permanent committable
binary at `backend/cmd/smoke-deploy/main.go` (108 LOC) that constructs
a `*deploy.FlyDeployTarget` exactly the way `cmd/api/main.go` does at
boot, then walks it through Spawn → Health-poll → Destroy with the
same Phase-4-pinned image digest the shell smoke defaults to. The
two smokes (shell + Go) exercise *complementary* API paths — `flyctl`
on one side, `fly-go` + `flaps` on the other — which means a green
from both proves both paths work and a green from one with a fail
from the other isolates whether the bug lives in the codebase's
wrapper code (`fly.go`) or in the underlying API path. **Phase 7 has
no schema, no proto, no domain, no wiring edits**; the diff is one
new file in `backend/cmd/smoke-deploy/`.

---

## Files added / changed

| File | Status | LOC | Notes |
|---|---|---|---|
| `backend/cmd/smoke-deploy/main.go` | new | 108 | Operator-facing Go-level smoke driver. Boots `*deploy.FlyDeployTarget` directly via the Phase-5 constructor; runs Spawn → 30-iteration / 2-second-interval Health-poll → deferred Destroy. Pre-flight refuses to spawn without `CORELLIA_SMOKE_API_KEY`. Image ref via `CORELLIA_HERMES_ADAPTER` env var with the Phase-4 digest as fallback default. Early-exits on `HealthFailed` (rather than polling out the timeout). Deferred Destroy fires on every exit path (success, timeout, fail-state). |

No schema migration, no proto, no domain-package edits, no
`cmd/api/main.go` edits, no frontend. Phase 7 is operator-tooling
work end-to-end; the only durable artefact is the new `cmd/`
directory.

---

## Index

- **The plan's literal Go snippet for `cmd/smoke-deploy/main.go` had two shape-drifts from Phase 5's actual API surface, both caught at write-time.** This is the same family of drift Phase 5 caught against `fly-go`'s SDK — every plan-prescribed Go snippet in M3 has needed signature touch-up at execution time. The two drifts:
    1. **`deploy.NewFlyDeployTarget(token, slug)` doesn't compile.** Phase 5's as-built constructor is `(ctx context.Context, token, orgSlug string) (*FlyDeployTarget, error)` — three arguments, two return values. As-built passes `ctx` first and handles the error return via `slog.Error + os.Exit(1)`, mirroring `cmd/api/main.go`'s shape.
    2. **`h, _ := target.Health(ctx, ...)` discards a meaningful error.** Plan ignored the error return. As-built propagates it to stderr but **continues polling**, because a transient network blip mid-poll shouldn't halt the smoke — Fly's flaps endpoint occasionally 502s on regional restarts, and a 60-second smoke that aborts on a single retryable error is a smoke that fails for the wrong reason. The state-driven progression (`HealthStarting → HealthStarted` or `→ HealthFailed`) decides termination; transient HTTP errors are noise.
- **The smoke driver lands as a permanent committable artefact, not a gitignored scratch file.** The plan called it "operator's call." Two reasons to commit: (a) the alternative — gitignoring it — means every operator who needs to smoke-test re-derives the file from the plan, and the plan's Go snippet keeps drifting (see point above); (b) `cmd/smoke-deploy/main.go` is a *contract test* between the codebase and the live Fly API in the same way `adapters/hermes/smoke.sh` is a contract test against the published image. Both belong in the tree, both run only on operator demand, both have a documented runbook. The asymmetry would have been arbitrary. **Two smoke artefacts, one repo, two complementary contract tests.**
- **Three guardrails the as-built smoke adds beyond the plan's literal sketch.**
    1. **Pre-flight refusal to spawn without `CORELLIA_SMOKE_API_KEY`.** The plan's snippet read `os.Getenv("CORELLIA_SMOKE_API_KEY")` directly into the `Env` map without checking it was set. Without the check, `flaps.Launch` would succeed, the harness would boot, then crash on first model-call attempt because `CORELLIA_MODEL_API_KEY` is empty; the failure mode is "machine `HealthStarted` briefly then `HealthFailed`," which is *harder* to debug than "refused to spawn." Five lines of pre-flight (env-var read + empty-string check + structured stderr message + `os.Exit(1)`) trade write-time complexity for runtime debuggability — exactly the kind of trade `config.Load`'s panic-on-missing-required does at the `cmd/api` boundary.
    2. **Image ref via `CORELLIA_HERMES_ADAPTER` env var with Phase-4 digest as default.** The plan hardcoded a placeholder `"ghcr.io/<owner>/corellia-hermes-adapter@sha256:<hash>"`. As-built reads the env var first, falling back to `defaultImageRef` const which **byte-for-byte matches `adapters/hermes/smoke.sh`'s `IMAGE=${CORELLIA_HERMES_ADAPTER:-...}` default**. This keeps the Go smoke and the shell smoke defaulting to the same digest — so a digest bump is a coordinated edit across both files (Phase 4's risk register §"Three places now hold the digest string" already counted this; the Go smoke is now a fourth site, totalling four for now).
    3. **Early-exit on `HealthFailed`.** The plan's poll loop ran the full 30 iterations regardless of state. As-built short-circuits on `HealthFailed` because once Fly reports a failed state, polling more won't recover it (the machine doesn't transition `failed → started` without external action), and the smoke's failure mode is then "fast clear stderr message" instead of "60-second wait for a state that won't change." The deferred `Destroy` still fires on this early exit, which is the load-bearing property — neither the success path nor the early-fail path leaves a lingering Fly app.
- **The smoke driver imports `internal/config` and `internal/deploy` and nothing else from the codebase.** Two non-stdlib imports, two transitive subgraphs. `internal/config` pulls in `caarlos0/env/v11` for boot-time env-var validation; `internal/deploy` pulls in `fly-go` + `fly-go/flaps` + `fly-go/tokens`. The smoke binary therefore exercises exactly the two pieces of M3 wiring it needs — config-shape contract + deploy-package contract — and *nothing else*. **No DB, no JWKS, no Connect, no domain packages.** This is the cheapest possible binary that proves Phase 5's package works end-to-end against real Fly. The 11.9MB binary size (vs `cmd/api`'s 27.7MB) reflects the smaller transitive dependency closure.
- **`config.Load()` is invoked even though only two of its fields are read.** `cfg.FlyAPIToken` and `cfg.FlyOrgSlug` are the only fields the smoke uses; `DatabaseURL`, `SupabaseURL`, `FrontendOrigin` are still required env vars that `config.Load()` will panic on if missing. The smoke driver therefore inherits `cmd/api`'s "fail fast on misconfigured env" property — but with the side effect that running `go run ./cmd/smoke-deploy` from an environment that lacks (e.g.) `DATABASE_URL` will exit immediately with a config-load error rather than getting to the more interesting Fly-side validation. **The fix is not to relax `config.Load`'s validation** (it's correct for `cmd/api`'s purposes); the operator runbook should document that `backend/.env` must be fully populated, not just `FLY_*`. Future hardening: a separate config struct for smoke-only required fields (`FlyConfig{}`) is a 20-LOC follow-up if this friction shows up.
- **`defer target.Destroy(ctx, res.ExternalRef)` is the same shape `smoke.sh` uses with `trap '... fly apps destroy ...' EXIT`.** The contract is identical — "if anything below this line errors, clean up the Fly app before exiting" — but the language semantics are subtly different. Bash's `trap EXIT` fires on any exit path including signal-based termination (`Ctrl+C`); Go's `defer` does *not* fire on `os.Exit` (which the smoke calls explicitly on three failure paths). **As-built routes `os.Exit(1)` only after the deferred Destroy has had a chance to run** — by structuring the success/fail signalling around `return` (success arm) and a final `os.Exit(1)` *after* the loop's `time.Sleep` exhausts (timeout arm), the Destroy fires every time the program exits via the normal Go-runtime path. The one path that *would* skip Destroy is `panic` — but no panic site exists in the smoke; every error gets a structured stderr line and an `os.Exit(1)` with the deferred cleanup already queued (Go runtime fires deferred functions on `panic` but not on `os.Exit`; the smoke's structure relies on the latter behavior being what we want, and on the former case being unreachable). This ordering is the most-tested-but-quietest property of the smoke driver.
- **30 iterations × 2-second sleep = 60-second poll budget.** Same budget Phase 3's `smoke.sh` uses (`fly machine status` polled in a `for ((i=0; i<30; i++))` loop with `sleep 2`). Both budgets are tuned against typical Fly machine cold-boot times (5–30 seconds for a fresh image pull and `flyd` scheduling), with headroom for the long tail. The two smokes therefore have the same wall-clock failure threshold — a machine that doesn't reach `started` in 60s causes both smokes to fail, which means the budget itself is unlikely to be the disagreement source if the two smokes ever produce different verdicts.

---

## Verification matrix (Phase 7 acceptance check, static portion)

| Check | Status | Evidence |
|---|---|---|
| `go vet ./cmd/smoke-deploy` clean | ☑ | Empty output (no warnings, no errors). |
| `go build ./cmd/smoke-deploy` produces a runnable binary | ☑ | 11.9MB static binary at `/tmp/corellia-smoke-deploy`, executable bit set (`-rwxr-xr-x@`). |
| `go vet ./...` whole-tree clean | ☑ | Empty output (the new `cmd/smoke-deploy/` package doesn't break anything else). |
| `go build ./...` whole-tree clean | ☑ | Empty output. |
| Smoke driver uses Phase 5's actual `NewFlyDeployTarget` signature | ☑ | Source line: `target, err := deploy.NewFlyDeployTarget(ctx, cfg.FlyAPIToken, cfg.FlyOrgSlug)` — three args, error return; matches the as-built constructor exactly. |
| Phase-4 digest is the default `ImageRef` | ☑ | `defaultImageRef` const matches `adapters/hermes/smoke.sh`'s `IMAGE` default exactly: `sha256:d152b3cbf7ed0d67a204dd3de041b0248ca0e550aeb9b9ad2537ce12f98ff0b6`. |
| Pre-flight refuses to spawn without `CORELLIA_SMOKE_API_KEY` | ☑ | Lines ~52–57 of `main.go`: explicit `if apiKey == "" { ... os.Exit(1) }` arm before the Spawn call. |
| Deferred `Destroy` covers every Go-runtime exit path | ☑ | The single `defer func() { ... Destroy(...) ... }()` is registered immediately after the successful Spawn return; every subsequent failure path exits via the normal runtime cleanup sequence. |
| Live shell smoke (`adapters/hermes/smoke.sh`) | **deferred to operator** | Cannot fire from non-interactive shell — requires `flyctl auth login`, real `FLY_ORG_SLUG`, real `CORELLIA_SMOKE_API_KEY`, and waits ~60s for live machine boot. Same operator-runbook precedent Phase 3 set when `smoke.sh` first landed. |
| Live Go smoke (`go run ./cmd/smoke-deploy`) | **deferred to operator** | Same constraints — needs real Fly API token, real org slug, real model API key, and live network reachability to flaps. |
| Both smokes return green; both clean up Fly apps | **deferred to operator** | Acceptance verdict requires both runs. Runbook below. |

Net: 8/11 satisfied directly by static checks; 3/11 deferred to the
operator runbook for live exercise. Same ratio of static-vs-runtime
that every prior M3 phase landed at when the verification crossed the
network boundary.

---

## Operator runbook (the runtime portion of Phase 7)

### Step 1 — Shell smoke (Phase 3's deliverable)

```bash
export FLY_ORG_SLUG=<your-org-slug>
export CORELLIA_SMOKE_API_KEY=sk-or-v1-<openrouter-key>
./adapters/hermes/smoke.sh
```

Expect output (in order):
- `>> creating app corellia-smoke-<8char>` followed by `flyctl` confirmation.
- `>> setting secrets` confirms the secret-set call returned successfully.
- `>> spawning machine` returns a Machine ID.
- `>> probing /health (60s timeout)` flips to `>> /health OK` within ~30s.
- `>> tail of logs:` shows Hermes booting (look for the upstream's startup banner).
- The `trap` cleanup destroys the app on exit (success or failure).

### Step 2 — Go smoke (Phase 7's deliverable)

```bash
cd backend
go run ./cmd/smoke-deploy
```

Required env (all loaded via `godotenv/autoload` from `backend/.env`):
- `FLY_API_TOKEN`, `FLY_ORG_SLUG` — read by `config.Load`.
- `DATABASE_URL`, `SUPABASE_URL`, `FRONTEND_ORIGIN` — also read by `config.Load` (panics on missing); stub values fine for the smoke since none are dereferenced.
- `CORELLIA_SMOKE_API_KEY` — read directly by `cmd/smoke-deploy/main.go`. Pre-flight refuses to spawn without it.
- `CORELLIA_HERMES_ADAPTER` (optional) — overrides `defaultImageRef`. Leave unset to default to the Phase-4 digest.

Expect stdout (in order):
- `spawned: fly-app:corellia-agent-<8> <machine-id>` (one line; Spawn returned a `SpawnResult`).
- `health: starting` (one or two iterations as flyd schedules the machine).
- `health: started` (Fly reports the machine has reached `started`).
- `ok: machine reached HealthStarted`.
- `destroyed: fly-app:corellia-agent-<8>`.

Failure surface (each is fatal — the program exits non-zero with a
structured stderr line):
- `new fly target: <error>` — `flaps.NewWithOptions` failed; check `FLY_API_TOKEN`.
- `CORELLIA_SMOKE_API_KEY is empty; refusing to spawn an agent without a model credential` — pre-flight refusal; export the env var and rerun.
- `spawn: <error>` — one of CreateApp / SetAppSecret-loop / Launch failed; check `FLY_ORG_SLUG`, model API key validity, and the machine config in `fly.go`. The error chain wraps `fly: <op>: <flaps-error>` so the failing call is identifiable.
- `fail: machine reached HealthFailed` — Fly considers the machine failed; tail Fly logs for the app via `fly logs -a corellia-agent-<8>`.
- `fail: machine did not reach HealthStarted within 60s` — Fly is still scheduling; either the cold-boot is slow this run or the machine is stuck. Tail logs.

### Step 3 — Confirm clean teardown

```bash
fly apps list | grep corellia-smoke || echo "clean"
fly apps list | grep corellia-agent || echo "clean"
```

Both should print `clean`. The shell smoke creates `corellia-smoke-<8>`
apps; the Go smoke creates `corellia-agent-<8>` apps. If either grep
returns matches, manual `fly apps destroy --yes <name>` per leftover.
**Lingering apps cost real money** — Fly's auto-stop reduces idle
cost to near-zero, but a leaked app still occupies the org's app-count
quota and shows up in dashboards as noise.

### Acceptance

- Both smokes (shell + Go) green end-to-end.
- `/health` returns 200 within 30s (shell smoke); machine reports `HealthStarted` within 60s (Go smoke).
- Apps cleaned up — no leaks per Step 3.

---

## Decisions made under-the-hood (not in the plan)

- **The smoke driver is a permanent file, not a gitignored scratch.** Plan
  said "gitignored or land it permanently — operator's call." As-built
  lands it permanently for the reasons in the Index above. The
  countervailing concern — "this binary holds inert credentials in its
  *required* env-var list" — is real but already managed: every required
  env var listed in `config.Config` is documented in `.env.example`, and
  `backend/.env` (which the smoke autoloads) is gitignored. The committed
  Go file holds only the *names* of env vars, not their values; same
  property `cmd/api/main.go` already has.
- **`defaultImageRef` is a Go `const`, not a function-level variable.**
  `const`'s compile-time evaluation means the digest is baked into the
  binary; a digest bump requires editing this file (and `smoke.sh`,
  and the Phase 2 capture comment, and the Phase 4 SQL audit comment —
  the four-site update Phase 4's risk register flagged). A
  `var defaultImageRef = "..."` would be functionally identical but
  invites a future "let's read this from a config file" refactor that
  drift the digest source-of-truth into a non-versioned config — bad
  for governance because the captured digest is a *governance artefact*
  per blueprint §11.2, not an environment-tunable parameter. **`const`
  forces digest changes to be tree-visible diffs.**
- **30-iteration / 2-second poll loop, hardcoded as named constants.**
  Plan had them as bare integer literals inline (`for i := 0; i < 30; i++`,
  `time.Sleep(2 * time.Second)`). As-built names them `healthPollMax = 30`
  and `healthPollEvery = 2 * time.Second`. Two reasons: (a) the
  interaction between the two values (`60s` total budget) is more
  visible at read time; (b) tuning either value (a future Fly slowness
  forcing a longer budget, say) is a one-line edit at the top of the
  file rather than a hunt-the-magic-number exercise. Plus the timeout
  message (`"fail: machine did not reach HealthStarted within ", healthPollMax*healthPollEvery`)
  computes the budget from the constants, so the message stays
  consistent with the actual loop behavior even if the constants
  change.
- **`fmt.Println` for stdout, `fmt.Fprintln(os.Stderr, ...)` for failures.**
  Not `slog`. The smoke binary is operator-facing tooling, not a
  service; structured JSON logging would be noise for a one-shot
  CLI run. The convention is the same `smoke.sh` uses: human-readable
  lines on stdout for progress, stderr for errors. **`slog` is
  load-bearing in `cmd/api` because that binary's logs are consumed
  by Fly's log aggregator; `cmd/smoke-deploy`'s logs are consumed
  by an operator's terminal once.** Different consumer, different
  format.
- **No `flag` package, no CLI args.** Plan didn't specify; as-built
  intentionally avoids `flag` because every smoke-time variation
  (image ref, model name, agent ID) is plausibly rerunnable across
  many invocations and therefore belongs in env vars (which can be
  set once in `backend/.env` or exported in shell history) rather
  than CLI args (which have to be retyped each time). The model
  name (`anthropic/claude-3.5-sonnet`) and agent ID (`smoke-go-1`)
  *are* hardcoded; varying them is a code edit. This is fine for
  an operator-facing smoke — the smoke's job is "prove the path
  works," not "exercise every parameter combination."

---

## What this means for Phase 8

Phase 8 is the testing pass + check matrix + changelog draft. Phase 7
→ Phase 8 coupling is *evidence-shape*, not *code-shape*: Phase 7's
runtime smokes (when fired by the operator) produce the runtime
evidence the Phase 8 changelog needs to claim "M3 ships a working
end-to-end Fly deploy path." Three sub-couplings:

1. **Phase 8 doesn't depend on Phase 7's runtime smokes having fired.**
   The unit tests Phase 8 adds (`internal/deploy/`'s `mapFlyState`,
   `appNameFor`, `validateImageRef`; `internal/adapters/`'s
   `UpdateImageRef` happy/not-found pair) all run in-process against
   in-memory fixtures. They land regardless of whether the operator
   has run `cmd/smoke-deploy` yet. The runtime smokes are *the
   acceptance criterion for the M3 changelog entry's runtime claim*,
   not a prerequisite for the unit tests.
2. **The Phase 8 changelog should explicitly distinguish "static
   check matrix green" from "runtime smoke green."** Same shape M2's
   changelog made for "operator runtime walkthrough" and Phase 4's
   completion doc made for the migration's down/up-cycle test. Static
   checks are the shipping gate; runtime smokes are the deploy
   confidence gate. Both are necessary; neither subsumes the other.
3. **Phase 7's smoke binary is testable territory for Phase 8 too.**
   `cmd/smoke-deploy/main.go`'s pre-flight check on `CORELLIA_SMOKE_API_KEY`
   and the env-var fallback for `CORELLIA_HERMES_ADAPTER` are pure
   functions of os env state — they could be table-tested. Whether
   they *should* be is a Phase 8 judgment call: the smoke binary is
   tooling, not application code, and tooling rarely earns unit tests
   in this codebase. Plan §Phase 8 didn't list it; as-built defers
   to that decision.

Phase 8 does not need to read this completion doc to draft the
changelog or write the unit tests — the relevant artefacts (the
smoke binary, the deploy package, the adapters service) are
self-documenting via their public Go signatures. The completion
doc captures the *why* and the *audit chain*; the type system and
the runbook capture the *what* and the *how*.

---

## Pre-work tasks status

The plan's §3 pre-work checklist is fully closed by Phase 4; Phase 7
inherits a fully-prepared substrate:

- ☑ Phase 1's Hermes adapter image published at GHCR with the
  pinned digest captured (`sha256:d152b3cb…`); the Go smoke uses
  this digest as `defaultImageRef`.
- ☑ Phase 5's `internal/deploy/` package compiled, tested, and
  ready — Phase 7 only consumes the constructor + `Spawn` /
  `Health` / `Destroy` and the `SpawnSpec` type.
- ☑ Phase 6's `cmd/api` boot pattern — Phase 7 reuses the same
  config-load + slog-error + os.Exit shape (with `fmt.Fprintln`
  in place of `slog` for tooling reasons documented above).
- ☑ Phase 3's `adapters/hermes/smoke.sh` already operating against
  the same digest — the two smokes are in lockstep on the image
  artefact under test.

Branch hygiene remains soft (same as Phases 1–6); the new
`backend/cmd/smoke-deploy/` directory is uncommitted alongside the
rest of the M3 working tree.

---

## Risks / open issues opened by Phase 7

- **The runtime smoke is unverified by static checks alone.** Static
  matrix proves the *types* are right and the *binary builds* — but
  not that calling the real Fly API produces the expected sequence of
  responses. The first time `cmd/smoke-deploy` runs against a real
  endpoint is the first time several invariants get tested
  empirically: that `flaps.CreateApp` accepts the slug we pass, that
  `flaps.SetAppSecret` accepts the env-var keys, that `flaps.Launch`
  accepts the `MachineConfig` shape, that `flaps.List` returns
  machines with the state strings `mapFlyState` knows how to map.
  Any of these can fail; if they do, the failure mode is a
  wrapped-error chain with `fly: <op>: <flaps-error>` — the
  operator should be able to identify the failing call from the
  error text alone. **The wrapped error chain is the diagnostic
  contract** — Phase 8's risk register might want to capture this
  for the eventual production runbook.
- **`CORELLIA_HERMES_ADAPTER` env-var override is unbounded.**
  Setting `CORELLIA_HERMES_ADAPTER=ghcr.io/foo/bar:latest` would
  pass `validateImageRef`'s `@sha256:` check (no, actually it
  wouldn't — `validateImageRef` requires `@sha256:` containment;
  a tag-form ref would be rejected). But setting it to a
  digest-pinned image that *isn't* the Hermes adapter — say,
  `ghcr.io/library/postgres@sha256:...` — would pass validation,
  spawn cleanly, then fail Health probes because Postgres isn't
  Hermes. The smoke would fail, but the failure mode is "Health
  never reached Started," not "image was wrong." Belt-and-braces:
  the smoke could check the image-ref *prefix* matches an
  expected `ghcr.io/.../corellia-hermes-adapter@` substring.
  Deferred — over-validation for an operator-facing tool whose
  invocation pattern is "set the var or accept the default";
  the failure mode is fast and the diagnosis is `fly logs`.
- **The smoke creates real Fly apps that cost real money.** Fly's
  auto-stop reduces idle cost to near-zero, but a *leaked* app
  (one the smoke didn't clean up due to a panic between Spawn
  return and the deferred Destroy registration) accrues a small
  cost until manually destroyed. The window is the ~3 lines
  between `Spawn` returning and the `defer` registration; a panic
  in those 3 lines is the only path that leaks. No panic site
  exists today; the risk is theoretical but worth flagging
  because future edits could introduce one.
- **No retry on transient flaps errors.** A transient 502 from
  `flaps.Launch` mid-Spawn surfaces as a `spawn: <error>` and
  the smoke exits with the deferred Destroy *not* having anything
  to destroy (the app was created but the machine launch failed).
  In that scenario the deferred Destroy still fires (against the
  app that *was* created via `flaps.CreateApp`), so cleanup is
  correct, but the operator's mental model — "spawn failed,
  nothing to clean up" — is wrong. The runbook should include
  a manual `fly apps list | grep corellia-agent` even after a
  spawn-time failure. Deferred to runbook documentation; not a
  code issue.
- **The smoke holds DB / Supabase / Frontend env-var requirements
  through `config.Load`.** As noted above, this means the smoke
  can't run from a fresh checkout that doesn't have a populated
  `backend/.env` — even though it dereferences none of those
  fields. Mitigation: the operator runbook documents the
  fully-populated env requirement; alternatively, a `FlyConfig{}`
  struct is a 20-LOC Phase 8 follow-up that decouples smoke env
  from app env. **Deferred because the friction has not yet
  surfaced** (every developer with the codebase has a populated
  `backend/.env` already).

---

## What's still uncommitted

Phase 7 produces a one-file diff in the repo:

- `backend/cmd/smoke-deploy/main.go` (new, 108 LOC)

Untracked, joining the M3 working tree (Phases 1–6's adapter source,
smoke script, migration, deploy package, and main.go wiring). The
Phase 7 diff has *no* runtime durability against the dev DB and *no*
external state changed — until the operator actually fires the smoke
binary, in which case it creates and destroys one Fly app per run,
both managed entirely by the smoke's lifecycle. **Phase 7 is the
second-most-reversible phase in M3, after Phase 5** — Phase 5 was
a new directory with no consumer; Phase 7 is a new directory with
its own `main()` function and no link to `cmd/api`. Reverting Phase
7 = `rm -rf backend/cmd/smoke-deploy/` with zero blast-radius into
the rest of the binary. The shell smoke (Phase 3) is unaffected and
remains operative as the alternate-path validation.

---

`★ Insight ─────────────────────────────────────`
- **Phase 7's smoke binary is the cheapest possible binary that
  proves Phase 5's package works against real Fly.** Two non-stdlib
  imports (`internal/config`, `internal/deploy`); 108 LOC of glue
  with three guardrails the plan didn't specify; an 11.9MB static
  binary that runs in one shell command. Pre-Phase 7, the codebase
  had two ways to call Fly: the shell path (Phase 3's `smoke.sh`,
  via `flyctl`) and the binary path (Phase 6's `cmd/api`, embedded
  in the running web server). Phase 7 introduces the **third**
  path — `cmd/smoke-deploy`, the SDK-direct path — which is the
  only one that exercises Phase 5's wrapper code in isolation
  from the web server's Connect / DB / auth substrate. **This
  three-path structure makes failure-mode triangulation possible**:
  if `cmd/smoke-deploy` succeeds but `cmd/api`'s spawn flow fails
  (when M4 lands), the bug is in M4's wiring, not Phase 5's
  wrapper. If `cmd/smoke-deploy` and `smoke.sh` disagree, the bug
  is in `fly.go`'s SDK-call shape vs. flyctl's CLI-call shape.
- **The plan-vs-as-built drift on Go API code has now happened in
  three out of seven M3 phases.** Phase 4 (the `*string → string`
  type-flip implication wasn't in the plan), Phase 5 (the
  `fly-go` SDK call shapes), and Phase 7 (the `cmd/smoke-deploy`
  signatures). **The plan got the architecture right in every
  case and the code wrong in every case** — which is the empirical
  argument for "plans should specify abstractions, codebases
  should specify call sites." The ratio (3/7 phases needed
  signature touch-up; 0/7 phases needed structural rework) is
  the right one for a healthy plan: structural decisions are
  hard and benefit from upfront design; call-site decisions are
  cheap and should be made in the code.
- **Phase 7 is the first M3 phase with no in-tree consumer of
  its deliverable.** Phases 1–6 all built things that the next
  phase (or the running binary) consumed. Phase 7's
  `cmd/smoke-deploy` has no in-tree caller and isn't expected to
  acquire one — it's tooling, not application code. The right
  way to read its status in the M3 graph: **it's a leaf node**.
  Phase 8's testing pass adds another leaf (unit tests) but
  doesn't depend on Phase 7's leaf. Both feed into the M3
  changelog draft. The phase ordering 1→2→3→4→5→6→7→8 is
  topological, but 7 and 8 are siblings under 6, not strictly
  sequential. The plan's linear numbering implied a chain;
  the actual dependency graph is shallower.
`─────────────────────────────────────────────────`

---

*(Phase 8 — testing pass + check matrix + changelog draft for
M3 — is next.)*
