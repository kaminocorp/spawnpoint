# corellia/hermes-adapter — chat sidecar

FastAPI process exposing `POST /chat`, `GET /health`, `POST /tools/invoke`
(stub) for a Hermes agent. Imports `AIAgent` from the upstream Hermes
package in-process (decision 2 of `docs/executing/hermes-chat-sidecar.md`)
and caches one instance per `session_id` (decision 3, LRU-capped per
risk 5). Bearer-auth via `CORELLIA_SIDECAR_AUTH_TOKEN` (decision 5).

Phase 1 source only — Dockerfile + entrypoint integration is Phase 2.
Local exit-gate harness: `./smoke.sh` (sibling).
