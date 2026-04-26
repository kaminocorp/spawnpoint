# Phase 3 Completion — Spawn Flow: Proto extension verification

**Plan:** `docs/executing/spawn-flow.md` §Phase 3
**Roadmap:** `docs/plans/post-0.2.6-roadmap.md` §M4
**Date:** 2026-04-26
**Status:** complete; checkpoint green (proto/Go/TS regenerate to byte-identical committed output, FE type-check clean, BE vet+build+test clean — no regressions across `agents` 18 sub-tests, `deploy` 26 sub-tests, `users` 3 sub-tests)

This phase is the **receipt for Phase 2's absorption-forward proto edit**, not a fresh code phase. Plan §Phase 3 was originally "Proto + sqlc-to-proto mapping"; the work shipped in Phase 2 because the Phase 2 service signatures (returning `*corelliav1.AgentInstance`) couldn't compile without the new proto types existing. Phase 3's role is the durable confirmation: the committed generated artefacts match the proto source, the wire surface is reachable from both halves of the stack, and the validation matrix from Phase 2 still holds. **No new hand-written code lands this phase** — every artefact already existed; what's new is the explicit no-drift attestation that closes the M4 contract-boundary work.

---

## Index

- **Zero new hand-written code.** `shared/proto/corellia/v1/agents.proto` (128 LOC) was edited in Phase 2; this phase neither edits it nor any of its consumers. `git status` against `shared/proto/`, `backend/internal/gen/`, and `frontend/src/gen/` is clean post-`pnpm proto:generate`.
- **One verification command, three checkpoints.** `pnpm proto:generate && git diff --exit-code -- backend/internal/gen frontend/src/gen` exits 0 — the CI invariant from `stack.md` §3 ("CI runs generation and diffs against HEAD") is satisfied today. Re-running the codegen produces byte-identical files because the proto edit + commit happened in lockstep in Phase 2.
- **Proto contract surface confirmed reachable from three locations.** The Go pb file (`agents.pb.go`, 1137 LOC) declares `AgentInstance`, `ModelProvider`, and the six `*Request` / `*Response` message types (8 generated structs total). The Connect-go handler interface (`agents.connect.go`, 293 LOC) widens with six methods on `AgentsServiceHandler` plus six matching `*Procedure` constants and six client constructors. The TS bundle (`agents_pb.ts`, 525 LOC) carries 98 references to M4 surfaces — counted via `grep -cE 'AgentInstance|ModelProvider|Spawn{,N}AgentRequest|...'`.
- **`// SECRET — never log this field` comment-as-contract preserved.** Two placements in `agents.proto`: line 80 on `SpawnAgentRequest.model_api_key`, line 96 on `SpawnNAgentsRequest.model_api_key`. Decision 7 is encoded in the IDL where every consumer (Go server, TS client, future code reviewer) sees it. **No buf-lint rule shipped** — the rationale and deferral are below.
- **Validation matrix.** `cd backend && go vet ./... && go build ./... && go test -count=1 ./...` all clean, all baselines preserved (`agents` 0.604s / 18 cases, `deploy` 0.873s / 26 cases, `users` 0.337s / 3 cases). `cd frontend && pnpm type-check` clean. Generated drift check exits 0.
- **One Phase-7-flagged optional shipped as deferred.** A buf-lint rule enforcing the `// SECRET` comment convention (Phase 2's "Optional" note) is deliberately not added — see "Decisions made this phase" §1 for the cost/benefit rationale.

---

## What this phase actually shipped

### The verification command

```bash
pnpm proto:generate && git diff --exit-code -- backend/internal/gen frontend/src/gen
```

This single command pin is the load-bearing artefact of Phase 3. It encodes three properties simultaneously:

1. **The committed generated code is reproducible.** A fresh contributor cloning the repo + running codegen gets the same bytes that are in HEAD. No "it worked on my machine" drift between the proto IDL and the consumed types.
2. **The proto IDL is the single source of truth.** Per `stack.md` §3 ("Both generated trees are committed and CI fails on drift"), any hand-edit to `gen/` would surface here. Phase 3 confirms the rule holds for the M4 surfaces just shipped.
3. **The codegen toolchain is healthy at this commit.** `buf generate` runs to completion against the in-tree `buf.yaml` + `buf.gen.yaml`; no plugin-version drift, no unresolved imports.

The exit code (0) is the receipt. Phase 4 onward can rely on the proto/generated boundary being honest.

### The three reachability spot-checks

**Backend Go pb.** `backend/internal/gen/corellia/v1/agents.pb.go` declares (counted via grep):

- `type AgentInstance struct` (1 — the wire shape with 12 fields per Phase 2's proto edit)
- `type ModelProvider int32` (1 — closed enum, UNSPECIFIED=0, ANTHROPIC=1, OPENAI=2, OPENROUTER=3)
- `type SpawnAgentRequest struct`, `type SpawnNAgentsRequest struct`, `type ListAgentInstancesRequest struct`, `type GetAgentInstanceRequest struct`, `type StopAgentInstanceRequest struct`, `type DestroyAgentInstanceRequest struct` (6)

Total: 8 generated structs that didn't exist pre-M4. Phase 2's `agents.Service` already imports them via the return-type signatures (`Spawn(...) (*corelliav1.AgentInstance, error)`); the build is green because the pb file shipped in lockstep.

**Backend Connect handler interface.** `backend/internal/gen/corellia/v1/corelliav1connect/agents.connect.go` declares:

- Six new `*Procedure` constants — `AgentsServiceSpawnAgentProcedure`, `...SpawnNAgentsProcedure`, `...ListAgentInstancesProcedure`, `...GetAgentInstanceProcedure`, `...StopAgentInstanceProcedure`, `...DestroyAgentInstanceProcedure`. Pattern: `/corellia.v1.AgentsService/<MethodName>`.
- Six new methods on the `AgentsServiceHandler` interface. **This is the compile-break that forced Phase 2's six `CodeUnimplemented` stubs** in `agents_handler.go` — the interface widened, `*AgentsHandler` had to satisfy it, and the stub shape (`return nil, connect.NewError(connect.CodeUnimplemented, ...)`) was the minimum-viable satisfaction until Phase 4 fills them with real logic.
- Six new client constructors (`spawnAgent`, `spawnNAgents`, ...) wired through `connect.NewClient[Req, Resp](baseURL+...Procedure, connect.WithSchema(...))`. The `WithSchema` calls reach into `agentsServiceMethods.ByName("SpawnAgent")` — a runtime introspection layer Connect uses for schema-aware features (planned validation hooks, future reflection-driven middleware).

**Frontend TS bundle.** `frontend/src/gen/corellia/v1/agents_pb.ts` carries 98 mentions of M4 identifiers — message classes, type aliases, schema descriptors, and the `ModelProvider` enum. Phase 5's deploy modal will import from this file; Phase 3 confirms the import path resolves and the types are present.

### The `// SECRET — never log this field` comment placements

Two preserved across the proto:

```proto
// at SpawnAgentRequest, line 80
// SECRET — never log this field. Forwarded once to the deploy
// target's secret store and never persisted to our DB.
string model_api_key = 5;

// at SpawnNAgentsRequest, line 96
// SECRET — same handling as SpawnAgentRequest. Reused across all N
// spawned instances per decision 15.
string model_api_key = 6;
```

The comment is encoded in the IDL where every downstream artefact picks it up: the Go pb has it as a struct field doc-comment, the TS bundle as a JSDoc above the field, and any future buf-reflection-aware tooling can introspect it. **The comment is the contract for v1**; Phase 4's handler implementation must respect it (no `slog.Info("spawn complete", "api_key", req.ApiKey)`-shaped lines), and the Phase 6 frontend's React DevTools session must not show the field in serializable component state beyond the in-flight form.

---

## Decisions made this phase

### 1. No buf-lint rule for the `// SECRET` comment convention (Phase 2 "Optional" deferred)

Phase 2's known-pending-work flagged "Optional: add a buf-lint rule to enforce the `// SECRET — never log` comment convention." Phase 3 deliberately does not ship it.

**Cost analysis**: A buf-lint rule for "fields named `*_api_key` or `*_secret_*` must have a comment matching `// SECRET`" would require either (a) writing a custom buf plugin in Go (~100 LOC + plugin registration in `buf.gen.yaml` + a new CI step) or (b) using `buf format`'s comment-preservation guarantees and a separate `grep`-based CI assertion. Both are reproducible CI infrastructure costs.

**Benefit analysis**: The rule catches one class of bug — a future field that *should* carry the comment and doesn't. The actual security harm (logging a secret) is one layer downstream and would have to bypass the comment-as-contract code-review hook. The two existing fields are already correctly annotated.

**Decision**: defer to a v1.5 polish pass when other governance-tier IDL conventions (e.g. PII tagging for the eventual audit log) accumulate enough mass to justify shared lint infrastructure. **Today's enforcement remains code-review.** The convention exists; the policy infrastructure does not. Aligns with the broader v1 stance that "schema/lint enforcement ships when there are ≥3 instances of the rule" — a pattern from M2's similar deferral on `enum` value validation.

### 2. No regeneration of unrelated proto files

`pnpm proto:generate` regenerates *all* proto files in `shared/proto/`, not just `agents.proto`. Phase 3 confirmed the drift check passes for the broader generated trees — `users.pb.go`, `organizations.pb.go`, etc. all stayed byte-identical. **No incidental regeneration noise.** This holds because previous milestones (M1, M2, M3, M3.5) each ran `pnpm proto:generate` and committed at clean drift, so the no-drift invariant is preserved transitively.

### 3. The "what shipped this phase" framing

Phase 1 and Phase 2 had heavy "what shipped" sections describing real new code. Phase 3 inverts: the section describes **what was already shipped that this phase verified**. The verification is the deliverable. Treating Phase 3 as an empty phase to skip would mean future contributors looking at `docs/completions/spawn-flow-phase-{1,2,4,...}.md` see a gap and wonder where the proto work happened — the phase-3 doc closes that loop by pointing to Phase 2's drift section §5 and being the durable receipt for the verification matrix.

This is the same shape M3.5's Phase 5 (its own `phase-5.md` if one existed) would have taken if M3.5 had separated "ship the resolver" from "validate the boot sequence" — in M3.5's case, validation rolled into Phase 4 and there was no Phase 5. M4 keeps Phase 3 as a discrete artefact because Phase 2 explicitly named it as a known-pending follow-up.

---

## Decision drift from the plan

**One intentional drift**, the absorption-forward itself, already documented in Phase 2's drift section §5. This phase formalizes the consequence:

- **Plan said Phase 3 = "Proto + sqlc-to-proto mapping" with three concrete tasks** (extend `agents.proto`, run `pnpm proto:generate`, verify generated files exist).
- **Phase 3 actually shipped: verification only.** The first two tasks landed in Phase 2 because the Phase 2 service signatures depended on the proto types existing at compile time. The third task (verify) is what Phase 3 does today.

**No new drift introduced.** The proto file's shape, the message field numbers, the enum values, the RPC method names — all match the plan §decisions 12–14 verbatim. The sqlc query files (Phase 1) and the service-layer mappers (Phase 2) bridge them; nothing in Phase 3 reopens those decisions.

---

## Validation matrix

```
pnpm proto:generate
→ buf generate completes; no errors
→ regenerates backend/internal/gen/corellia/v1/* and frontend/src/gen/corellia/v1/*

git diff --exit-code -- backend/internal/gen frontend/src/gen
→ exit 0 (no diff)

cd backend && go vet ./... && go build ./... && go test -count=1 ./...
→ vet OK
→ build OK (cmd/api + cmd/smoke-deploy + all internal/* packages)
→ tests:
    internal/agents     0.604s  (18 sub-tests, Phase 2 baseline preserved)
    internal/deploy     0.873s  (26 sub-tests, M3+M3.5 baseline preserved)
    internal/users      0.337s  (3 sub-tests, 0.2.5 baseline preserved)

cd frontend && pnpm type-check
→ tsc --noEmit clean

grep -cE 'rpc Spawn|rpc List|rpc Get|rpc Stop|rpc Destroy' shared/proto/corellia/v1/agents.proto
→ 6 (six M4 RPCs declared)

grep -cE 'type AgentInstance struct|type ModelProvider int32|type \w+Request struct' \
  backend/internal/gen/corellia/v1/agents.pb.go
→ 8+ (1 AgentInstance + 1 ModelProvider + 6 Request structs at minimum)

grep -nE 'SECRET' shared/proto/corellia/v1/agents.proto
→ 80:  // SECRET — never log this field. Forwarded once to the deploy
→ 96:  // SECRET — same handling as SpawnAgentRequest. Reused across all N
```

All Phase 3 checkpoint conditions satisfied:

- ✅ TS proto types reachable from FE (`agents_pb.ts` regenerates byte-identical; FE type-check clean).
- ✅ Go pb types reachable from BE (`agents.pb.go` regenerates byte-identical; BE build + tests clean).
- ✅ Connect handler interface widened correctly (6 new methods on `AgentsServiceHandler`; Phase 2's stubs satisfy the interface; build green).
- ✅ `// SECRET` comments preserved through codegen at both placement sites.
- ✅ No drift between proto source and committed generated trees.

---

## Known pending work

**Phase 4** (handler + complete cmd/api wiring, the next substantive code phase):

- Replace the six `CodeUnimplemented` handler stubs in `backend/internal/httpsrv/agents_handler.go` with real implementations. Per plan decision 27 + Phase 2's Known Pending Work section: extract `auth.AuthClaims` → call `usersSvc.GetByAuthUserID` for `org_id` + `owner_user_id` → construct `SpawnInput` → call `agentsSvc.Spawn` → marshal proto response. Each method ≤30 LOC per `stack.md` §11.9.
- Extend `agentsErrToConnect` switch in the same file with all M4 sentinels per decision 25:
  - `ErrInvalidName` / `ErrInvalidProvider` / `ErrMissingAPIKey` / `ErrSpawnLimit` → `CodeInvalidArgument`
  - `ErrTemplateNotFound` / `ErrInstanceNotFound` → `CodeNotFound`
  - `ErrFlyAPI` / `ErrTargetUnavailable` → `CodeUnavailable` (with redacted message; raw error stays in `slog.Error`)
- The boot-time stale-pending sweep is already wired in `cmd/api/main.go` from Phase 2; no additional Phase 4 work there.

**Phase 5–7** (frontend deploy modal + fleet page + integration smoke) — all unchanged from plan §Phase 5–7. Phase 3 unblocks Phase 5 by confirming the TS types are reachable from the FE bundle; Phase 5's deploy modal will import `SpawnAgentRequest`, `SpawnNAgentsRequest`, and the `ModelProvider` enum from `frontend/src/gen/corellia/v1/agents_pb.ts`.

**Phase 8 hardening** (already flagged in Phase 2):

- **Transactional spawn writes** (decision 27 step 6 deferred). Pattern: `Transactor` abstraction around `pgxpool.Pool.BeginTx`, `WithTx(tx)` lifter on `agentQueries`.
- **`logsURL` lifted to `DeployTarget` interface** (Phase 2 deviation #4). v1.5 candidate.
- **Polling integration test** for `pollHealth`. Requires goroutine-aware test infrastructure.
- **Cross-org isolation test** (`TestList_OtherOrgInvisible`). Requires testcontainers-go or similar.

**buf-lint rule for `// SECRET`** — explicitly deferred this phase. v1.5 polish when shared IDL governance infrastructure has ≥3 use cases.

---

## Files touched

```
docs/completions/spawn-flow-phase-3.md     new (this file)
```

**Zero changes to source files.** Phase 3 is a pure verification + documentation phase by design — the source-of-truth artefacts (proto + generated trees) all shipped in Phase 2 and pass the no-drift contract today.

The completion doc is the load-bearing artefact: it converts Phase 2's "absorbed forward" claim into a Phase 3 receipt that future contributors can grep for when wondering where the M4 proto work happened. The drift check + reachability spot-checks + green validation matrix are the structural evidence that Phase 2's absorption was clean and Phase 4 can proceed against a stable contract surface.
