-- name: GetUserByAuthID :one
SELECT * FROM users WHERE auth_user_id = $1;

-- name: CreateUser :one
INSERT INTO users (auth_user_id, email, org_id, role, name)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdateUserName :one
UPDATE users SET name = $2, updated_at = now()
WHERE id = $1
RETURNING *;
