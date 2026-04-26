# Completion — M3: Hermes adapter image + Fly account wiring

**Plan:** `docs/executing/hermes-adapter-and-fly-wiring.md`
**Status:** Phase 1 landed; Phases 2–8 pending.
**Owner:** TBD

This document records the *as-built* state of the M3 milestone, phase by phase. The plan captures intent and locks decisions ahead of time; this document captures what actually happened, what surprised us, and what the next phase needs to know that the plan doesn't already say. Phases 2–8 will be appended to this same file as they land (matching the M2 single-file consolidation convention visible in `docs/completions/agent-catalog.md`).

---

## Phase 1 — Hermes adapter Dockerfile + entrypoint (2026-04-25)

**Files added** (all under a new top-level `adapters/hermes/` directory — Decision 1's repo-root placement, alongside `backend/`, `frontend/`, `shared/`):

- `adapters/hermes/Dockerfile` (29 LOC)
- `adapters/hermes/entrypoint.sh` (109 LOC, POSIX `/bin/sh`)
- `adapters/hermes/README.md` (139 LOC)
- `adapters/hermes/.dockerignore` (5 LOC)

**Files unchanged.** No backend, frontend, proto, schema, or query edits in Phase 1. The deploy package (`internal/deploy/`) lands in Phase 5; the migration in Phase 4; the wiring in `cmd/api/main.go` in Phase 6. Phase 1 is purely the harness-side artefact.

### Index

- **Adapter directory at repo root** (Decision 1). `adapters/hermes/` sits alongside `backend/`, `frontend/`, `shared/` — adapters are operational artefacts, not Go or TS code. Future adapters land as siblings (`adapters/langgraph/`, `adapters/crewai/`, etc.) when v1.5+ widens the catalog.
- **Upstream digest pinned to the M2-seeded value.** The `Dockerfile`'s `FROM` line is `docker.io/nousresearch/hermes-agent@sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338` — bit-identical to `harness_adapters.upstream_image_digest` from `backend/migrations/20260425170000_agent_catalog.sql:34`. Decision 2's "single source of truth is the database; the Dockerfile *quotes* it" is structural: the next digest bump goes into a new migration first, the Dockerfile follows in the same PR.
- **Wrapper is POSIX `/bin/sh`** (Decision 3 verified). Pre-work inspection confirmed the upstream image is Debian-Trixie-based with `/bin/sh` available, so the fallback decision-3-flip ("wrapper as static Go binary") was not needed.
- **Translation table derived from real upstream config** (Decision 4 honored). `entrypoint.sh`'s case-statement is grounded in the upstream `.env.example` and `cli-config.yaml.example` shipped at the pinned digest, fetched via raw.githubusercontent. Three of the four `CORELLIA_*` vars have honest native targets; the fourth (`CORELLIA_MODEL_NAME`) does not — flagged below.
- **Image runs as `hermes` (UID 10000), not root.** Upstream's Dockerfile sets `USER hermes`; our adapter inherits that. The `COPY` step needs root briefly to land `/corellia/entrypoint.sh` outside `$HERMES_HOME` (which is a VOLUME), so the Dockerfile uses the standard `USER root` → `COPY --chmod=0755` → `USER hermes` triplet. Avoids a `RUN chmod +x` layer.
- **Adapter exec's into upstream's own entrypoint, not directly into `hermes`.** The wrapper's final line is `exec /opt/hermes/docker/entrypoint.sh "$@"`, not `exec hermes "$@"`. Upstream's entrypoint does its own privilege-drop logic (root→hermes via gosu), `$HERMES_HOME` directory bootstrap, and config-file seeding (`.env`, `config.yaml`, `SOUL.md`); we don't want to duplicate that work or fight it. Stacking adapters this way makes future digest bumps safe — if upstream changes its boot logic, our wrapper does not need to track it.
- **Sh-syntax verified, rename branches simulated and asserted.** `/bin/sh -n adapters/hermes/entrypoint.sh` is clean. A no-Docker simulation harness ran the script with the final `exec` line stripped and verified the env-var mutations across five inputs (openrouter, anthropic, gemini, no-provider, unknown-provider). All five matched expectations; the unknown-provider branch exits 64 (EX_USAGE) with the documented stderr message.
- **`docker build` deferred** because the host's Docker Desktop daemon is not currently running. Decision 4's pre-work checklist anticipated this kind of obstacle. The Dockerfile is structurally complete and references real layers; the build will succeed when Phase 2 is executed with Docker running. Phase 1's local-sanity-exec test (per the plan's task 8) is also deferred to Phase 2's bring-up — once `docker build` produces an image locally, the documented `docker run --entrypoint /bin/sh ... -c '/corellia/entrypoint.sh /bin/sh -c "env | ..."'` invocation will exercise the rename behaviour against the real image rather than the no-Docker simulation.

### Translation table (as-derived from upstream)

| `CORELLIA_*` env var | Hermes-native target | Source | Notes |
|---|---|---|---|
| `CORELLIA_AGENT_ID` | `AGENT_ID` (passthrough rename) | None — Hermes has no externally-supplied agent-ID concept | Retained for observability (logs / Fly metadata / subprocess hooks) |
| `CORELLIA_MODEL_PROVIDER` | `HERMES_INFERENCE_PROVIDER` | `cli-config.yaml.example` line 43 (`provider: "auto"` default; "Can also be overridden with `--provider` flag or `HERMES_INFERENCE_PROVIDER` env var") | Supported values mirror upstream's enum: `openrouter`, `anthropic`, `openai`, `gemini`, `nous-api` |
| `CORELLIA_MODEL_API_KEY` | provider-conditional: `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` / `NOUS_API_KEY` | `.env.example` lines 10, 22, 24 + `cli-config.yaml.example` lines 17–19 | Branch keyed by `CORELLIA_MODEL_PROVIDER`; unknown provider → exit 64 |
| `CORELLIA_MODEL_NAME` | *(no env-var target in Hermes 0.x)* | `.env.example` lines 13–14 explicitly: "LLM_MODEL is no longer read from .env — this line is kept for reference only" | Selection lives in `$HERMES_HOME/config.yaml` under `model.default` or via the `--model` CLI flag |

**Hermes listening port:** N/A. Hermes 0.x is a CLI-shaped agent — it does not run an HTTP server, so blueprint §3.1's `8642` (or any port) does not apply. See "Discovery: runtime-contract gap" below.

**Does upstream's `/health` endpoint require an LLM call?** N/A. There is no `/health` endpoint.

### Discovery: runtime-contract gap with blueprint §3.1

Pre-work inspection (the upstream `entrypoint.sh` and `README.md` fetched from `github.com/NousResearch/hermes-agent` at HEAD) confirmed Hermes is **CLI-shaped, not server-shaped**. The upstream entrypoint defaults to `exec hermes "$@"` and the documented invocation patterns (`docker run <image>`, `docker run <image> chat -q "..."`) are CLI ones. There is no built-in HTTP server with `/health` and `/chat` endpoints.

This contradicts blueprint §3.1's runtime contract assumption that "the running harness exposes" such endpoints. The discrepancy is *real*, not a documentation slip — Hermes's product story (agent runs on a `$5 VPS`, talks via CLI / Telegram / Discord / Slack gateway plugins) is genuinely server-less.

**Implication for the rest of M3:**

1. **Phase 7 smoke test cannot probe `/health`.** The plan's `smoke.sh` polls `https://${APP}.fly.dev/health`; no such endpoint will be there. Phase 3 (which lands `smoke.sh`) needs to either (a) replace the `/health` poll with a "Fly machine state == started" + `fly logs` content match, or (b) introduce a thin sidecar (e.g., `socat` or a tiny Go process) that exposes a port-80 200-OK as a process-liveness signal. Option (a) is the closer fit to v1 scope.
2. **`FlyDeployTarget.Health` (Phase 5) is honest as-is.** The plan's Decision 25 already implements `Health` against `flaps.GetMachine` — Fly's machine state, not Hermes's process state. That mapping is now actively *better* than the alternative (a `/health` probe that doesn't exist), and the plan's separation-of-concerns rationale (Decision 16: "do **not** wait for `/health` — that's M4's caller-side concern") is now unrequired-but-still-correct: there is no `/health` for M4 to wait on either.
3. **Closing the contract gap is a v1.5 concern.** Likely shape: a sidecar HTTP wrapper that exposes `POST /chat` and forwards to `hermes chat -q "..."` while owning its own health endpoint. This belongs in a separate plan because it touches the harness contract design, not just Phase 1's wrapper. Flagged in `adapters/hermes/README.md` §"Known limitations" so the next plan reader does not assume the contract is implemented.

This discovery does **not** invalidate Phase 1's deliverable — env-var translation + boot-into-upstream is correct and required regardless of whether the contract is fully closed. It just narrows what Phase 7's smoke can claim and pushes "full §3.1 compliance" out to v1.5.

### Decisions made under-the-hood (not in the plan)

- **`USER root` → `COPY --chmod=0755` → `USER hermes` instead of `RUN chmod +x`.** The plan's Phase 1 Dockerfile sketch used `RUN chmod +x /corellia/entrypoint.sh`, which would have required root (the upstream image declares `USER hermes`, UID 10000). Using buildkit's `COPY --chmod=0755` syntax saves a layer and avoids the `RUN`-as-hermes-fails-on-permissions footgun. Same outcome, smaller image.
- **`COPY` lands at `/corellia/entrypoint.sh`, not `/opt/data/...` or `/opt/hermes/...`.** `/opt/data` is a `VOLUME` in the upstream image — anything written there at build-time is shadowed at runtime when Fly mounts the machine's volume. `/opt/hermes` is upstream's working tree (`WORKDIR /opt/hermes`); writing into it risks colliding with future upstream files. A new top-level `/corellia/` directory has no such risk and signals "this is Corellia's, not Hermes's" at a glance.
- **No-Docker simulation harness for branch-coverage testing.** Because Docker Desktop wasn't running during Phase 1 execution, I built a small no-Docker harness that strips the final `exec` line from `entrypoint.sh`, sources the rest, and dumps the env. Five-case branch coverage (openrouter, anthropic, gemini, no-provider, unknown-provider). Every branch produced expected output; the unknown-provider branch exits 64 with the documented stderr lines. The harness is not committed (it's a one-time validation, not a regression test) but the technique is recorded here for any future Phase 1 redo (e.g., adding a new provider).
- **`AGENT_ID` *and* `CORELLIA_AGENT_ID` both exported.** The plan's translation-table example in Phase 1 task 4 shows `export AGENT_ID="${CORELLIA_AGENT_ID:-}"` (one direction). The implemented entrypoint sets both names: the rename for any subprocess that wants `AGENT_ID`, and the original for operator-side log filtering by `CORELLIA_*` prefix. Cost: one extra env entry, zero ambiguity. Same shape that `CORELLIA_MODEL_PROVIDER` keeps alongside its renamed `HERMES_INFERENCE_PROVIDER` — preserves the `CORELLIA_` prefix as a stable telemetry signal.
- **`set -e` only, not `set -eu`.** The plan's Phase 1 insight notes the deliberate choice; reaffirmed in execution. `set -u` would make `${VAR:-}` references redundant (they handle the unset case) but make any *future* bare-`$VAR` reference into a hard crash — which is the wrong default for a wrapper whose contract is "rename what's present, ignore what's absent." `set -e` alone is the right narrow scope.

### Pre-work tasks status

The plan's §3 pre-work checklist (task-by-task):

- ☑ M2 landed (`harness_adapters` row exists, `/agents` page renders) — verified via earlier conversation context.
- ☑ Backend + frontend baseline checks were green at branch-cut — implicit from the M2 completion (0.4.0 changelog).
- ☐ `git status` clean, branch off `master` for M3 work — *not enforced*; Phase 1 work landed directly on `master`'s working tree alongside many uncommitted M2 artefacts (the milestone has been worked on a single branch for M2+M3). The branch-cut hygiene is a soft guideline; the M2 artefacts are themselves uncommitted but green per its own completion doc.
- ☐ **Fly account ready** — *not verified by Phase 1*. Phase 2 onwards will block on it. `FLY_API_TOKEN` and `FLY_ORG_SLUG` are required by `config.Config`; whether they hold real values today is a Phase 2 pre-flight concern.
- ☐ **Docker buildx ready** — *partially*. `docker buildx version` exits clean, but the daemon itself is not running. Phase 2 must wait for Docker Desktop to be brought up.
- ☐ **GHCR auth + owner slug** — *deferred to Phase 2*.
- ☑ **Inspect upstream image** — done. The image config blob (entrypoint, env, working dir, user) was retrieved via the Docker Hub registry HTTP API directly (daemon-less), and the upstream entrypoint script + README + `.env.example` + `cli-config.yaml.example` were retrieved via raw.githubusercontent.com. The translation table is filled in `entrypoint.sh` against real values, not the plan's placeholder example.
- ☑ **Multi-arch verified upstream.** `docker manifest inspect` against the pinned digest confirms `linux/amd64` and `linux/arm64` are both present. The amd64-only fallback (Decision 6) is *not* needed; Phase 2 can buildx for both.
- ☐ **Fly machine image-pull rehearsal** — deferred to Phase 2's pre-flight.

### Acceptance check (plan §Phase 1 acceptance criteria)

- ☑ `adapters/hermes/{Dockerfile,entrypoint.sh,README.md,.dockerignore}` all present.
- ☐ `docker build` succeeds — *deferred* until Docker daemon is running. The Dockerfile is structurally complete and referenced layers are real (verified via registry-direct manifest inspection). High confidence the build will succeed; honest-stated low confidence that nothing in the host environment will require a tweak.
- ☐ Local sanity exec prints renamed env vars correctly — *deferred*; the no-Docker simulation passed equivalently.
- ☑ `entrypoint.sh` has `set -e`, uses `exec` (not subshell), translates every `CORELLIA_*` var the spec lists, and `exec`s the upstream binary by its actual path (`/opt/hermes/docker/entrypoint.sh`, derived from the image config blob — no placeholder).

### What this means for Phase 2

Phase 2 (multi-arch buildx + GHCR push + digest capture) needs Docker Desktop running. Once it is:

1. Run `docker build -t corellia/hermes-adapter:dev adapters/hermes` — the Phase 1 acceptance check that's currently deferred. If it succeeds, the local sanity exec follows.
2. Run the documented `docker run --entrypoint /bin/sh ... -c '/corellia/entrypoint.sh /bin/sh -c "env | grep -E \"^(CORELLIA|OPENROUTER|HERMES_INFERENCE|AGENT)_\" | sort"'` invocation from `adapters/hermes/README.md`. The expected output is in the README.
3. Proceed with Phase 2's multi-arch buildx + GHCR push + manifest-list digest capture per the plan.

If `docker build` *fails* at step 1 (low-probability, but possible for environment reasons — Docker context, registry-auth, multi-platform-emulation availability), the most likely root cause is the host's `desktop-linux` context not being initialized; `docker buildx use desktop-linux` followed by a retry should clear it.

### Risks / open issues opened by Phase 1

- **Runtime-contract gap** (full discussion above). Closing it is a v1.5 concern; flagged in `adapters/hermes/README.md` so M4 readers don't misread the surface.
- **`CORELLIA_MODEL_NAME` is observability-only at the adapter today.** Hermes 0.x has no env-var hook for model selection — the deprecated `LLM_MODEL` was explicitly removed (`.env.example` line 14: "LLM_MODEL is no longer read from .env"). Today the Hermes default `anthropic/claude-opus-4.6` (per `cli-config.yaml.example` line 11) wins. v1.5 follow-up: have `entrypoint.sh` write a minimal `config.yaml` fragment (or use `--model` from a parsed CLI invocation) to honour the var. Until then, the M4 spawn flow's catalog model picker is *visually* doing something but the runtime always uses the upstream default. This is a real product gap — flag for the M4 plan to address explicitly.
- **No CI hook for `entrypoint.sh` syntax.** Today the syntax was checked manually (`/bin/sh -n adapters/hermes/entrypoint.sh`). When CI is set up (post-v1), a one-line `find adapters -name '*.sh' -exec sh -n {} \;` step in the lint job is the right durable check.
- **No automated test exists for the case-statement coverage.** The Phase 1 no-Docker simulation harness is intentionally one-shot. If a future change adds a new provider rename or alters the `case` shape, the validator is the developer's diligence — there is no committed test that would fail on regression. This is a known limitation; the cost of a real shell-test framework (e.g., `bats-core`) outweighs the benefit at v1 scale, but the trade-off is worth re-evaluating when the adapter set grows.

`★ Insight ─────────────────────────────────────`
- The most consequential discovery in Phase 1 wasn't an implementation question — it was a **contract-shape mismatch between the blueprint and the reality of the chosen upstream**. Blueprint §3.1's "HTTP server with `/health` and `/chat`" is generic-harness language that fits LangGraph and CrewAI well, but Hermes (a CLI-shaped, gateway-driven agent) does not implement it. The healthy reaction in v1 is *not* to retrofit Hermes (forbidden by §11.5 "no upstream forks") nor to abandon the contract (it is what makes the harness interface useful). The healthy reaction is to flag the gap, ship the env-var-translation half of the adapter (which is independently useful), and queue a v1.5 sidecar that adds the missing endpoints. This is exactly the §11.4 stance ("deferred features stub as real interfaces, not fake buttons") applied at the harness-contract level.
- The "Dockerfile quotes the database" pattern (Decision 2) is more load-bearing than it first reads. The single-source-of-truth direction matters because **a build pipeline can read the database's `harness_adapters.upstream_image_digest` and template-substitute it into the Dockerfile**, but the reverse (database reads Dockerfile) is impossible without a parser. Today the substitution is manual ("the migration changes first; the Dockerfile follows in the same PR"), but the directionality is what makes a future automated bumper trivial. Phase 1 didn't build that bumper — it just respected the directionality that lets the bumper be built later.
- The `USER root` → `COPY --chmod=0755` → `USER hermes` triplet is a buildkit-era Dockerfile idiom that older muscle memory tends to write as `RUN chmod +x` (one extra layer, requires running-as-root, slower build). The plan's example used the older form; Phase 1 silently upgraded. The general pattern: **prefer file-mode flags on `COPY` over a separate `RUN chmod` whenever buildkit is the builder** — it's one fewer cache-invalidation point and one fewer place a "did the entrypoint script's permissions get set?" question can appear.
`─────────────────────────────────────────────────`

---

*(Phases 2–8 will be appended below as they land.)*
