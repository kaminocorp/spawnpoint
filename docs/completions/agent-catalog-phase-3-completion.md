# Phase 3 Completion — Agent Catalog: Proto + buf regen

**Plan:** `docs/executing/agent-catalog.md` §Phase 3
**Roadmap:** `docs/plans/post-0.2.6-roadmap.md` §M2
**Date:** 2026-04-25
**Status:** complete; both regen targets clean (`go build` + `pnpm type-check`)

This phase landed the wire contract for the agent catalog. One small `.proto` source file, three generated artefacts (Go server stubs, Go client stubs, TS message types + service descriptor), zero existing files modified. The codebase now has both halves of the FE↔BE contract for `ListAgentTemplates` in place — Phase 4 wires up the Go server side, Phase 5 wires up the FE caller.

---

## Index

- **One new proto source.** `shared/proto/corellia/v1/agents.proto` — 18 lines (one service, one RPC, three messages). Verbatim from `docs/executing/agent-catalog.md` §Phase 3 task 1, including the `option go_package = "...corellia/v1;corelliav1"` shape that matches the existing `users.proto` and `organizations.proto`.
- **Three new generated files, all committed per stack.md §3.** `backend/internal/gen/corellia/v1/agents.pb.go` (7.5 KB; protobuf message types), `backend/internal/gen/corellia/v1/corelliav1connect/agents.connect.go` (5.2 KB; Connect-go server + client interfaces and the `NewAgentsServiceHandler` factory), `frontend/src/gen/corellia/v1/agents_pb.ts` (3.1 KB; Connect-ES v2 types + `AgentsService` descriptor).
- **Zero modifications to existing files.** No `users.proto` edits, no `organizations.proto` edits, no churn in the existing `*.pb.go` / `*.connect.go` / `*_pb.ts` files. This is the strongest possible additivity result for a contract-layer regen — `git diff --stat` against existing files shows nothing.
- **`buf lint` clean** — pre-flight check ran before regen. The `option go_package` shape that places the Go identifier (`corelliav1`) after a semicolon is the buf-canonical form; using it consistently across `users.proto`, `organizations.proto`, and now `agents.proto` keeps the import alias compact (`corelliav1`) while letting `paths=source_relative` produce the path-matched output structure.
- **`go build ./...` clean.** The new `agents.pb.go` and `agents.connect.go` compile in isolation against the existing imports — no caller exists yet, so this phase's check is "do the stubs compile?" not "does anything use them?". Phase 4 mounts the handler.
- **`pnpm -C frontend type-check` clean.** The new `agents_pb.ts` type-checks against the Connect-ES v2 runtime already present in `package.json` (`@bufbuild/protobuf` + `@connectrpc/connect-web`). No FE caller yet — Phase 5 plumbs `api.agents.listAgentTemplates(...)`.
- **Wire path locked.** `/corellia.v1.AgentsService/ListAgentTemplates`. Phase 6's `curl` smoke test will hit this exact path.

---

## What was written, where, why

### File: `shared/proto/corellia/v1/agents.proto`

```proto
syntax = "proto3";
package corellia.v1;

option go_package = "github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1;corelliav1";

service AgentsService {
  rpc ListAgentTemplates(ListAgentTemplatesRequest) returns (ListAgentTemplatesResponse);
}

message ListAgentTemplatesRequest {}
message ListAgentTemplatesResponse {
  repeated AgentTemplate templates = 1;
}

message AgentTemplate {
  string id = 1;
  string name = 2;
  string description = 3;
}
```

Eighteen lines. Mirrors decisions 11–12 of the plan exactly:

- **Decision 12** (proto location): `shared/proto/corellia/v1/agents.proto`. Convention from `stack.md` §3 — one service per file, package namespace `corellia.v1` is permanent; v2 migrations create `corellia/v2/agents.proto`, never silent edits to v1.
- **Decision 11** (response field set): `AgentTemplate { id, name, description }`. Three fields, no `default_config`, no `harness_name`, no adapter join. The deploy modal in M4 either widens this message (additive change — safe) or adds a `GetAgentTemplate(id) -> AgentTemplateDetail` RPC. Pre-projecting M4 fields here would have been unused payload on every catalog response.
- **Empty request message** (`ListAgentTemplatesRequest {}`). Connect-ES requires a request object even for no-field requests; the empty-message pattern is the canonical idiom. Keeping it nominally distinct (rather than `google.protobuf.Empty`) leaves room to add filter/pagination fields without a proto-breaking change later.

The `option go_package` line deserves a paragraph because it's load-bearing for buf's behavior:

```
github.com/hejijunhao/corellia/backend/internal/gen/corellia/v1;corelliav1
```

The semicolon splits the directive into two halves: **before semicolon** is the import path Go should use (`...gen/corellia/v1`); **after semicolon** is the identifier the package emits (`corelliav1`). Combined with `paths=source_relative` in `buf.gen.yaml`, this produces `backend/internal/gen/corellia/v1/agents.pb.go` (path matches the proto's directory) but with `package corelliav1` (compact identifier, no underscore). All three proto files share this shape, so `import corelliav1 "..."` works uniformly across `users.pb.go`, `organizations.pb.go`, `agents.pb.go`. This isn't documented in the plan because it was already the convention — but it's worth recording here as the why-don't-the-paths-and-identifiers-match question that bites every new contributor.

### Generated: `backend/internal/gen/corellia/v1/agents.pb.go` (7.5 KB)

Protobuf message types — `ListAgentTemplatesRequest`, `ListAgentTemplatesResponse`, `AgentTemplate` — with `protoreflect` machinery, `String()` methods, `Reset()` methods, and the `File_corellia_v1_agents_proto` file descriptor. Standard `protoc-gen-go` output; nothing remarkable. Imports only `protoreflect`, `protoimpl`, `reflect`, `sync` — no transitive dependency surge.

### Generated: `backend/internal/gen/corellia/v1/corelliav1connect/agents.connect.go` (5.2 KB)

Connect-go server-and-client glue. Three identifiers worth knowing:

1. **`AgentsServiceListAgentTemplatesProcedure = "/corellia.v1.AgentsService/ListAgentTemplates"`** — the wire path. `pkg.Service/Method` is the gRPC convention; Connect uses the same shape over HTTP/1.1. This is what curl, Postman, and any inspection of network traffic will show.

2. **`AgentsServiceHandler`** interface (one method):
   ```go
   type AgentsServiceHandler interface {
       ListAgentTemplates(
           context.Context,
           *connect.Request[v1.ListAgentTemplatesRequest],
       ) (*connect.Response[v1.ListAgentTemplatesResponse], error)
   }
   ```
   Phase 4's `httpsrv.AgentsHandler` will satisfy this interface structurally — same shape as `users_handler.go`'s `UsersHandler` satisfies `UsersServiceHandler`, and `organizations_handler.go` satisfies `OrganizationsServiceHandler`.

3. **`NewAgentsServiceHandler(svc, opts...) (string, http.Handler)`** — the factory. Returns the mount path *plus* the handler; the path is the package prefix `/corellia.v1.AgentsService/`, and Chi mounts it via `r.Mount(path, handler)` — this is exactly what `server.go:36-40` already does for users and organizations. Phase 4's `server.go` edit is one such mount line.

The file also generates an `AgentsServiceClient` interface (for Go-side callers — used in the future if backend code calls itself, which v1 doesn't). Existence is harmless; bytes are tiny.

### Generated: `frontend/src/gen/corellia/v1/agents_pb.ts` (3.1 KB)

Connect-ES v2 output. Notable shape:

```ts
export type AgentTemplate = Message<"corellia.v1.AgentTemplate"> & {
  id: string;
  name: string;
  description: string;
};

export const AgentTemplateSchema: GenMessage<AgentTemplate> = /*@__PURE__*/ ...;

export const AgentsService: GenService<{
  listAgentTemplates: {
    input: typeof ListAgentTemplatesRequestSchema;
    output: typeof ListAgentTemplatesResponseSchema;
  };
  // ...
}>;
```

Connect-ES v2 emits **schema descriptors** (`*Schema`) that the Connect transport uses at runtime, alongside **TypeScript types** that exist only at compile time. The `AgentsService` const is the descriptor object Phase 5 imports:

```ts
import { AgentsService } from "@/gen/corellia/v1/agents_pb";
import { createClient } from "@connectrpc/connect";
// ...
const agents = createClient(AgentsService, transport);
agents.listAgentTemplates({});  // returns Promise<ListAgentTemplatesResponse>
```

This shape is identical to how `frontend/src/lib/api/client.ts` already wires `users` and `organizations`. Phase 5's edit is one new line in that file plus the import.

The **method-name camelCase transform** is automatic (`ListAgentTemplates` in proto → `listAgentTemplates` in TS) — Connect-ES v2 follows the standard "TS uses camelCase, proto uses PascalCase" convention. Worth knowing because it's the only place in the codebase where a proto identifier doesn't appear verbatim in the consuming code.

### File: `buf.gen.yaml` — unchanged

`shared/proto/buf.gen.yaml` already has all three plugins wired (Go protobuf + Go Connect + local TS protoc-gen-es), so adding a fourth proto file is zero-config: `buf generate` enumerates `*.proto` files in the directory and runs the configured plugins against each. No edit needed.

---

## Validation — Phase 3 acceptance gates

### `buf lint shared/proto` — clean (pre-flight)

```
$ cd shared/proto && buf lint
$ echo $?
0
```

Buf's default lint rules check service naming, message naming, package paths, and several anti-pattern flags. Clean exit means the proto file matches existing project conventions — no `_v1`-suffixed service, no PascalCase fields, no missing `option go_package`. The full ruleset is `STANDARD`; `buf.yaml` doesn't override it, so we get the default checks for free.

### `pnpm proto:generate` — clean

```
$ pnpm proto:generate
> corellia@ proto:generate
> cd shared/proto && buf generate
$ echo $?
0
```

No output (which is buf's success shape — silent on success, verbose on failure). The script wraps `cd shared/proto && buf generate` and is wired in `package.json` from 0.1.0.

### `go build ./...` — clean

```
$ cd backend && go build ./...
$ echo $?
0
```

The new `agents.pb.go` compiles against `protoreflect` + `protoimpl` already in `go.mod` (transitive of the `users.pb.go` / `organizations.pb.go` files). The new `agents.connect.go` compiles against `connectrpc.com/connect` — same import. Zero new module dependencies. The fact that the backend builds clean *without* the agents handler existing yet is the canary that Phase 3 produced valid stubs.

### `pnpm -C frontend type-check` — clean

```
$ pnpm -C frontend type-check
> frontend@0.1.0 type-check
> tsc --noEmit
$ echo $?
0
```

The new `agents_pb.ts` type-checks against `@bufbuild/protobuf` (already in `package.json` from 0.2.0). No FE consumer references the file yet — Phase 5's `client.ts` edit is the first.

### `git status` — final state

```
?? shared/proto/corellia/v1/agents.proto
?? backend/internal/gen/corellia/v1/agents.pb.go
?? backend/internal/gen/corellia/v1/corelliav1connect/agents.connect.go
?? frontend/src/gen/corellia/v1/agents_pb.ts
```

Four new files. Zero modifications to anything that existed before this phase. The plan's "purely additive" promise honored at the strongest possible level — no files in the `git diff --stat` summary, only files in the `git status --porcelain ?? ...` listing.

---

## Behavior change (known)

- **Three new types in `internal/gen/corellia/v1`.** `corelliav1.ListAgentTemplatesRequest`, `corelliav1.ListAgentTemplatesResponse`, `corelliav1.AgentTemplate`. Nothing imports them yet — Phase 4's domain service writes the first reference (`return out, nil` where `out` is `[]*corelliav1.AgentTemplate`).
- **One new Connect-go service registration available.** `corelliav1connect.NewAgentsServiceHandler(svc, opts...)`. Phase 4 calls this exactly once in `httpsrv/server.go` to mount the new RPC inside the existing auth middleware group.
- **One new TS service descriptor available.** `AgentsService` (from `@/gen/corellia/v1/agents_pb`). Phase 5 imports it once into `frontend/src/lib/api/client.ts` and wires `agents: createClient(AgentsService, transport)` alongside the existing `users` and `organizations` clients.
- **No runtime behavior change.** The application boots, listens, serves the same RPCs identically. The new wire path `/corellia.v1.AgentsService/ListAgentTemplates` is *not* registered yet — calling it today returns 404 from Chi (the default for unmatched routes). Phase 4's `server.go` edit registers it.

---

## Observations worth keeping

### `buf.gen.yaml` is plugin-driven, file-naive

The buf config enumerates plugins, not proto files. Every `*.proto` file under `shared/proto/corellia/v1/` is fed to all three plugins automatically. This is why Phase 3 had no buf-config edits — adding a new service is zero config, by design. It also means: deleting a proto file (or renaming a service) should be done via `buf breaking` first to catch consumers, since the silent-discovery model means you can ship a proto deletion that compiles locally but breaks any consumer outside the repo. Not a concern for v1 (we have one repo and one consumer), but worth knowing for v2's split.

### The `option go_package`'s semicolon trick

Buf-canonical form, used uniformly across the three proto files. Worth surfacing for any future contributor wondering "why does the import path say `corellia/v1` but the package identifier say `corelliav1`?" — answer: the semicolon split in `option go_package`. Documented here once so the next person doesn't have to reverse-engineer it from `protoc` docs.

### Connect-ES v2 emits descriptors *and* types, not just types

Older Connect-ES (v1 / `@connectrpc/protoc-gen-connect-es`) emitted a separate `_connect.ts` file per service. v2 (`@bufbuild/protoc-gen-es` with `target=ts`) collapses everything into the single `_pb.ts` file by emitting `GenService<...>` descriptors alongside the message types. `frontend/src/lib/api/client.ts` already uses this shape — see `import { UsersService } from "@/gen/corellia/v1/users_pb"` (not `users_connect`). The convention is set; Phase 5 just extends it.

---

## Known pending work

- **No backend handler yet.** Phase 4's job. The Connect handler interface (`AgentsServiceHandler`) exists, but no implementation does — the server can't route the new path, and curl will get a 404.
- **No FE caller yet.** Phase 5's job. The TS descriptor exists; `api.agents.listAgentTemplates(...)` doesn't.
- **No `buf breaking` check in CI.** Once we have any external consumer, `buf breaking --against '.git#branch=main'` should land in the PR check matrix to catch field-removal / field-renumber regressions. Out of scope for v1 (single-repo, two-half consumer).
- **No proto-level documentation comments.** `users.proto`, `organizations.proto`, `agents.proto` all declare types without GoDoc-style comments. The generated Go and TS would inherit such comments verbatim — useful for IDE hover. Nice-to-have for v1.5+ when public API discovery starts mattering.
- **The empty `ListAgentTemplatesRequest {}` is a future extension point.** When pagination/filtering becomes useful, fields are added here additively. The proto-evolution rules cover this cleanly: new fields default to zero values, old clients ignore unknown fields, no breaking change. Listed for visibility, not as a TODO.

---

## What's next — Phase 4 hand-off

Phase 4 (backend domain + handler) is the first phase where this contract becomes live behavior:

- **Pre-conditions:** ✅ Tables (Phase 1), ✅ typed Go queries (Phase 2), ✅ Connect-go server stubs (Phase 3). Three of the four foundations for the catalog RPC are in place.
- **Phase 4 work:**
  1. New package `backend/internal/adapters/` — single getter, single sentinel, one file. M3 will extend.
  2. New package `backend/internal/agents/` — `Service.ListAgentTemplates(ctx) ([]*corelliav1.AgentTemplate, error)`, returns a non-nil empty slice on zero rows (decision 28's contract).
  3. New file `backend/internal/httpsrv/agents_handler.go` — implements `corelliav1connect.AgentsServiceHandler`, sentinel-mapping switch with redacted-`Internal` default arm.
  4. Edit `backend/internal/httpsrv/server.go` — `Deps` gains `AgentsHandler`; mount line inside the existing `r.Group(...)` block.
  5. Edit `backend/cmd/api/main.go` — instantiate `agents.NewService(queries)` and pass to `httpsrv.Deps`.
- **Phase 4 acceptance:** `go vet ./...`, `go build ./...`, `go test ./...` all clean. End-to-end RPC reachable via curl with a Bearer token (manual verification deferred to Phase 6's full validation matrix; Phase 4's gate is just "compiles + tests pass").
- **Risks heading in:** small. The patterns to follow are all established (`users_handler.go` + `organizations_handler.go` are the templates). The only judgment call is the `agents.Service.ListAgentTemplates` signature — plan decision specifies non-nil empty slice on zero rows; the implementation needs a `make([]*proto, 0, len(rows))` rather than a `var out []*proto` to honor that contract. The `agents` package's test suite (Phase 6) pins this with the `_Empty` case.
