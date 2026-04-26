-- +goose Up

-- M-chat Phase 7: bump adapter_image_ref to the post-sidecar Hermes adapter image.
--
-- OPERATOR — before running `goose up`, replace <IMAGE-DIGEST-PENDING> below with
-- the actual manifest-list digest captured after the multi-arch buildx push:
--
--   docker buildx build \
--     --platform linux/amd64,linux/arm64 \
--     -t ghcr.io/hejijunhao/corellia-hermes-adapter:v2026-04-27-mchat \
--     --push adapters/hermes
--
--   docker buildx imagetools inspect \
--     ghcr.io/hejijunhao/corellia-hermes-adapter:v2026-04-27-mchat \
--     | grep "Digest:" | head -1
--   # → sha256:<64-char-hex>
--
-- Then update the UPDATE statement below:
--   adapter_image_ref = 'ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:<64-char-hex>'
--
-- Running `goose up` with the placeholder will fail the
-- adapter_image_ref_digest_pinned CHECK constraint intentionally — that
-- constraint is the guardrail that prevents a non-digest ref from landing.
--
-- What changed in the new image (M-chat Phases 1–2):
--   - sidecar/sidecar.py baked in at /corellia/sidecar/ (FastAPI, POST /chat,
--     GET /health, POST /tools/invoke stub)
--   - entrypoint.sh extended with two-process supervisor branch:
--     when CORELLIA_CHAT_ENABLED=true, uvicorn starts in background on :8642
--     and the entrypoint fans SIGTERM to both sidecar + hermes on shutdown
--   - When CORELLIA_CHAT_ENABLED is unset or any value other than "true",
--     the original single-process exec path is taken — byte-equivalent to
--     the pre-M-chat adapter (sha256:d152b3…)
--
-- Existing agents whose adapter_image_ref is the old digest continue running
-- unaffected per blueprint §5; ChatWithAgent calls on those instances return
-- ErrChatUnreachable until the agent is destroy-and-respawned to this digest.
UPDATE harness_adapters
   SET adapter_image_ref = 'ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:e31cc422c6e9c98200e1afae8abb99ef1256b12dc0b1d09802d1f878c9516441'
 WHERE harness_name = 'hermes';

-- +goose Down
-- Revert to the pre-M-chat adapter image (M3 Phase 2 build).
UPDATE harness_adapters
   SET adapter_image_ref = 'ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:d152b3cbf7ed0d67a204dd3de041b0248ca0e550aeb9b9ad2537ce12f98ff0b6'
 WHERE harness_name = 'hermes';
