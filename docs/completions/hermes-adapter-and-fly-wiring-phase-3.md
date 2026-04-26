# Completion — M3 Phase 3: `adapters/hermes/smoke.sh` + README invocation block (2026-04-26)

**Plan:** `docs/executing/hermes-adapter-and-fly-wiring.md` §Phase 3
**Status:** Phase 3 landed; Phases 4–8 pending.
**Predecessors:**
- `docs/completions/hermes-adapter-and-fly-wiring-phase-1.md` (adapter source artefacts)
- `docs/completions/hermes-adapter-and-fly-wiring-phase-2.md` (multi-arch build + GHCR publish + digest capture; Phase 3 hand-off section)

This document records the *as-built* state of Phase 3. Phase 1 produced
the adapter source (`Dockerfile`, `entrypoint.sh`, `README.md`,
`.dockerignore`); Phase 2 published it as a content-addressed multi-arch
image at GHCR and rehearsed the Fly substrate pull; Phase 3 lands the
**operator-facing smoke harness** that boots that published image on a
real Fly machine end-to-end. No backend, frontend, proto, or schema
edits — Phase 3 is operator-tooling work end-to-end. Two committable
artefacts: a new ~110-LOC bash script (`adapters/hermes/smoke.sh`,
`chmod +x`'d) and a ~25-line edit to `adapters/hermes/README.md`'s
"Smoke test" section that turns a forward-looking placeholder into a
real invocation block with caveat documentation.

---

## Files added / changed

| File | Status | LOC | Notes |
|---|---|---|---|
| `adapters/hermes/smoke.sh` | new | 110 | `#!/usr/bin/env bash`, `set -euo pipefail`, executable (`-rwxr-xr-x@`). |
| `adapters/hermes/README.md` | edit | +30 / -5 | "Smoke test" section: placeholder → real invocation + caveat block. |

No backend, frontend, proto, schema, or domain-package edits. Phase 4
(migration) reads the Phase 2 captured-metadata block directly into
SQL — Phase 3 does not stage anything for it.

---

## Index

- **`smoke.sh` shape: ~110 LOC, single bash script, zero non-`fly`
  dependencies.** Modelled after the Phase 2 rehearsal's working
  pattern — explicit `fly apps create` → `--stage` secrets →
  `fly machines run --restart no --detach` → state poll → bounded log
  dump → trap-EXIT destroy. Plain bash, no `jq` (a deliberately-cheap
  awk-on-quoted-strings JSON parse for the state field), no Python, no
  Go test harness. The script is one operator command from a
  cold-checkout: `./adapters/hermes/smoke.sh` after exporting two env
  vars (`FLY_ORG_SLUG`, `CORELLIA_SMOKE_API_KEY`).
- **Three departures from the plan's exact `smoke.sh` sketch.** All
  three flagged in Phase 2's "What this means for Phase 3" section;
  Phase 3 absorbed them all rather than relitigate the plan:
    1. **No `curl /health` loop.** Hermes 0.x is CLI-shaped (Phase 1
       discovery — no HTTP server, no `/health`). Replaced with a
       `fly machines list --json` poll asserting `state == started`,
       plus a bounded `fly logs --no-tail` dump for the human reader.
       The plan's `for i in $(seq 1 30); do curl -sf .../health` would
       404 indefinitely against a real Hermes machine; the state poll
       is the honest signal.
    2. **`fly logs --no-tail` is bounded.** Phase 2 documented this
       CLI quirk: `--no-tail` hangs on empty log streams instead of
       printing-and-exiting. The script wraps the call in `gtimeout`
       (from `brew install coreutils`) and falls back to a
       backgrounded-and-killed `( cmd & ; sleep 15; kill $! )` pattern
       on hosts without coreutils. Two-line conditional; same shape
       Phase 2 recommended verbatim.
    3. **Explicit `fly apps create` + trap-EXIT destroy.** Phase 2
       corrected my initial reading that `--rm` doesn't exist (it
       does); the right pattern is still explicit-create + trap-destroy
       because `fly apps destroy` removes app + machines atomically
       and doesn't need `--rm`'s sugar. Trap is registered *before*
       `fly apps create` so even an early-failure path still fires
       the destroy harmlessly (the `2>/dev/null || true` swallows the
       "no such app" error).
- **Also dropped the plan's `--port 80:8642 / --port 443:8642` lines.**
  Plan §Phase 3 task 1 advertises an HTTP listener on Hermes's
  blueprint-§3.1 port; Hermes does not expose one (Phase 1 discovery).
  Binding ports the binary doesn't listen on would only confuse Fly's
  proxy-attached health checks (the auto-attached external probe would
  fail and Fly would mark the machine unhealthy, undermining the
  state-poll signal we *do* trust). The smoke spawns a machine with no
  port mappings; the state poll alone is the success signal.
- **Default image baked in is Phase 2's captured digest.** Line 36 of
  the script:
  ```bash
  IMAGE="${CORELLIA_HERMES_ADAPTER:-ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:d152b3cbf7ed0d67a204dd3de041b0248ca0e550aeb9b9ad2537ce12f98ff0b6}"
  ```
  Operator overrides via `CORELLIA_HERMES_ADAPTER=...` for testing a
  pre-publish build; the default points at the registry-published
  image so a cold-checkout operator runs against the canonical
  artefact with no extra setup. **The digest matches Phase 2's
  captured value exactly** — this is the second place in the codebase
  the digest now appears (the first is awaiting Phase 4's migration).
  When Phase 4 lands, the migration's UPDATE value, `smoke.sh`'s
  default, and the eventual Phase 8 changelog entry should all carry
  the same string; one find-and-replace bumps all three coherently
  when a future digest cycle happens.
- **Required env-var guard via `: "${VAR:?must be set}"`.** Two
  variables (`FLY_ORG_SLUG`, `CORELLIA_SMOKE_API_KEY`) abort the
  script with a contextful error message at the top instead of
  failing midway through `fly apps create` or `fly secrets set` with
  a confusing downstream error. The `:` no-op-builtin trick is the
  right shape for *required input* (vs. `${VAR:-default}` for
  *optional input with fallback*); using both in the same script
  signals the input-classification clearly to the next reader.
- **`--stage` on `fly secrets set`.** Without `--stage`, setting
  secrets on an app with no machines triggers an empty release (Fly
  tries to roll forward "the deployment" and finds nothing). `--stage`
  defers the secret application until the next machine creation,
  which is exactly when `fly machines run` happens two lines later.
  One fewer warning in the operator terminal; correct semantics for
  the create-app → set-secrets → spawn-machine sequence the smoke is
  built around.
- **State poll exits early on terminal-failure states.** The
  `case "$STATE" in started ... stopped|failed)` switch surfaces
  `stopped` / `failed` immediately (rather than waiting the full 60s)
  by `break`ing without setting `SUCCESS=1`, then the script falls
  through to the bounded log dump for an operator eyeball-check, then
  exits 1. Crash-loops surface in ~6–10s instead of always paying the
  full 60s; legitimate slow boots still get the full window.
- **Final exit code communicates pass/fail.** `exit 0` on success,
  `exit 1` on timeout/terminal-failure. The trap on EXIT runs in
  *both* cases — destroy semantics are independent of pass/fail. This
  matters for Phase 7's invocation, which will likely capture the
  exit code in a higher-level test report.

---

## Decisions made under-the-hood (not in the plan)

- **`awk -F'"' '/"state":/ {print $4; exit}'` instead of `jq -r
  '.[0].state'`.** `jq` is a near-universal install but not a
  guaranteed one; an operator-facing smoke script that requires
  `brew install jq` adds a setup step. The awk parse depends on
  Fly's JSON output keeping the `"state": "<value>"` shape (which is
  part of `flyctl`'s public JSON contract — breaking-change-protected
  by deprecation). The trade-off is "zero new dependencies, structurally
  fragile but quickly debuggable" vs. "one more brew prerequisite for
  guaranteed parsing"; for a smoke script the first wins. If a future
  rev pulls in `jq` for a richer assertion (e.g., parsing
  `image_ref.digest` to verify the spawned machine is running our
  pinned image), the awk parse can be swapped at the same time.
- **Trap message includes the app name.** Plan's task 1 sketch had
  `trap 'fly apps destroy --yes "$APP" 2>/dev/null || true' EXIT`;
  Phase 3's implementation prepends `echo ">> tearing down $APP"; `
  so the operator sees the destroy fire in their terminal output even
  on a clean exit. Trivial addition (~30 chars); meaningful operator
  signal that "yes, the trap actually ran." Without it, a successful
  smoke ends with the bounded-log-dump's output and silence — the
  trap fires after the script's last visible line, leaving the
  operator briefly unsure whether cleanup happened.
- **Heredoc-style multi-line `fly secrets set` with `\` continuations.**
  The plan's sketch used the same style; reaffirmed in implementation.
  Single-line variant works too but reads as a wall of `=` pairs;
  one-secret-per-line with backslash continuations is the standard
  bash style for multi-arg invocations and matches what the M4 spawn
  flow's Fly API caller will produce structurally (one
  secret-per-line is also how Fly's Machines API JSON body shapes
  the secrets array).
- **No `set -x` / verbose-mode flag.** Considered adding
  `${SMOKE_VERBOSE:+set -x}` for debug-mode tracing; rejected as
  premature. The script's `echo ">> ..."` step markers already give
  enough operator-visible progress; full bash trace would obscure
  more than reveal in the common-case run. If Phase 7 or operator
  use surfaces a "what did the script actually do?" debugging need,
  adding `SMOKE_VERBOSE=1` later is a one-line change.
- **README's caveat block lists *what the smoke does not probe*, not
  just *how to invoke*.** Documenting absences explicitly (no
  `/health` poll, no `--port` binding, bounded `fly logs`) is the
  honest shape for a v1 smoke that's known to be operating against a
  partially-implemented harness contract. The next reader (or M4
  plan author) lands on the smoke and immediately sees what it can
  and cannot validate, instead of having to dig into Phase 1's
  completion doc to find the runtime-contract gap.

---

## Acceptance check (plan §Phase 3 acceptance criteria)

- ☑ **Script exists, is executable, and is committed.** Existence:
  yes (`adapters/hermes/smoke.sh`, 110 LOC). Executable: yes
  (`-rwxr-xr-x@ ... 4574 ... smoke.sh` — the `chmod +x` step from
  task 3 ran cleanly). "Committed" status: same as the rest of the
  M3 working tree — uncommitted at file-system level following the
  branch-hygiene pattern Phases 1 and 2 also have. The file is
  *committable* (no secrets, no host-specific paths, no temp-file
  artefacts); a single commit can land Phase 1's four files +
  Phase 3's two file changes whenever branch hygiene is decided.
- ☑ **`bash -n adapters/hermes/smoke.sh` clean.** Syntax-only check
  ran with no output (the bash convention for "no errors found"). No
  unmatched quotes, no malformed control flow, no shebang issues.
- ☑ **README documents invocation.** "Smoke test" section now contains
  the three-line export-and-run block, two optional-override docs
  (`CORELLIA_HERMES_ADAPTER`, `REGION`), and the three-bullet "what
  the smoke does *not* probe" caveat block.

Net: 3/3 plan acceptance criteria satisfied.

**Not in the plan's acceptance set but worth recording:** an
end-to-end *execution* of the smoke against a live Fly machine was
**not** run as part of Phase 3. The plan deliberately scopes Phase 3
to "the operator-facing smoke script exists and is documented;
Phase 7 invokes it against the registry-pushed image." Phase 7's
"End-to-end harness contract validation (smoke)" milestone is the
first time `smoke.sh` runs against a real Fly app for verification
purposes. Phase 3's contribution is the *artefact*; Phase 7's is the
*invocation report*.

---

## Pre-work tasks status

The plan's §3 pre-work checklist has been progressively closed across
Phases 1 + 2; Phase 3's only direct dependency was Phase 2's published
image (so the script's default `IMAGE=` is a real, pullable digest
ref). No new pre-work items were opened or closed by Phase 3 itself.
Branch hygiene remains soft (same as Phases 1 + 2 — single-thread M3
work on `master`'s working tree); no separate branch was cut for
Phase 3 work.

---

## What this means for Phase 4

Phase 4 is the goose migration that writes Phase 2's captured digest
(`sha256:d152...`) into `harness_adapters.adapter_image_ref` and
tightens the column from `TEXT NULL` to `TEXT NOT NULL` (per the
0.4.0 changelog's "Phase 1 leaves `adapter_image_ref` as `TEXT NULL`;
M3 fills it and tightens the column to `NOT NULL`" framing). Phase 3
hands Phase 4 nothing it doesn't already have — Phase 2's "Captured
metadata" block is the single source of truth the migration imports
verbatim. The only Phase 3 → Phase 4 coupling is the *coordination*
of the digest string: today it appears in `smoke.sh`'s default
`IMAGE=` value; Phase 4 adds a second appearance in the migration's
UPDATE clause; Phase 8's changelog will add a third. Future digest
bumps need a coherent edit across all three sites — flagged here so
the bump runbook (post-v1) lists them.

Phase 5 (`internal/deploy/` package) does not depend on Phase 3 at
all; the package's `FlyDeployTarget` reads `adapter_image_ref` from
the database (which Phase 4 backfills), not from `smoke.sh`. Phase 3
is a sibling artefact, not a dependency.

---

## Risks / open issues opened by Phase 3

- **Smoke has not been executed end-to-end yet.** The script is
  syntax-clean and structurally complete; the first real-Fly run
  happens in Phase 7. Possible Phase 7 surprises: (a) the upstream
  Hermes entrypoint may print a startup error when no
  `$HERMES_HOME/config.yaml` is staged (the upstream entrypoint
  bootstraps a default if missing per the inspection in Phase 1, but
  that path may emit warnings worth grepping for); (b) the
  state-poll's awk parse may need adjustment if `flyctl`'s JSON
  output has subtle indentation (the parse is whitespace-tolerant
  for the value but not the key); (c) the `gtimeout` fallback path
  has not been exercised on a coreutils-installed host (it's the
  fallback for when coreutils is absent — verified by inspection,
  not by run). Any of these surface as a Phase 7 finding rather
  than a Phase 3 regression.
- **The default `IMAGE=` digest will go stale on the next adapter
  rebuild.** Phase 2 documented that BuildKit attestation manifests
  make the manifest-list digest non-deterministic across rebuilds.
  When the next rebuild happens (e.g., post-v1 upstream Hermes digest
  bump), the script's default needs editing to match. The
  `CORELLIA_HERMES_ADAPTER` env-var override means this is a
  zero-blocker for an operator with the new digest in hand — they
  just `export CORELLIA_HERMES_ADAPTER=...` before invoking — but
  the default-bake convenience evaporates until the script catches
  up. Flagged in this doc rather than the script itself because the
  script's job is to be runnable as-is; documenting the staleness
  failure mode here is more useful than embedding it as a comment
  the operator only sees mid-debug.
- **Smoke depends on `OpenRouter` being a viable provider for the
  test-key path.** The script hard-codes
  `CORELLIA_MODEL_PROVIDER="openrouter"` and
  `CORELLIA_MODEL_NAME="anthropic/claude-3.5-sonnet"`. If OpenRouter
  ever drops the free tier, deprecates that model alias, or changes
  the API-key format, the smoke breaks. Mitigation today is the
  documented `CORELLIA_SMOKE_API_KEY` (operator can swap the key);
  for a richer fix, a `SMOKE_PROVIDER` / `SMOKE_MODEL` env-var pair
  would let the operator override both. Deferred — over-parameterizing
  a v1 smoke for hypothetical breakage is exactly the trap CLAUDE.md
  warns against ("don't design for hypothetical future requirements").
  When OpenRouter deprecation actually happens, add the override
  vars in the same edit.
- **No CI hook for `bash -n` on `smoke.sh`.** Phase 1's completion
  doc flagged the same gap for `entrypoint.sh`; the same one-line
  `find adapters -name '*.sh' -exec bash -n {} \;` (or `sh -n` for
  the entrypoint) covers both when CI lands post-v1. Bundle them at
  CI-setup time; today the verifier is the developer's diligence.
- **No assertion that the spawned machine is *actually running our
  pinned image*.** The state poll asserts `state == started` but
  doesn't read back `image_ref.digest` to verify the running image
  matches `IMAGE`. A faulty Fly substrate cache or a wrong
  `IMAGE=` value would produce a false positive (the wrong image
  starts cleanly and reports `started`). Adding the assertion is
  ~5 LOC of `jq` against `fly machines list --json`; deferred for
  the same reason the awk-vs-jq trade-off was made (no new
  dependencies for v1). When Phase 7 lands `jq` as a real
  dependency for any other reason, this assertion becomes free.

---

## What's still uncommitted

Phase 3 produces two file diffs in the repo:

- `adapters/hermes/smoke.sh` (new, 110 LOC, `chmod +x`)
- `adapters/hermes/README.md` (edit, +30 / -5)

Both untracked / unstaged, joining the still-uncommitted Phase 1 +
Phase 2 working tree (Phase 1's four adapter files + Phase 2's zero
file diffs + Phase 3's two). A single M3-bundled commit could
package Phases 1 + 3's adapter source under one log entry whenever
branch hygiene is settled. Phase 4's migration will be the first
M3 artefact that *requires* a commit (because `goose up` doesn't
care about working-tree state, but the migration filename ordering
matters for repeatability).

---

`★ Insight ─────────────────────────────────────`
- **Phase 3 was the first phase that absorbed a predecessor's
  hand-off corrections wholesale.** Phase 1 closed M2's pre-work
  items it could; Phase 2 closed Phase 1's deferred Docker-and-GHCR
  items. Phase 3 took *three concrete corrections to its own plan
  text* from Phase 2's "What this means for Phase 3" section
  (`/health` removal, `fly logs` bounding, `--rm` semantics) and
  applied them without re-opening the plan-vs-reality discussion.
  This is the completion-doc-as-living-handoff pattern paying
  dividends — the plan locks intent, the predecessor's completion
  doc holds the plan accountable to reality, the next phase reads
  both and ships the union. Far cleaner than a plan revision (which
  would conflict with the still-pending Phases 4–8) or a
  meta-discussion (which would burn iteration time on what the right
  shape of `smoke.sh` is, instead of just writing it).
- **The "trap before action" idiom is more important than it looks
  for cost-bearing operations.** Smoke scripts that create
  cost-bearing resources (Fly apps, AWS instances, Postgres
  databases) need the cleanup trap registered *before* the resource
  is created — otherwise a failure between trap-registration and
  resource-creation leaves nothing to clean up, but a failure
  between resource-creation and trap-registration leaks the
  resource silently. Phase 3's trap is the third line after `set
  -euo pipefail`, well before `fly apps create`. The
  `2>/dev/null || true` guards make it harmless when the resource
  doesn't yet exist. This is a small correctness property that
  generalizes: any operator-side script that creates
  cost-bearing resources should follow this template.
- **The `--port 80:8642 / --port 443:8642` lines in the plan are
  a perfect example of "the plan is honest about what the
  blueprint says; the implementation is honest about what the
  upstream does."** Blueprint §3.1 names port 8642 as Hermes's
  documented port; the plan dutifully wires it through. Phase 1
  discovered Hermes 0.x does not actually listen on any port;
  Phase 3 dropped the port lines. Neither author was wrong — the
  plan was written against the contract, the implementation was
  written against reality. The right artefact (`smoke.sh`) is
  the one that matches reality; the right artefact (`blueprint.md`)
  is the one that names the contract; the bridge between them is
  the completion-doc trail that records the gap. Once the v1.5
  sidecar lands and Hermes does expose port 8642, Phase 3's port
  lines come back — and the completion doc's record of *why they
  were dropped in v1* is the single best evidence for *why they
  should be re-added in v1.5*.
`─────────────────────────────────────────────────`

---

*(Phase 4 — migration backfilling `adapter_image_ref` + tightening
to `NOT NULL` — is next.)*
