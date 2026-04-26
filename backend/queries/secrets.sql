-- name: InsertSecret :one
-- Audit-only DB record. The actual secret value is set on the Fly app
-- via FlyDeployTarget.Spawn → Fly's app-secrets API; storage_ref is the
-- opaque handle pointing at it. This insert lives in the same pgx.Tx as
-- the parent agent_instances insert (decision 27 step 6) so a
-- half-inserted state — instance row exists, secret rows don't — is
-- impossible.
INSERT INTO secrets (agent_instance_id, key_name, storage_ref)
VALUES ($1, $2, $3)
RETURNING *;

-- name: ListSecretsByInstance :many
-- Audit read. v1 has no caller; v1.5+ surfaces "which secrets are set
-- on this agent?" in the fleet detail view. Shipped now because the
-- query is trivial and querier-interface widening costs nothing.
SELECT * FROM secrets
WHERE agent_instance_id = $1
ORDER BY created_at ASC;
