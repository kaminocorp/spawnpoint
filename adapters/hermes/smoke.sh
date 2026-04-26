#!/usr/bin/env bash
# adapters/hermes/smoke.sh — manual harness-contract smoke test.
#
# Boots the registry-pushed adapter image on a real Fly machine with
# CORELLIA_* secrets set, waits for the machine to reach 'started',
# probes /health via HTTP, sends a test /chat message with the per-instance
# bearer token, then destroys the app on EXIT (trap-guarded).
#
# Reflects three corrections from
# docs/completions/hermes-adapter-and-fly-wiring-phase-2.md §"What this
# means for Phase 3":
#   2. `fly logs --no-tail` hangs on empty streams — bounded via gtimeout.
#   3. Explicit `fly apps create` + trap-EXIT destroy is the working
#      pattern from Phase 2's rehearsal.
#
# M-chat update (Phase 7): --port binding added, CORELLIA_CHAT_ENABLED +
# CORELLIA_SIDECAR_AUTH_TOKEN secrets staged, /health HTTP probe added,
# /chat bearer-auth probe added. The original "no /health" limitation
# (Hermes 0.x CLI-shaped) is closed by the M-chat chat sidecar.
#
# Prerequisites:
#   - fly auth login                                 (`fly auth whoami` works)
#   - FLY_ORG_SLUG                                   (e.g. crimson-sun-technologies)
#   - CORELLIA_SMOKE_API_KEY                         (free-tier OpenRouter key is fine)
#   - brew install coreutils                         (optional; for gtimeout)
#
# Invocation:
#   export FLY_ORG_SLUG=<your-org-slug>
#   export CORELLIA_SMOKE_API_KEY=sk-or-v1-<openrouter-key>
#   ./adapters/hermes/smoke.sh

set -euo pipefail

: "${FLY_ORG_SLUG:?must be set (e.g. crimson-sun-technologies)}"
: "${CORELLIA_SMOKE_API_KEY:?must be set (a free-tier OpenRouter key works)}"

IMAGE="${CORELLIA_HERMES_ADAPTER:-ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:e31cc422c6e9c98200e1afae8abb99ef1256b12dc0b1d09802d1f878c9516441}"
APP="corellia-smoke-$(uuidgen | tr '[:upper:]' '[:lower:]' | cut -c1-8)"
REGION="${REGION:-iad}"
# Per-smoke bearer token — random, not stored anywhere, lives only in this
# script invocation and the Fly app secret we stage below.
SIDECAR_TOKEN="$(openssl rand -hex 32)"

# Trap-on-EXIT teardown: even if `set -e` aborts mid-run, the app gets
# cleaned up. Fly machines accumulate cost; leaks here would matter.
trap 'echo ">> tearing down $APP"; fly apps destroy --yes "$APP" 2>/dev/null || true' EXIT

echo ">> creating app $APP in org $FLY_ORG_SLUG"
fly apps create "$APP" --org "$FLY_ORG_SLUG"

# --stage holds secrets in a pending state so they apply at first
# machine creation rather than triggering an unnecessary release on an
# app that has no machines yet.
echo ">> staging CORELLIA_* secrets"
fly secrets set --app "$APP" --stage \
    CORELLIA_AGENT_ID="$APP" \
    CORELLIA_MODEL_PROVIDER="openrouter" \
    CORELLIA_MODEL_NAME="anthropic/claude-3.5-sonnet" \
    CORELLIA_MODEL_API_KEY="$CORELLIA_SMOKE_API_KEY" \
    CORELLIA_CHAT_ENABLED="true" \
    CORELLIA_SIDECAR_AUTH_TOKEN="$SIDECAR_TOKEN"

# --port 443:8642/tcp:http:tls: Fly's edge terminates TLS on :443 and
# forwards plain HTTP to the sidecar's internal :8642. The sidecar's
# /health and /chat routes are only reachable via this port mapping.
# --restart no: terminal "stopped" state on exit is unambiguous.
# --detach: don't block the script on the machine boot stream; we poll
# explicitly.
echo ">> spawning machine in $REGION (image: $IMAGE)"
fly machines run \
    --app "$APP" \
    --region "$REGION" \
    --restart no \
    --detach \
    --port 443:8642/tcp:http:tls \
    "$IMAGE"

# Poll machine state for up to 60s. `started` is the success signal;
# `stopped`/`failed` are terminal-failure signals.
echo ">> waiting for machine to reach 'started' (60s timeout)"
SUCCESS=0
for _ in $(seq 1 30); do
    STATE=$(fly machines list --app "$APP" --json 2>/dev/null \
        | awk -F'"' '/"state":/ {print $4; exit}')
    case "$STATE" in
        started)
            echo ">> machine state: started"
            SUCCESS=1
            break
            ;;
        stopped|failed)
            echo "!! machine reached terminal state: $STATE — see logs below" >&2
            break
            ;;
    esac
    sleep 2
done

# Bounded log dump for the human reader.
echo ">> log tail (bounded 15s):"
if command -v gtimeout >/dev/null 2>&1; then
    gtimeout 15 fly logs --app "$APP" --no-tail || true
else
    ( fly logs --app "$APP" --no-tail & FLYPID=$!; sleep 15; \
      kill "$FLYPID" 2>/dev/null || true; \
      wait "$FLYPID" 2>/dev/null || true )
fi

if [ "$SUCCESS" -ne 1 ]; then
    echo "!! smoke FAILED — machine did not reach 'started' within 60s" >&2
    exit 1
fi

# /health probe — unauthenticated per sidecar design (Fly edge health probes
# run without credentials; authenticated /health would expose the token to
# Fly's edge or flip every machine unhealthy). Retries for up to 60s to
# allow Hermes to finish its own boot after the sidecar is up.
echo ">> probing GET /health (up to 60s for Hermes boot)"
HEALTH_OK=0
for _ in $(seq 1 30); do
    HEALTH=$(curl -fsS --max-time 5 "https://${APP}.fly.dev/health" 2>/dev/null || true)
    if echo "$HEALTH" | grep -q '"ok":true'; then
        echo ">> /health: $HEALTH"
        HEALTH_OK=1
        break
    fi
    sleep 2
done
if [ "$HEALTH_OK" -ne 1 ]; then
    echo "!! /health did not return {\"ok\":true} within 60s" >&2
    exit 1
fi

# /chat probe — bearer token required; sidecar returns 401 without it.
# Sends a minimal prompt; asserts the response carries a non-empty "content"
# key. Uses the same SIDECAR_TOKEN staged above.
echo ">> probing POST /chat with bearer token (30s timeout)"
CHAT_RESP=$(curl -fsS --max-time 30 \
    -X POST "https://${APP}.fly.dev/chat" \
    -H "Authorization: Bearer ${SIDECAR_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"session_id":"smoke","message":"reply with the single word: pong"}' \
    2>/dev/null || true)
echo ">> /chat response: $CHAT_RESP"
if echo "$CHAT_RESP" | grep -q '"content"'; then
    echo ">> smoke complete (trap will destroy $APP)"
    exit 0
else
    echo "!! /chat did not return {\"content\":...}" >&2
    exit 1
fi
