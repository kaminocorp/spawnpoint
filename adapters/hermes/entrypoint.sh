#!/bin/sh
# corellia/hermes-adapter — entrypoint
#
# CORELLIA_* → Hermes-native env-var translation. This script is the
# *only* place in the codebase that knows the names of Hermes-native
# env vars. Per blueprint.md §11.3: harness configuration flows through
# CORELLIA_* env vars; adapters translate; Corellia code never reaches
# into a harness's native env var names from outside the adapter.
#
# Translation table (derived from the Hermes 0.x .env.example +
# cli-config.yaml.example shipped by NousResearch/hermes-agent at the
# pinned upstream digest):
#
#   CORELLIA_AGENT_ID       → AGENT_ID   (passthrough — no native
#                                          consumer; retained for
#                                          observability and so logs /
#                                          Fly metadata can include it)
#   CORELLIA_MODEL_PROVIDER → HERMES_INFERENCE_PROVIDER  (overrides
#                                          model.provider in
#                                          $HERMES_HOME/config.yaml)
#   CORELLIA_MODEL_API_KEY  → provider-conditional rename to one of
#                             OPENROUTER_API_KEY / ANTHROPIC_API_KEY /
#                             OPENAI_API_KEY / GOOGLE_API_KEY /
#                             NOUS_API_KEY
#   CORELLIA_MODEL_NAME     → (no native env-var hook in Hermes 0.x;
#                              LLM_MODEL was removed; selection lives
#                              in $HERMES_HOME/config.yaml under
#                              model.default or via --model CLI flag.
#                              v1.5 follow-up: write a config.yaml
#                              fragment here at boot.)
#
# POSIX shell deliberately — zero runtime dependencies, no compile
# step, no language version skew. `set -e` aborts on any error;
# `${VAR:-}` makes every var optional from the wrapper's perspective
# (Hermes is responsible for surfacing missing-required errors at its
# own boundary, not the adapter's).

set -e

# --- Provider passthrough --------------------------------------------
# HERMES_INFERENCE_PROVIDER is the documented runtime override for the
# `model.provider` config.yaml field; takes precedence over
# auto-detection. When unset, Hermes falls back to "auto" which selects
# from whatever credentials it finds.
if [ -n "${CORELLIA_MODEL_PROVIDER:-}" ]; then
    export HERMES_INFERENCE_PROVIDER="${CORELLIA_MODEL_PROVIDER}"
fi

# --- API key, provider-conditional rename ----------------------------
# Hermes uses provider-specific env-var names rather than a single
# generic credential. We branch on CORELLIA_MODEL_PROVIDER and rename
# accordingly. An unknown provider exits 64 (EX_USAGE) loudly rather
# than silently shipping an unconfigured agent.
case "${CORELLIA_MODEL_PROVIDER:-}" in
    openrouter)
        export OPENROUTER_API_KEY="${CORELLIA_MODEL_API_KEY:-}"
        ;;
    anthropic)
        export ANTHROPIC_API_KEY="${CORELLIA_MODEL_API_KEY:-}"
        ;;
    openai)
        export OPENAI_API_KEY="${CORELLIA_MODEL_API_KEY:-}"
        ;;
    gemini)
        export GOOGLE_API_KEY="${CORELLIA_MODEL_API_KEY:-}"
        ;;
    nous-api)
        export NOUS_API_KEY="${CORELLIA_MODEL_API_KEY:-}"
        ;;
    "")
        # No provider declared — let Hermes auto-detect from any
        # already-set credentials. This branch is reachable from local
        # `docker run` invocations that pre-export native names; it is
        # NOT expected at runtime via Corellia (M4's spawn flow always
        # sets CORELLIA_MODEL_PROVIDER).
        ;;
    *)
        echo "corellia adapter: unknown CORELLIA_MODEL_PROVIDER='${CORELLIA_MODEL_PROVIDER}'" >&2
        echo "corellia adapter: supported values: openrouter, anthropic, openai, gemini, nous-api" >&2
        exit 64
        ;;
esac

# --- Identifier passthrough ------------------------------------------
# Hermes 0.x has no native concept of an externally-supplied agent ID.
# We export AGENT_ID for any downstream subprocess (skill scripts,
# hook scripts, MCP servers) that wants to read it, and retain
# CORELLIA_AGENT_ID itself so operator-side log filtering by the
# CORELLIA prefix continues to work.
if [ -n "${CORELLIA_AGENT_ID:-}" ]; then
    export AGENT_ID="${CORELLIA_AGENT_ID}"
fi

# --- Model name ------------------------------------------------------
# Deliberately unwired in v1. CORELLIA_MODEL_NAME is observability-only
# at this adapter; the model defaults to upstream's
# anthropic/claude-opus-4.6 (per cli-config.yaml.example). v1.5
# follow-up: drop a minimal config.yaml fragment under $HERMES_HOME
# before exec'ing upstream so model.default is set from the env var.
# See README.md §"Known limitations".

# --- Chat sidecar branch (M-chat Phase 2) ----------------------------
# docs/executing/hermes-chat-sidecar.md §4 Phase 2 introduces an
# optional FastAPI sidecar at /corellia/sidecar/ that exposes the
# Corellia-shaped /chat + /health HTTP runtime contract (blueprint
# §3.1). The sidecar source is *always* present in the image (the
# Dockerfile COPYs it unconditionally); whether it *runs* is gated
# here by CORELLIA_CHAT_ENABLED, set per-instance by the BE's spawn
# path (Phase 3). Default-deny per risk 4: only the literal string
# "true" enables the sidecar — unset, "false", "1", "True" all skip,
# preserving byte-equivalent behaviour for every M4-era spawn that
# never sets the var.
if [ "${CORELLIA_CHAT_ENABLED:-}" = "true" ]; then
    # Two-process supervision. This is a *deliberate* departure from
    # the single-process `exec` pattern below: with two children we
    # MUST stay as PID 1 to fan SIGTERM/SIGINT out to both, otherwise
    # one child receives Fly's grace-period signal and the other gets
    # SIGKILLed without draining. The trap below is the fan-out.
    #
    # Hermes is the *primary* process — its exit drives container
    # shutdown. The sidecar is bookkeeping; if Hermes dies we tear it
    # down and exit with Hermes's status. The reverse (sidecar dies,
    # Hermes keeps running) leaves /chat returning connection-refused
    # to Corellia's BE, which surfaces as `ErrChatUnreachable` in
    # Phase 4 — observable from the operator's fleet view rather than
    # silently swallowed.

    forward_term() {
        [ -n "${SIDECAR_PID:-}" ] && kill -TERM "$SIDECAR_PID" 2>/dev/null || true
        [ -n "${HERMES_PID:-}" ] && kill -TERM "$HERMES_PID" 2>/dev/null || true
    }
    trap forward_term TERM INT

    # Sidecar starts first so it's already listening when M4's Health()
    # poll fires — Phase 6 is what tightens Health() into hitting the
    # HTTP /health route, but starting the listener early avoids a
    # post-spawn race regardless. uvicorn binds 0.0.0.0:8642 by default
    # (decision 4); CORELLIA_SIDECAR_PORT exists as a dev-only override.
    python -m uvicorn \
        --app-dir /corellia/sidecar \
        sidecar:app \
        --host 0.0.0.0 \
        --port "${CORELLIA_SIDECAR_PORT:-8642}" \
        --log-level info &
    SIDECAR_PID=$!

    /opt/hermes/docker/entrypoint.sh "$@" &
    HERMES_PID=$!

    # `set +e` around the wait-then-capture so a non-zero exit from
    # Hermes doesn't trip the script-level `set -e` before we get a
    # chance to clean up the sidecar. The trap fires asynchronously
    # if SIGTERM arrives mid-wait; afterward we still fall through to
    # the kill+wait teardown so the sidecar can drain.
    set +e
    wait "$HERMES_PID"
    HERMES_EXIT=$?
    kill -TERM "$SIDECAR_PID" 2>/dev/null
    wait "$SIDECAR_PID" 2>/dev/null
    set -e

    exit "$HERMES_EXIT"
fi

# --- Exec upstream (chat-disabled or unset) --------------------------
# `exec` (not subshell) is load-bearing on this branch: without it the
# wrapper shell stays as PID 1 and the upstream Hermes process becomes
# PID 2, which means SIGTERM from Fly hits the shell and Hermes never
# gets a chance to drain in-flight work before the grace-period
# SIGKILL. With exec, the shell *replaces itself* with the upstream
# entrypoint, which itself execs into `hermes` after its own bootstrap.
# (The chat-enabled branch above accepts staying as PID 1 because it
# has two children to fan signals to — that's the trade-off the trap
# pays for.)
exec /opt/hermes/docker/entrypoint.sh "$@"
