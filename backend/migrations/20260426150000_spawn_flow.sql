-- +goose Up

-- M4 Phase 1: spawn-flow tables. Three tables landing in one migration per
-- plan decision 1 (no table before its first reader; all three have callers
-- in M4) and decision 2 (single migration file, atomic per goose's per-file
-- transaction).
--
-- FK order at create time: deploy_targets → agent_instances → secrets.
-- Down-migration drops in reverse FK order (decision 45). The seed INSERT
-- on deploy_targets must run before any agent_instances row references it,
-- so it's at the bottom of this Up block (post-table-create, pre-down).

-- DeployTarget — operator-facing registry of where agents can be deployed.
-- v1 surfaces only the seeded 'fly' row; the table exists so the FK from
-- agent_instances.deploy_target_id is real (blueprint §11.4 — deferred
-- features stub as real interfaces, not fake UI). v1.5 adds DBResolver
-- which reads this table at request time instead of the env-var bootstrap;
-- the row shape doesn't need to change for that swap.
CREATE TABLE deploy_targets (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT        NOT NULL UNIQUE,
    kind        TEXT        NOT NULL CHECK (kind IN ('fly', 'aws', 'local')),
    config      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    enabled     BOOLEAN     NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AgentInstance — one concrete deployed agent. Blueprint §9 is the spec;
-- decisions 3, 4, 5, 8, 9, 10, 11 in docs/executing/spawn-flow.md §2 are
-- the column-level rationale.
--
-- Status lifecycle (decision 3): pending → running | failed
--                                running → stopped | destroyed
--                                stopped → destroyed
-- DEFAULT 'pending' because the row is inserted *before* the Fly call
-- starts (decision 27, step 5). The polling goroutine flips to 'running'
-- on first successful /health (or to 'failed' on timeout).
--
-- deploy_external_ref is NULL until the Fly app is created (decision 4 —
-- the row is auditable even on Fly failure; nullable is honest). The
-- partial unique index below catches any double-spawn that would point
-- two rows at the same Fly app at the DB layer (decision 11).
--
-- model_provider CHECK pins the enum at the DB layer in addition to the
-- proto enum + service-layer validation (decision 26's never-trust-the-
-- client posture). model_name is intentionally *not* CHECK'd — provider
-- model lists change frequently (decision 26).
--
-- org_id NOT NULL is the multi-tenancy enforcement seed (decision 9 —
-- M4 is the first table where cross-org leakage would be visible).
-- All read queries filter on org_id; RLS stays disabled per stack §6.
CREATE TABLE agent_instances (
    id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                 TEXT        NOT NULL,
    agent_template_id    UUID        NOT NULL REFERENCES agent_templates(id),
    owner_user_id        UUID        NOT NULL REFERENCES users(id),
    org_id               UUID        NOT NULL REFERENCES organizations(id),
    deploy_target_id     UUID        NOT NULL REFERENCES deploy_targets(id),
    deploy_external_ref  TEXT        NULL,
    model_provider       TEXT        NOT NULL CHECK (model_provider IN ('anthropic', 'openai', 'openrouter')),
    model_name           TEXT        NOT NULL,
    status               TEXT        NOT NULL DEFAULT 'pending'
                                              CHECK (status IN ('pending', 'running', 'stopped', 'failed', 'destroyed')),
    config_overrides     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    last_started_at      TIMESTAMPTZ NULL,
    last_stopped_at      TIMESTAMPTZ NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot read path: fleet view's "show me this org's agents, newest first"
-- (decision 11). DESC at the index level so the planner can use it
-- directly without an explicit Sort node.
CREATE INDEX agent_instances_org_created_idx
    ON agent_instances (org_id, created_at DESC);

-- Catch double-spawns at the DB layer (decision 11). Partial because
-- pre-Fly-call rows have NULL deploy_external_ref and would all collide
-- on a non-partial unique index. Postgres treats multiple NULLs as
-- distinct in unique indexes, but the partial form is more explicit
-- about intent.
CREATE UNIQUE INDEX agent_instances_deploy_ref_uniq
    ON agent_instances (deploy_external_ref)
    WHERE deploy_external_ref IS NOT NULL;

-- Secret — DB record of *what was set* without exposing *what it was*.
-- No `value` column by design (decision 6, blueprint §9): raw secrets
-- live in Fly's encrypted secret store; storage_ref is the opaque Fly
-- handle (e.g. 'fly:corellia-agent-<uuid>:CORELLIA_MODEL_API_KEY').
-- The table exists for audit + lifecycle ("which secrets did we set on
-- this app?") not for retrieval.
--
-- (agent_instance_id, key_name) UNIQUE per Phase 1 Q1 — duplicate
-- CORELLIA_MODEL_API_KEY rows for the same instance would be nonsense
-- and likely a programming error; the index pins it.
CREATE TABLE secrets (
    id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_instance_id  UUID        NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
    key_name           TEXT        NOT NULL,
    storage_ref        TEXT        NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (agent_instance_id, key_name)
);

-- Seed: the single 'fly' deploy target. AWS / local are NOT seeded —
-- their stub DeployTarget impls exist (M3) but the DB row would be a
-- lie ("you can deploy here") that the UI doesn't expose. v1.5 adds
-- rows when targets become operator-configurable.
INSERT INTO deploy_targets (name, kind, enabled)
VALUES ('fly', 'fly', true)
ON CONFLICT (name) DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS secrets;
DROP TABLE IF EXISTS agent_instances;
DROP TABLE IF EXISTS deploy_targets;
