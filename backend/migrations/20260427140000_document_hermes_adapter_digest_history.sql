-- +goose Up

-- 0.11.9: documentation-only migration. Zero DDL, zero DML — exists
-- solely to seal the digest history that 20260427130000's leading
-- comment block left ambiguous (the prior file's operator-instruction
-- block read as if <IMAGE-DIGEST-PENDING> were still unfilled, even
-- though line 39 was filled and the migration was applied to prod
-- on Sun Apr 26 17:23:48 2026 per goose status).
--
-- Modifying an already-applied migration in-place — even comments
-- only — would mutate immutable history; new environments running
-- `goose up` from scratch would see a different file than the one
-- prod recorded. This additive no-op is the correct shape: it lands
-- as a normal migration, prod re-runs it harmlessly, and any future
-- reader walking the migration tree in chronological order sees the
-- digest history sealed at this point.
--
-- Hermes adapter image digest history (M3 → M-chat → present):
--
--   M3 Phase 2          (2026-04-26)  sha256:d152b3cbf7ed0d67a204dd3de041b0248ca0e550aeb9b9ad2537ce12f98ff0b6
--                                     -- single-process Hermes; no /chat, no /health, no services block
--                                     -- backfilled by 20260426120000_adapter_image_ref_backfill.sql
--
--   M-chat Phase 7      (2026-04-27)  sha256:e31cc422c6e9c98200e1afae8abb99ef1256b12dc0b1d09802d1f878c9516441
--                                     -- adds sidecar.py + two-process entrypoint supervisor
--                                     -- captured via `docker buildx imagetools inspect …:v2026-04-27-mchat`
--                                     -- pinned by 20260427130000_bump_hermes_adapter_for_chat.sql
--                                     -- applied to prod Sun Apr 26 17:23:48 2026 (per goose status)
--
-- The adapter_image_ref_digest_pinned CHECK constraint (LIKE '%@sha256:%')
-- remains the runtime guardrail; this migration adds nothing to it.

SELECT 1 WHERE FALSE;  -- explicit no-op so `goose up` records the row

-- +goose Down

SELECT 1 WHERE FALSE;
