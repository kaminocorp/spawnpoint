-- name: GetToolByID :one
-- Single toolset row. Used by ValidateScopeForTool (Phase 1) and the
-- manifest builder (Phase 2) to fetch scope_shape before validating
-- a caller-supplied scope_json.
SELECT * FROM tools WHERE id = $1;

-- name: ListToolsForHarness :many
-- All catalog rows for a given (harness, adapter_version) pair. Phase 2
-- uses this to build the initial config.yaml at boot; Phase 3 exposes it
-- as the ListTools RPC (pre-org-curation filtering). Ordered by display_name
-- for deterministic UI rendering.
SELECT *
FROM tools
WHERE harness_adapter_id = $1
  AND adapter_version    = $2
ORDER BY display_name;

-- name: ListOrgToolCuration :many
-- Full catalog for a harness + version, with per-org enabled flag merged in.
-- A missing org_tool_curation row means "enabled" (COALESCE default true).
-- Phase 3 ListTools RPC returns this shape; the FE merges enabled_for_org
-- to decide which catalog rows to render as active vs locked.
SELECT
    t.*,
    COALESCE(otc.enabled, true) AS enabled_for_org
FROM tools t
LEFT JOIN org_tool_curation otc
       ON otc.tool_id = t.id
      AND otc.org_id  = $1
WHERE t.harness_adapter_id = $2
  AND t.adapter_version    = $3
ORDER BY t.display_name;

-- name: UpsertOrgToolCuration :exec
-- Org-admin enable/disable for a single toolset. ON CONFLICT updates enabled +
-- curated_by so the audit surface stays current. curated_at is always now() —
-- Phase 7 tool_grant_audit is the durable history; this column is "last touched".
INSERT INTO org_tool_curation (org_id, tool_id, enabled, curated_by, curated_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (org_id, tool_id) DO UPDATE
    SET enabled    = EXCLUDED.enabled,
        curated_by = EXCLUDED.curated_by,
        curated_at = now();

-- name: ListInstanceToolGrants :many
-- All active (non-revoked) grants for an instance, joined with the tool row
-- for display fields. The manifest builder (Phase 2) uses this to assemble
-- the ToolManifest proto; the fleet-view inspector (Phase 7) uses it to render
-- the per-instance editor. revoked_at IS NULL is the partial-index predicate
-- from agent_instance_tool_grants_active_uniq.
SELECT
    g.id,
    g.agent_instance_id,
    g.tool_id,
    g.scope_json,
    g.credential_storage_ref,
    g.granted_by,
    g.granted_at,
    g.revoked_at,
    g.expires_at,
    t.toolset_key,
    t.display_name,
    t.scope_shape
FROM agent_instance_tool_grants g
JOIN tools t ON t.id = g.tool_id
WHERE g.agent_instance_id = $1
  AND g.revoked_at IS NULL
ORDER BY t.display_name;

-- name: InsertInstanceToolGrant :one
-- Insert a new active grant. The unique partial index (revoked_at IS NULL)
-- enforces at most one active grant per (instance, tool); a duplicate INSERT
-- will hit a unique-constraint violation. The service layer calls
-- RevokeAllActiveToolGrants + InsertInstanceToolGrant (×N) inside a transaction
-- for atomic full-replacement (Phase 3 SetInstanceGrants). RETURNING * gives
-- the caller the row ID for the audit table (Phase 7).
INSERT INTO agent_instance_tool_grants (
    agent_instance_id,
    tool_id,
    scope_json,
    credential_storage_ref,
    granted_by,
    granted_at
)
VALUES ($1, $2, $3, $4, $5, now())
RETURNING *;

-- name: RevokeInstanceToolGrant :exec
-- Soft-delete a single active grant. The corellia_guard plugin (Phase 5) will
-- pick up the removal on its next manifest poll (≤TTL seconds). Idempotent:
-- if already revoked, the WHERE revoked_at IS NULL clause no-ops.
UPDATE agent_instance_tool_grants
   SET revoked_at = now()
 WHERE agent_instance_id = $1
   AND tool_id           = $2
   AND revoked_at IS NULL;

-- name: GetAgentInstanceOrgGuard :one
-- Existence + org-guard check for tools-governance writes (Phase 3).
-- Returns the instance ID iff it exists AND belongs to the given org.
-- pgx.ErrNoRows on any mismatch — the service layer maps that to
-- ErrInstanceNotForOrg so the handler can render a 404 (not 403) and avoid
-- leaking cross-org existence (matches the M4 multi-tenancy posture in
-- GetAgentInstanceByID).
SELECT id FROM agent_instances WHERE id = $1 AND org_id = $2;

-- name: RevokeAllActiveToolGrants :exec
-- Revoke all active grants for an instance in one statement. Used by
-- SetInstanceGrants (Phase 3) as the first step of its
-- revoke-all → insert-new atomic replacement pattern. Also called on
-- instance destroy if the cascade behaviour needs to be audited before drop
-- (Phase 7 audit rows). Idempotent when there are no active rows.
UPDATE agent_instance_tool_grants
   SET revoked_at = now()
 WHERE agent_instance_id = $1
   AND revoked_at IS NULL;
