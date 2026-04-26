-- +goose Up

-- v1.5 Pillar B Phase 2: bump adapter image ref for render_config.py +
-- corellia_guard plugin stub + entrypoint.sh manifest-fetch block.
--
-- OPERATOR-GATED. Fill in the real digest before running goose up:
--
--   1. Build + push the Phase 2 adapter image:
--        docker buildx build \
--          --platform linux/amd64,linux/arm64 \
--          -t ghcr.io/hejijunhao/corellia-hermes-adapter:v2026-04-27-pillar-b-phase2 \
--          --push adapters/hermes
--
--   2. Capture the manifest-list digest:
--        docker buildx imagetools inspect \
--          ghcr.io/hejijunhao/corellia-hermes-adapter:v2026-04-27-pillar-b-phase2 \
--          | grep "Digest:" | head -1
--        # → Digest: sha256:<64-char-hex>
--
--   3. Replace <IMAGE-DIGEST-PENDING> below with the captured digest.
--
--   4. Run the migration:
--        goose -dir backend/migrations postgres "$DATABASE_URL_DIRECT" up
--
-- The adapter_image_ref_digest_pinned CHECK (LIKE '%@sha256:%') will reject
-- the placeholder value if you accidentally run goose up before filling it in.
--
-- +goose StatementBegin
UPDATE harness_adapters
   SET adapter_image_ref = 'ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:b8a6371d752be57a746b33d9a03f28d3e136731708ac187589f6e664aefe1664'
 WHERE harness_name = 'hermes';
-- +goose StatementEnd

-- +goose Down

-- Revert to the M-chat Phase 7 adapter (adds sidecar.py + two-process
-- entrypoint supervisor; no render_config.py or plugin stub).
-- +goose StatementBegin
UPDATE harness_adapters
   SET adapter_image_ref = 'ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:e31cc422c6e9c98200e1afae8abb99ef1256b12dc0b1d09802d1f878c9516441'
 WHERE harness_name = 'hermes';
-- +goose StatementEnd
