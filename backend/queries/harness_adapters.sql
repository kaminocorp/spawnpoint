-- name: GetHarnessAdapterByID :one
SELECT * FROM harness_adapters WHERE id = $1;
