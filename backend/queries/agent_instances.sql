-- name: InsertAgentInstance :one
-- Full insert at the head of decision 27's order of operations (step 5).
-- Status is omitted — the column DEFAULT 'pending' is the source of truth
-- for the initial state, and putting it in the call site would invite
-- typos. last_started_at / last_stopped_at default to NULL until the
-- polling goroutine flips status to 'running' (and beyond).
--
-- M-chat Phase 3: chat_enabled is written explicitly here (rather than
-- letting migration 20260427120000's DEFAULT TRUE kick in) so the
-- service layer's call site is the single source of truth for the
-- value — Phase 5's wizard checkbox flows through DeployConfig
-- → SpawnInput → here. Same posture as the M5 nine deploy-config
-- columns: DB DEFAULTs exist as a fallback, but every BE-driven
-- spawn carries an explicit value.
INSERT INTO agent_instances (
    name,
    agent_template_id,
    owner_user_id,
    org_id,
    deploy_target_id,
    model_provider,
    model_name,
    config_overrides,
    chat_enabled
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: SetAgentInstanceDeployRef :exec
-- Called post-Fly-create (decision 27 step 9). Separate query (not folded
-- into a status update) because the status flip happens later, in the
-- polling goroutine — these are two different wall-clock events.
UPDATE agent_instances
   SET deploy_external_ref = $2,
       updated_at = now()
 WHERE id = $1;

-- name: SetAgentInstanceRunning :exec
-- pending → running transition. Sets last_started_at to wall-clock now.
-- Separate from the generic status setter so the timestamp invariant
-- ("last_started_at is set iff the instance has ever been running") is
-- enforced at the query layer, not the call site.
UPDATE agent_instances
   SET status = 'running',
       last_started_at = now(),
       updated_at = now()
 WHERE id = $1;

-- name: SetAgentInstanceStopped :exec
-- running → stopped transition (decision 23). Sets last_stopped_at.
-- Mirrors SetAgentInstanceRunning's shape — same single-purpose,
-- timestamp-invariant-pinning rationale.
UPDATE agent_instances
   SET status = 'stopped',
       last_stopped_at = now(),
       updated_at = now()
 WHERE id = $1;

-- name: SetAgentInstanceDestroyed :exec
-- → destroyed transition (decision 24). Sets last_stopped_at because
-- destroy implies the agent has stopped running. Soft-delete: row stays,
-- only the status flips. The audit trail ("this org once had 5 agents
-- but only 2 today") is what survives.
UPDATE agent_instances
   SET status = 'destroyed',
       last_stopped_at = now(),
       updated_at = now()
 WHERE id = $1;

-- name: SetAgentInstanceFailed :exec
-- pending → failed transition. Used by the polling goroutine on /health
-- timeout (decision 16) and by the boot-time stale-pending sweep
-- (decision 32). No timestamp side-effect — the agent never started.
UPDATE agent_instances
   SET status = 'failed',
       updated_at = now()
 WHERE id = $1;

-- name: ListAgentInstancesByOrg :many
-- Fleet view's primary read. Joins agent_templates so the FE can label
-- each row with the template name without a second round-trip
-- (decision 31). org_id filter is the multi-tenancy gate (decision 9 —
-- never grant the FE the ability to see another org's rows).
-- M-chat Phase 6: chat_enabled added so the fleet gallery can surface the
-- chat badge + the Health() probe path can read the correct probe strategy.
SELECT
    ai.id,
    ai.name,
    ai.agent_template_id,
    ai.owner_user_id,
    ai.org_id,
    ai.deploy_target_id,
    ai.deploy_external_ref,
    ai.model_provider,
    ai.model_name,
    ai.status,
    ai.config_overrides,
    ai.last_started_at,
    ai.last_stopped_at,
    ai.created_at,
    ai.updated_at,
    t.name AS template_name,
    ai.chat_enabled
FROM agent_instances ai
JOIN agent_templates t ON t.id = ai.agent_template_id
WHERE ai.org_id = $1
ORDER BY ai.created_at DESC;

-- name: GetAgentInstanceByID :one
-- Single-row read with org guard at the query layer. Two-arg shape
-- (id + org_id) is the M4-wide multi-tenancy posture: every read that
-- could surface a row must be parameterised by the requesting user's
-- org. Misuse — passing only id — would be a compile error because
-- sqlc generates a struct-arg with both fields.
--
-- M5 Phase 4: the projection now includes the nine deploy-config
-- columns added by migration 20260426160000. UpdateDeployConfig /
-- ResizeReplicas / ResizeVolume / DetectDrift load the current
-- desired state via this query before applying their respective
-- delta. The fleet-page list query (ListAgentInstancesByOrg) is
-- widened in Phase 5/6 when the FE row card needs those fields.
SELECT
    ai.id,
    ai.name,
    ai.agent_template_id,
    ai.owner_user_id,
    ai.org_id,
    ai.deploy_target_id,
    ai.deploy_external_ref,
    ai.model_provider,
    ai.model_name,
    ai.status,
    ai.config_overrides,
    ai.last_started_at,
    ai.last_stopped_at,
    ai.created_at,
    ai.updated_at,
    ai.region,
    ai.cpu_kind,
    ai.cpus,
    ai.memory_mb,
    ai.restart_policy,
    ai.restart_max_retries,
    ai.lifecycle_mode,
    ai.desired_replicas,
    ai.volume_size_gb,
    ai.chat_enabled,
    t.name AS template_name
FROM agent_instances ai
JOIN agent_templates t ON t.id = ai.agent_template_id
WHERE ai.id = $1 AND ai.org_id = $2;

-- name: UpdateAgentDeployConfig :exec
-- M5 Phase 4 caller (UpdateDeployConfig non-dry-run path). Writes the
-- full nine-tuple of deploy-config columns in one statement so the
-- service layer doesn't have to compose deltas at the SQL boundary.
-- The (id, org_id) pair is the multi-tenancy gate (matches the
-- GetAgentInstanceByID two-arg shape — same posture as M4).
UPDATE agent_instances
   SET region              = $3,
       cpu_kind            = $4,
       cpus                = $5,
       memory_mb           = $6,
       restart_policy      = $7,
       restart_max_retries = $8,
       lifecycle_mode      = $9,
       desired_replicas    = $10,
       volume_size_gb      = $11,
       updated_at          = now()
 WHERE id = $1 AND org_id = $2;

-- name: UpdateAgentReplicas :exec
-- M5 Phase 4 caller (ResizeReplicas). Single-column update kept
-- separate from UpdateAgentDeployConfig because replica resize is its
-- own flow with its own RPC (ResizeAgentReplicas) and its own
-- reconciliation loop (per-replica volume provisioning/cleanup is
-- decision 7's Corellia-side reconciliation; this query is just the
-- DB-side desired-state flip).
UPDATE agent_instances
   SET desired_replicas = $3,
       updated_at       = now()
 WHERE id = $1 AND org_id = $2;

-- name: UpdateAgentInstanceVolumeSize :exec
-- M5 Phase 4 caller (ResizeVolume). Mirrors UpdateAgentReplicas's
-- single-column shape — separate RPC (ResizeAgentVolume), separate
-- live-update path (flaps.ExtendVolume per replica). Per decision 8.3
-- volumes are extend-only; the service layer rejects newSizeGB <
-- current with ErrVolumeShrink before this query runs, so the CHECK
-- (1..500) is the only DB-side guard needed.
--
-- Naming note: this writes the *parent's* desired-state column on
-- agent_instances. The per-row mirror update on agent_volumes is the
-- separately-namespaced UpdateAgentVolumeSize. Same caller (ResizeVolume)
-- runs both inside one tx; the names had to diverge because sqlc's
-- query-name namespace is per-package, not per-table.
UPDATE agent_instances
   SET volume_size_gb = $3,
       updated_at     = now()
 WHERE id = $1 AND org_id = $2;

-- name: BulkUpdateAgentDeployConfig :exec
-- M5 Phase 4 caller (BulkUpdateDeployConfig). id = ANY($1) is the
-- pgx-friendly form of "in this set" — sqlc generates a []uuid.UUID
-- param. org_id filter is applied to every row; instance IDs that
-- belong to another org silently no-op (the service layer pre-filters
-- via ListAgentInstancesByOrg, so this is defence-in-depth, not the
-- primary tenancy gate).
--
-- Per decision 8.4 volume_size_gb is intentionally absent from the
-- bulk delta — bulk-extending across a fleet creates surprise cost
-- and is rarely the right action. Per-instance ResizeVolume is the
-- power-user path.
UPDATE agent_instances
   SET region              = $3,
       cpu_kind             = $4,
       cpus                 = $5,
       memory_mb            = $6,
       restart_policy       = $7,
       restart_max_retries  = $8,
       lifecycle_mode       = $9,
       desired_replicas     = $10,
       updated_at           = now()
 WHERE id = ANY($1::uuid[]) AND org_id = $2;

-- name: ReapStalePendingInstances :many
-- Boot-time sweep (decision 32). Reaps any pending row older than 5
-- minutes — the conservative bound that says "if a poll goroutine
-- existed for this row at process start, its 90s budget plus jitter is
-- well-elapsed by 5 min." Returning the IDs lets cmd/api log them
-- explicitly so a contributor seeing the warn line knows *which* rows
-- got reaped, not just how many.
UPDATE agent_instances
   SET status = 'failed',
       updated_at = now()
 WHERE status = 'pending'
   AND created_at < now() - interval '5 minutes'
RETURNING id;
