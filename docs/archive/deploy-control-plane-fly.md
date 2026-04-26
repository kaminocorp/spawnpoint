# Completion — M3.9 Deploy Control Plane (Backend → Fly) (2026-04-26)

**Plan:** none drafted (artefact-and-deploy bundled into one session per the user's "prepare artefacts + launch app" instruction). Roadmap entry: `docs/plans/post-0.2.6-roadmap.md` §M3.9.
**Status:** backend half landed; frontend → Vercel still pending (the rest of M3.9).
**Predecessors:**
- `docs/changelog.md` §0.5.1 (M3.5) — last shipped milestone; resolver indirection in place but no deployed substrate to exercise it against.
- `docs/plans/post-0.2.6-roadmap.md` §M3.9 — the milestone this completion partially satisfies (backend-half only).

This document records the *as-built* state of the backend deploy. The change is artefact-and-infra: three new files in `backend/`, one Fly app reservation, secrets staged from the local `.env`, single-machine deploy in SIN.

---

## Files added / changed

| File | Status | Δ | Notes |
|---|---|---|---|
| `backend/Dockerfile` | new | +24 | Multi-stage Go 1.26 build → distroless `static-debian12:nonroot` final stage. `CGO_ENABLED=0`, `-trimpath -ldflags="-s -w"`. BuildKit cache mounts on `/go/pkg/mod` + `/root/.cache/go-build`. Final image: 7.5 MB. |
| `backend/fly.toml` | new | +25 | App `corellia`, region `sin`, `internal_port = 8080`, HTTP service on `:443` with `force_https = true`, `/healthz` HTTP check (30s interval), `auto_stop_machines = "stop"` + `auto_start_machines = true`, `min_machines_running = 0`, `shared-cpu-1x` / 512 MB. |
| `backend/.dockerignore` | new | +13 | Excludes `.env`, `bin/`, `tmp/`, `*_test.go`, editor noise. |
| `docs/plans/post-0.2.6-roadmap.md` | edit | (separate session-earlier edit) | M3.9 promoted from §4 out-of-scope to §3 as a real milestone; M1/M2/M3/M3.5 marked shipped; snapshot updated to 2026-04-26. |

No backend code edits. No proto changes. No migration. The runtime image is byte-identical to a `cd backend && go build -o bin/api ./cmd/api` of the same source tree, just statically linked and shipped in distroless.

---

## Operational state

| Property | Value |
|---|---|
| Fly app | `corellia` |
| Org | `crimson-sun-technologies` |
| Hostname | `corellia.fly.dev` |
| Region | `sin` |
| Machine | `d894d6eb245038`, `started`, 1 of 1 health checks passing |
| Image | `registry.fly.io/corellia:deployment-01KQ3ZP09QGPV40PZJXFD3NGK4` (7.5 MB) |
| IPs | Dedicated IPv6 `2a09:8280:1::10b:6929:0`; shared IPv4 `66.241.124.245` |
| `/healthz` | HTTP 200 in 73 ms (cold-path test from local) |
| Secrets set (5) | `DATABASE_URL`, `SUPABASE_URL`, `FLY_API_TOKEN`, `FLY_ORG_SLUG`, `FRONTEND_ORIGIN` |
| Boot success indicator | `/healthz` returning 200 — `config.Load()` did not panic on any of the 5 required vars; `auth.NewJWKSVerifier` reached Supabase; `db.NewPool` reached the Supabase Direct host from SIN. |

---

## Sequence executed

1. `fly apps create corellia --org crimson-sun-technologies` → reserved global name.
2. (User redirect: change region IAD → SIN, take secrets from local `.env`.)
3. `fly apps destroy corellia --yes` + recreate — empty reservation, no machines yet, fully reversible.
4. Edit `backend/fly.toml`: `primary_region = "sin"`.
5. `grep -E '^(DATABASE_URL|SUPABASE_URL|FLY_API_TOKEN|FLY_ORG_SLUG|FRONTEND_ORIGIN)=' backend/.env | fly secrets import --stage` — 5 keys staged into Fly's vault without broadcasting (no machines to receive yet).
6. `cd backend && fly deploy --remote-only --ha=false` — remote builder, single machine.
7. `curl https://corellia.fly.dev/healthz` → HTTP 200, machine `started` with 1/1 checks passing.

---

## Behavior change (known)

- **First time the control plane is reachable from outside `localhost`.** `https://corellia.fly.dev/*` exists; the open `/healthz` route at `httpsrv/server.go:32` is the only currently-callable endpoint without a Supabase access token. RPC paths (`/corellia.v1.UsersService/GetCurrentUser`, etc.) require `Authorization: Bearer <token>` from a signed-in Supabase session.
- **CORS allowed origin is `http://localhost:3000`** (from the local `.env`). The deployed BE will reject browser RPCs from any other origin — including the eventual Vercel URL — until `FRONTEND_ORIGIN` is updated.
- **`auto_stop_machines = "stop"` is live.** The machine idles to stopped after a few minutes of no traffic; first request after idle pays a ~300 ms cold start, subsequent requests are warm. `min_machines_running = 0` is what permits this.
- **Outbound Fly API access is wired but unexercised.** The boot log emits `deploy targets initialised kinds=aws,fly,local fly_org=crimson-sun-technologies`; the resolver is reachable but no handler reads it yet (M4 is the first reader). The deployed BE *can* call Fly's API to spawn agent apps under `crimson-sun-technologies` as soon as M4 ships the spawn handler.

---

## Resolves

- **`docs/plans/post-0.2.6-roadmap.md` §M3.9 — backend half.** The remaining FE → Vercel half is still pending; the milestone closes when `corellia.fly.dev`'s `FRONTEND_ORIGIN` references the deployed Vercel URL and a signed-in user can complete the onboarding wizard end-to-end against the deployed substrate.
- **CLAUDE.md "No Dockerfile/fly.toml yet. Nothing is deployed."** No longer accurate post-this-completion. The CLAUDE.md note should update to "Backend deployed to Fly (`corellia.fly.dev`); frontend deploy to Vercel still pending" at the next housekeeping pass.
- **Stack.md §10's `cd backend && fly deploy` recipe is now actually runnable.** Pre-this-completion it was aspirational documentation; post-this-completion it's the canonical command for subsequent backend deploys.

---

## Known pending work

- **Frontend → Vercel.** Roadmap M3.9's other half. Until landed, the deployed BE is unreachable to a real user — sign-in still happens against `localhost:3000`.
- **`FRONTEND_ORIGIN` cross-reference.** Once Vercel URL exists: `fly secrets set FRONTEND_ORIGIN=https://<vercel-url> -a corellia`. The two BE deploys / one FE deploy chicken-and-egg from the M3.9 plan still applies.
- **Supabase Auth Site URL + Redirect URLs.** Supabase's auth dashboard needs the Vercel URL added to allowed redirect URLs once it exists, otherwise sign-in callbacks 400.
- **No CI deploy pipeline.** `fly deploy` stays manual; Vercel will auto-deploy on push to `main`. GitHub Actions for backend deploy is a v1.5 follow-up if/when manual deploys become friction.
- **No staging environment.** Single production app per side. If demo prep ever requires a separable environment, `fly apps create corellia-staging` + a Vercel preview branch is the cheap path; not worth pre-paying for it.
- **Operator runtime walkthrough** — `/healthz` confirms boot but no end-to-end RPC has been exercised against the deployed substrate yet (would require a signed-in Supabase session calling `GetCurrentUser` via the deployed FE, which doesn't exist yet). M3.9's FE half closes this loop.

---

## Supersedes

- **Roadmap §4's "Deploying the control plane itself to Fly + Vercel ... slotted opportunistically — likely between M2 and M3, ... not blocking the M-sequence."** That window has closed and the framing was overtaken: M3.9 is now a real numbered milestone whose backend half this completion documents, not an opportunistic side-task.
- **Stack.md §12's "Hour 4–5" deploy milestone.** Hour-by-hour framing was the hackathon-zero scaffolding metaphor; post-this-completion the relevant question is "is M3.9 done end-to-end" not "are we past hour 5."
