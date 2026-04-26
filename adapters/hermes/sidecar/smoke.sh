#!/usr/bin/env bash
# adapters/hermes/sidecar/smoke.sh — Phase 1 exit gate.
#
# Plan: docs/executing/hermes-chat-sidecar.md §4 Phase 1.
#
# Boots the sidecar locally inside the unmodified upstream Hermes image
# with this directory bind-mounted in (no Dockerfile change yet — Phase
# 2's job), generates a per-run bearer token, and asserts:
#
#   1. GET /health   (no auth)              -> 200 {"ok":true,"hermes":"ready"}
#   2. POST /chat    (no auth header)       -> 401
#   3. POST /chat    (wrong bearer)         -> 401
#   4. POST /chat    (valid bearer)         -> 200, non-empty `content`
#   5. POST /tools/invoke (valid bearer)    -> 501
#
# Cleanup is trap-guarded: even if `set -e` aborts mid-run, the
# container is removed.
#
# Prerequisites:
#   - docker (running daemon)
#   - curl, jq
#   - OPENROUTER_API_KEY exported (free-tier key works) — used by AIAgent
#     when the upstream package is reachable on PYTHONPATH inside the
#     image. If the import fails for any reason inside the container,
#     the sidecar's stub branch returns a deterministic non-empty reply
#     instead, and assertion 4 still passes (the smoke is exercising
#     the FastAPI shape, not Hermes itself — Phase 6's smoke is what
#     proves the round-trip to a real model).

set -euo pipefail

: "${OPENROUTER_API_KEY:?must be set (free-tier OpenRouter key works)}"

# Pinned to the same upstream digest seeded in
# backend/migrations/20260425170000_agent_catalog.sql and quoted by
# adapters/hermes/Dockerfile's FROM line. Single source of truth: the DB.
IMAGE="${CORELLIA_HERMES_UPSTREAM:-docker.io/nousresearch/hermes-agent@sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338}"
NAME="corellia-sidecar-smoke-$(date +%s)-$RANDOM"
PORT="${CORELLIA_SIDECAR_PORT:-8642}"
TOKEN="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"
HOST_DIR="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
    echo ">> tearing down $NAME"
    docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- Boot the sidecar in the upstream image ------------------------------
#
# - `--user 0` so pip install can write to the image's site-packages if
#   the [all] extra didn't bring fastapi/uvicorn (defensive — should be
#   no-op on most runs).
# - bind mount is read-only; sidecar.py + requirements.txt aren't
#   modified at runtime.
# - `--entrypoint /bin/sh` skips the upstream entrypoint entirely; we
#   want the FastAPI process to be PID 1 here, no Hermes alongside.
# - `-q` on pip + `--disable-pip-version-check` keeps the container log
#   clean enough that Phase 1 readers can spot uvicorn's "Application
#   startup complete" line.
echo ">> starting sidecar container $NAME (port $PORT, image $IMAGE)"
docker run -d --rm \
    --name "$NAME" \
    --user 0 \
    -p "${PORT}:${PORT}" \
    -v "${HOST_DIR}:/corellia/sidecar:ro" \
    -e CORELLIA_SIDECAR_AUTH_TOKEN="$TOKEN" \
    -e CORELLIA_SIDECAR_PORT="$PORT" \
    -e CORELLIA_SIDECAR_ALLOW_STUB=true \
    -e CORELLIA_MODEL_PROVIDER=openrouter \
    -e HERMES_INFERENCE_PROVIDER=openrouter \
    -e OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
    --entrypoint /bin/sh \
    "$IMAGE" \
    -c "pip install -q --disable-pip-version-check -r /corellia/sidecar/requirements.txt && \
        cd /corellia/sidecar && \
        exec python -m uvicorn sidecar:app --host 0.0.0.0 --port ${PORT} --log-level info" \
    >/dev/null

# --- Wait for /health ----------------------------------------------------
echo ">> waiting for /health (60s timeout)"
HEALTHY=0
for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
        HEALTHY=1
        break
    fi
    sleep 1
done

if [ "$HEALTHY" -ne 1 ]; then
    echo "!! sidecar did not become healthy within 60s — container logs:" >&2
    docker logs "$NAME" >&2 || true
    exit 1
fi

# --- Assertion 1: GET /health (no auth) ---------------------------------
echo ">> [1/5] GET /health (no auth)"
HEALTH_BODY="$(curl -fsS "http://127.0.0.1:${PORT}/health")"
echo "    $HEALTH_BODY"
echo "$HEALTH_BODY" | jq -e '.ok == true and .hermes == "ready"' >/dev/null \
    || { echo "!! /health body unexpected" >&2; exit 1; }

# --- Assertion 2: POST /chat without auth -> 401 ------------------------
echo ">> [2/5] POST /chat (no bearer) -> expect 401"
CODE="$(curl -s -o /dev/null -w '%{http_code}' \
    -X POST "http://127.0.0.1:${PORT}/chat" \
    -H 'content-type: application/json' \
    -d '{"session_id":"smoke","message":"hi"}')"
[ "$CODE" = "401" ] || { echo "!! expected 401, got $CODE" >&2; exit 1; }

# --- Assertion 3: POST /chat with wrong bearer -> 401 -------------------
echo ">> [3/5] POST /chat (bad bearer) -> expect 401"
CODE="$(curl -s -o /dev/null -w '%{http_code}' \
    -X POST "http://127.0.0.1:${PORT}/chat" \
    -H "authorization: Bearer not-the-token" \
    -H 'content-type: application/json' \
    -d '{"session_id":"smoke","message":"hi"}')"
[ "$CODE" = "401" ] || { echo "!! expected 401, got $CODE" >&2; exit 1; }

# --- Assertion 4: POST /chat with valid bearer -> 200, non-empty -------
#
# The reply may come from the real AIAgent (if the upstream package is
# importable in this container) or from the sidecar's stub branch (if
# the import fails). Either way, the FastAPI shape is what we're
# asserting in Phase 1; round-trips against a real model are Phase 6.
echo ">> [4/5] POST /chat (valid bearer) -> expect 200, non-empty content"
CHAT_BODY="$(curl -fsS -X POST "http://127.0.0.1:${PORT}/chat" \
    -H "authorization: Bearer ${TOKEN}" \
    -H 'content-type: application/json' \
    -d '{"session_id":"smoke","message":"say the single word: pong"}')"
echo "    $CHAT_BODY"
echo "$CHAT_BODY" | jq -e '.content | type == "string" and length > 0' >/dev/null \
    || { echo "!! /chat body lacks non-empty .content" >&2; exit 1; }

# --- Assertion 5: POST /tools/invoke -> 501 ----------------------------
echo ">> [5/5] POST /tools/invoke (valid bearer) -> expect 501"
CODE="$(curl -s -o /dev/null -w '%{http_code}' \
    -X POST "http://127.0.0.1:${PORT}/tools/invoke" \
    -H "authorization: Bearer ${TOKEN}" \
    -H 'content-type: application/json' \
    -d '{}')"
[ "$CODE" = "501" ] || { echo "!! expected 501, got $CODE" >&2; exit 1; }

echo ">> all assertions passed (trap will tear down $NAME)"
