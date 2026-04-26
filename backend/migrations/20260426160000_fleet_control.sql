-- +goose Up

-- M5 Phase 1: fleet-control schema. Two changes in one migration (per
-- goose's per-file transaction semantics — the column adds and the new
-- table land atomically or not at all):
--
--   (1) Nine columns added to agent_instances. Every column is NOT NULL
--       with a DEFAULT — backward-compatible against the M4 row population
--       (per pre-work step 6: dev-scale, all 'iad' machines, no volumes).
--       DEFAULTs match decision 5's typed primitives + decision-20's
--       validation bounds: region='iad' (M4's de-facto default; the
--       wizard's wire default is 'sin' per Q1 — that lives in service
--       code, not the DB layer); cpu_kind/cpus/memory_mb match the
--       smallest preset (`shared-cpu-1x · 512MB`, Q3); restart_policy
--       'on-failure' + max_retries=3 match Fly's machine-level default;
--       lifecycle_mode='always-on' matches today's behaviour (decision 3);
--       desired_replicas=1 matches the M4 one-app=one-machine invariant
--       (now retired per decision 1, but 1 is the right default for
--       single-spawn); volume_size_gb=1 matches Fly's volume default
--       (decision 8.1).
--
--       lifecycle_mode's CHECK admits all four enum values
--       ('always-on','manual','idle-on-demand','suspended') even though
--       the API only accepts the first two in v1.5 (decision 3) — the
--       column is forward-compatible; the API surface is the constraint.
--
--   (2) New table agent_volumes, one row per provisioned Fly volume
--       (decision 8 + 8.2 — one volume per replica, region-pinned).
--       fly_machine_id is nullable per Q10: an unattached row is a
--       legitimate state (created-but-launch-failed orphan, or scheduled
--       reattach). UNIQUE(fly_volume_id) and UNIQUE(agent_instance_id,
--       fly_machine_id) — the latter is "one volume per machine per
--       agent" (the partial-NULL semantics in Postgres treat multiple
--       NULLs as distinct, so multiple unattached rows per agent are
--       fine pre-launch). ON DELETE CASCADE on the agent_instances FK
--       so re-deletion is symmetric with M4's secrets cascade — but
--       in practice agents.Service.Destroy hard-deletes agent_volumes
--       rows itself after flaps.DeleteVolume succeeds (decision 8.5),
--       and agent_instances soft-deletes rather than DELETEs, so the
--       cascade is a safety net for any future hard-DELETE path, not
--       the primary cleanup mechanism.
--
--       mount_path defaults to '/opt/data' (Hermes' $HERMES_HOME, per
--       upstream Dockerfile). Q9: the column is shipped on day one as
--       forward-compatibility for non-Hermes harnesses; the value is
--       written by service-layer code reading a constant, swapped to
--       harness_adapters.default_mount_path when the second harness lands.
--
-- No data backfill in this migration. Pre-work step 7 (recommendation a):
-- existing M4 agent_instances rows are operator-destroyed and re-spawned
-- post-M5; the migration writes volume_size_gb=1 to those rows but leaves
-- agent_volumes empty until re-spawn populates it.

ALTER TABLE agent_instances
    ADD COLUMN region              TEXT      NOT NULL DEFAULT 'iad',
    ADD COLUMN cpu_kind            TEXT      NOT NULL DEFAULT 'shared'
        CHECK (cpu_kind IN ('shared', 'performance')),
    ADD COLUMN cpus                INTEGER   NOT NULL DEFAULT 1
        CHECK (cpus BETWEEN 1 AND 16),
    ADD COLUMN memory_mb           INTEGER   NOT NULL DEFAULT 512
        CHECK (memory_mb BETWEEN 256 AND 131072 AND memory_mb % 256 = 0),
    ADD COLUMN restart_policy      TEXT      NOT NULL DEFAULT 'on-failure'
        CHECK (restart_policy IN ('no', 'always', 'on-failure')),
    ADD COLUMN restart_max_retries INTEGER   NOT NULL DEFAULT 3
        CHECK (restart_max_retries >= 0),
    ADD COLUMN lifecycle_mode      TEXT      NOT NULL DEFAULT 'always-on'
        CHECK (lifecycle_mode IN ('always-on', 'manual', 'idle-on-demand', 'suspended')),
    ADD COLUMN desired_replicas    INTEGER   NOT NULL DEFAULT 1
        CHECK (desired_replicas BETWEEN 1 AND 10),
    ADD COLUMN volume_size_gb      INTEGER   NOT NULL DEFAULT 1
        CHECK (volume_size_gb BETWEEN 1 AND 500);

CREATE TABLE agent_volumes (
    id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_instance_id  UUID        NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
    fly_volume_id      TEXT        NOT NULL,
    fly_machine_id     TEXT        NULL,
    region             TEXT        NOT NULL,
    size_gb            INTEGER     NOT NULL CHECK (size_gb BETWEEN 1 AND 500),
    mount_path         TEXT        NOT NULL DEFAULT '/opt/data',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (fly_volume_id),
    UNIQUE (agent_instance_id, fly_machine_id)
);

-- Hot read path: per-agent volume enumeration on every fleet render
-- (Phase 4 DetectDrift, Phase 7 inspector slide-over).
CREATE INDEX agent_volumes_by_instance_idx
    ON agent_volumes (agent_instance_id);

-- +goose Down
DROP TABLE IF EXISTS agent_volumes;

ALTER TABLE agent_instances
    DROP COLUMN IF EXISTS volume_size_gb,
    DROP COLUMN IF EXISTS desired_replicas,
    DROP COLUMN IF EXISTS lifecycle_mode,
    DROP COLUMN IF EXISTS restart_max_retries,
    DROP COLUMN IF EXISTS restart_policy,
    DROP COLUMN IF EXISTS memory_mb,
    DROP COLUMN IF EXISTS cpus,
    DROP COLUMN IF EXISTS cpu_kind,
    DROP COLUMN IF EXISTS region;
