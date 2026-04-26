-- +goose Up

-- v1.5 Pillar B Phase 5: bump adapter image ref for the corellia_guard
-- enforcement plugin. The Phase 2 image shipped a no-op plugin stub; this
-- bump ships the real plugin (scope matchers, pre_tool_call hook, manifest
-- poll daemon) plus render_config.py extension that writes the initial
-- $HERMES_HOME/corellia/scope.json.
--
-- OPERATOR-GATED. Fill in the real digest before running goose up:
--
--   1. Build + push the Phase 5 adapter image:
--        docker buildx build \
--          --platform linux/amd64,linux/arm64 \
--          -t ghcr.io/hejijunhao/corellia-hermes-adapter:v2026-04-27-pillar-b-phase5 \
--          --push adapters/hermes
--
--   2. Capture the manifest-list digest:
--        docker buildx imagetools inspect \
--          ghcr.io/hejijunhao/corellia-hermes-adapter:v2026-04-27-pillar-b-phase5 \
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

-- Revert to the Phase 2 adapter (manifest renderer + plugin stub; no
-- enforcement). NOTE: replace this digest with the actual Phase 2 digest
-- captured during the Phase 2 operator gate before relying on `goose down`.
-- +goose StatementBegin
UPDATE harness_adapters
   SET adapter_image_ref = 'ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:e31cc422c6e9c98200e1afae8abb99ef1256b12dc0b1d09802d1f878c9516441'
 WHERE harness_name = 'hermes';
-- +goose StatementEnd
