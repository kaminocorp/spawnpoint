-- name: InsertToolGrantAudit :exec
-- Append-only write into the tool_grant_audit log. Phase 7 fills in the
-- auditAppend(...) no-op call sites planted in Phase 3 with this query.
-- before_json / after_json are reserved for the v1.6 reader UI — Phase 7
-- writes pass nil for both; the action + FK columns alone power the
-- operator-action timeline.
INSERT INTO tool_grant_audit (
    actor_user_id,
    org_id,
    instance_id,
    tool_id,
    action,
    before_json,
    after_json
)
VALUES ($1, $2, $3, $4, $5, $6, $7);
