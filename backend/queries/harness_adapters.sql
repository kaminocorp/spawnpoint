-- name: GetHarnessAdapterByID :one
SELECT * FROM harness_adapters WHERE id = $1;

-- name: UpdateHarnessAdapterImageRef :one
UPDATE harness_adapters
   SET adapter_image_ref = $2,
       updated_at = now()
 WHERE id = $1
RETURNING *;
