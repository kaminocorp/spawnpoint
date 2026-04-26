# M-chat Hermes Chat Sidecar — Phase 2 completion notes

**Plan:** `docs/executing/hermes-chat-sidecar.md` §4 Phase 2.
**Date:** 2026-04-27.
**Scope:** Bake the Phase 1 sidecar source into the adapter image and gate it at boot via `CORELLIA_CHAT_ENABLED`. No Fly changes, no Go, no TS, no migration, no proto. The deployed adapter image now *can* run the chat sidecar; whether it *does* is per-instance and decided by the BE in Phase 3.

---

## What shipped

Four files modified, zero new files. All edits live under `adapters/hermes/`.

### Modified files

- **`adapters/hermes/Dockerfile`** — adds one `COPY` line under the existing `USER root` block: `COPY --chmod=0755 sidecar/ /corellia/sidecar/`. The directory lands at the same `/corellia/` prefix the existing `entrypoint.sh` lives at, outside `$HERMES_HOME` (which is a runtime VOLUME and would shadow build-time writes). No `pip install` step — see "Plan deviations" §1 below for why.
- **`adapters/hermes/.dockerignore`** — adds `sidecar/README.md` and `sidecar/smoke.sh` to the ignore list. The two non-runtime files now have explicit ignore patterns; without them, the `COPY sidecar/` line above would pull them into the image. Net runtime payload from `sidecar/` reaches the image as exactly two files: `sidecar.py` + `requirements.txt`.
- **`adapters/hermes/entrypoint.sh`** — extends the existing CORELLIA_* translation logic with a *conditional* two-process supervisor branch. The legacy `exec /opt/hermes/docker/entrypoint.sh "$@"` line stays as the fallback; the new branch is reached only when `CORELLIA_CHAT_ENABLED=true` (literal string match — risk 4 default-deny). Inside the new branch:
  - `forward_term()` function fan-outs SIGTERM/SIGINT to both `$SIDECAR_PID` and `$HERMES_PID`. The `[ -n "${PID:-}" ]` guard makes the trap safe even if the signal arrives during the brief window before either child has been started.
  - `trap forward_term TERM INT` installs the fan-out.
  - `python -m uvicorn --app-dir /corellia/sidecar sidecar:app --host 0.0.0.0 --port "${CORELLIA_SIDECAR_PORT:-8642}" --log-level info &` starts the sidecar in background; `SIDECAR_PID=$!` captures the PID.
  - `/opt/hermes/docker/entrypoint.sh "$@" &` starts the upstream entrypoint (which performs root→hermes drop and execs `hermes`) in background; `HERMES_PID=$!`.
  - `set +e` brackets the `wait`/teardown sequence so a non-zero Hermes exit doesn't trip script-level `set -e` before the sidecar gets cleaned up. Hermes is the *primary* process: the script `wait`s on `$HERMES_PID`, captures `HERMES_EXIT`, kills the sidecar with SIGTERM, waits for the sidecar to drain, restores `set -e`, and `exit "$HERMES_EXIT"`.
- **`adapters/hermes/README.md`** — two new env-var rows in the translation table:
  - `CORELLIA_CHAT_ENABLED` — adapter-only (not forwarded to Hermes); gates the sidecar at boot; default-deny semantics documented.
  - `CORELLIA_SIDECAR_AUTH_TOKEN` — consumed by the sidecar; required when chat is enabled; empty value → 503 fail-closed (per Phase 1's `bearer_auth` middleware).

  Plus a new "Local sanity exec — chat-enabled image" subsection inserted *above* the existing "Smoke test" section. Walks through `docker build`, `docker run -e CORELLIA_CHAT_ENABLED=true ...`, the `docker exec ... ps -ef` two-process check, and a four-step curl sequence (health unauth → chat no-auth 401 → chat valid 200 → byte-equivalent disabled-chat path). Cross-references the Phase 1 sidecar smoke (`adapters/hermes/sidecar/smoke.sh`) as the cheapest "is the sidecar source healthy" probe — that test predates the Phase 2 image build and remains useful for source-only iteration.

`git diff --stat`: `+154 -9` across the four files; `git status --short`: 4 modified, 4 new (the four Phase 1 sidecar files persist untouched).

---

## How it diverged from the plan

Three deviations, each flagged at the moment of choice:

### 1. No `pip install` and no venv inside the Dockerfile

Plan §4 Phase 2 specifies `RUN /corellia/venv/bin/pip install -r /corellia/sidecar/requirements.txt` (with the parenthetical "or omits the venv if we trust the upstream `[all]` extra"). I omitted both the venv *and* the `pip install`. Reasons:

1. **Pre-work item 2's verification is implicitly already paid.** Changelog 0.9.5's re-inspection cited `hermes_cli/web_server.py` as proof that fastapi + uvicorn ship in the upstream image via the `[all]` extra. The Phase 1 sidecar smoke (when run with `OPENROUTER_API_KEY=…`) actually exercises a `python -m uvicorn sidecar:app` invocation against the *exact same pinned upstream digest* that `FROM` references — i.e., once the Phase 1 smoke passes, fastapi/uvicorn are proven importable in the deployed image at runtime, and a duplicate `pip install` would be redundant.
2. **`--system-site-packages` venv is the worst of both worlds.** A "pure" venv (no system access) makes `from run_agent import AIAgent` unimportable, since `run_agent` is in upstream's site-packages. A `--system-site-packages` venv inherits upstream's fastapi anyway, and our pinned `pip install` would either be a no-op (versions match) or *upgrade* upstream's deps in a way that risks breaking Hermes's own use of fastapi. Both paths defeat the isolation goal.
3. **`pip install --no-deps` into upstream's site-packages** is the cleanest "pin our deps without disturbing transitive ones" option, but it costs ~1 layer and ~5MB, and the failure mode it protects against (upstream's `[all]` drifts off our pinned versions on a future digest bump) is the same failure mode `requirements.txt` itself documents — Phase 1's smoke detects it before the digest bump merges.

The decision is reversible: if Phase 5 or Phase 7 surfaces a real version-skew issue, adding `RUN python -m pip install --no-deps -r /corellia/sidecar/requirements.txt` is a single-line follow-up that doesn't restructure anything else.

### 2. `wait $HERMES_PID` semantics differ slightly from the plan's `& + wait` description

Plan §4 Phase 2 says "Background uvicorn startup uses `&` + `wait` pattern so SIGTERM from Fly hits both processes". A bare `wait` (no PID) waits for *all* backgrounded children, which means if the sidecar crashes early, the wait returns at that moment — and we'd race against Hermes's startup. Using `wait "$HERMES_PID"` specifically pins the wait to Hermes's lifetime: Hermes is the primary process, sidecar dying doesn't take the container down. This matches plan decision 1 ("the sidecar is bookkeeping; if Hermes dies we tear it down and exit with Hermes's status") implicitly, but the plan's prose phrasing was a little loose. Surfacing here so a future re-reader doesn't try to "fix" the explicit-PID wait into a bare `wait`.

### 3. README Smoke section gets a new "Local sanity exec — chat-enabled image" subsection rather than amending the existing "Smoke test" section

Plan §4 Phase 2 says "Smoke section grows a 'with chat enabled' variant." The existing "Smoke test" section documents `adapters/hermes/smoke.sh`, which is the *Fly-based* smoke (boots an app, polls `fly machines list`, destroys). Grafting a chat variant onto that section would either (a) imply the Fly smoke handles chat (it doesn't — that's Phase 7's runbook), or (b) require duplicating the entire local-docker workflow inside it. Splitting it out into a sibling subsection above the Fly smoke (titled "Local sanity exec — chat-enabled image", parallel to the existing "Local sanity exec — env-var rename verification") keeps each section single-purpose and reads cleanly.

---

## What I deliberately did NOT do

- **Did not add a Hermes-readiness gate to `/health`.** Risk 7's `{ok: false, hermes: "starting"}` pre-ready branch is Phase 6's concern, not Phase 2's. The sidecar still answers `/health` immediately on its own startup; in this phase, that means a brief window where `/health` returns `ready` while `hermes` is still booting. Phase 6 closes the window when `Health()` flips to the HTTP probe.
- **Did not add an `entrypoint.sh`-level sanity check that `CORELLIA_SIDECAR_AUTH_TOKEN` is set when `CORELLIA_CHAT_ENABLED=true`.** The sidecar's `bearer_auth` middleware already fails closed (503) when the token is unset, and Phase 4's `agents.ChatWithAgent` will surface that as `ErrChatUnreachable` → Connect `Unavailable`. Adding a duplicate check at `entrypoint.sh` would be defensive but redundant; keeping the sole enforcement point in the sidecar makes the failure mode debuggable from one place.
- **Did not change the upstream image digest pin.** Same `sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338`. The Phase 7 migration is what records the *adapter* image digest after the Phase 2 build is pushed; Phase 2 itself doesn't bump anything in the DB.
- **Did not push the new image to GHCR.** That's Phase 7's operator-collaboration step. Phase 2's exit gate is local: `docker build && docker run`.
- **Did not modify `adapters/hermes/smoke.sh` (the Fly-based parent smoke).** That smoke deliberately boots the agent in chat-disabled mode (no `CORELLIA_CHAT_ENABLED` set), so its existing "no `/health` poll" + "no `--port` binding" framing remains accurate for the chat-disabled path. Once Phase 7's adapter-image-bump migration lands, a separate Phase 7 follow-up can teach `smoke.sh` an opt-in `--chat` flag.
- **Did not touch the Phase 1 sidecar files.** `sidecar/sidecar.py`, `sidecar/requirements.txt`, `sidecar/README.md`, `sidecar/smoke.sh` are all unchanged. Phase 2's contract is purely "make the existing source actually run in the deployed image."

---

## Validation gates met (workstation, no docker-build)

- `sh -n adapters/hermes/entrypoint.sh` clean — POSIX-shell parse passes for the new conditional branch and the trap-with-named-function form.
- `python3 -c 'import ast; ast.parse(...)'` for `sidecar.py` clean (re-verified post-Phase-2 to confirm no incidental edit).
- `git status --short` shows exactly 4 modified files and 4 new (Phase 1) files; nothing outside `adapters/hermes/`.
- README's two new table rows render as a valid markdown table (visual inspection — no leftover `|`, alignment matches the existing rows).

---

## Validation gates owed (operator, requires docker)

Phase 2's hard exit gate per plan §4:

```sh
docker build -t corellia/hermes-adapter:dev adapters/hermes

# Chat-enabled boot — both processes, /health 200, /chat round-trips
docker run --rm -d \
  --name corellia-chat-dev \
  -p 8642:8642 \
  -e CORELLIA_AGENT_ID=local-dev \
  -e CORELLIA_MODEL_PROVIDER=openrouter \
  -e CORELLIA_MODEL_API_KEY="$OPENROUTER_API_KEY" \
  -e CORELLIA_CHAT_ENABLED=true \
  -e CORELLIA_SIDECAR_AUTH_TOKEN=dev-token \
  corellia/hermes-adapter:dev

docker exec corellia-chat-dev ps -ef             # expect both uvicorn + hermes
curl -fsS http://127.0.0.1:8642/health           # 200, {ok:true,hermes:"ready"}
curl -fsS -X POST http://127.0.0.1:8642/chat \
    -H 'authorization: Bearer dev-token' \
    -H 'content-type: application/json' \
    -d '{"session_id":"local","message":"say pong"}'   # 200, non-empty .content

docker rm -f corellia-chat-dev

# Chat-disabled boot — single Hermes process, no listener on :8642
docker run --rm -d --name corellia-nochat-dev \
  -e CORELLIA_AGENT_ID=local-dev \
  -e CORELLIA_MODEL_PROVIDER=openrouter \
  -e CORELLIA_MODEL_API_KEY="$OPENROUTER_API_KEY" \
  corellia/hermes-adapter:dev

docker exec corellia-nochat-dev ps -ef           # expect only hermes
docker exec corellia-nochat-dev sh -c '
    nc -z localhost 8642 && echo "OPEN" || echo "CLOSED"'   # expect CLOSED

docker rm -f corellia-nochat-dev
```

Multi-arch buildx variant — proves the image still publishes both `linux/amd64` + `linux/arm64` (per existing M3 multi-arch pre-work):

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
    -t corellia/hermes-adapter:phase2-dev \
    --load \
    adapters/hermes
```

The Phase 1 sidecar smoke (`./adapters/hermes/sidecar/smoke.sh`) is *unchanged* and remains the cheapest end-to-end check on the sidecar source itself; it does not exercise the entrypoint supervisor branch (it `--entrypoint /bin/sh`-overrides the entrypoint entirely).

---

## Design rationale worth keeping

- **Two children mean PID 1 has to be us, not upstream.** The M3 single-process `exec` pattern was correct for one child: replace the wrapper shell, let upstream become PID 1, signals route correctly. With two children, `exec` would replace us with one of them, and the other would orphan up to PID 1 (the new exec'd process), which has no idea about it. Result: SIGTERM hits PID 1, the orphan child never gets the signal, Fly SIGKILLs after the grace period. Staying as PID 1 with an explicit trap-and-fan-out is the only shape that makes both children drainable. The chat-disabled branch keeps the original `exec` because it has the original problem shape (one child, exec-replace is right).
- **Hermes-as-primary, sidecar-as-bookkeeping.** Asymmetric supervision: `wait $HERMES_PID` (specific) means Hermes's exit drives container shutdown. If the sidecar crashes (Python import error, unhandled exception, OOM), Hermes keeps running — `/chat` returns connection-refused, the BE's `agents.ChatWithAgent` (Phase 4) surfaces `ErrChatUnreachable`, and the operator sees the failure in the fleet view. The reverse asymmetry (sidecar-as-primary) would mean a transient sidecar restart kills Hermes, losing in-flight conversations. Wrong direction.
- **`set +e`/`set -e` brackets around the wait/teardown.** With `set -e` left on, a non-zero Hermes exit would abort the script before the kill+wait teardown runs. The bracketed region is exactly the cleanup, so leaving `set -e` off temporarily is precise and bounded — neither the trap nor the cleanup itself need `set -e`'s help.
- **`SIGTERM` (not `SIGKILL`) to the sidecar on teardown.** uvicorn handles SIGTERM gracefully (drains in-flight requests, closes connections); SIGKILL would hard-cut. The `wait "$SIDECAR_PID" 2>/dev/null || true` after the kill gives uvicorn its drain window. Bounded by Fly's grace period: if the sidecar exceeds it, Fly sends its own SIGKILL to the whole container, which is fine.
- **`--app-dir /corellia/sidecar` instead of `cd` + `uvicorn sidecar:app`.** Same effect, but `--app-dir` is the documented uvicorn idiom and survives a future refactor to a multi-module sidecar package without touching the entrypoint.
- **Default-deny on `CORELLIA_CHAT_ENABLED`.** Literal string `true` is the only enabler. Risk 4 specifically. Anything else (including `True`, `1`, `"true "` with trailing space, etc.) takes the legacy `exec` branch. Rationale: the BE's spawn path is the only writer; if a typo there silently flipped chat *on* across a fleet, the per-instance bearer-token issuance plumbing wouldn't have been set up either, and operators would discover the mismatch only after the first `ChatWithAgent` call returned a 503 — confusing failure. Default-deny means a typo silently flips chat *off* instead, which is observable as "the chat panel doesn't appear in the fleet view" and immediately diagnosable.
- **No `Authorization` redaction filter added in Phase 2 either.** Same call as Phase 1: uvicorn's default access log doesn't include headers, and the entrypoint shell doesn't log the request line at all. If Phase 5 or 6 customizes uvicorn's access format to include headers, *that* is when redaction earns its place. Defending against a hypothetical we haven't introduced is dead code.

---

## Next phase entry checkpoint

Phase 3 is **`FlyDeployTarget` machine-config: services block + secret plumbing** (Go-only, no FE). The deployed adapter image is now ready to be spawned with `CORELLIA_CHAT_ENABLED=true` and serve `/chat` on `:8642` *internally* — Phase 3 is what wires Fly's `services` block to expose `:443` → `:8642` and what generates + injects the per-instance bearer token alongside `CORELLIA_MODEL_API_KEY`.

The Phase 7 image rebuild + GHCR push + migration is what makes the new adapter image the deployed artefact across the fleet. Phase 2's image build is local-only — operators verifying Phase 2's exit gate today are testing against `corellia/hermes-adapter:dev` (or whatever local tag), not the GHCR-pushed digest in the DB.

The boundary between this phase and Phase 3 is clean: Phase 2 has zero Go/proto/SQL/FE surface, Phase 3 has zero adapter-image surface. The two phases compose without rework.
