# corellia/hermes-adapter
#
# v1 hand-written adapter wrapping nousresearch/hermes-agent. Per
# blueprint.md §4 (adapter strategy) and §11.5 (no upstream forks).
#
# Pinning: the digest below is bit-identical to the value seeded in
# backend/migrations/20260425170000_agent_catalog.sql (column
# harness_adapters.upstream_image_digest). Single source of truth for
# the upstream digest is the database; this Dockerfile quotes it. When
# the upstream digest is bumped, the migration changes first
# (atomically updates both upstream_image_digest and adapter_image_ref)
# and this FROM line is updated to match in the same PR.
FROM docker.io/nousresearch/hermes-agent@sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338

# Upstream's image declares USER hermes (UID 10000). We need root briefly
# to land /corellia/ outside $HERMES_HOME (which is a VOLUME, so anything
# written there at build-time is shadowed by the runtime volume mount).
USER root
COPY --chmod=0755 entrypoint.sh /corellia/entrypoint.sh

# M-chat Phase 2 (docs/executing/hermes-chat-sidecar.md §4 Phase 2): the
# chat sidecar source ships baked into the image. The directory is
# *always* present in the image; whether the sidecar process *runs* is
# gated at boot by CORELLIA_CHAT_ENABLED in entrypoint.sh (decision 6,
# risk 4 — default-deny). No `pip install` step here: per pre-work
# checklist item 2, fastapi + uvicorn + pydantic ship in the upstream
# image via the `[all]` extra (changelog 0.9.5 confirmed via the
# `hermes_cli/web_server.py` import in the same pinned digest). If a
# future upstream digest bump drops them, the chat-enabled boot path
# fails fast at uvicorn startup; the chat-disabled path is unaffected.
# .dockerignore excludes sidecar/README.md + sidecar/smoke.sh so only
# the runtime files (sidecar.py + requirements.txt) reach the image.
COPY --chmod=0755 sidecar/ /corellia/sidecar/

USER hermes

# Override upstream entrypoint with our translating wrapper. The wrapper
# renames CORELLIA_* env vars to the names Hermes natively consumes,
# then exec's the upstream entrypoint (/opt/hermes/docker/entrypoint.sh)
# which performs its own root→hermes privilege drop and bootstrap before
# exec'ing `hermes`. Per blueprint.md §11.3: only the adapter knows the
# names of Hermes-native env vars; Corellia code outside the adapter
# never reaches into them.
ENTRYPOINT ["/corellia/entrypoint.sh"]
