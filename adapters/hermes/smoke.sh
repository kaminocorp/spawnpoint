#!/usr/bin/env bash
# adapters/hermes/smoke.sh — manual harness-contract smoke test.
#
# Boots the registry-pushed adapter image on a real Fly machine with
# CORELLIA_* secrets set, polls for `state == started`, dumps the tail
# of logs for the operator's eyeball, then destroys the app.
#
# Plan: docs/executing/hermes-adapter-and-fly-wiring.md §Phase 3.
# Reflects three corrections from
# docs/completions/hermes-adapter-and-fly-wiring-phase-2.md §"What this
# means for Phase 3":
#   1. No /health to poll — Hermes 0.x is CLI-shaped (Phase 1 discovery).
#      We poll `fly machines list --json` for state instead.
#   2. `fly logs --no-tail` hangs on empty streams — we bound it via
#      gtimeout (or a backgrounded-and-killed fallback).
#   3. Explicit `fly apps create` + trap-EXIT destroy is the working
#      pattern from Phase 2's rehearsal; --rm exists but requires --app
#      already in scope, so we just keep one consistent shape.
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

IMAGE="${CORELLIA_HERMES_ADAPTER:-ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:d152b3cbf7ed0d67a204dd3de041b0248ca0e550aeb9b9ad2537ce12f98ff0b6}"
APP="corellia-smoke-$(uuidgen | tr '[:upper:]' '[:lower:]' | cut -c1-8)"
REGION="${REGION:-iad}"

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
    CORELLIA_MODEL_API_KEY="$CORELLIA_SMOKE_API_KEY"

# --restart no: terminal "stopped" state on exit is unambiguous (no
# auto-recovery race against the state poll below).
# --detach: don't block the script on the machine boot stream; we poll
# explicitly. No --port lines: Hermes has no HTTP listener (Phase 1
# discovery), so binding ports would just confuse Fly's auto-attached
# proxy health checks.
echo ">> spawning machine in $REGION (image: $IMAGE)"
fly machines run \
    --app "$APP" \
    --region "$REGION" \
    --restart no \
    --detach \
    "$IMAGE"

# Poll machine state for up to 60s. `started` is the success signal;
# `stopped`/`failed` are terminal-failure signals worth surfacing
# immediately so we don't waste the full 60s on a crash-loop.
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

# Bounded log dump for the human reader. `fly logs --no-tail` hangs on
# empty streams (Phase 2 finding), so we wrap with gtimeout when
# available and fall back to a backgrounded-and-killed pattern when
# coreutils isn't installed.
echo ">> log tail (bounded 15s):"
if command -v gtimeout >/dev/null 2>&1; then
    gtimeout 15 fly logs --app "$APP" --no-tail || true
else
    ( fly logs --app "$APP" --no-tail & FLYPID=$!; sleep 15; \
      kill "$FLYPID" 2>/dev/null || true; \
      wait "$FLYPID" 2>/dev/null || true )
fi

if [ "$SUCCESS" -eq 1 ]; then
    echo ">> smoke complete (trap will destroy $APP)"
    exit 0
else
    echo "!! smoke FAILED — machine did not reach 'started' within 60s" >&2
    exit 1
fi
