-- name: GetUserByAuthID :one
SELECT * FROM users WHERE auth_user_id = $1;
