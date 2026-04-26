-- +goose Up

-- v1.5 Pillar B Phase 5 — DOWN-direction correction.
--
-- WHY THIS EXISTS:
--   Migration 20260427180000_adapter_image_ref_bump_pillar_b_phase5.sql
--   ships an incorrect DOWN block. Its DOWN reverts the harness_adapters
--   row to the M-chat Phase 7 digest (`e31cc422…`), which would be the
--   correct revert target ONLY if Phase 2 had been deployed separately.
--   In practice Phases 2 + 5 deployed as one image (changelog 0.13.6 —
--   "Phase 2 intermediate image was skipped — Phases 2–5 were deployed
--   together, so both adapter migrations pin the same digest"), so the
--   correct post-Phase-5 revert state is Phase 2's UP digest
--   (`b8a6371d…`), not M-chat.
--
--   Applied migrations are immutable (their content is part of the audit
--   trail and any developer `goose down`-ing must land at the same state
--   as production), so the buggy DOWN cannot be edited in place. This
--   migration is the forward-only correction: its DOWN sets the row to
--   the corrected post-Phase-5 state (b8a6371d). An operator running
--   `goose down 1` from the head lands here at b8a6371d — which IS the
--   correct "Phase 5 reverted, Phase 2 still in effect" state. Continuing
--   `goose down` past 180000 still hits the buggy DOWN and lands at
--   e31cc422; that step is now explicitly the "Phase 2 + Phase 5 both
--   reverted to M-chat" path, which is the documented full-rollback
--   intent of running 170000's DOWN anyway.
--
-- UP behaviour: idempotent re-pin to b8a6371d. The row should already
-- be at this value (set by 170000 and re-set by 180000); the explicit
-- statement makes the desired post-correction state legible at the SQL
-- level and self-heals the row if any out-of-band drift occurred between
-- 0.13.6 and now.
--
-- +goose StatementBegin
UPDATE harness_adapters
   SET adapter_image_ref = 'ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:b8a6371d752be57a746b33d9a03f28d3e136731708ac187589f6e664aefe1664'
 WHERE harness_name = 'hermes'
   AND adapter_image_ref <> 'ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:b8a6371d752be57a746b33d9a03f28d3e136731708ac187589f6e664aefe1664';
-- +goose StatementEnd

-- +goose Down

-- DOWN behaviour: revert to the post-Phase-2 state (b8a6371d). This is
-- the corrected revert target the original 180000 DOWN should have
-- landed at. Running `goose down 1` from the head with this migration
-- applied gives operators an explicit, documented path to the
-- "Phase 5 reverted, Phase 2 still in effect" state without touching
-- the immutable historical record of 180000.
--
-- +goose StatementBegin
UPDATE harness_adapters
   SET adapter_image_ref = 'ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:b8a6371d752be57a746b33d9a03f28d3e136731708ac187589f6e664aefe1664'
 WHERE harness_name = 'hermes';
-- +goose StatementEnd
