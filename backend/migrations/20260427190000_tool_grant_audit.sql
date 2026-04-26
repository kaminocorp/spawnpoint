-- +goose Up

-- v1.5 Pillar B Phase 7: tool_grant_audit table.
--
-- Append-only audit log for tools-governance writes. Phase 3 planted no-op
-- auditAppend(...) call sites at every write path (SetOrgCuration,
-- SetInstanceGrants); Phase 7 fills in the persistence behind those stubs.
-- Read paths land post-v1.5 (a dashboard reader is out of scope for v1.5
-- per plan §1.2).
--
-- Schema mirrors the four-tag signature `auditAppend(action, org, instance, tool)`
-- used at the existing call sites: every audit row has an action and a (nullable)
-- combination of org / instance / tool depending on which event it captures.
-- before_json / after_json are reserved for the v1.6 reader UI; Phase 7's BE
-- writes leave them NULL today (the action string + the FK columns suffice
-- for the operator-action timeline this audit row supports).

CREATE TABLE tool_grant_audit (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    org_id          UUID        NULL REFERENCES organizations(id) ON DELETE SET NULL,
    instance_id     UUID        NULL REFERENCES agent_instances(id) ON DELETE SET NULL,
    tool_id         UUID        NULL REFERENCES tools(id) ON DELETE SET NULL,
    -- Closed enum at v1.5: org_curation_set | instance_grants_set | instance_restart.
    -- Adding a new action is a non-breaking append (CHECK widening).
    action          TEXT        NOT NULL CHECK (action IN (
                        'org_curation_set',
                        'instance_grants_set',
                        'instance_restart'
                    )),
    before_json     JSONB       NULL,
    after_json      JSONB       NULL,
    at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One index per likely read axis (instance timeline, org timeline). The audit
-- table grows monotonically; without these indexes the reader UI's "show
-- changes for this instance" query would table-scan.
CREATE INDEX tool_grant_audit_instance_at_idx
    ON tool_grant_audit (instance_id, at DESC)
 WHERE instance_id IS NOT NULL;

CREATE INDEX tool_grant_audit_org_at_idx
    ON tool_grant_audit (org_id, at DESC)
 WHERE org_id IS NOT NULL;

-- +goose Down

DROP TABLE tool_grant_audit;
