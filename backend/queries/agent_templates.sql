-- name: ListAgentTemplates :many
-- Narrowed projection (no SELECT *) — keeps created_by_user_id and timestamps
-- off the row type so the catalog service can't accidentally surface them.
-- v1.5 Pillar B Phase 4 added harness_adapter_id so the spawn wizard's TOOLS
-- step can scope ListTools without a second round-trip.
SELECT id, name, description, harness_adapter_id, default_config
FROM agent_templates
ORDER BY created_at ASC;

-- name: GetAgentTemplateByID :one
-- M4 spawn flow's first step (decision 27 step 2): resolve the chosen
-- template + its harness_adapter so we know which adapter image to spawn.
-- Full row including harness_adapter_id and default_config — Spawn needs
-- the FK to load harness_adapters.adapter_image_ref next, and config
-- overrides will eventually merge against default_config.
SELECT * FROM agent_templates WHERE id = $1;
