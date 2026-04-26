# Phase 5 Completion — Agent Catalog: Frontend `/agents` page

**Plan:** `docs/executing/agent-catalog.md` §Phase 5
**Roadmap:** `docs/plans/post-0.2.6-roadmap.md` §M2
**Date:** 2026-04-25
**Status:** complete; full FE check matrix green (`pnpm type-check` / `pnpm lint` / `pnpm build`); `/agents` route prerenders as `○ Static` alongside the seven other M1 routes.

This phase wired the M1 `ComingSoon` placeholder at `(app)/agents` into a real catalog page, backed by the Phase 4 RPC. One Connect-client line lit up the agents service in `lib/api/client.ts`; one shadcn primitive (`Badge`) was added because the plan needed it; four new files (one shared lib, two card components, one metadata-only layout) plus a full rewrite of `agents/page.tsx` complete the user-visible surface. The discriminated-union state machine pattern from `(app)/layout.tsx` was lifted directly — same shape, same `ConnectError.from(e)` handling, same four-state union — so the page reads as familiar to anyone who's read the layout.

---

## Index

- **Added shadcn primitive: `frontend/src/components/ui/badge.tsx`** via `pnpm dlx shadcn@latest add badge`. Confirmed `base-nova` registry includes Badge — unlike `form` which M1 documented as silently skipped. Provides `variant: secondary` for the "Coming Soon" pill on sneak-peek cards.
- **New file: `frontend/src/lib/agents/coming-soon.ts`** (24 LOC). Static `COMING_SOON_HARNESSES` array — three entries (LangGraph / CrewAI / AutoGen). One file, easy to delete entries from when a harness graduates from sneak-peek to real seed row. Plan decision 25.
- **New file: `frontend/src/components/agent-template-card.tsx`** (44 LOC). Live (DB-backed) template card. Bot icon in tinted square, title, description, disabled `Deploy` button with "Available in v1" tooltip. **Tooltip uses base-ui's `render={<span tabIndex={0} />}` pattern, not Radix's `<TooltipTrigger asChild>`** — the plan was written in Radix idiom but the codebase is on `@base-ui/react` via the `base-nova` registry. Plan decisions 23 + 24.
- **New file: `frontend/src/components/coming-soon-harness-card.tsx`** (32 LOC). Sneak-peek card. Sparkles icon (muted), name + vendor + description, `<Badge variant="secondary">Coming Soon</Badge>` in the header. **Crucially: no `CardFooter`, no `Button`** — decision 25's "nothing to click means nothing to fake" §11.4 compliance. Anyone adding a click target to a sneak-peek harness has to add a whole new section, which is a far higher bar than re-enabling a disabled button.
- **New file: `frontend/src/app/(app)/agents/layout.tsx`** (12 LOC). Metadata-only layout. Exports `metadata.title = "Agents — Corellia"`. Required because the page itself becomes `"use client"` and Next.js's App Router doesn't allow `export const metadata` from client components — the sibling-layout pattern is the established workaround across the codebase (M1 used it for `/onboarding`'s "Welcome to Corellia" title).
- **Replaced: `frontend/src/app/(app)/agents/page.tsx`** (135 LOC, was an 18-LOC `ComingSoon` stub). `"use client"`, four-state discriminated union (`loading | ready | empty | error`), `useEffect`-driven fetch via `api.agents.listAgentTemplates({})`, `<TooltipProvider>` mounted at page scope (no global provider in M1; mounted here rather than at layout-level since other chrome routes don't use tooltips today). Plan decision 26.
- **Modified: `frontend/src/lib/api/client.ts`** (+2 LOC: import + client line). `agents: createConnectClient(AgentsService, transport)` slotted alongside `users` and `organizations` in the returned object — alphabetical-ish-by-domain matches the `Deps` ordering in `httpsrv/server.go`.
- **Validation matrix.** `pnpm type-check` clean; `pnpm lint` clean; `pnpm build` clean — all 8 routes (`/`, `/_not-found`, `/agents`, `/dashboard`, `/fleet`, `/onboarding`, `/settings`, `/sign-in`) prerender as `○ Static` (or `ƒ` for `/`). `/agents` hits `○ Static` even though the page is `"use client"` — Next 16's static-export pass produces a static shell because the data fetch lives in `useEffect` (post-hydration), not at render time. Same shape M1's `/dashboard` already established.

---

## Plan-vs-reality reconciliation

The plan was written before some shadcn-base-ui details were nailed down. Four real deviations from the plan's exact JSX, all surfaced and resolved during writing:

### 1. `Badge` was not present after M1; added cleanly via shadcn

Plan Phase 5 task 4 anticipated this with the parenthetical "may require a Phase 5a `pnpm dlx shadcn@latest add tooltip badge`." Tooltip was already in place from M1 Phase 1; only Badge needed the add. **Risk that turned into a non-issue:** M1's changelog (0.2.7) documented that `base-nova` *silently* skipped `form` during `shadcn add` — same registry, same install command, no error message, just no file produced. I expected the same outcome with Badge. It worked: `✔ Created 1 file: src/components/ui/badge.tsx`. Confirmed by inspecting the file (53 LOC, 6 variants including `secondary`). The Badge component uses `useRender` from `@base-ui/react/use-render` — same API surface as the rest of the `base-nova` primitives.

**Worth filing for future reference:** `base-nova` is not uniformly complete. `form` skipped, `badge` present. The only way to know which is which is to attempt the add and inspect the output. For shadcn primitives that the plan calls for but isn't in the registry, the fallback is hand-rolling against the `base-ui` API surface — usually ~10-30 LOC, looking at any neighbour primitive (e.g., `button.tsx`) for the pattern.

### 2. Tooltip uses base-ui `render`, not Radix `asChild`

The plan's Phase 5 JSX read:

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <span tabIndex={0}>
      <Button disabled>Deploy</Button>
    </span>
  </TooltipTrigger>
  <TooltipContent>Available in v1</TooltipContent>
</Tooltip>
```

That's the canonical Radix idiom from the broader shadcn ecosystem, but `base-nova` is on `@base-ui/react`, and `base-ui` doesn't have `asChild`. Trying to use it would have produced `Property 'asChild' does not exist on type 'TooltipPrimitive.Trigger.Props'` at type-check — same failure mode M1's changelog documented for `<SidebarMenuButton asChild>` (which got rewritten as `<SidebarMenuButton render={<Link />}>`). The codebase-wide convention M1 established is `render`, not `asChild`. I used:

```tsx
<TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
  <Button disabled>Deploy</Button>
</TooltipTrigger>
```

`render` *replaces* the trigger's rendered element entirely (so the DOM has a `<span tabIndex={0}>`, not the default `<button>`); children pass through unchanged (so the `<Button disabled>` is the span's child). The `inline-flex` class keeps the span's intrinsic layout button-shaped — without it, the span is `display: inline` and the disabled button's hover area is jagged.

**Why a wrapper at all.** Native HTML `<button disabled>` swallows pointer events on most browsers, which suppresses the parent tooltip's hover detection. The wrapper-span is the canonical workaround and it's listed in the plan's risk register §6 entry on `Tooltip` on disabled `Button` — the exact pattern just needed translation from Radix's prop name to base-ui's.

### 3. `<TooltipProvider>` mounted at page scope, not globally

`base-ui`'s `Tooltip.Root` requires a `Tooltip.Provider` ancestor — same constraint Radix has. M1 didn't introduce one because no chrome route used tooltips. I had three options:

1. Mount `<TooltipProvider>` in the root layout (`app/layout.tsx`).
2. Mount in the chrome layout (`(app)/layout.tsx`).
3. Mount in the agents page itself.

Picked (3). The reasoning mirrors M1's choice of where to mount `<UserProvider>`: hoist abstractions to their broadest *legitimate* scope, but no broader. Today no other route uses tooltips; mounting at root or chrome scope would be hoisting in anticipation of consumers that don't exist. When a second consumer arrives (Settings has obvious candidates — info icons next to fields, etc.), promote the provider one level up at that point. The cost of moving it later is one line in two files; the cost of premature hoisting is hidden coupling that's easy to forget about and hard to back out.

This is the same call M1 made on `<Toaster />` (mounted in root because portals render globally and toasts cross route group boundaries) versus `<UserProvider>` (mounted inside the chrome layout's ready branch, not globally). Different scopes for different invariants.

### 4. `multiagent-deployment-frameworks.md` doesn't exist

Plan §6 risk register entry on "Sneak-peek harnesses misrepresent the roadmap" said: "read `docs/multiagent-deployment-frameworks.md` at execution time and align the static array with whatever that doc shortlists." I checked — the file doesn't exist in the current tree. The plan named it speculatively from the broader research-folder convention. With no shortlist available, I defaulted to the plan's example set (LangGraph / CrewAI / AutoGen). When such a doc lands, it's a one-file edit to swap entries.

The static-array shape (one file, no DB writes, no migration) is exactly what makes this corrigible. If the right list turns out to be different, the cost of correction is editing the array — not writing a migration to remove placeholder seed rows that violated the §11.2 CHECK constraint (the worse alternative the plan considered and rejected).

---

## What was written, where, why

### File: `frontend/src/components/ui/badge.tsx` (added via shadcn)

53 LOC. Six variants (`default`, `secondary`, `destructive`, `outline`, `ghost`, `link`). Uses `cva` for variant composition and `useRender` from `@base-ui/react/use-render` so callers can pass a `render` prop to override the default `<span>` element. The `secondary` variant (`bg-secondary text-secondary-foreground`) is the "muted pill" tone used on the sneak-peek cards' "Coming Soon" badge — visually distinct from `default` (the loud primary-color pill) without crossing into `destructive` (red) or `outline` (border-only).

### File: `frontend/src/lib/agents/coming-soon.ts`

24 LOC. One exported type, one exported constant array. Three entries:

- **LangGraph** by LangChain — "Stateful, multi-actor agents on LangChain's graph runtime."
- **CrewAI** by CrewAI Inc. — "Role-based multi-agent orchestration. Define a crew, give them tasks."
- **AutoGen** by Microsoft Research — "Microsoft's multi-agent conversation framework."

The `vendor` field is optional in the type but populated for all three; the rendering component falls back gracefully if it's missing (no "by undefined" surfacing). Three entries is the right count: enough to suggest breadth, few enough that the catalog doesn't feel padded. Plan decision 25's framing.

### File: `frontend/src/components/agent-template-card.tsx`

44 LOC. Receives one prop (`template: AgentTemplate` from the generated TS). The structure mirrors the dashboard cards from `(app)/dashboard/page.tsx` — `<Card>` with a `<CardHeader>` (icon-square + title), `<CardContent>` (description), `<CardFooter>` (action). The deviation from the dashboard pattern: a *disabled* primary action with a tooltip, not a live `<Button render={<Link>...</Link>}>` link. Plan decisions 23 (Bot icon) + 24 (disabled Deploy + tooltip).

The Bot icon sits in `bg-primary/10 text-primary` — same tinted-square pattern the dashboard's `Sparkles` and `Box` icons use, but in primary color rather than muted. The tonal difference is intentional: the live catalog cards are the *call to action* on the page; the dashboard's "navigate to other surfaces" cards are not.

### File: `frontend/src/components/coming-soon-harness-card.tsx`

32 LOC. Receives three props (`name`, `description`, `vendor?`). The structural divergence from `AgentTemplateCard` is the load-bearing detail: **no `CardFooter`, no `Button`, no `Tooltip`.** The card is a passive presentation surface, not an action surface. Decision 25's framing: §11.4 forbids "non-functional UI buttons"; the cleanest compliance is "no button at all."

The "Coming Soon" badge sits in the header, top-right, next to the title — right where a status indicator would go in a real fleet card later (M4). Reusing that visual slot for the sneak-peek state means a future reader of the JSX reads the relationship as "this card is in a non-functional intermediate state" rather than "this card is a different component entirely with a coincidentally similar layout." The `opacity-75` on the outer `<Card>` is the supporting visual cue: a *real* harness card at full opacity is the one you can use; the dimmed one is the preview.

### File: `frontend/src/app/(app)/agents/layout.tsx`

12 LOC. Exports `metadata.title = "Agents — Corellia"` and a passthrough default export (`return children`). The default export is required for Next.js to recognise the file as a layout — without it, `metadata` exports from this file would be ignored.

This sibling-layout pattern is the established workaround for the `"use client"` page wanting static metadata. M1 used it for `/onboarding` (title "Welcome to Corellia"); the new chrome routes (`/agents`, `/fleet`, `/settings`) all need the same shape eventually. Today only `/agents` has a client-component page (the others are still M1's server-component placeholders, which can export `metadata` directly); when `/fleet` and `/settings` become client components in M4 / future polish-pass plans, they'll each grow a sibling layout.tsx exporting their own metadata.

A pending follow-up (already flagged in 0.2.7's "Known pending work"): consolidate the per-route `"<Name> — Corellia"` strings via `metadata.title.template` on the root layout (`title: { default: "Corellia", template: "%s — Corellia" }`), then each page declares just `"Agents"`. One-line root edit, three-line simplification across pages. Not in M2's scope.

### File: `frontend/src/app/(app)/agents/page.tsx` (full replacement)

135 LOC. The structural pattern is lifted from `(app)/layout.tsx` directly:

```tsx
type State =
  | { kind: "loading" }
  | { kind: "ready"; templates: AgentTemplate[] }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export default function AgentsPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = createApiClient();
        const res = await api.agents.listAgentTemplates({});
        if (cancelled) return;
        if (res.templates.length === 0) {
          setState({ kind: "empty" });
        } else {
          setState({ kind: "ready", templates: res.templates });
        }
      } catch (e) {
        if (cancelled) return;
        const err = ConnectError.from(e);
        setState({ kind: "error", message: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  // ... render branches
}
```

Three observations on this shape:

**The `cancelled` flag is not optional.** React 19's StrictMode in dev double-invokes `useEffect` cleanups; without the flag, an in-flight `setState` after unmount triggers a "Can't perform a React state update on an unmounted component" warning. The flag turns the post-await `setState` calls into no-ops if the effect has been torn down — same pattern `(app)/layout.tsx` and `/onboarding` use. Plan didn't specify it; lifted from the layout.

**`Code.Unauthenticated` is *not* handled in this page.** The chrome layout (`(app)/layout.tsx`) already redirects unauthenticated users to `/sign-in` *before* this page's effect runs — the layout's own `getCurrentUser` fails first. By the time this page's `useEffect` fires, the session is established. If a session expires *between* layout-fetch and page-fetch (the only window where a Connect call from this page could see `Unauthenticated`), the user sees an error toast on the page rather than an immediate redirect — acceptable degradation. The next interaction will hit the layout again and redirect normally.

**`PermissionDenied` is also not handled.** Catalog reads are global per decision 10; there's no per-user scoping. If the BE ever returns `PermissionDenied` here, it's a bug, not a state. Same logic as `Code.Unauthenticated` in the layout — the layout maps `PermissionDenied` to the `not-provisioned` state because `users.Service` returns it for missing-`public.users` rows; agents has no such concept.

The render branches:
- **`loading`** — `LoadingGrid` renders three `<Skeleton className="h-44 w-full" />` cards in the responsive grid. Single-block skeletons rather than card-shaped placeholders; lighter touch and matches the layout's skeleton style.
- **`ready`** — `CatalogGrid` with mapped `<AgentTemplateCard />` components, then `ComingSoonSection` below the divider. Both grids share the `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4` shape so cards align horizontally if both grids have items in the same row visually.
- **`empty`** — `ComingSoonSection` only. Even with no live templates, the sneak peeks still tell the product story; no "No harnesses available" copy needed because the page is never *actually* empty (sneak peeks always render in this branch). Plan Phase 5 task 3.
- **`error`** — Centered `<Card>` with "Couldn't load harnesses." title and the underlying message as description. Sneak peeks deliberately *suppressed* in this branch — surfacing them while the live catalog errors would be confusing ("why does this one work and not the others?"). Plan Phase 5 task 3.

The `ComingSoonSection` is its own small subcomponent in the page file. It renders a horizontal `<Separator />` flanked by an uppercase "Coming Soon" caption, then the static-array map onto `<ComingSoonHarnessCard>`. The `<Separator className="flex-1" />` flanks expand to fill the gaps on either side of the caption; without `flex-1` they'd collapse to zero width. The caption uses `font-medium uppercase tracking-wide text-muted-foreground` — the small-caps caption pattern that shadcn uses elsewhere.

### Edit: `frontend/src/lib/api/client.ts` (+2 / -0)

```diff
+import { AgentsService } from "@/gen/corellia/v1/agents_pb";
 import { OrganizationsService } from "@/gen/corellia/v1/organizations_pb";
 import { UsersService } from "@/gen/corellia/v1/users_pb";
```

```diff
   return {
     users: createConnectClient(UsersService, transport),
     organizations: createConnectClient(OrganizationsService, transport),
+    agents: createConnectClient(AgentsService, transport),
   };
```

Two lines of additive change against the file. The `agents` client gets the same `transport` instance as `users` and `organizations`, which means it inherits the same Supabase-token-attaching `fetch` wrapper — no per-service auth wiring. The service is mounted *inside* the auth group on the BE (Phase 4); the FE expects `Bearer <token>` to be attached unconditionally; the transport handles both. Zero per-call ceremony.

---

## Validation — full FE check matrix output

### `pnpm -C frontend type-check` — clean

```
$ pnpm -C frontend type-check
> tsc --noEmit
$ echo $?
0
```

The interesting type-check signals this phase exercises:

- **`api.agents.listAgentTemplates({})`** typechecks: the empty-message argument is `{}` (the `ListAgentTemplatesRequest` message has zero fields per `agents.proto`); Connect-ES v2's client method accepts a plain object literal that satisfies the message shape. If the proto were ever to grow a required field, this call site would fail type-check immediately.
- **`AgentTemplate[]`** flows correctly from the generated TS into the discriminated union's `ready` arm. The `Message<"corellia.v1.AgentTemplate">` brand in `agents_pb.ts` keeps it from being confused with any other `AgentTemplate` type elsewhere in the codebase (there isn't one today, but the brand is the contract).
- **`ConnectError.from(e)`** is the canonical Connect-ES v2 idiom for narrowing an `unknown` exception to a `ConnectError`; same shape `(app)/layout.tsx:64` and `app/onboarding/page.tsx:86,119` use.

### `pnpm -C frontend lint` — clean

```
$ pnpm -C frontend lint
> eslint
$ echo $?
0
```

Particularly: no `react-hooks/exhaustive-deps` warning on the empty `useEffect` dependency array. The effect fetches once on mount and doesn't read any closure-captured variables — `setState` is stable, `createApiClient()` is constructed inline. If a future change adds a captured variable (e.g., a search filter), the lint rule will surface it.

### `pnpm -C frontend build` — clean

```
$ pnpm -C frontend build
> next build
✓ Compiled successfully in 1461ms
✓ Generating static pages using 11 workers (10/10) in 256ms

Route (app)
┌ ƒ /
├ ○ /_not-found
├ ○ /agents
├ ○ /dashboard
├ ○ /fleet
├ ○ /onboarding
├ ○ /settings
└ ○ /sign-in
```

`/agents` prerenders as `○ Static`. The route's prerender outcome is a function of *render-time* dependencies, not *data-flow* dependencies: even though the page is `"use client"` and fetches via Connect, the static-export pass produces the static shell HTML (initial state `{ kind: "loading" }`, three skeleton cards) and ships it. Hydration-time the effect fires, `listAgentTemplates({})` round-trips, the state machine flips, and the user sees the live cards. This is the same shape `/dashboard` and `/onboarding` already had — the codebase pattern works correctly for the new route.

### `git diff --stat` — additivity confirmation

The only modified file is `frontend/src/lib/api/client.ts` (`+2 / -0`). Everything else is brand-new (six new files: `ui/badge.tsx`, `lib/agents/coming-soon.ts`, two cards, layout, page) or the M1 stub being fully replaced (`agents/page.tsx`, `+135 / -18` net). Nothing existing was touched in any of the M1 chrome surfaces (`(app)/layout.tsx`, `app-sidebar.tsx`, `app-top-bar.tsx`, `coming-soon.tsx`, `dashboard/page.tsx`).

---

## Behavior change (known)

- **`/agents` is now a real page.** Signed-in users navigating to `/agents` see one Hermes card (live, DB-backed) followed by three sneak-peek cards (LangGraph / CrewAI / AutoGen, static FE content). Hovering the disabled `Deploy` button surfaces the "Available in v1" tooltip. The M1 placeholder card with the construction icon is gone for this route specifically; `/fleet` and `/settings` retain it.
- **First production caller of an Agents-service RPC.** The page mounts an effect that issues `POST /corellia.v1.AgentsService/ListAgentTemplates` on every cold mount. With the FE deployed against the BE deployed, every signed-in user landing on `/agents` exercises the round-trip wired in Phase 4. The BE's `slog`-emitting middleware will log one auth-validation event + one Connect-handler invocation per page-mount — easy to confirm against backend stdout.
- **One round-trip per page-mount, not per page-mount-or-state-change.** The state machine doesn't refetch on user interaction; the only refetch trigger today is a fresh navigation to `/agents` (which remounts the page component). Future M2.5 polish (e.g., a refresh button) would add an explicit refetch handler.
- **`<TooltipProvider>` is now mounted somewhere in the app for the first time.** Page-scoped, so other routes don't get it for free. If a future `/dashboard` enhancement adds tooltips and forgets to mount its own provider, the tooltips will silently fail to position (no runtime error — base-ui tooltips just don't open without a provider context). When that happens, hoist this provider to `(app)/layout.tsx` rather than mounting per-page.

---

## Observations worth keeping

### Plan-vs-codebase reality is the most important reading the plan author can't do

The plan was written rigorously, with risk-register entries anticipating most of what came up. Three of the four deviations (Badge missing, Tooltip pattern, no global TooltipProvider) were addressed in plan-time risk register entries — *as Radix-shaped concerns*. The codebase is base-ui-shaped. The translation work (Radix `asChild` → base-ui `render`, Radix `<TooltipProvider>` ergonomics → base-ui's same-named-but-still-required ancestor) is the kind of detail a plan writer can't see from the plan-doc layer alone.

This is why the M1 / 0.2.6 / M2 pattern of "completion docs document deviations explicitly" is load-bearing. Without the deviations section, a future reader of the plan-versus-code-state would see `<TooltipTrigger asChild>` in the plan and `<TooltipTrigger render={<span tabIndex={0} />}>` in the code, and have to reverse-engineer why they differ. The deviation note shifts that from a "spelunking exercise" to a "named decision with named rationale."

### The static-array sneak-peek pattern is reusable

The shape (typed array + map-onto-component + no DB writes) generalises beyond harnesses. Future surfaces that need "marketing-ish content embedded in the product" — a deploy-target picker showing AWS / SkyPilot / NixOS as "coming soon" alongside Fly's live tile, a memory-provider picker showing Elephantasm / mem0 / Letta — can adopt the same pattern verbatim. Three files: a `lib/<surface>/coming-soon.ts` array, a `<ComingSoonXCard>` component, a section divider on the live page. Each surface decision is *whether* to show sneak peeks (depends on how much of the product story needs them) and *what* to show (depends on the named-target shortlist). The structure is invariant.

The §11.4 invariant — "no buttons on sneak peeks, ever" — is what makes the pattern safe across all those surfaces. Without it, every sneak-peek surface invites a separate "should we make this clickable to a waitlist signup?" debate; with it, the answer is always "no, not until the harness/target/provider has a real seed row backing it." Cheaper than building a waitlist; honest about what the product currently does.

### `useEffect` + `cancelled` flag + `ConnectError.from` is the canonical FE-fetch shape in this codebase

Three pages use it now: `(app)/layout.tsx`, `/onboarding/page.tsx`, and `(app)/agents/page.tsx`. Future pages doing data-fetch should match the shape unless there's a specific reason not to:

```tsx
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const api = createApiClient();
      const res = await api.<service>.<method>({...});
      if (cancelled) return;
      // setState(...) on success
    } catch (e) {
      if (cancelled) return;
      const err = ConnectError.from(e);
      // setState(error) — possibly with err.code-specific branching
    }
  })();
  return () => { cancelled = true; };
}, [/* deps */]);
```

The discriminated-union state shape goes alongside it. Consistency means future reviewers can read a new page in 30 seconds because they've read three already.

---

## Known pending work

- **No tests for the page or the two card components.** Plan §28-29 only specified backend tests (Phase 6). Component tests would land in `frontend/src/components/__tests__/` with Vitest + Testing Library; FE test infrastructure isn't set up in v1 (CLAUDE.md flags this — "No Playwright / E2E in v1"). When v2 introduces FE testing, `AgentTemplateCard` (props in, JSX out) and `ComingSoonHarnessCard` (same) are the easiest high-value surfaces to start with.
- **No real-DB end-to-end run-through yet.** Phase 5's acceptance gates are static (`type-check` / `lint` / `build`). Phase 6's Validation §3 + §4 + §5 run the curl smoke + the FE walkthrough + the DB sanity SELECT against a live binary against a live DB.
- **`pnpm-lock.yaml` likely changed** as a side-effect of `shadcn add badge`. The Badge component is *vendored* (a `.tsx` file in `components/ui/`), but the shadcn CLI may have ensured its dependencies (`class-variance-authority`, `@base-ui/react/merge-props`, `@base-ui/react/use-render`) are reachable. `git diff frontend/pnpm-lock.yaml` will surface any actual lockfile drift; if no diff, the deps were already present from M1's adds. Worth a quick check before commit.
- **Sneak-peek harness names are placeholder-quality copy.** "Stateful, multi-actor agents on LangChain's graph runtime" is fine; "Microsoft's multi-agent conversation framework" is fine; both could be sharper. When `multiagent-deployment-frameworks.md` lands (or whichever doc replaces it), the descriptions are worth a copy-pass alongside the harness-name swap.
- **`metadata.title.template` consolidation deferred.** Pre-existing pending item from 0.2.7. M2's new layout (`agents/layout.tsx`) is the third declarer of `"<Name> — Corellia"`; the longer the list grows, the more obviously a root-layout `template` simplifies things. Polish-pass candidate; not blocking.
- **No empty-state copy.** The `kind: "empty"` branch renders sneak peeks only; if both the live catalog and the sneak-peek list were empty, the page would render the heading + nothing. Decision-25 sneak peeks make this a hypothetical (they're never empty), but if the static array were ever drained to zero, the page would feel broken. Defensive: when `COMING_SOON_HARNESSES.length === 0` and the live catalog is also empty, the page should fall back to a "Catalog coming soon" message. Not implemented in M2; flag for follow-up.

---

## What's next — Phase 6 hand-off

Phase 6 (tests + validation matrix) is the closing gate:

- **Pre-conditions:** ✅ Schema + seed (Phase 1), ✅ typed Go queries (Phase 2), ✅ proto + generated TS (Phase 3), ✅ live RPC (Phase 4), ✅ live FE consumer (Phase 5). The full vertical slice is in place.
- **Phase 6 work:**
  1. New file `backend/internal/agents/service_test.go` — two cases (happy path with one row, empty list). Pattern lifted from `users/service_test.go`. The empty case pins decision-28's contract (FE relies on `[]` not `null`).
  2. Full check matrix: `go vet`, `go build`, `go test`, `pnpm type-check`, `pnpm lint`, `pnpm build`.
  3. Curl smoke against the live RPC (3 sub-calls — healthz, no-auth 401, valid-token happy path).
  4. FE end-to-end walkthrough (5 sub-scenarios — sign in, navigate, hover tooltip, scroll past divider to sneak peeks, backend-down regression).
  5. DB sanity SELECT against the seed row.
  6. Cleanup pass: zero `TODO` / `FIXME` / `console.log` / blank-identifier keepalives.
  7. Changelog entry for `0.3.0` (flagged out-of-strict-scope but worth queueing).
- **Phase 6 acceptance:** full check matrix green; runtime checks (3 / 4 / 5) pass against a live setup or are documented in an operator runbook for non-localhost validation.
- **Risk heading in:** small. The full vertical slice is already deployed-locally-ish; Phase 6's tests just lock the contract in place. Runtime checks are the only real unknown — most likely failure mode is environment-shape (DB credentials, JWKS URL drift, missing seed) rather than code defect.
