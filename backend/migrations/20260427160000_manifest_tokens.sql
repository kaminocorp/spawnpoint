-- +goose Up

-- v1.5 Pillar B Phase 2: per-instance manifest bearer tokens.
--
-- The adapter entrypoint fetches CORELLIA_TOOL_MANIFEST_URL at boot,
-- authenticating with CORELLIA_INSTANCE_TOKEN (a 32-byte random hex string
-- stored as a Fly app secret). This table stores the SHA-256 hash of each
-- token so the manifest endpoint can verify an incoming bearer token without
-- the hash needing to be a secret (hash is one-way; the raw token lives only
-- in Fly's encrypted secrets store and in the adapter's process env).
--
-- PK is agent_instance_id (not a separate UUID): one active token per instance.
-- ON DELETE CASCADE propagates through from agent_instances — destroying an
-- instance revokes its manifest token atomically.
--
-- manifest_version is a monotonic counter used for ETag / If-None-Match on
-- the manifest endpoint. It starts at 1 and is bumped by Phase 3's
-- SetInstanceGrants each time the grant set changes. The adapter's Phase 5
-- poll daemon sends If-None-Match to skip re-rendering scope.json when nothing
-- has changed.

CREATE TABLE agent_instance_manifest_tokens (
    agent_instance_id UUID    NOT NULL PRIMARY KEY
                              REFERENCES agent_instances(id) ON DELETE CASCADE,
    token_hash        TEXT    NOT NULL UNIQUE,
    manifest_version  BIGINT  NOT NULL DEFAULT 1
);

-- +goose Down
DROP TABLE IF EXISTS agent_instance_manifest_tokens;
