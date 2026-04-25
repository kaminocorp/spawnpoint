-- name: GetOrganizationByID :one
SELECT * FROM organizations WHERE id = $1;

-- name: UpdateOrganizationName :one
UPDATE organizations SET name = $2, updated_at = now()
WHERE id = $1
RETURNING *;
