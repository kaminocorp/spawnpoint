# Completion — Spawn page redesign, Phase 5: Wizard fields wired to the existing RPC

**Plan:** `docs/executing/agents-ui-mods.md` §4 Phase 5
**Date:** 2026-04-26
**Scope:** FE-only. Replaces the Phase-4 `<StubBody>` placeholders with real form-controlled field surfaces; wires Step 5's `› DEPLOY AGENT` to the existing M4 `spawnAgent` RPC; transitions to a streaming-log surface on submission and redirects to `/fleet` on success. Deploy-modal's M4 wire path is now reachable from the spawn page again — this time as a multi-step flow instead of a single `<Dialog>`.
**Validation:** `pnpm -C frontend type-check && lint && build` all green.

---

## What Phase 5 delivers (per plan)

> The wizard actually deploys. Same `spawnAgent` RPC as today's modal; the UX is the wrapper. Single-spawn only (decision 11).

The wizard becomes a *functional* spawn flow end-to-end. Each step swaps its stub body for a real `<form>` (react-hook-form + zod, defaults preserved across edit-cascade). Step 5 reads the accumulated state, builds the request, fires `spawnAgent`. While the RPC is in flight a streaming-log surface replaces the wizard chrome and synthesizes 4 lines on a 600 ms tick (decision 14); on success the router pushes `/fleet`; on error the log surface flips to its `failed` accent and offers `› BACK TO REVIEW`.

---

## Files updated (1)

### `frontend/src/components/spawn/wizard.tsx` — bodies + submission + log surface

The Phase-4 file gains ~500 LOC. Three concerns layered on top of the existing shell:

#### 1. Per-step forms (Steps 2 / 3 / 4)

Each body now has two render branches: **`isCurrent`** renders a `<form>` with the step's fields; **`!isCurrent && isConfirmed`** renders a `<ConfirmedSummary>` — a compact `<dl>` of field-value rows so the operator can scan their accumulated config without un-confirming. The cascading-invalidation contract (decision 9) is unchanged: clicking `[ EDIT ]` un-confirms the step *and* every step downstream; the form's `defaultValues` re-seed from `state.fields`, so re-editing preserves what was typed.

The schemas are lifted *verbatim* from `deploy-modal.tsx` to avoid drift between the modal (still in tree as orphan code per Phase 6) and the wizard:

- **Step 2 IDENTITY (`identitySchema`).** `name: z.string().trim().min(1).max(80)`.
- **Step 3 MODEL (`modelSchema`).** `provider: z.enum([anthropic, openai, openrouter])` + `modelName: z.string().trim().min(1).max(200)` + `apiKey: z.string().min(1)`. Show/hide toggle on the API-key input via `EyeIcon` / `EyeOffIcon` from `lucide-react`. Inline copy preserved verbatim from the modal: *"Forwarded once to the agent's secret store. Never written to Corellia's database."*
- **Step 4 DEPLOYMENT (`deploymentSchema`).** New schema for this phase: `lifecycle: z.enum(["always-on", "manual"])` + `replicas: z.number().int().min(1).max(10)`. Both surface as real inputs (Select for `lifecycle`, numeric Input for `replicas`); the four M5-deferred knobs (`REGION` / `SIZE` / `VOLUME` / `RESTART`) stay below the inputs as read-only `[ COMING WITH FLEET CONTROL ]` rows, exactly as in Phase 4. **Neither `lifecycle` nor `replicas` is sent on the wire** — the M4 `SpawnAgentRequest` proto has no fields for them. They're tracked in wizard state so when M5's `DeployConfig` proto arrives, Phase 5's submission logic gains a one-line `request.deployConfig = { lifecycle, replicas }` addition. The `replicas` cap of 10 mirrors the v1 `count` cap in `manySchema` from `deploy-modal.tsx`; not an arbitrary number.

The provider→proto translation (`PROVIDERS` array with `{value, label, proto}` triples) is duplicated from `deploy-modal.tsx`. Extracting it to a shared helper is a Phase 6 cleanup if the modal still exists by then; today the duplication is the smaller cost than the abstraction.

#### 2. Step 5 review + deploy button

`<ReviewStep>` renders a 7-row `<dl>` summary table with everything the wizard has captured. The API key surfaces as `••••••••<last4>` (`maskApiKey()` — fixed 8-dot prefix regardless of true length, so the mask doesn't leak length information). On `› DEPLOY AGENT` click, the parent `<Wizard>`'s `onDeploy` fires:

```
setDeploy({ kind: "deploying", lines: ["› creating fly app…"] });
api.agents.spawnAgent({
  templateId, name, provider: proto, modelName, modelApiKey: apiKey,
});
router.push("/fleet");
```

Single-spawn only (decision 11). `spawnNAgents` stays on the wire but is unreached from this UI; if it's needed again it'll come back as a fleet-page bulk action per the plan §3 deferred-decisions list.

#### 3. Streaming-log surface

New `DeployState` discriminated union (separate from the reducer state):

```
type DeployState =
  | { kind: "idle" }
  | { kind: "deploying"; lines: string[] }
  | { kind: "error"; lines: string[]; message: string };
```

When `deploy.kind !== "idle"`, the `<Wizard>` early-returns to `<DeployLog>` and the entire wizard chrome disappears. The log component runs a `setInterval` that increments a tick counter every 600 ms (cache-warm-friendly cadence — total budget is ~2.4 s for the 4 synthetic lines, comfortably under the typical M4 `spawnAgent` round-trip). Lines come from the module constant `SYNTHETIC_LINES`:

```
"› creating fly app…"
"› setting secrets…"
"› launching machine…"
"› awaiting health-check…"
```

These are decorative — they do *not* reflect real BE lifecycle events (per plan §4 Phase 5: *"real per-step events from the BE arrive in M5+ via streaming RPCs"*). The RPC fires in parallel; whichever resolves first wins:

- **RPC succeeds first (typical happy path)**: `router.push("/fleet")` unmounts the log surface mid-stream, ~1–2 s into the synthetic sequence. The log was decorative; the redirect is the truth.
- **All 4 lines emit before RPC resolves**: the log shows the full sequence and just stays on the last line until the RPC resolves.
- **RPC errors**: `setDeploy({ kind: "error", ... })` appends a `› error: <message>` line; `<DeployLog>` flips to the `failed` accent (red) and renders `› BACK TO REVIEW`. Clicking it sets `deploy` back to `idle`, which re-mounts the wizard with all 5 steps still confirmed (the `useReducer` state was preserved). The operator can tap `[ EDIT ]` on any step to fix and resubmit without re-typing.

The `Exclude<DeployState, { kind: "idle" }>` type on `<DeployLog>`'s `deploy` prop is what lets TypeScript narrow `prev.lines` inside the component — the parent never renders `<DeployLog>` with `idle`, and the type encodes that contract directly. Avoids the `if (kind === "idle") return null` boilerplate inside the child.

#### 4. Reducer surface unchanged

The Phase-4 reducer (`confirm` / `edit` / `setField`) handles the wiring without modification. Each step's submit handler dispatches `setField` (with the form's validated `values`) followed immediately by `confirm`. Because `setField` is a merge-patch and `confirm` only mutates the `current` + `confirmed` slices, there's no race between the two dispatches.

The cascading invalidation continues to do the right thing: editing Step 2 after confirming Steps 3–5 un-confirms 3–5 *but* leaves their `fields.*` values populated. Re-confirming Step 2 puts the cursor back on Step 3, whose form is seeded by `state.fields.provider / modelName / apiKey` from before, so the operator only retypes if they want to. The API key is the only field the operator might *prefer* to retype on re-edit; today it's preserved across the cascade since plan §4 Phase 5 didn't call for clearing it. (The whole wizard is ephemeral per decision 8 — refresh wipes everything including the key — so the persistence here is one-render-tree-deep, not durable.)

---

## Files added (0)

No new files. Phase 5 is entirely additive within `wizard.tsx`. Splitting into per-step modules is deferred — `wizard.tsx` is now ~870 LOC, large but cohesively organized around the section-rule comments (`/* ─── STEP N // KEY ──── */`). Splitting would mean prop-drilling shared types (`StepBodyProps`, `WizardFields`, `DeployState`) across files; the cost outweighs the readability win at this size. If a future phase pushes it past 1200 LOC it splits naturally along the section rules.

---

## Files deleted (0)

`deploy-modal.tsx` is *still* in the tree as orphan code; Phase 6 owns the deletion. The schemas + provider-list duplication between the wizard and the modal will resolve when the modal goes.

---

## Why this exact set of changes, and not more

Plan §4 Phase 5's bullet list maps 1:1 to the diff:

- ✅ Step 2 uses the same Zod schema as `deploy-modal.tsx` (`name min(1) max(80)`).
- ✅ Step 3 uses the modal's schemas for `provider`, `modelName`, `apiKey`. API-key inline copy carries over verbatim.
- ✅ Step 4 has `lifecycle = "always-on" | "manual"` (default always-on) and `replicas = 1` (default), tracked in state but **not sent on the wire**.
- ✅ Step 5 builds the request from accumulated state and calls `api.agents.spawnAgent` (single-spawn only).
- ✅ Streaming-log surface per design-system §34.3 + decision 14: 4 synthesized lines, fixed-height terminal container, error line on RPC failure.
- ✅ On success: `router.push("/fleet")` (matches M4 modal behavior).

Things deliberately *not* done:

- **No new RPCs.** Decision 17 — pure FE.
- **No `deploy-modal.tsx` refactor or deletion.** Phase 6.
- **No proto change for `lifecycle` / `replicas`.** They're collected client-side and dropped at the request boundary; M5's `DeployConfig` proto is the right place for them, not this plan.
- **No localStorage / draft persistence.** Decision 20 — wizard stays ephemeral.
- **No streaming RPC.** Decision 14 — synthetic lines are the v1 affordance; real streaming is M5+.
- **No `[ EDIT ]` clearing of the API-key field on re-edit.** Plan didn't call for it; `setField`-merge preserves prior values across edit cascades. If the operator wants a fresh key they retype it in the field, which is the same UX as the M4 modal.
- **No CLAUDE.md / changelog edits.** Phase 6.
- **No `/agents` redirect-shim deletion.** Phase 6.

---

## Validation evidence

```
pnpm -C frontend type-check    # tsc --noEmit, exit 0
pnpm -C frontend lint           # eslint, exit 0
pnpm -C frontend build          # next build, exit 0
```

`next build` route table is unchanged from Phase 4 — `/spawn/[templateId]` still the only dynamic route, still server-renderable.

A manual smoke pass with `overmind start` is owed and can now exercise the *functional* path:

1. From `/spawn`, click `› SELECT` on Hermes → wizard route loads, Step 1 active with the green-dominant nebula at 180px.
2. Confirm Step 1 → Step 2 active, name input focused.
3. Type a name → submit → Step 3 active.
4. Pick provider, type model, paste API key (toggle show/hide) → submit → Step 4 active.
5. Pick lifecycle, set replicas → submit → Step 5 active.
6. Review the summary; API key shows `••••••••<last4>`.
7. Click `› DEPLOY AGENT` → wizard chrome disappears, `[ DEPLOY LOG ]` panel shows synthetic lines streaming in at 600 ms each.
8. RPC succeeds → land on `/fleet` with the new agent in `pending` → `running`.
9. Repeat with a deliberately malformed key → log flips to `failed` accent, error line appended, `› BACK TO REVIEW` returns to the wizard with all 5 steps still confirmed and editable.
10. From any confirmed step, click `[ EDIT ]` on Step 2 → Steps 3–5 un-confirm, Step 2 form re-seeds with prior name.

DevTools confirms exactly **one** `<canvas>` element in the wizard DOM throughout (decision 21).

---

## Phase 5 exit criteria — status

Per plan §4 Phase 5:

- ✅ `type-check + lint + build` green.
- 🔄 An end-to-end wizard run spawns Hermes successfully — manual gate, deferred to next `overmind start` boot.
- 🔄 An error in any step surfaces inline (per-field validation) or as a streaming-log error line on the deploy step — manual gate.

Both runtime gates are exercised by the same smoke pass above. The build pipeline can verify shape correctness; behavior is the manual round-trip the v1 testing posture leans on (no Playwright; deployed RPC round-trip as the integration smoke test).

---

## Known regression window: closed

Phase 3 broke the spawn flow ("clicking SELECT lands on a 404"). Phase 4 closed the route (wizard skeleton renders). Phase 5 closes the *flow* — clicking through the five steps and pressing `› DEPLOY AGENT` actually deploys an agent. The M4 deploy-modal path is now superseded as the spawn entry point; the modal remains in the tree as unreferenced code awaiting Phase-6 deletion.

---

## Known pending work (Phase-5 scope)

- **Manual UI smoke pass** owed per the 10-check list above. Type/lint/build catch shape errors, not feature behavior.
- **`lifecycle` + `replicas` are collected client-side but dropped at the request boundary.** M5's `DeployConfig` proto fills the gap; this plan reserved the slot deliberately (decision 10).
- **Provider-list + zod schemas duplicated** between `deploy-modal.tsx` and `wizard.tsx`. Resolves when Phase 6 deletes the modal.
- **`deploy-modal.tsx`** still orphan code. Phase 6.
- **`/agents` redirect shim** still in place. Phase 6.
- **No automated test for the wizard.** Consistent with v1's testing posture.
- **Synthetic log lines are decorative** (decision 14). Real per-step BE events are M5+.
- **Provider→proto map is the only non-extracted shared helper.** Three lines; not worth a `lib/spawn/providers.ts` until a third caller exists.

---

## Supersedes

- **Phase 4's `<StubBody>` placeholders for Steps 2 / 3 / 4 / 5** — replaced with real forms + a review summary. Step 1's `<HarnessStep>` is unchanged from Phase 4.
- **Phase 4's no-op `› DEPLOY AGENT` button** — now fires `spawnAgent` and transitions to the streaming-log surface.
- **The M4 deploy-modal flow as the only spawn entry** — superseded by the wizard. Modal stays in the tree as orphan code until Phase 6.
- **The Phase-3 *Known regression window*** — was already navigation-closed in Phase 4; now functionally closed.
