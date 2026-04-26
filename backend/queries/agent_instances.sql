-- name: InsertAgentInstance :one
-- Full insert at the head of decision 27's order of operations (step 5).
-- Status is omitted — the column DEFAULT 'pending' is the source of truth
-- for the initial state, and putting it in the call site would invite
-- typos. last_started_at / last_stopped_at default to NULL until the
-- polling goroutine flips status to 'running' (and beyond).
INSERT INTO agent_instances (
    name,
    agent_template_id,
    owner_user_id,
    org_id,
    deploy_target_id,
    model_provider,
    model_name,
    config_overrides
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
    t.name AS template_name
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
    t.name AS template_name
FROM agent_instances ai
JOIN agent_templates t ON t.id = ai.agent_template_id
WHERE ai.id = $1 AND ai.org_id = $2;

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
