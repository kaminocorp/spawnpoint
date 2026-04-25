# Backend Scaffolding

Step-by-step guide to bringing `backend/` into existence — the Go service half
of Corellia. Follow sections in order; by the end of §11 you have a running
local backend with a working authenticated RPC against Supabase.

Status: **scaffolding-stage reference.** Once `backend/` is actually built
and patterns are established, the live code becomes authoritative. Update
this doc only if the scaffolding *approach* changes before we've scaffolded.

## Companion reading

- `vision.md` — the problem Corellia is solving
- `blueprint.md` — the product architecture this backend implements (esp. §9 data model, §11 rules)
- `stack.md` — *why* each tool was picked; canonical spec for `shared/`, env vars, deploy
- `frontend-scaffolding.md` — mirrored guide for the Next.js half

When this doc conflicts with `stack.md`, `stack.md` wins. When `stack.md`
conflicts with `blueprint.md`, `blueprint.md` wins.

---

## 1. Prerequisites

Install before starting. Versions listed are minimums; newer is fine.

| Tool | Version | Install |
|------|---------|---------|
| Go | 1.22+ | [go.dev/dl](https://go.dev/dl) or `brew install go` |
| buf | 1.30+ | `brew install bufbuild/buf/buf` |
| sqlc | 1.25+ | `brew install sqlc` |
| goose | 3.19+ | `go install github.com/pressly/goose/v3/cmd/goose@latest` |
| air | 1.50+ | `go install github.com/air-verse/air@latest` |
| flyctl | latest | `brew install flyctl` |

Also needed:
- A Supabase project (dev tier is enough). From its dashboard, grab:
  - Project URL, anon key, service key, JWT secret
  - Connection pooler URL (Settings → Database → Connection pooling)
- A Fly.io account with `fly auth login` completed

---

## 2. Final directory structure

Target state after §1–§11 of this doc:

```
backend/
├── cmd/
│   └── api/
│       └── main.go                     HTTP server entrypoint + DI wiring
├── internal/
│   ├── agents/                         (scaffolded empty; filled post-§15)
│   ├── adapters/                       (scaffolded empty; filled post-§15)
│   ├── auth/
│   │   ├── claims.go                   AuthClaims struct + context helpers
│   │   └── middleware.go               Supabase JWT validator (Chi middleware)
│   ├── config/
│   │   └── config.go                   env var loading, typed Config struct
│   ├── db/                             ★ sqlc-generated (do not hand-edit)
│   │   ├── db.go
│   │   ├── models.go
│   │   ├── users.sql.go
│   │   └── pool.go                     ← the only hand-written file here
│   ├── deploy/                         (scaffolded empty; filled post-§15)
│   ├── gen/                            ★ buf-generated (do not hand-edit)
│   │   └── corellia/
│   │       └── v1/
│   │           ├── users.pb.go
│   │           └── corelliav1connect/
│   │               └── users.connect.go
│   ├── httpsrv/
│   │   ├── server.go                   Chi router + middleware + Connect mounts
│   │   ├── cors.go                     CORS middleware
│   │   └── users_handler.go            Connect handler glue (thin)
│   └── users/
│       └── service.go                  domain: GetCurrentUser, provision on first login
├── migrations/
│   └── 20260423120000_initial_schema.sql    users + organizations
├── queries/
│   └── users.sql                       sqlc input (raw SQL per domain)
├── tmp/                                air build artifacts (gitignored)
├── .air.toml                           air config
├── sqlc.yaml                           sqlc config
├── Dockerfile                          multi-stage build for Fly
├── fly.toml                            Fly app config
├── go.mod
└── go.sum
```

Files marked ★ are generated and committed but never hand-edited.
See `stack.md` §2 layout rules.

---

## 3. Go module + workspace initialization

From repo root:

```bash
mkdir -p backend/cmd/api backend/internal backend/migrations backend/queries
cd backend
go mod init github.com/<your-org>/corellia/backend
```

Pick your canonical module path. Throughout this doc, `<mod>` stands in for
whatever you chose (e.g., `github.com/crimsonsun/corellia/backend`).

Create `go.work` at the repo root:

```bash
cd ..
cat > go.work <<'EOF'
go 1.22

use ./backend
EOF
go work sync
```

Verify:

```bash
cd backend && go mod tidy
```

Expected: `go.mod`, `go.sum` in `backend/`; `go.work` at repo root.

---

## 4. Dependencies

From `backend/`:

```bash
# HTTP routing
go get github.com/go-chi/chi/v5

# Connect-go + Proto runtime
go get connectrpc.com/connect
go get google.golang.org/protobuf

# Postgres
go get github.com/jackc/pgx/v5
go get github.com/jackc/pgx/v5/pgxpool

# JWT validation
go get github.com/golang-jwt/jwt/v5

# UUID
go get github.com/google/uuid

# Env var parsing with validation
go get github.com/caarlos0/env/v11

# Dev-time .env loader (no-op if .env missing, so prod-safe)
go get github.com/joho/godotenv
```

`go mod tidy` to normalize. See `stack.md` §1 for the rationale on each pick.

---

## 5. Configuration package

File: `backend/internal/config/config.go`

```go
package config

import (
    "log/slog"
    "os"

    "github.com/caarlos0/env/v11"
)

type Config struct {
    Port int `env:"PORT" envDefault:"8080"`

    // DatabaseURL is the Supabase session-pooler URL used by the app at
    // runtime. DATABASE_URL_DIRECT (migration-only, superuser role) is
    // deliberately not exposed here — it is a shell-only env var read by
    // goose, so the app binary never holds superuser credentials.
    DatabaseURL string `env:"DATABASE_URL,required"`

    SupabaseURL       string `env:"SUPABASE_URL,required"`
    SupabaseJWTSecret string `env:"SUPABASE_JWT_SECRET,required"`
    FlyAPIToken       string `env:"FLY_API_TOKEN,required"`
    FlyOrgSlug        string `env:"FLY_ORG_SLUG,required"`
    FrontendOrigin    string `env:"FRONTEND_ORIGIN,required"`
}

func Load() Config {
    var cfg Config
    if err := env.Parse(&cfg); err != nil {
        slog.Error("config load failed", "err", err)
        os.Exit(1)
    }
    return cfg
}
```

`config.Load()` is called exactly once in `main.go`. No other package touches
`os.Getenv`. Per `stack.md` §11 rule 8.

---

## 6. Database layer

### 6.1 Connection pool

File: `backend/internal/db/pool.go`

```go
package db

import (
    "context"
    "time"

    "github.com/jackc/pgx/v5/pgxpool"
)

// NewPool builds the app's single pgxpool connected to the Supabase session
// pooler. Tuning values are v1 starters — revisit when we know real traffic
// shape and how many Fly machines are in rotation.
func NewPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
    cfg, err := pgxpool.ParseConfig(dsn)
    if err != nil {
        return nil, err
    }

    cfg.MaxConns = 10
    cfg.MinConns = 2
    cfg.MaxConnLifetime = time.Hour
    cfg.MaxConnIdleTime = 30 * time.Minute
    cfg.HealthCheckPeriod = time.Minute

    return pgxpool.NewWithConfig(ctx, cfg)
}
```

### Connection strategy (why two URLs)

- **`DATABASE_URL`** — the app's runtime connection, via Supabase's
  **Session Pooler** (Supavisor on port 5432 at the pooler hostname).
  Gives us IPv4 support, connection multiplexing, and the full PG feature
  set that pgx + sqlc rely on (prepared statements, session vars,
  advisory locks).
- **`DATABASE_URL_DIRECT`** — direct connection (`db.<ref>.supabase.co:5432`),
  used **only by goose for migrations**. DDL and extension-management
  statements behave more reliably on a direct connection than through a
  pooler. Kept out of `config.Config` so the Go binary never holds
  superuser credentials.

Both URLs use the `postgres` role for v1. Later (post-RLS), `DATABASE_URL`
switches to a restricted `corellia_app` role that does not bypass RLS;
`DATABASE_URL_DIRECT` stays on `postgres`.

**We do not use Transaction Pooling (port 6543).** pgx prepares statements
by default — that's how sqlc's generated code gets its type-safety and
performance. Transaction pooling (pgbouncer in txn mode) breaks prepared
statements across txn boundaries. Go servers have stable, modest
connection counts; the multiplexing txn pooling provides is a pattern for
Python async / serverless, not for a long-lived Go process.

### 6.2 First migration

File: `backend/migrations/20260423120000_initial_schema.sql`

```sql
-- +goose Up
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE organizations (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID        NOT NULL UNIQUE,
    email        TEXT        NOT NULL UNIQUE,
    org_id       UUID        NOT NULL REFERENCES organizations(id),
    role         TEXT        NOT NULL DEFAULT 'admin',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed a default org for v1 (single-tenant assumption).
INSERT INTO organizations (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Org');

-- +goose Down
DROP TABLE users;
DROP TABLE organizations;
DROP EXTENSION IF EXISTS "uuid-ossp";
```

Apply (migrations always run against `DATABASE_URL_DIRECT`, never the
pooler URL):

```bash
goose -dir backend/migrations postgres "$DATABASE_URL_DIRECT" up
```

Remaining blueprint §9 tables (`harness_adapters`, `agent_templates`,
`agent_instances`, `secrets`, `deploy_targets`) land in subsequent
migrations as each becomes needed — see §15.

### 6.3 sqlc config + first query

File: `backend/sqlc.yaml`

```yaml
version: "2"
sql:
  - engine: "postgresql"
    queries: "queries"
    schema: "migrations"
    gen:
      go:
        package: "db"
        out: "internal/db"
        sql_package: "pgx/v5"
        emit_interface: true
        emit_pointers_for_null_types: true
        emit_json_tags: true
```

File: `backend/queries/users.sql`

```sql
-- name: GetUserByAuthID :one
SELECT * FROM users WHERE auth_user_id = $1;

-- name: CreateUser :one
INSERT INTO users (auth_user_id, email, org_id)
VALUES ($1, $2, $3)
RETURNING *;
```

Generate:

```bash
cd backend && sqlc generate
```

Expected: `backend/internal/db/` now contains generated `db.go`, `models.go`,
`users.sql.go`. These are generated — commit, don't edit.

---

## 7. Auth middleware

> **Superseded — see `docs/executing/auth-es256-migration.md`.** This
> section captures the 0.1.0 HS256 scaffold (shared-secret HMAC
> validation via `SUPABASE_JWT_SECRET`). The live code now validates
> ES256 signatures against a cached JWKS fetched from Supabase's
> `.well-known` endpoint; the `SUPABASE_JWT_SECRET` config field and
> env var have been removed. The prose below is preserved as the
> historical record of what 0.1.0 shipped — do not edit it to match
> the current state; read the completion docs in
> `docs/completions/auth-es256-migration-phase*-completion.md` for
> what actually landed.

File: `backend/internal/auth/claims.go`

```go
package auth

import "github.com/google/uuid"

type AuthClaims struct {
    AuthUserID uuid.UUID
    Email      string
}
```

File: `backend/internal/auth/middleware.go`

```go
package auth

import (
    "context"
    "net/http"
    "strings"

    "github.com/golang-jwt/jwt/v5"
    "github.com/google/uuid"
)

type ctxKey struct{}

// Middleware validates the Supabase access token on `Authorization: Bearer`
// and attaches parsed claims to the request context.
func Middleware(jwtSecret string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            tokenStr := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
            if tokenStr == "" {
                http.Error(w, "missing bearer token", http.StatusUnauthorized)
                return
            }

            claims := jwt.MapClaims{}
            if _, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
                return []byte(jwtSecret), nil
            }); err != nil {
                http.Error(w, "invalid token", http.StatusUnauthorized)
                return
            }

            sub, _ := claims["sub"].(string)
            email, _ := claims["email"].(string)
            authUserID, err := uuid.Parse(sub)
            if err != nil {
                http.Error(w, "invalid sub claim", http.StatusUnauthorized)
                return
            }

            ctx := context.WithValue(r.Context(), ctxKey{}, &AuthClaims{
                AuthUserID: authUserID,
                Email:      email,
            })
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}

func FromContext(ctx context.Context) (*AuthClaims, bool) {
    ac, ok := ctx.Value(ctxKey{}).(*AuthClaims)
    return ac, ok
}
```

The middleware handles JWT validation only. Loading or provisioning the
application `User` row is a domain concern — see `users.Service` in §9.
Per `stack.md` §11 rule 6, Supabase specifics stay inside `auth/`.

---

## 8. How `shared/` relates from the backend

`shared/` is canonically documented in `stack.md` §3. From this side:

- **Input:** `.proto` files in `shared/proto/corellia/v1/` — authored as
  the FE↔BE API contract. Changes here require regenerating and
  committing both halves' generated code in the same commit.
- **Output:** generated Go in `backend/internal/gen/corellia/v1/` (messages)
  and `backend/internal/gen/corellia/v1/corelliav1connect/` (service
  handlers + clients).
- **Trigger:** `pnpm proto:generate` from repo root. Script defined in
  `frontend/package.json`, wraps `buf generate shared/proto`. Backend
  engineers run the same command.

The `shared/proto/buf.gen.yaml` declaration responsible for emitting the
Go bits is set up as part of `frontend-scaffolding.md` §7 (or can be
authored here first — it's language-neutral config).

Example `shared/proto/buf.gen.yaml` for the Go plugin only:

```yaml
version: v2
plugins:
  - remote: buf.build/protocolbuffers/go
    out: ../../backend/internal/gen
    opt: paths=source_relative
  - remote: buf.build/connectrpc/go
    out: ../../backend/internal/gen
    opt: paths=source_relative
```

TS plugins are appended in §7 of the frontend doc.

---

## 9. First Connect-go service: `GetCurrentUser`

The "prove the pipeline" milestone from `stack.md` §12.

### 9.1 Proto

File: `shared/proto/corellia/v1/users.proto`

```proto
syntax = "proto3";
package corellia.v1;

option go_package = "<mod>/internal/gen/corellia/v1;corelliav1";

service UsersService {
  rpc GetCurrentUser(GetCurrentUserRequest) returns (GetCurrentUserResponse);
}

message GetCurrentUserRequest {}

message GetCurrentUserResponse {
  User user = 1;
}

message User {
  string id = 1;
  string email = 2;
  string org_id = 3;
  string role = 4;
}
```

Run `pnpm proto:generate` from repo root. Verify
`backend/internal/gen/corellia/v1/users.pb.go` and
`backend/internal/gen/corellia/v1/corelliav1connect/users.connect.go`
exist. The filesystem path mirrors the `.proto` path (because
`buf.gen.yaml` sets `paths=source_relative`); the Go package name
stays `corelliav1` via the `;corelliav1` suffix on `go_package`.

### 9.2 Domain service

File: `backend/internal/users/service.go`

```go
package users

import (
    "context"
    "errors"

    "<mod>/internal/auth"
    "<mod>/internal/db"
    corelliav1 "<mod>/internal/gen/corellia/v1"
    "github.com/google/uuid"
)

var defaultOrgID = uuid.MustParse("00000000-0000-0000-0000-000000000001")

type Service struct {
    queries *db.Queries
}

func NewService(queries *db.Queries) *Service {
    return &Service{queries: queries}
}

func (s *Service) GetCurrentUser(ctx context.Context) (*corelliav1.User, error) {
    claims, ok := auth.FromContext(ctx)
    if !ok {
        return nil, errors.New("unauthenticated")
    }

    user, err := s.queries.GetUserByAuthID(ctx, claims.AuthUserID)
    if err != nil {
        // Auto-provision on first login.
        user, err = s.queries.CreateUser(ctx, db.CreateUserParams{
            AuthUserID: claims.AuthUserID,
            Email:      claims.Email,
            OrgID:      defaultOrgID,
        })
        if err != nil {
            return nil, err
        }
    }

    return &corelliav1.User{
        Id:    user.ID.String(),
        Email: user.Email,
        OrgId: user.OrgID.String(),
        Role:  user.Role,
    }, nil
}
```

The default-org assumption is v1-only. Multi-org self-service is
post-v1 (blueprint §13).

### 9.3 Connect handler glue

File: `backend/internal/httpsrv/users_handler.go`

```go
package httpsrv

import (
    "context"

    "connectrpc.com/connect"
    corelliav1 "<mod>/internal/gen/corellia/v1"
    "<mod>/internal/users"
)

type usersHandler struct {
    svc *users.Service
}

func NewUsersHandler(svc *users.Service) *usersHandler {
    return &usersHandler{svc: svc}
}

func (h *usersHandler) GetCurrentUser(
    ctx context.Context,
    _ *connect.Request[corelliav1.GetCurrentUserRequest],
) (*connect.Response[corelliav1.GetCurrentUserResponse], error) {
    user, err := h.svc.GetCurrentUser(ctx)
    if err != nil {
        return nil, connect.NewError(connect.CodeUnauthenticated, err)
    }
    return connect.NewResponse(&corelliav1.GetCurrentUserResponse{User: user}), nil
}
```

Handler is <20 lines — parses request, calls service, wraps response.
Business logic stays in `users.Service`. Per `stack.md` §11 rule 9.

---

## 10. HTTP server assembly

### 10.1 CORS middleware

File: `backend/internal/httpsrv/cors.go`

```go
package httpsrv

import "net/http"

func corsMiddleware(allowedOrigin string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
            w.Header().Set("Access-Control-Allow-Headers",
                "Authorization, Content-Type, Connect-Protocol-Version, Connect-Timeout-Ms")
            w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            if r.Method == http.MethodOptions {
                w.WriteHeader(http.StatusNoContent)
                return
            }
            next.ServeHTTP(w, r)
        })
    }
}
```

v1 uses a single `allowedOrigin` (the deployed FE URL or `*` for dev). v2
tightens this per-environment.

### 10.2 Server

File: `backend/internal/httpsrv/server.go`

```go
package httpsrv

import (
    "net/http"

    "github.com/go-chi/chi/v5"
    "github.com/go-chi/chi/v5/middleware"

    "<mod>/internal/auth"
    "<mod>/internal/config"
    "<mod>/internal/gen/corellia/v1/corelliav1connect"
)

type Deps struct {
    Config       config.Config
    UsersHandler corelliav1connect.UsersServiceHandler
    AllowedOrigin string
}

func New(d Deps) http.Handler {
    r := chi.NewRouter()

    r.Use(middleware.Logger)
    r.Use(middleware.Recoverer)
    r.Use(corsMiddleware(d.AllowedOrigin))

    r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
        w.WriteHeader(http.StatusOK)
    })

    r.Group(func(r chi.Router) {
        r.Use(auth.Middleware(d.Config.SupabaseJWTSecret))

        path, handler := corelliav1connect.NewUsersServiceHandler(d.UsersHandler)
        r.Mount(path, handler)
    })

    return r
}
```

### 10.3 `main.go`

File: `backend/cmd/api/main.go`

```go
package main

import (
    "context"
    "fmt"
    "log/slog"
    "net/http"
    "os"

    _ "github.com/joho/godotenv/autoload" // loads .env in dev, no-op in prod

    "<mod>/internal/config"
    "<mod>/internal/db"
    "<mod>/internal/httpsrv"
    "<mod>/internal/users"
)

func main() {
    slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

    cfg := config.Load()
    ctx := context.Background()

    pool, err := db.NewPool(ctx, cfg.DatabaseURL)
    if err != nil {
        slog.Error("db pool", "err", err)
        os.Exit(1)
    }
    defer pool.Close()

    queries := db.New(pool)
    usersSvc := users.NewService(queries)

    handler := httpsrv.New(httpsrv.Deps{
        Config:        cfg,
        UsersHandler:  httpsrv.NewUsersHandler(usersSvc),
        AllowedOrigin: cfg.FrontendOrigin,
    })

    addr := fmt.Sprintf(":%d", cfg.Port)
    slog.Info("listening", "addr", addr)
    if err := http.ListenAndServe(addr, handler); err != nil {
        slog.Error("server", "err", err)
        os.Exit(1)
    }
}
```

Dependency wiring is explicit and manual. No DI framework, per `stack.md`
philosophy.

---

## 11. Local dev

File: `backend/.air.toml`

```toml
root = "."
tmp_dir = "tmp"

[build]
  cmd         = "go build -o ./tmp/api ./cmd/api"
  bin         = "./tmp/api"
  include_ext = ["go"]
  exclude_dir = ["tmp", "internal/gen", "internal/db"]
  delay       = 1000

[log]
  time = true
```

From `backend/`:

```bash
air
```

Or from repo root via overmind (see `frontend-scaffolding.md` §11 for the
full Procfile.dev that boots both halves).

`.env` at repo root is loaded automatically via `godotenv/autoload`.

---

## 12. Deploy to Fly.io

### 12.1 Dockerfile

File: `backend/Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1
FROM golang:1.22-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12
COPY --from=builder /out/api /api
EXPOSE 8080
ENTRYPOINT ["/api"]
```

### 12.2 fly.toml

File: `backend/fly.toml`

```toml
app            = "corellia-api"
primary_region = "ams"

[build]

[http_service]
  internal_port        = 8080
  force_https          = true
  auto_stop_machines   = true
  auto_start_machines  = true
  min_machines_running = 0

[[vm]]
  cpu_kind  = "shared"
  cpus      = 1
  memory_mb = 256
```

### 12.3 First deploy

```bash
cd backend

fly launch --copy-config --name corellia-api --region ams --no-deploy

fly secrets set \
  DATABASE_URL="..." \
  SUPABASE_URL="..." \
  SUPABASE_JWT_SECRET="..." \
  FLY_API_TOKEN="..." \
  FLY_ORG_SLUG="..." \
  FRONTEND_ORIGIN="https://<your-vercel-url>"

fly deploy
```

Verify:

```bash
curl https://corellia-api.fly.dev/healthz
# expect 200
```

---

## 13. Testing

v1 is lean on tests. Non-negotiables:

- **`go vet ./...`** on every CI pass.
- **Table-driven unit tests** for functions in `internal/*` with branching
  logic. Filename convention: `<file>_test.go` next to the code.
- **No E2E tests** (Playwright/Cypress) in v1 — the hour-5 deployed-pipeline
  milestone is the integration smoke test.
- **No DB mocks.** If a test needs a DB, use a real throwaway Postgres via
  [testcontainers-go](https://golang.testcontainers.org/) or point at a
  local dev DB. Never inject mocks through the `*db.Queries` layer —
  sqlc's generated queries are thin SQL wrappers; mocking them tests
  nothing useful.

Run:

```bash
cd backend && go test ./...
```

---

## 14. Post-scaffolding: what to build first

Once the "prove the pipeline" milestone is green (authenticated
`GetCurrentUser` RPC works locally and in prod), real product work begins.
Order matches blueprint §10 + §14:

1. **`harness_adapters` table + seed.** Second migration. Seed one row for
   the hand-written Hermes adapter (`source: hand_written`, pinned digest).
2. **`agent_templates` table + seed.** Third migration. Seed one template
   pointing at the Hermes adapter.
3. **`agent_instances` + `secrets` tables.** Fourth migration.
4. **`deploy/interface.go` + stub implementations.** `DeployTarget`
   interface; `FlyDeployTarget` skeleton; `AWSDeployTarget`,
   `LocalDeployTarget`, `SkyPilotDeployTarget` as structs that return
   `NotImplemented`. Per blueprint §11 rule 4.
5. **`FlyDeployTarget.Spawn()` implementation.** Calls Fly's GraphQL API
   to create app, set secrets, create machine. Per blueprint §11 rule 1:
   no Fly primitives referenced outside this file.
6. **`agents.proto` — full service.** `SpawnAgent`, `ListAgents`,
   `StopAgent`, `DestroyAgent`.
7. **`agents.Service` domain package.** Implements the spawn flow
   end-to-end: creates `agent_instance` row, calls `DeployTarget.Spawn()`,
   updates status on success/failure.
8. **Fleet view RPC.** `ListAgents` with per-agent status.
9. **"Deploy N agents" path.** Parallel spawn using `errgroup` — the demo
   moment from blueprint §10.

Stubs live alongside real implementations from day one. A stubbed
`AWSDeployTarget` that returns `NotImplemented` is a passing
architectural exercise; a fake UI button that does nothing is not.

---

## 15. Known deferrals (implementation-specific)

Things this scaffold deliberately skips (see also blueprint §13 and
`stack.md` §13):

- Structured request IDs / tracing — `slog` gets us far enough in v1.
- Graceful shutdown with context cancellation — can be added in ~15
  minutes when needed; not blocking for a hackathon.
- Connection pool tuning — default pgxpool config is fine for v1.
- Request-scoped DB transactions — domain packages call queries directly.
- Rate limiting.
- Metrics export (Prometheus / OpenTelemetry).
- Health checks beyond `/healthz` returning 200.

None of these are architecturally load-bearing; they plug in cleanly
later without a refactor.
