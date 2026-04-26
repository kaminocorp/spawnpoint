# M-chat Hermes Chat Sidecar — Phase 5 completion notes

**Plan:** `docs/executing/hermes-chat-sidecar.md` §4 Phase 5.
**Date:** 2026-04-27.
**Scope:** Proto + BE handler + FE chat panel + FE instance-detail page + wizard Step 4 checkbox. No domain-method change (Phase 4 wired `ChatWithAgent`; this phase wires it to the wire). No migration, no sqlc, no Fly push, no adapter image rebuild.

---

## What shipped

### Proto (`shared/proto/corellia/v1/agents.proto`)

- **`rpc ChatWithAgent(ChatWithAgentRequest) returns (ChatWithAgentResponse)`** added to `AgentsService`. M-chat Phase 5 — proxied chat turn, plan decision 11.
- **`ChatWithAgentRequest { instance_id, session_id, message }`** — minimal inputs for a proxied chat turn. `session_id` is a client-generated UUID (plan decision 3).
- **`ChatWithAgentResponse { content }`** — the agent reply. Non-empty on success.
- **`DeployConfig.chat_enabled bool = 10`** — carries the wizard's "Enable chat" checkbox value on the wire. Zero value is `false`; the wizard default is `true` (plan decision 6).
- **`AgentInstance.chat_enabled bool = 24`** — populated on the Get path (via Phase 3's `GetAgentInstanceByIDRow.ChatEnabled`); left at false on the List path until Phase 6 widens `ListAgentInstancesByOrg`.
- `pnpm proto:generate` regenerated both `backend/internal/gen/` and `frontend/src/gen/` cleanly.

### Backend (`backend/internal/httpsrv/agents_handler.go`)

- **`agentsService` interface** gains `ChatWithAgent(ctx, instanceID, orgID uuid.UUID, sessionID, message string) (string, error)`.
- **`(*AgentsHandler).ChatWithAgent`** handler — 21 LOC, within the <30 LOC budget per blueprint §11.9. Parses instance UUID, calls `svc.ChatWithAgent`, marshals `content`. Bad UUID → `NotFound` (same pattern as other lifecycle handlers).
- **`agentsErrToConnect`** gains three new cases with their Phase 5 sentinel mappings:
  - `ErrChatDisabled` → `FailedPrecondition` (operator must enable chat first).
  - `ErrChatUnreachable` → `Unavailable` (sidecar down / network).
  - `ErrChatAuth` → `Internal` with redacted message + server-side `slog.Error` (Corellia-side token drift; not a user error).
- **`deployConfigFromProto`** gains `ChatEnabled: p.GetChatEnabled()` so the wizard's checkbox flows through to `agents.Spawn`.

### Backend (`backend/internal/agents/service.go`)

- **`toProtoInstanceGetRow`** gains `ChatEnabled: r.ChatEnabled` to populate field 24 on the Get path. The List path (`toProtoInstanceListRow`) is unchanged — its DB row (`ListAgentInstancesByOrgRow`) doesn't include `chat_enabled` yet; Phase 6 widens that query.

### Backend tests (`backend/internal/httpsrv/agents_handler_test.go`)

- **`fakeAgentsSvc`** gains `chatContent string` + `chatErr error` + `ChatWithAgent` method.
- **`TestChatWithAgent_SentinelMapping`** — table-driven, 4 cases: `ErrChatDisabled → FailedPrecondition`, `ErrChatUnreachable → Unavailable`, `ErrChatAuth → Internal`, `ErrInstanceNotFound → NotFound`.
- **`TestChatWithAgent_HappyPath`** — content string forwarded verbatim.
- **`TestChatWithAgent_BadInstanceID`** — malformed UUID → NotFound before service call.

`go vet ./... && go build ./... && go test ./...` — all green. Six new test cases across two new test functions.

### Frontend — deployment-presets.ts

- `DeploymentConfigValues` gains `chatEnabled: boolean`.
- `DEFAULT_DEPLOYMENT_VALUES` gains `chatEnabled: true` (default-on per plan decision 6 / Q2).

### Frontend — deployment-config-form.tsx

- `deploymentConfigSchema` gains `chatEnabled: z.boolean()`.
- `DeploymentFormValues` (inferred from schema) now includes `chatEnabled`.
- **`ChatEnabledField`** component: checkbox + prose hint rendered after `LifecycleField` in the form. Used by both the wizard's Step 4 and the fleet inspector's edit pane (the inspector now also passes `chatEnabled` through `deployConfigFromValues`).

### Frontend — wizard.tsx

- `deployConfigFromFields` gains `chatEnabled: d.chatEnabled` so the proto `DeployConfig.chat_enabled` field is populated on every `spawnAgent` call.
- `deploymentSummaryRows` gains `{ label: "CHAT", value: d.chatEnabled ? "enabled" : "disabled" }` so Step 4's confirmed summary and Step 5's review row show the chat setting.

### Frontend — deployment-inspector.tsx

- `deploymentValuesFromInstance` gains `chatEnabled: i.chatEnabled ?? true` (fallback to `true` matches the migration default; the list query leaves the field at false until Phase 6, so `?? true` is the right optimistic sentinel).
- `deployConfigFromValues` gains `chatEnabled: v.chatEnabled`.

### Frontend — `frontend/src/components/fleet/chat-panel.tsx` (new)

- `<ChatPanel instanceId>` — message list + textarea input + "› SEND" button.
- `session_id` managed via `useSessionId(instanceId)`: reads from / writes to `sessionStorage` keyed `corellia:chat-session:<instanceId>`, generated fresh on first mount, cleared on tab close (plan Q4).
- Enter to send, Shift+Enter for newline.
- Scroll-to-bottom after each message via `ref` + `scrollIntoView`.
- Three states: `idle`, `sending` (animated ellipsis bubble), `error` (red message below conversation).
- `ConnectError.from(e)` surfaces the Connect-level message on error (e.g. "agent chat disabled").

### Frontend — `frontend/src/app/(app)/fleet/[id]/page.tsx` (new)

- Client component (plan §4 Phase 5 adds the instance-detail page). Loads via `GetAgentInstance` RPC.
- Identity block in a `<TerminalContainer>`: STATUS, PROVIDER, MODEL, REGION, SIZE, REPLICAS, CREATED, CHAT labels. `<AgentRowActions>` bar below the spec sheet for start/stop/destroy/logs/deployment actions.
- Chat-enabled branch: `<TerminalContainer title="CHAT // HERMES" accent="adapter">` wrapping `<ChatPanel instanceId>` at 480px height.
- Chat-disabled branch: affordance paragraph + "→ spawn a chat-enabled agent" link to `/spawn`.
- Breadcrumb: `← fleet / <name>`.

### Frontend — fleet list page + agent card

- Fleet list table: agent name is now a `<Link href={/fleet/${id}}>` so the detail page is reachable from the list.
- `agent-card.tsx`: agent name `<h2>` is wrapped in a `<Link href={/fleet/${id}}>` for gallery-view navigation to the detail page.

---

## How it diverged from the plan

### 1. `ChatEnabledField` is a plain `<input type="checkbox">`, not a shadcn `<Switch>`

Plan §4 Phase 5 doesn't prescribe the checkbox widget. The `<Switch>` from shadcn is used elsewhere in the codebase but its import chain is heavier than a bare `<input type="checkbox">`. Given the mission-control visual register (explicit toggles vs. toggles-as-actions), a visible checkbox with a label is clearer. Future PR can swap to `<Switch>` if operator feedback calls for it.

### 2. `ListAgentInstancesByOrg` not widened in Phase 5

Plan §4 Phase 3 notes and the Phase 5 scope note both say "widened in Phase 5/6 when the FE row card needs it." The `/fleet/[id]` detail page loads via `GetAgentInstance` (which already returns `chat_enabled`), so the list-page gallery and list-view table don't need the field to render the detail link. The fallback in `deploymentValuesFromInstance` (`i.chatEnabled ?? true`) handles the interim. Phase 6 widens the list query.

### 3. Fleet list: link on name only (not whole row)

Plan doesn't prescribe navigation affordance from the list. Making only the name a link (rather than the whole row) keeps the row's checkbox + action affordances from competing with navigation. The gallery card also links on the name `<h2>` only, not the entire card surface — consistent with the compact action row already occupying the footer.

---

## What I deliberately did NOT do

- **Did not implement `UpdateAgentDeployConfig` chat toggle.** `mergeMachineConfig` doesn't yet inject/remove the services block on Update — a chat-off-to-chat-on toggle via the inspector would update the DB column but not add the Fly `services` block. This is the known Phase 5+ follow-up documented in Phase 3's notes; the inspector's `ChatEnabledField` will be wired to an explicit warning / respawn prompt in Phase 6.
- **Did not widen `ListAgentInstancesByOrg`.** The list query omits `chat_enabled`; the gallery card and list row show the detail link regardless. Phase 6.
- **Did not implement the "wipe session" button (plan Q4).** The "start new conversation" affordance is post-Phase 5; clearing `sessionStorage` manually suffices for the demo.
- **Did not implement streaming.** v1 is unary; v1.6 adds streaming. The `<ChatPanel>` is authored with streaming-shaped state (per plan Q3 note) — the `sending` state renders an animated ellipsis bubble that's already streaming-ready visually; replacing the unary RPC with a streaming one in v1.6 is a transport swap, not a UI rewrite.
- **Did not push a Fly deploy.** Phase 7 owns the image push + migration + end-to-end smoke.

---

## Validation gates met

- `cd backend && go vet ./...` clean.
- `cd backend && go build ./...` clean.
- `cd backend && go test ./...` — every package green (agents, deploy, httpsrv, users). Six new test cases in `httpsrv`.
- `pnpm proto:generate` clean (no buf errors, generated Go + TS committed).
- `pnpm -C frontend type-check` clean.
- `pnpm -C frontend lint` clean.

---

## Validation gates owed (operator)

Phase 5's hard exit gate per plan §4:

```
Manual: spawn agent via wizard with "Enable chat" checked (default)
→ land on fleet view → click agent name → agent detail page loads
→ chat panel renders ("[ CHAT // HERMES ]" terminal container)
→ type a message, hit Enter → response appears

Negative paths:
- Spawn with chat disabled → detail page shows disabled affordance,
  not the chat panel
- Chat with a stopped agent → expect "agent chat unreachable" error
  message in the chat panel
```

Phase 5's live test is blocked until Phase 7 pushes the sidecar-capable adapter image. The chat panel will render correctly (form renders, send fires the RPC), but the RPC will return `ErrChatUnreachable` until the Phase 2 adapter image (`CORELLIA_CHAT_ENABLED=true` + uvicorn sidecar) is the live image.

---

## Next phase entry checkpoint

Phase 6 is **`Health()` switches to HTTP probe for chat-enabled instances** (Go-only; no FE, no proto). The pieces Phase 5 leaves Phase 6:

- `AgentInstance.chat_enabled` is on the wire (field 24); the detail page already reads it.
- `ListAgentInstancesByOrg` still omits `chat_enabled` — Phase 6 widens it for the fleet gallery `chat_enabled` badge and the `Health()` path.
- The `ChatEnabledField` in the inspector currently has no "requires respawn" gate — Phase 6 adds that warning.
- Phase 7 (adapter image + migration) can happen in parallel with Phase 6.
