-- name: GetDeployTargetByName :one
-- Server-side resolution of the FK target for agent_instances inserts
-- (decision 5). v1 always passes 'fly'. The name parameter is
-- code-internal — the user never picks a deploy target in v1.
SELECT * FROM deploy_targets WHERE name = $1;

-- name: ListDeployTargets :many
-- v1 has no caller; v1.5 admin views surface the registry. Same shipped-
-- early rationale as secrets.ListSecretsByInstance — querier widening is
-- free, and the contract surface is more honest with both reads visible.
SELECT * FROM deploy_targets
WHERE enabled = true
ORDER BY name ASC;
