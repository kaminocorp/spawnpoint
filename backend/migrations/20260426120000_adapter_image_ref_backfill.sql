-- +goose Up

-- M3 backfill: populate harness_adapters.adapter_image_ref for the
-- 'hermes' row M2 deliberately seeded as NULL, then tighten the
-- column to NOT NULL and add a digest-pinning CHECK constraint.
--
-- Adapter image audit (per docs/completions/hermes-adapter-and-fly-wiring-phase-2.md):
--   registry_ref:  ghcr.io/hejijunhao/corellia-hermes-adapter
--   tag:           v2026-04-26-0ece98b   (mutable; for humans only — not consumed at runtime)
--   digest:        sha256:d152b3cbf7ed0d67a204dd3de041b0248ca0e550aeb9b9ad2537ce12f98ff0b6
--                  -- multi-arch OCI image index; references linux/amd64 (sha256:4aefe3a2...)
--                  -- and linux/arm64 (sha256:a0027be5...) per Phase 2 capture.
--                  -- Manifest-list digest is non-deterministic across rebuilds (BuildKit
--                  -- attestation timestamps); the per-arch substantive content is
--                  -- deterministic. The DB pin is the operational identity ("this exact
--                  -- push"); the per-arch digests are the substantive identity ("this
--                  -- exact runtime image"). See Phase 2 completion §"Two attestation
--                  -- manifests embedded in the image index" for full discussion.
--   captured_at:   2026-04-26
--   captured_via:  `docker buildx imagetools inspect` against ghcr.io after the
--                  multi-arch buildx push (`crane` is the preferred tool but was
--                  not installed on the capture host; imagetools returns the same
--                  manifest-list information).
--   built_from:    upstream sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338
--                  (the Hermes upstream digest in harness_adapters.upstream_image_digest;
--                  the two columns now form a complete chain — upstream Hermes
--                  pinned + Corellia adapter pinned, both auditable independently
--                  against their source registries).
--   blueprint:     §11.2 (digest-pinning is non-negotiable), §4 (v1 hand-written adapter)
UPDATE harness_adapters
   SET adapter_image_ref = 'ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:d152b3cbf7ed0d67a204dd3de041b0248ca0e550aeb9b9ad2537ce12f98ff0b6'
 WHERE harness_name = 'hermes';

-- Defence-in-depth: future inserts/updates can't sneak in a NULL or a
-- tag-pinned ref. Pairs with M2's CHECK on upstream_image_digest. The
-- LIKE pattern is deliberately permissive on the registry host —
-- pinning 'ghcr.io/%@sha256:%' would lock in the operational choice
-- of where the image lives, while what matters for §11.2 is that the
-- ref is digest-pinned regardless of registry.
--
-- Order matters: the UPDATE above must run before this ALTER, because
-- Postgres validates new CHECK constraints against existing rows.
-- Bundling both in one migration (rather than two) means goose's
-- per-file atomicity guarantees they land or fail together — no
-- partial state where the column is NOT NULL but the row is still NULL.
ALTER TABLE harness_adapters
    ALTER COLUMN adapter_image_ref SET NOT NULL,
    ADD CONSTRAINT adapter_image_ref_digest_pinned
        CHECK (adapter_image_ref LIKE '%@sha256:%');

-- +goose Down
ALTER TABLE harness_adapters
    DROP CONSTRAINT IF EXISTS adapter_image_ref_digest_pinned,
    ALTER COLUMN adapter_image_ref DROP NOT NULL;

UPDATE harness_adapters
   SET adapter_image_ref = NULL
 WHERE harness_name = 'hermes';
