-- name: ListAgentTemplates :many
-- Narrowed projection (no SELECT *) — keeps created_by_user_id and timestamps
-- off the row type so the catalog service can't accidentally surface them.
-- M4 widens this or adds a sibling query when the deploy modal needs default_config.
SELECT id, name, description, default_config
FROM agent_templates
ORDER BY created_at ASC;
