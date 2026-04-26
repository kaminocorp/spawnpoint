-- +goose Up

-- v1.5 Pillar B Phase 1: tools governance schema + Hermes catalog seed.
--
-- Three tables land in one migration (atomic per goose's per-file transaction):
--   tools                     — toolset catalog, one row per (harness, version, key)
--   org_tool_curation         — per-org enable/disable overrides
--   agent_instance_tool_grants — per-spawn equipping + scope + credential ref
--
-- FK order: harness_adapters → tools → org_tool_curation
--                            → agent_instance_tool_grants
--
-- The catalog seed at the bottom of this Up block is the SQL translation of
-- adapters/hermes/catalog/toolsets.yaml (adapter_version = 'v2026.4.23', grounded
-- against the Hermes upstream pin sha256:d4ee57f…ddd338 / _config_version 22).
-- Platform-restricted toolsets (discord, discord_admin, messaging) are omitted —
-- they cannot load on cli-only v1 deployments (blueprint §11.4 / §1.0 table).
-- oauth_only=true toolsets are seeded but rendered locked in the Phase 4 wizard.
--
-- Down drops in reverse FK order. The catalog seed rows are wiped by the table drops.

-- toolsets catalog — one row per (harness_adapter_id, toolset_key, adapter_version).
-- The UNIQUE triple allows a Hermes digest bump to land new rows alongside the old
-- without disturbing in-flight grants that reference old tool IDs.
CREATE TABLE tools (
    id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    harness_adapter_id   UUID        NOT NULL REFERENCES harness_adapters(id),
    toolset_key          TEXT        NOT NULL,
    display_name         TEXT        NOT NULL,
    description          TEXT        NOT NULL,
    category             TEXT        NOT NULL CHECK (category IN ('info', 'compute', 'integration')),
    icon                 TEXT        NULL,
    default_on_in_hermes BOOLEAN     NOT NULL DEFAULT true,
    oauth_only           BOOLEAN     NOT NULL DEFAULT false,
    scope_shape          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    required_env_vars    TEXT[]      NOT NULL DEFAULT '{}',
    adapter_version      TEXT        NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (harness_adapter_id, toolset_key, adapter_version)
);

-- org_tool_curation — org-admin enable/disable overrides on the catalog.
-- Absence of a row means "enabled" (the default). The curated_by/curated_at
-- pair is a lightweight audit surface; the full tool_grant_audit table arrives
-- in Phase 7 alongside the fleet-view grant editor.
CREATE TABLE org_tool_curation (
    org_id      UUID        NOT NULL REFERENCES organizations(id),
    tool_id     UUID        NOT NULL REFERENCES tools(id),
    enabled     BOOLEAN     NOT NULL DEFAULT true,
    curated_by  UUID        NOT NULL REFERENCES users(id),
    curated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, tool_id)
);

-- agent_instance_tool_grants — per-spawn toolset equipping.
-- One active row per (agent_instance_id, tool_id). "Active" means revoked_at IS NULL.
-- Revocation soft-deletes by setting revoked_at; the plugin's manifest poll picks
-- up the removal within TTL (Phase 5). Full replacement is: revoke-all + insert-new
-- inside a transaction (Phase 3 SetInstanceGrants).
--
-- ON DELETE CASCADE on agent_instance_id: destroying an instance wipes its grants.
-- credential_storage_ref is nullable — toolsets with no required_env_vars pass NULL.
-- expires_at is reserved (no Phase 1–7 UI surface — see §1.2 out-of-scope list).
CREATE TABLE agent_instance_tool_grants (
    id                     UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_instance_id      UUID        NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
    tool_id                UUID        NOT NULL REFERENCES tools(id),
    scope_json             JSONB       NOT NULL DEFAULT '{}'::jsonb,
    credential_storage_ref TEXT        NULL,
    granted_by             UUID        NOT NULL REFERENCES users(id),
    granted_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at             TIMESTAMPTZ NULL,
    expires_at             TIMESTAMPTZ NULL
);

-- Partial unique index: at most one active grant per (instance, tool).
-- Revoked rows (revoked_at IS NOT NULL) are excluded — re-granting after
-- revocation inserts a new row rather than resurrecting the old one.
CREATE UNIQUE INDEX agent_instance_tool_grants_active_uniq
    ON agent_instance_tool_grants (agent_instance_id, tool_id)
    WHERE revoked_at IS NULL;

-- Hot read path: manifest builder needs all active grants for an instance.
CREATE INDEX agent_instance_tool_grants_instance_idx
    ON agent_instance_tool_grants (agent_instance_id)
    WHERE revoked_at IS NULL;

-- ── Catalog seed ──────────────────────────────────────────────────────────────
--
-- Source: adapters/hermes/catalog/toolsets.yaml, adapter_version = 'v2026.4.23'.
-- 19 rows (22 upstream CONFIGURABLE_TOOLSETS minus 3 platform-restricted ones).
-- Scope-shape JSON mirrors the YAML's scope_shape field verbatim.
-- ON CONFLICT DO NOTHING makes re-running goose up on an already-seeded DB safe.

INSERT INTO tools (
    harness_adapter_id,
    toolset_key,
    display_name,
    description,
    category,
    default_on_in_hermes,
    oauth_only,
    scope_shape,
    required_env_vars,
    adapter_version
)
SELECT
    ha.id,
    v.toolset_key,
    v.display_name,
    v.description,
    v.category,
    v.default_on_in_hermes,
    v.oauth_only,
    v.scope_shape::jsonb,
    v.required_env_vars,
    'v2026.4.23'
FROM harness_adapters ha
CROSS JOIN (VALUES
    (
        'web',
        'Web Search & Fetch',
        'Search the web and fetch URLs. Backed by Exa, Parallel, or Firecrawl.',
        'info',
        true,
        false,
        '{"url_allowlist":{"type":"pattern_list","description":"Glob patterns for allowed URLs. Empty list = deny all.","default_deny":true}}',
        ARRAY['EXA_API_KEY']::text[]
    ),
    (
        'browser',
        'Browser Automation',
        'Drive a headless browser to render pages and interact with web UIs.',
        'info',
        true,
        false,
        '{"url_allowlist":{"type":"pattern_list","description":"Glob patterns for allowed URLs. Empty list = deny all.","default_deny":true}}',
        ARRAY[]::text[]
    ),
    (
        'terminal',
        'Terminal',
        'Execute shell commands. Backs the agent''s ability to run system commands, install packages, and manage processes.',
        'compute',
        true,
        false,
        '{"command_allowlist":{"type":"regex_list","description":"Regex patterns for allowed commands. Empty list = deny all.","default_deny":true},"working_directory":{"type":"path","description":"Pin the working directory. Leave blank for no restriction.","default_deny":false}}',
        ARRAY[]::text[]
    ),
    (
        'file',
        'File System',
        'Read and write files on the agent''s local file system.',
        'compute',
        true,
        false,
        '{"path_allowlist":{"type":"pattern_list","description":"Glob patterns for allowed file paths. Empty list = deny all.","default_deny":true},"working_directory":{"type":"path","description":"Pin the working directory. Leave blank for no restriction.","default_deny":false}}',
        ARRAY[]::text[]
    ),
    (
        'code_execution',
        'Code Execution',
        'Execute Python code in a sandboxed environment. Note: direct Python egress bypasses scope enforcement in v1.5.',
        'compute',
        true,
        false,
        '{}',
        ARRAY[]::text[]
    ),
    (
        'vision',
        'Vision',
        'Analyse and describe images using the agent''s configured vision-capable model.',
        'info',
        true,
        false,
        '{}',
        ARRAY[]::text[]
    ),
    (
        'image_gen',
        'Image Generation',
        'Generate images from text prompts. Backed by OpenAI DALL-E or Stability AI.',
        'compute',
        false,
        false,
        '{}',
        ARRAY['OPENAI_API_KEY']::text[]
    ),
    (
        'moa',
        'Mixture of Agents',
        'Orchestrate multiple specialised sub-agents in parallel for a single task (MoA pattern).',
        'compute',
        false,
        false,
        '{}',
        ARRAY[]::text[]
    ),
    (
        'tts',
        'Text-to-Speech',
        'Convert text responses to synthesised speech. Backed by OpenAI TTS.',
        'compute',
        false,
        false,
        '{}',
        ARRAY['OPENAI_API_KEY']::text[]
    ),
    (
        'skills',
        'Skills',
        'Equip reusable declarative skills from the Hermes built-in library. External registry is v1.5 Pillar C.',
        'integration',
        false,
        false,
        '{}',
        ARRAY[]::text[]
    ),
    (
        'todo',
        'To-Do List',
        'Persistent task tracking with create, update, and query operations scoped to the current agent session.',
        'compute',
        true,
        false,
        '{}',
        ARRAY[]::text[]
    ),
    (
        'memory',
        'Memory',
        'Long-term agent memory backed by Hermes''s local store (state.db). Retention policy governance is deferred to v2.',
        'integration',
        false,
        false,
        '{}',
        ARRAY[]::text[]
    ),
    (
        'session_search',
        'Session Search',
        'Full-text search across the current and prior conversation sessions stored in Hermes''s local state.',
        'info',
        true,
        false,
        '{}',
        ARRAY[]::text[]
    ),
    (
        'clarify',
        'Clarify',
        'Ask the user a clarifying question before proceeding with an ambiguous task.',
        'info',
        true,
        false,
        '{}',
        ARRAY[]::text[]
    ),
    (
        'delegation',
        'Delegation',
        'Delegate sub-tasks to other agents within Corellia''s fleet.',
        'compute',
        false,
        false,
        '{}',
        ARRAY[]::text[]
    ),
    (
        'cronjob',
        'Cron Jobs',
        'Schedule recurring tasks inside the agent using cron syntax.',
        'compute',
        false,
        false,
        '{}',
        ARRAY[]::text[]
    ),
    (
        'rl',
        'Reinforcement Learning',
        'Apply reward-based feedback signals to tune the agent''s behaviour over time.',
        'compute',
        false,
        false,
        '{}',
        ARRAY[]::text[]
    ),
    (
        'homeassistant',
        'Home Assistant',
        'Control Home Assistant devices and automations via the local REST API.',
        'integration',
        false,
        false,
        '{}',
        ARRAY['HA_URL', 'HA_TOKEN']::text[]
    ),
    (
        'spotify',
        'Spotify',
        'Control Spotify playback and search. Requires OAuth onboarding — deferred to v1.6.',
        'integration',
        false,
        true,
        '{}',
        ARRAY[]::text[]
    )
) AS v(
    toolset_key,
    display_name,
    description,
    category,
    default_on_in_hermes,
    oauth_only,
    scope_shape,
    required_env_vars
)
WHERE ha.harness_name = 'hermes'
ON CONFLICT (harness_adapter_id, toolset_key, adapter_version) DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS agent_instance_tool_grants;
DROP TABLE IF EXISTS org_tool_curation;
DROP TABLE IF EXISTS tools;
