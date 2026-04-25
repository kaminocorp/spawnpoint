-- +goose Up

CREATE TABLE harness_adapters (
    id                     UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    harness_name           TEXT        NOT NULL UNIQUE,
    upstream_image_digest  TEXT        NOT NULL CHECK (upstream_image_digest LIKE 'sha256:%'),
    adapter_image_ref      TEXT        NULL,    -- filled by M3 once corellia/hermes-adapter is built+pushed
    source                 TEXT        NOT NULL DEFAULT 'hand_written'
                                                CHECK (source IN ('hand_written', 'generated')),
    generated_at           TIMESTAMPTZ NULL,
    validated_at           TIMESTAMPTZ NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_templates (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                TEXT        NOT NULL,
    description         TEXT        NOT NULL,
    harness_adapter_id  UUID        NOT NULL REFERENCES harness_adapters(id),
    default_config      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by_user_id  UUID        NULL     REFERENCES users(id),  -- NULL = system seed
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed: Hermes harness adapter + matching agent template.
--
-- Pin audit (per docs/executing/agent-catalog.md decision 22):
--   registry_ref:  docker.io/nousresearch/hermes-agent
--                  (NOT ghcr.io/... as docs/blueprint.md §1 states; the GHCR path
--                   does not exist; the canonical published location is Docker Hub)
--   resolved_tag:  v2026.4.23                                        -- highest stable version tag (NOT :latest)
--   digest:        sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338
--                  -- multi-arch OCI image index; references linux/amd64 + linux/arm64
--   captured_at:   2026-04-25
--   captured_via:  Docker Hub registry HEAD against the manifest endpoint;
--                  cross-checked against hub.docker.com/v2/.../tags?page_size=100.
--                  `crane digest` would be the preferred tool but was not installed
--                  on the capture host; the registry HEAD response carried
--                  Content-Type: application/vnd.oci.image.index.v1+json which
--                  is the same artefact `crane digest` returns.
--   blueprint:     §11.2 (digest-pinning is non-negotiable)
INSERT INTO harness_adapters (harness_name, upstream_image_digest, source)
VALUES ('hermes', 'sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338', 'hand_written')
ON CONFLICT (harness_name) DO NOTHING;

INSERT INTO agent_templates (name, description, harness_adapter_id, default_config)
SELECT
    'Hermes',
    'Nous Research''s open-source tool-using agent. OpenAI-compatible chat with first-class function calling.',
    ha.id,
    '{}'::jsonb
FROM harness_adapters ha
WHERE ha.harness_name = 'hermes'
  AND NOT EXISTS (
      SELECT 1 FROM agent_templates t WHERE t.harness_adapter_id = ha.id
  );

-- +goose Down
DROP TABLE IF EXISTS agent_templates;
DROP TABLE IF EXISTS harness_adapters;
