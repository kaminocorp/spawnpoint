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

# --- Exec upstream ---------------------------------------------------
# `exec` (not subshell) is load-bearing: without it the wrapper shell
# stays as PID 1 and the upstream Hermes process becomes PID 2, which
# means SIGTERM from Fly hits the shell and Hermes never gets a chance
# to drain in-flight work before the grace-period SIGKILL. With exec,
# the shell *replaces itself* with the upstream entrypoint, which
# itself execs into `hermes` after its own bootstrap.
exec /opt/hermes/docker/entrypoint.sh "$@"
