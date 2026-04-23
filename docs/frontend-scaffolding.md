# Frontend Scaffolding

Step-by-step guide to bringing `frontend/` into existence — the Next.js 15
App Router half of Corellia. Follow sections in order; by the end of §11
you have a running local frontend that signs in via Supabase and reads the
current user from the Go backend.

Status: **scaffolding-stage reference.** Once `frontend/` is actually built
and patterns are established, the live code becomes authoritative. Update
this doc only if the scaffolding *approach* changes before we've scaffolded.

## Companion reading

- `vision.md` — the problem Corellia is solving
- `blueprint.md` — the product architecture this frontend surfaces (esp. §10 UX flow)
- `stack.md` — *why* each tool was picked; canonical spec for `shared/`, env vars, deploy
- `backend-scaffolding.md` — mirrored guide for the Go half; the API this frontend talks to

When this doc conflicts with `stack.md`, `stack.md` wins. When `stack.md`
conflicts with `blueprint.md`, `blueprint.md` wins.

---

## 1. Prerequisites

Install before starting.

| Tool | Version | Install |
|------|---------|---------|
| Node | 20+ | [volta.sh](https://volta.sh) or nvm |
| pnpm | 9+ | `npm install -g pnpm` or via Volta |
| buf | 1.30+ | `brew install bufbuild/buf/buf` |

Also needed:
- A Supabase project (same one the backend uses). From its dashboard:
  - Project URL, anon key
- A Vercel account for deploy (can wait until §12)

---

## 2. Final directory structure

Target state after §1–§11 of this doc:

```
frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx              root layout with Supabase session provider
│   │   ├── page.tsx                "/" — redirects to /dashboard or /sign-in
│   │   ├── sign-in/
│   │   │   └── page.tsx            Supabase email/password sign-in
│   │   ├── auth/
│   │   │   └── callback/
│   │   │       └── route.ts        OAuth/magic-link callback (if used)
│   │   └── dashboard/
│   │       └── page.tsx            "prove the pipeline" — reads GetCurrentUser
│   ├── components/
│   │   └── ui/                     shadcn-generated primitives (button, form, input, ...)
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts           browser-side Supabase client factory
│   │   │   ├── server.ts           server-side Supabase client factory
│   │   │   └── middleware.ts       session-refresh helper for Next.js middleware
│   │   └── api/
│   │       └── client.ts           Connect-go API client with auth header injection
│   ├── gen/                        ★ buf-generated (do not hand-edit)
│   │   └── corellia/v1/
│   │       ├── users_pb.ts
│   │       └── users_connect.ts
│   ├── middleware.ts               Next.js middleware — refreshes Supabase session
│   └── styles/
│       └── globals.css             Tailwind directives
├── public/
├── .env.local                      gitignored; mirrors repo-root .env
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── tsconfig.json
├── components.json                 shadcn config
├── package.json
└── pnpm-lock.yaml
```

Files marked ★ are generated and committed but never hand-edited.
See `stack.md` §2 layout rules.

---

## 3. Bootstrap Next.js

From repo root:

```bash
pnpm create next-app@latest frontend \
  --typescript \
  --tailwind \
  --app \
  --src-dir \
  --eslint \
  --import-alias "@/*"
```

Accept defaults for Turbopack if prompted. Verify:

```bash
cd frontend && pnpm dev
# http://localhost:3000 renders the default Next.js page
```

Add the frontend workspace to root `pnpm-workspace.yaml`:

```yaml
packages:
  - "frontend"
```

---

## 4. Dependencies

From `frontend/`:

```bash
# Supabase
pnpm add @supabase/supabase-js @supabase/ssr

# Connect-go TS runtime + transport
pnpm add @connectrpc/connect @connectrpc/connect-web @bufbuild/protobuf

# Forms
pnpm add react-hook-form @hookform/resolvers zod

# shadcn/ui runtime deps (installed via `pnpm dlx shadcn` in §5, but listing for clarity)
pnpm add class-variance-authority clsx tailwind-merge lucide-react

# Codegen plugins (dev only)
pnpm add -D @bufbuild/protoc-gen-es @connectrpc/protoc-gen-connect-es
```

See `stack.md` §1 for rationale on each.

---

## 5. Tailwind + shadcn/ui

Tailwind is already wired from `create-next-app`. Add shadcn/ui:

```bash
cd frontend
pnpm dlx shadcn@latest init
```

Accept the defaults (New York style, neutral base color, CSS vars). This
creates `components.json` and rewrites `src/styles/globals.css` with
shadcn's CSS-var layer.

Add the primitives needed for v1:

```bash
pnpm dlx shadcn@latest add button form input label select card toast
```

These land in `src/components/ui/`. Treat them as your own code — shadcn
is a generator, not a library. Edit freely.

---

## 6. Supabase client setup

Three files — the @supabase/ssr canonical pattern for Next.js App Router.

### 6.1 Browser client

File: `frontend/src/lib/supabase/client.ts`

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

### 6.2 Server client

File: `frontend/src/lib/supabase/server.ts`

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    },
  );
}
```

### 6.3 Middleware helper

File: `frontend/src/lib/supabase/middleware.ts`

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // Refreshes the session on every request if expired.
  await supabase.auth.getUser();
  return response;
}
```

File: `frontend/src/middleware.ts`

```ts
import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

Per `stack.md` §5, the Supabase client on the frontend is used strictly
for auth (sign-in, session). All *application* data flows through
Connect-go RPCs to the Go backend.

---

## 7. How `shared/` relates from the frontend

`shared/` is canonically documented in `stack.md` §3. From this side:

- **Input:** `.proto` files in `shared/proto/corellia/v1/`.
- **Output:** generated TS in `frontend/src/gen/corellia/v1/`.
- **Trigger:** `pnpm proto:generate` from repo root.

### 7.1 Codegen config

File: `shared/proto/buf.yaml`

```yaml
version: v2
modules:
  - path: .
lint:
  use:
    - STANDARD
breaking:
  use:
    - FILE
```

File: `shared/proto/buf.gen.yaml`

```yaml
version: v2
plugins:
  # Backend — Go
  - remote: buf.build/protocolbuffers/go
    out: ../../backend/internal/gen
    opt: paths=source_relative
  - remote: buf.build/connectrpc/go
    out: ../../backend/internal/gen
    opt: paths=source_relative

  # Frontend — TS (@bufbuild/es + @connectrpc/connect-es)
  - local: ./node_modules/.bin/protoc-gen-es
    out: ../../frontend/src/gen
    opt:
      - target=ts
  - local: ./node_modules/.bin/protoc-gen-connect-es
    out: ../../frontend/src/gen
    opt:
      - target=ts
```

The `local:` plugin paths resolve via the frontend's `node_modules`.

### 7.2 Root pnpm script

In `frontend/package.json`, add:

```json
{
  "scripts": {
    "proto:generate": "cd ../shared/proto && buf generate"
  }
}
```

Run from repo root:

```bash
pnpm -C frontend proto:generate
# or, if the root package.json delegates:
pnpm proto:generate
```

The first run requires network access (buf pulls remote plugins). After
that, Go + TS generated code lands in their respective `gen/` folders.
Commit both.

---

## 8. Connect-go client

File: `frontend/src/lib/api/client.ts`

```ts
import { createConnectTransport } from "@connectrpc/connect-web";
import { createPromiseClient } from "@connectrpc/connect";

import { UsersService } from "@/gen/corellia/v1/users_connect";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";

export function createApiClient() {
  const supabase = createSupabaseClient();

  const transport = createConnectTransport({
    baseUrl: process.env.NEXT_PUBLIC_API_URL!,
    fetch: async (input, init) => {
      const { data } = await supabase.auth.getSession();
      const headers = new Headers(init?.headers);
      if (data.session) {
        headers.set("Authorization", `Bearer ${data.session.access_token}`);
      }
      return fetch(input, { ...init, headers });
    },
  });

  return {
    users: createPromiseClient(UsersService, transport),
  };
}
```

Usage in a client component:

```tsx
"use client";
import { createApiClient } from "@/lib/api/client";

const api = createApiClient();
const { user } = await api.users.getCurrentUser({});
```

Each generated service exposes typed methods. TS types come from the
`.proto` — no hand-maintained request/response types.

Per `stack.md` §11 rule 10: this client is the **only** path for
application data. Supabase client is for auth only.

---

## 9. Auth flow

### 9.1 Sign-in page

File: `frontend/src/app/sign-in/page.tsx`

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SignInPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setErr(error.message); return; }
    router.push("/dashboard");
  }

  return (
    <main className="mx-auto max-w-sm space-y-4 p-8">
      <h1 className="text-2xl font-bold">Sign in</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" value={password}
            onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <Button type="submit">Sign in</Button>
      </form>
    </main>
  );
}
```

For the hackathon, create a test user directly in the Supabase dashboard
(Auth → Users → Add user → email/password). Magic-link, OAuth, signup
flows are all available later without architectural changes.

### 9.2 Route protection

Server-side check in any protected route:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function ProtectedPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  // ...
}
```

---

## 10. "Prove the pipeline" — the dashboard

File: `frontend/src/app/dashboard/page.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createApiClient } from "@/lib/api/client";
import { createClient } from "@/lib/supabase/client";

export default function DashboardPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const api = createApiClient();
        const res = await api.users.getCurrentUser({});
        setEmail(res.user?.email ?? null);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, []);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/sign-in");
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 p-8">
      <h1 className="text-2xl font-bold">Corellia</h1>
      {err && <p className="text-red-600">{err}</p>}
      {email && <p>Signed in as <strong>{email}</strong></p>}
      <button onClick={signOut} className="text-sm underline">Sign out</button>
    </main>
  );
}
```

If this page loads after sign-in and displays the current user's email,
the full pipeline is working: Supabase issues a JWT → frontend attaches
it → Go validates it → Go queries Postgres → Go returns `User` over
Connect → frontend renders it. The hour-5 milestone from `stack.md` §12.

---

## 11. Local dev

Within `frontend/`:

```bash
pnpm dev
# http://localhost:3000
```

From repo root with overmind (boots both halves):

File: `Procfile.dev`

```
web: pnpm -C frontend dev
api: cd backend && air
```

Then:

```bash
overmind start -f Procfile.dev
```

Env vars: the frontend reads from `frontend/.env.local` (per Next.js
convention — the root `.env` is not auto-loaded by Next.js). For v1,
either:

- **Duplicate** relevant vars into `frontend/.env.local`
  (`NEXT_PUBLIC_*` + `NEXT_PUBLIC_API_URL`), or
- **Symlink** `frontend/.env.local → ../.env` for convenience

The symlink is simpler for the hackathon. Both files are gitignored.

Required `NEXT_PUBLIC_*` vars for the frontend:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
NEXT_PUBLIC_API_URL=http://localhost:8080
```

---

## 12. Deploy to Vercel

1. Push the repo to GitHub.
2. In the Vercel dashboard: **New Project → Import Repo**.
3. Set **Root Directory** to `frontend`. (Vercel auto-detects Next.js.)
4. Framework preset: **Next.js**.
5. Build command: `pnpm build` (default).
6. Output directory: `.next` (default).
7. Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_API_URL` — the Fly backend URL (`https://corellia-api.fly.dev`)
8. Deploy.

Vercel auto-deploys `main` and produces preview URLs per PR. Update the
backend's `FRONTEND_ORIGIN` Fly secret to the Vercel URL so CORS
accepts production origins:

```bash
cd backend && fly secrets set FRONTEND_ORIGIN="https://<your-vercel-url>"
```

---

## 13. Testing

v1 is lean on tests. Non-negotiables:

- **`pnpm type-check`** (= `tsc --noEmit`) on every CI pass.
- **`pnpm lint`** (= `next lint`) on every CI pass.
- **No component-level unit tests** in v1 — the surface area is small and
  changes too fast. Revisit for v1.5.
- **No Playwright** in v1 — the hour-5 deployed-pipeline milestone is the
  integration smoke test.

Run:

```bash
cd frontend
pnpm type-check
pnpm lint
```

---

## 14. Post-scaffolding: what to build first

Once the "prove the pipeline" milestone is green (signed in, current
user rendered from backend RPC), real product work begins. Order tracks
blueprint §10:

1. **Catalog page** (`/catalog` or `/new-agent`). Renders one card for
   Hermes (others grayed). Click → character-creation form.
2. **Spawn form.** The §10 "RPG character creation" UX — name, model
   provider, API key, model. Validates with `zod`. Submits via
   `api.agents.spawnAgent({...})`.
3. **Fleet view** (`/agents` or `/dashboard`). Lists `agent_instances`
   with name, status, template, actions. Polls status every ~5s.
4. **Agent detail page** (`/agents/[id]`). Shows runtime status, logs
   link (Fly native), stop/destroy actions.
5. **"Deploy N agents" flow.** Catalog page's "Deploy N" action: same
   form + count + name prefix. Submit triggers N parallel `SpawnAgent`
   calls via the backend.
6. **shadcn polish.** Toasts on success/failure, loading states,
   empty-state illustrations.

The TS client auto-updates as `.proto` grows — every new service/method
lands in `src/gen/` after `pnpm proto:generate`, zero hand-written
types.

---

## 15. Known deferrals (implementation-specific)

Things this scaffold deliberately skips (see also blueprint §13 and
`stack.md` §13):

- Dark mode toggle beyond whatever shadcn ships by default.
- Internationalization.
- Error boundaries and production-grade error states — v1 tolerates
  generic "something went wrong" text.
- Server-rendered data fetching (RSC + fetch()) — v1 uses client-side
  `useEffect` calls for simplicity. Can migrate to RSC after the API
  shape stabilizes.
- Optimistic updates / mutation queues.
- Progressive enhancement for the sign-in form.
- Image optimization beyond Next.js defaults.

None are load-bearing for v1; all plug in cleanly post-scaffold.
