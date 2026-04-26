-- +goose Up

-- M-chat Phase 3: per-instance chat-sidecar opt-in column. Plan:
-- docs/executing/hermes-chat-sidecar.md §4 Phase 3, decision 6.
--
-- chat_enabled is the per-AgentInstance gate that drives three
-- coordinated runtime behaviours:
--
--   1. FlyDeployTarget.Spawn emits a `services` block on the machine
--      config (external :443 → internal :8642) only when this column
--      is TRUE; chat-disabled spawns get byte-equivalent M5-shape
--      machine config with no inbound network exposure (decision 6,
--      "matching today's posture for every existing agent").
--   2. The adapter image's entrypoint.sh reads CORELLIA_CHAT_ENABLED
--      (set by FlyDeployTarget.Spawn from this column's value) and
--      starts the FastAPI sidecar process only when the literal string
--      "true" is observed (Phase 2 of the chat-sidecar plan, default-
--      deny per risk 4).
--   3. agents.Service.ChatWithAgent (Phase 4) returns ErrChatDisabled
--      → Connect FailedPrecondition when callers try to chat with an
--      instance that has chat_enabled=FALSE, even if the deployed
--      adapter image is the post-Phase-7 sidecar-capable digest.
--
-- Default TRUE per plan decision 6: "makes the default explicit and
-- lets fleet-view filter on it". This implies that, post-Phase-5
-- wizard ship, the user-facing default for new spawns is chat-on.
-- Existing M4/M5-era rows backfill to TRUE on this migration's UP —
-- they continue running their pre-Phase-7 adapter image (per
-- blueprint.md §5: existing AgentInstances continue running the old
-- digest until rolled forward explicitly), so chat_enabled=TRUE on
-- those rows is cosmetic until the operator destroy-and-respawns;
-- agents.Service.ChatWithAgent surfaces the gap as ErrChatUnreachable
-- → Connect Unavailable, which is observable in the fleet view rather
-- than silently swallowed. Phase 7's runbook covers the operator-side
-- respawn step.
--
-- Between Phase 3 (this migration) and Phase 5 (wizard checkbox):
-- agents.Service.Spawn writes the explicit Go-zero value (FALSE) into
-- new rows via the widened InsertAgentInstance query, so newly
-- spawned agents in the gap have chat_enabled=FALSE by BE write. The
-- DEFAULT TRUE here only governs (a) backfill on this migration's UP
-- and (b) any future caller that omits the column — Phase 5+ flows
-- explicitly carry the value from the wire so DEFAULT is a fallback
-- safety net, not the primary writer.
--
-- No CHECK constraint needed — BOOLEAN's domain is its own constraint.

ALTER TABLE agent_instances
    ADD COLUMN chat_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- +goose Down

ALTER TABLE agent_instances
    DROP COLUMN IF EXISTS chat_enabled;
