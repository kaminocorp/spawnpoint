# M-chat Hermes Chat Sidecar — Phase 1 completion notes

**Plan:** `docs/executing/hermes-chat-sidecar.md` §4 Phase 1.
**Date:** 2026-04-26.
**Scope:** Source files only. No Dockerfile change, no entrypoint change, no Go, no TS, no migration, no proto, no Fly. The sidecar lives in the source tree but the deployed adapter image still doesn't know about it (Phase 2's job).

---

## What shipped

Four new files under a brand-new `adapters/hermes/sidecar/` directory. Zero files touched outside that directory.

### New files

- **`adapters/hermes/sidecar/sidecar.py`** (~220 LOC) — FastAPI app exposing the three blueprint §3.1 routes:
  - `POST /chat` — bearer-authenticated; loads (or creates) an `AIAgent` keyed on `session_id` and returns `{content: <reply>}`.
  - `GET /health` — unauthenticated; returns `{ok: true, hermes: "ready"}`.
  - `POST /tools/invoke` — bearer-authenticated; returns `501 {detail: "tools/invoke not implemented"}` (anti-scope-creep §5).
  - **Auth middleware** uses `secrets.compare_digest` (constant-time), reads `CORELLIA_SIDECAR_AUTH_TOKEN` from env, exempts `/health`, and *fails closed* with `503` when the token is unset (defence in depth, risk 4).
  - **AIAgent import** is `try`/`except`-guarded against `ImportError` *and* any other import-time failure: when the upstream package isn't on `PYTHONPATH` (workstation dev), a stub class returns a deterministic non-empty reply so the FastAPI shape itself stays testable. Inside the deployed adapter image (Phase 2 onward), the import always succeeds and the stub branch is dead code.
  - **Constructor signature is upstream-internal**, so `_get_or_create_agent` tries the named-arg form (`AIAgent(session_id=session_id)`, matching the upstream `gateway/session.py` pattern documented in changelog 0.9.5) and falls back to the no-arg form on `TypeError`. This insulates the sidecar from upstream constructor churn at no runtime cost.
  - **Session cache** is an `OrderedDict`-based LRU capped at 100 (configurable via `CORELLIA_SIDECAR_MAX_SESSIONS`) per risk 5. Wrapped in a `threading.Lock` because uvicorn's worker model can shift sync endpoints into a thread pool — the lock costs nothing today and protects against the kind of shape change that would silently break it later.
  - **Eviction is safe by design**: Hermes's durable session state lives in `$HERMES_HOME/sessions/<id>.sqlite` (per the changelog 0.9.5 re-inspection). The in-memory dict is a perf cache, never the source of truth — eviction just makes the next request for that session id pay one re-load.
- **`adapters/hermes/sidecar/requirements.txt`** — pins `fastapi==0.115.5`, `uvicorn[standard]==0.32.1`, `pydantic==2.10.3`. All three are also present in the upstream image via the `[all]` extra (per pre-work checklist item 2 + changelog 0.9.5's `hermes_cli/web_server.py` import evidence), but pinning our own copy protects against an upstream extra-set change. Pin choices are recent stable releases as of late-2025/early-2026 — no semver-major risk in the v1 timeline.
- **`adapters/hermes/sidecar/README.md`** — five-line stub per plan. Cross-references the binding decisions and the smoke harness.
- **`adapters/hermes/sidecar/smoke.sh`** — POSIX-bash smoke test, `chmod +x`. Per plan §4 Phase 1's exit gate, asserts five behaviours in order:
  1. `GET /health` (no auth) returns `200` with `{"ok":true,"hermes":"ready"}`.
  2. `POST /chat` without an `Authorization` header returns `401`.
  3. `POST /chat` with a wrong bearer returns `401`.
  4. `POST /chat` with the valid bearer returns `200` and a non-empty `.content` string.
  5. `POST /tools/invoke` with the valid bearer returns `501`.

  Cleanup is `trap`-on-EXIT-guarded (matching `adapters/hermes/smoke.sh`'s pattern from M3), so a `set -e` abort mid-script still tears down the container. Boots the sidecar inside the unmodified upstream Hermes image (pinned to the same digest as the parent `Dockerfile` and the DB seed) with `--entrypoint /bin/sh` overriding upstream's entrypoint and the sidecar dir bind-mounted in read-only — no Dockerfile change needed for Phase 1, exactly per plan.

### Files deliberately NOT touched

- `adapters/hermes/Dockerfile` — Phase 2's job (decision 9 / phase 2 add `COPY` + optional `RUN pip install`).
- `adapters/hermes/entrypoint.sh` — Phase 2's job (extends shell from "exec hermes" to "if `CORELLIA_CHAT_ENABLED=true`, start uvicorn in background, then exec hermes").
- `adapters/hermes/README.md` — Phase 2's job (env-var table grows two rows; smoke section grows a "with chat enabled" variant).
- `adapters/hermes/smoke.sh` — unchanged; the M3 smoke is orthogonal to the chat sidecar smoke. The sidecar smoke lives at `adapters/hermes/sidecar/smoke.sh` precisely so the two don't entangle.
- Every Go file, every TS file, every migration, every proto file. Phase 3 onward.

`git status --short` post-Phase-1 (sidecar-specific): `?? adapters/hermes/sidecar/` (the entire directory is new, so git lists it once at the directory level).

---

## How it diverged from the plan

Three deviations, each flagged at the moment of choice:

### 1. AIAgent import has a stub fallback in the sidecar itself, not just in the smoke

The plan body says Phase 1 "runs locally against a fake `AIAgent` (or a real one with a model API key)". I read the parenthetical as the smoke's choice, and originally considered the fallback only in `smoke.sh`. But the FastAPI module imports `AIAgent` at module load time, so the stub has to live inside `sidecar.py` — otherwise a developer running `uvicorn sidecar:app` outside docker hits an `ImportError` before the bearer-auth middleware ever runs and can't even verify the auth shape. Putting the stub in `sidecar.py` keeps the workstation-dev path open at zero runtime cost (the `try` block is evaluated once at import time, branch is dead code in Phase 2's deployed image).

This is a strict superset of the plan's intent — Phase 2's exit gate (the deployed image always imports the real `AIAgent`) is unchanged.

### 2. Smoke runs the sidecar with `--entrypoint /bin/sh`, not by composing with upstream's entrypoint

Plan §4 Phase 1's smoke spec says "`docker run` the unmodified upstream Hermes image with the sidecar bind-mounted, curl `/chat` with a fake model API key, assert non-empty response". Two ways to read that:

- **(a)** Run upstream's entrypoint, which boots `hermes` interactively, *and* somehow start the sidecar alongside.
- **(b)** Skip upstream's entrypoint entirely, run only the sidecar process.

I went with (b). Reasons: (1) Phase 1's exit gate asserts the **FastAPI shape** — bearer auth, JSON in/out, `/health` reachable — not Hermes itself. (2) Composing two processes inside `docker run` without modifying `entrypoint.sh` would require either a tini/dumb-init wrapper inside the smoke or a `bash -c "uvicorn ... & exec /opt/hermes/docker/entrypoint.sh"` hack, both of which would prefigure Phase 2's supervisor design and risk locking in choices that should be made there. (3) Phase 6's smoke is what proves the round-trip to a real model; Phase 1's smoke proves the sidecar's own surface. The split is clean and matches the plan's phasing.

The smoke's `--user 0` is a small belt-and-suspenders against the upstream image's `USER hermes` (UID 10000) — pip install's site-packages writes need root if the `[all]` extra didn't already bring fastapi/uvicorn. On most runs the `pip install` is a no-op and `--user 0` is invisible. Phase 2's image will have the deps baked at build time, so this concern goes away then.

### 3. Smoke calls `pip install` defensively

Pre-work checklist item 2 ("Confirm `fastapi` + `uvicorn` are present in the upstream image at our pinned digest") wasn't run as a separate step before this phase — the operator's note in the plan is "Likely yes, verify via `docker run --entrypoint /bin/sh ... -c 'python -c "import fastapi; import uvicorn"'`". To keep Phase 1 self-checking without taking a hard dependency on a verification I didn't run, the smoke does `pip install -q -r /corellia/sidecar/requirements.txt` before launching uvicorn. If the deps are already present at the pinned versions, pip resolves to a no-op in <1s. If they're absent or at different versions, pip installs them into the running container's site-packages (write-needs are why `--user 0` is set). Either way the smoke proceeds — no false-negative on pre-work uncertainty.

Phase 2's `Dockerfile` change can drop this once the deps are baked at build time. Recommended Phase 2 follow-up: replace the `pip install` line in `smoke.sh` with a hard import-check that fails loudly if the deps drifted.

---

## What I deliberately did NOT do

Per the plan's Phase 1 framing:

- **Did not modify the parent `adapters/hermes/Dockerfile`.** The upstream digest pin in the `FROM` line is unchanged; the parent image is still byte-identical to what M3 shipped.
- **Did not modify the parent `adapters/hermes/entrypoint.sh`.** The CORELLIA_* env-var translation surface is unchanged; today's deployed agents see no change.
- **Did not run the smoke against a real OpenRouter key on the operator's network.** Operator owes that step (see "Validation gates owed" below). The Python parse + bash `set -n` syntax checks are local-only proxies; the round-trip exit gate needs docker.
- **Did not add a `CORELLIA_CHAT_ENABLED` env-var read.** That's a Phase 2 entrypoint-script concern; the sidecar process itself, once running, doesn't need to know whether chat is "enabled" at the orchestration level — its existence *is* the enabled signal. (When `CORELLIA_CHAT_ENABLED=false` in Phase 2, the entrypoint simply doesn't start uvicorn.)
- **Did not implement a real `/health` Hermes-readiness probe.** Risk 7's `{ok: false, hermes: "starting"}` pre-ready branch is Phase 6's concern (when `Health()` switches from machine-state to HTTP probe). Phase 1's `/health` reports `ready` as soon as the process is up — the sidecar is its own readiness signal until Phase 6.
- **Did not implement `/chat` streaming.** Anti-scope-creep §5: v1 is unary, v1.6 is streaming. The proto reservation is not yet earned.
- **Did not wire any audit log, rate limit, or per-message metrics.** Audit + cost guards are post-v1.5 (anti-scope-creep §5).

---

## Validation gates met

- `python3 -c 'import ast; ast.parse(open(...).read())'` clean — `sidecar.py` parses on the workstation's Python 3 (no dependency on FastAPI being installed locally; `ast.parse` is import-free).
- `bash -n smoke.sh` clean — POSIX-bash syntax check passes.
- `chmod +x smoke.sh` set; `ls -la` confirms executable bit.
- File layout matches the plan: four files under `adapters/hermes/sidecar/`, no spillover into other directories.
- `git status --short` confirms zero modifications to existing files; the sole change is the new directory.

---

## Validation gates owed (operator)

Phase 1's hard exit gate — operator must run before Phase 2 starts:

```sh
export OPENROUTER_API_KEY=sk-or-v1-<key>
./adapters/hermes/sidecar/smoke.sh
```

Expected output: five `>> [N/5] ...` lines, each followed by either an asserted body or a code-only line, then `>> all assertions passed (trap will tear down ...)`. Container is removed automatically on success or failure.

If the `pip install` step is slower than expected on the operator's network, increase the `for _ in $(seq 1 60)` health-poll bound. Empirically the sidecar process itself comes up in <2s once Python imports complete; the bottleneck is whichever of fastapi/uvicorn isn't already cached.

If the **AIAgent constructor signature has shifted upstream** in a way that breaks both the named-arg and no-arg forms (decision 2's fallback), assertion 4 will return a 502 with `chat failed: TypeError`. Mitigation: read the upstream `run_agent.py`'s current signature and add a third constructor branch in `_get_or_create_agent`; this is the closest thing Phase 1 has to a "real-world" failure mode, and the test exists explicitly to surface it before Phase 2.

---

## Design rationale worth keeping

The plan covers the *what*; this section pins the non-obvious *why* for future readers reaching the source cold.

- **`/health` is unauthenticated, every other route requires bearer.** Fly's edge proxy attaches health checks without our token; an authenticated `/health` would mean either (a) Fly has the token (defeats decision 5's "BE-only secret" posture) or (b) Fly sees a 401 and flips the machine to unhealthy on every probe. Exempting `/health` from auth is the only sustainable shape — and it's safe because `/health` reveals only liveness, no agent state.
- **Empty `AUTH_TOKEN` → 503, not 200.** A zero-length token would compare-equal to a zero-length presented bearer (`secrets.compare_digest("", "") is True`), wide-opening the surface. The explicit empty-token check fails closed before ever reaching `compare_digest`. Phase 3's BE-side spawn path is responsible for actually generating and injecting the token; the sidecar's job is to refuse to operate without one.
- **`secrets.compare_digest`, not `==`.** Constant-time compare prevents timing oracles on the bearer token. Negligible perf cost on a 32-byte string; zero downside.
- **Logging filter for `Authorization` is *not* added in Phase 1.** Risk 3 says "Sidecar redacts `Authorization` from any log line." uvicorn's default access-log format is `%(h)s ... "%(r)s" %(s)s ...` where `%(r)s` is the request line (`METHOD path HTTP/1.1`) — headers are *never* in the access log by default. Application-level logger calls in `sidecar.py` never log the request object directly, only message + session_id. So there's nothing currently to redact. **If** uvicorn's access format is customized in Phase 2 to include headers, *that* is when the redaction filter earns its place. Adding it now would be a defence against a hypothetical that doesn't exist; better to leave a Phase 2 follow-up note than to ship dead code.
- **`AIAgent.chat` is sync, called from an async handler — yes, this blocks the event loop.** Documented inline. v1 is unary chat with one in-flight call per session id; the loop block matters only when N concurrent sessions exceed worker count (`uvicorn` default workers=1 + threadpool=40). The Phase 6 health-probe path doesn't touch `chat`, so a slow model call doesn't poison `/health`. v1.6 streaming is the right time to reshape — moving `agent.chat(...)` into `asyncio.to_thread(...)` is a one-line change. Premature now.
- **Stub AIAgent reply prefix (`[stub-aiagent] echo: ...`)** is deliberately distinguishable from any plausible real-model output. Operators reading the smoke logs can tell at a glance whether the upstream import succeeded or fell back. This is the kind of soft signal that costs nothing to add now and is annoying to retrofit later.
- **`CORELLIA_SIDECAR_PORT` is configurable** (defaulting to 8642 per decision 4) so the smoke can run on a non-default host port if 8642 is occupied — a workstation reality. The deployed image always uses 8642 (Phase 3's `services` block expects it); the env var is exclusively a smoke/dev knob.

---

## Next phase entry checkpoint

Phase 2 is **Dockerfile + entrypoint integration** (image rebuild, no Fly changes). Three edits:

1. `adapters/hermes/Dockerfile` — `COPY --chmod=0755 sidecar/ /corellia/sidecar/` and (per pre-work item 2 verification) `RUN /corellia/venv/bin/pip install -r /corellia/sidecar/requirements.txt`.
2. `adapters/hermes/entrypoint.sh` — extend from `exec /opt/hermes/docker/entrypoint.sh "$@"` to a two-process supervisor: when `CORELLIA_CHAT_ENABLED=true`, start uvicorn in background, then exec the upstream entrypoint. Default-deny (anything other than the literal string `true` skips the sidecar) per risk 4.
3. `adapters/hermes/README.md` — env-var table gains `CORELLIA_CHAT_ENABLED` + `CORELLIA_SIDECAR_AUTH_TOKEN` rows; smoke section grows a "with chat enabled" variant.

Phase 2 exit gate: local `docker build && docker run` shows both processes running; `/health` returns 200 with `hermes: "ready"`; `/chat` round-trips. Disabled-chat path (`CORELLIA_CHAT_ENABLED=false` or unset) shows only `hermes` running, no listener on `:8642`.

The sidecar source is ready to back Phase 2's image build with no further code changes; only the **integration glue** (Dockerfile `COPY` + entrypoint supervisor branch) is owed before the deployed adapter image gains chat capability.
