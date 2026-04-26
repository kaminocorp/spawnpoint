-- name: InsertManifestToken :exec
-- Write the SHA-256 hash of the raw bearer token at spawn time.
-- agent_instance_id is the PK so a second spawn attempt for the same
-- instance hits a unique violation — use UpsertManifestToken if rotation
-- is ever needed (Phase 7+ follow-up).
INSERT INTO agent_instance_manifest_tokens (agent_instance_id, token_hash)
VALUES ($1, $2);

-- name: GetManifestTokenByHash :one
-- Authenticate an incoming bearer token: hash it on the caller side, then
-- look up the instance. Returns the full row so the handler can extract
-- both agent_instance_id and manifest_version in one query.
SELECT * FROM agent_instance_manifest_tokens WHERE token_hash = $1;

-- name: GetManifestTokenByInstance :one
-- Read the current manifest_version for ETag emission without needing
-- the raw token. Used by the manifest assembler.
SELECT * FROM agent_instance_manifest_tokens WHERE agent_instance_id = $1;

-- name: BumpManifestVersion :exec
-- Increment manifest_version after a grant write (Phase 3 SetInstanceGrants).
-- Invalidates any cached ETag the adapter's poll daemon is holding.
UPDATE agent_instance_manifest_tokens
   SET manifest_version = manifest_version + 1
 WHERE agent_instance_id = $1;
