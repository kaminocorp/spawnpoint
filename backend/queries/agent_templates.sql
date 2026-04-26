-- name: ListAgentTemplates :many
-- Narrowed projection (no SELECT *) — keeps created_by_user_id and timestamps
-- off the row type so the catalog service can't accidentally surface them.
-- M4 widens this or adds a sibling query when the deploy modal needs default_config.
SELECT id, name, description, default_config
FROM agent_templates
ORDER BY created_at ASC;

-- name: GetAgentTemplateByID :one
-- M4 spawn flow's first step (decision 27 step 2): resolve the chosen
-- template + its harness_adapter so we know which adapter image to spawn.
-- Full row including harness_adapter_id and default_config — Spawn needs
-- the FK to load harness_adapters.adapter_image_ref next, and config
-- overrides will eventually merge against default_config.
SELECT * FROM agent_templates WHERE id = $1;
