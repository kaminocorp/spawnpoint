-- name: GetUserByAuthID :one
SELECT * FROM users WHERE auth_user_id = $1;

-- name: CreateUser :one
INSERT INTO users (auth_user_id, email, org_id)
VALUES ($1, $2, $3)
RETURNING *;
