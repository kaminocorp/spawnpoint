# Phase 2 Completion — Onboarding wizard at `/onboarding`

**Plan:** `docs/executing/onboarding-wizard.md` §Phase 2
**Status:** complete
**Date:** 2026-04-25
**Acceptance:** `pnpm -C frontend type-check && pnpm -C frontend lint` both green. End-to-end manual run-through deferred to Phase 6 per plan §4.

---

## What

A standalone, chrome-less route at `/onboarding` that:

1. Loads the current user via `users.GetCurrentUser`.
2. Bounces signed-out callers to `/sign-in`, already-named callers to `/dashboard`, and unprovisioned callers (`PermissionDenied`) to a static "account not provisioned" card with a sign-out affordance.
3. Otherwise loads the user's workspace via `organizations.GetOrganization` to seed the org-name field with the trigger-generated default (`alice's Workspace`).
4. Renders a two-field form (name + workspace name) backed by `react-hook-form` + `zodResolver` with trim/min(1)/max(80) validation.
5. On submit, fires both updates in parallel via `Promise.all`, surfaces a success toast, and redirects to `/dashboard`.
6. On Connect errors mid-submit, surfaces an error toast and re-enables the form.

Two new files. Zero changes anywhere else.

---

## Where (file-level)

| Action | Path | LOC | Note |
|---|---|---|---|
| new | `frontend/src/app/onboarding/page.tsx` | 222 | Client component — the wizard itself |
| new | `frontend/src/app/onboarding/layout.tsx` | 13 | Server component, sole purpose: `metadata.title = "Welcome to Corellia"` |

Untouched (intentionally):
- All Phase 1 additions (`Toaster`, shadcn primitives, `use-mobile.ts`).
- `frontend/src/app/dashboard/page.tsx` — still at top level with the four-state union from 0.2.5; gets moved into `(app)/dashboard/` in Phase 3.
- `frontend/src/lib/api/client.ts`, `frontend/src/lib/supabase/*` — wizard consumes them as-is.

---

## Why each call

### Why a separate `layout.tsx` file just to set `metadata.title`

Next.js 16's metadata API requires `metadata` exports from a **server** module — but `page.tsx` is `"use client"` (the wizard runs supabase/Connect code client-side, has interactive form state, calls `useRouter`). Server-side `metadata` exports from a client module are forbidden.

The idiomatic resolution is a sibling `layout.tsx` that owns `metadata` while transparently rendering its children. The layout is a no-op identity wrapper (`return children`) — its only job is to be a server module that contributes the per-route title. This pattern recurs across the App Router whenever a leaf page is `"use client"` but still needs static metadata; documenting it once here so the same shape on `/dashboard`, `/agents`, etc. in later phases doesn't need re-explanation.

### Why `useEffect` with a `cancelled` guard rather than `useSWR` / React Query

The codebase has zero data-fetching libraries in `package.json`. Adding one for a single page is scope creep; the dashboard at `(app)/dashboard/` (currently `app/dashboard/`) uses raw `useEffect` with the same shape. Consistency wins.

The `cancelled` guard handles the React 19 strict-mode double-mount: if the effect runs twice in dev, the first run's stale `setState` is ignored. Three places need it — after `getCurrentUser`, after `getOrganization`, and inside the catch block — because each is an `await` boundary that lets a tear-down land while we're suspended.

### Why fetch `getCurrentUser` then `getOrganization` sequentially, not in parallel

The plan considered `Promise.all([getCurrentUser, getOrganization])` but `getOrganization`'s request requires `id`, which only comes back from `getCurrentUser`. Running them in parallel would require a hard-coded org ID or a separate "list my orgs" RPC — neither exists, neither is worth introducing. Sequential is the correct shape.

The cost is one extra round-trip on the cold path (≈30ms typical). Acceptable: the wizard runs once per user lifetime.

### Why the org-name field is pre-filled, but the user-name field is empty

Decision #5 + #6 in the plan, restated:

- **Org name** has a meaningful default (`split_part(email, '@', 1) || '''s Workspace'` from the trigger). Pre-filling reveals what we did and lets the user keep or edit. Empty would feel like we lost their data.
- **User name** has no good default. `email[0..@]` is a username, not a display name; "alice.smith" reads worse than empty. The empty field signals "we genuinely don't know" rather than "we guessed wrong."

Asymmetric defaulting is the right call here, even though it looks inconsistent at first glance.

### Why both updates fire in parallel via `Promise.all`

The two RPCs are independent — `UpdateCurrentUserName` writes to `public.users`, `UpdateOrganizationName` writes to `public.organizations`. Neither requires the other to have completed. `Promise.all` halves wall-clock latency and is simpler than sequencing.

The risk decision #7 acknowledges: if one resolves and the other rejects, the user is in a half-onboarded state. That's acceptable because re-entering the wizard re-fetches and pre-fills with whichever value already persisted — the "is this user onboarded?" check (`user.name?.trim()`) will still be false because the failing half kept it empty, so they'll see the form again, with the half that succeeded already saved. They finish the unfinished half and continue. No corrupt state, no data loss.

### Why `router.replace` (not `router.push`)

Three call sites use `router.replace`:
- Already-named user → `/dashboard`: `replace` so the back button doesn't return them to `/onboarding` (they aren't onboarding; they're already done).
- Successful submit → `/dashboard`: same reasoning. The wizard is one-shot; back-navigation should not re-trigger it.
- Unauthenticated → `/sign-in`: `replace` so they don't land back on `/onboarding` after signing in via the back button — they should land wherever the sign-in flow's redirect points (currently `/dashboard`).

The general rule: `replace` for forced navigation that shouldn't be reversible by back-button; `push` for user-initiated nav. Every navigation in this file is forced.

### Why `aria-invalid` on the inputs

shadcn's `Input` has built-in `aria-invalid` styling (red ring, destructive border colour) that fires on `aria-invalid="true"` — see `components/ui/button.tsx` for the parallel `aria-invalid:border-destructive aria-invalid:ring-destructive/20` cascade. Wiring `aria-invalid={!!form.formState.errors.name}` lights up the visual error state automatically without any custom CSS or a wrapping `FormItem`-style component (which is what the absent `Form` primitive would have provided). It's the closest equivalent to `Form`/`FormField` semantics with the deps we have.

### Why `<form>` directly inside `<Card>` (not wrapped in a separate component)

The shadcn `Card` is a presentation primitive; it doesn't care what's nested. Putting `<form>` inside `<CardContent>` would make `form.handleSubmit` not catch the submit because `<button type="submit">` has to be inside a `<form>` ancestor — but `CardFooter` is where the submit button lives. Putting `<form>` *around* `CardContent` + `CardFooter` lets both inherit the form context cleanly while keeping the visual structure. This is the canonical shadcn form-in-card layout.

### Why `signOut` exists on the wizard, in three branches

The wizard is the first route a freshly-provisioned user ever sees. If something goes wrong (`error` state) or their account isn't provisioned (`not-provisioned` state) or they want to switch users mid-onboarding (`ready` state), they need an exit. Without sign-out on this route, an unprovisioned user is trapped — every navigation ends up back here because they don't satisfy the layout-gate predicates.

The sign-out is identical across branches; could be hoisted into a shared component, but at three usages it's not worth the abstraction.

### Why no Zod `superRefine` or async validation

The fields have hard validation (required, max length) that's purely client-side. The backend will eventually grow input validation — that's flagged in 0.2.5 "Known pending work" — but cross-field validation (e.g., "name can't equal workspace name") doesn't add value at this layer. Trim+min+max is exactly the surface we need.

### Why `form.reset(...)` to populate the org-name default

`react-hook-form`'s `defaultValues` are read once at form construction. By the time the async `getOrganization` resolves, the form already exists with empty `defaultValues`. `form.reset({ name: "", orgName: org.name })` cleanly re-initializes it without flicker (it doesn't trigger a validation pass) and keeps `formState.isDirty` semantics intact.

The alternative — `defaultValues: useMemo(() => ..., [org])` with conditional rendering — is the same outcome with more wiring. `reset` is the idiomatic `react-hook-form` answer.

---

## Behavior change

### Visible
- New route at `/onboarding`. Anyone can navigate there:
  - Signed-out: redirected to `/sign-in`.
  - Signed-in but `auth.users` row never created via the trigger: amber "not provisioned" card with sign-out.
  - Signed-in and already named: redirected to `/dashboard`.
  - Signed-in, provisioned, name still NULL: form renders with org-name pre-filled.
- Successful submit toasts `Welcome to Corellia, <name>.` and lands on `/dashboard`.
- Failed submit toasts the Connect error message and re-enables the form.

### Invisible (yet)
- Nothing currently *redirects* a freshly-provisioned user to `/onboarding`. That's Phase 3's job — the `(app)/` chrome layout will read `user.name?.trim()` and `router.replace('/onboarding')` if empty. Until then, a freshly-provisioned user lands on `/dashboard` and sees only the email (per the existing 0.2.5 four-state shape). The wizard is reachable by typing the URL but isn't yet on the auto-flow.

This split is intentional and matches the plan's phase ordering: Phase 2 ships the wizard standalone and runnable; Phase 3 wires the redirect.

---

## Deviations from the written plan

### 1. No shadcn `Form` primitive — used raw `useForm` + `register`

Already covered in Phase 1's deviations (`form.tsx` doesn't exist in the `base-nova` registry). The wizard uses `form.register("name")` spread directly onto `<Input>` and `form.formState.errors.name` for inline error rendering. This matches `app/sign-in/page.tsx`'s style and keeps the FE coherent.

The visible cost compared to the planned shape: ~6 LOC of repetition between the two field blocks (each block manually does Label + Input + spread + error message render). With `Form`/`FormField`/`FormItem` wrappers it would have been more declarative. Acceptable for a two-field form; if the wizard grows beyond five fields, extract a tiny `<FormField>` helper component.

### 2. Sign-out CTA on every render branch, not just `not-provisioned`

The plan didn't explicitly mandate sign-out on the `error` and `ready` branches — only on the not-provisioned panel. Added it on all three because (a) the wizard is the first authenticated route a user lands on, so it's their only escape hatch if something is wrong, and (b) the cost is negligible. Flagging here so the next reviewer doesn't see it as out-of-spec.

### 3. `Card` wrapping rather than the plan's "no chrome" framing

The plan's wording was "Layout-less (the existing root `<body className="min-h-full flex flex-col">` provides centering on a card)." I interpreted that as "no app-chrome (sidebar, top bar)" rather than "no card whatsoever." The wizard sits inside a `Card` because:
- The card provides visual containment that makes the form feel intentional rather than dropped onto the page.
- Reuses the design language we'll have on `(app)/dashboard/` cards in Phase 5 — consistency.
- The error/not-provisioned/ready branches all share the card shape, so layout shifts are minimal across state transitions.

The "no chrome" intent is honoured: there is no sidebar, no top bar, no nav. Just a card on a centered page.

---

## Findings (out of Phase 2 scope)

### Tab title regression risk for `/onboarding/layout.tsx`

The `layout.tsx` is a 13-line no-op wrapper whose only purpose is the `metadata` export. If a future contributor moves the wizard to `(app)/onboarding/` (i.e., inside the chrome route group), this layout will collide with `(app)/layout.tsx` and Next.js will use only the most-specific one. As long as both export `metadata` correctly, no behaviour change — but worth noting for anyone refactoring the route tree later.

### Sign-out goes to `/sign-in` with `router.replace`

After sign-out, the user lands on `/sign-in`. The existing root `app/page.tsx` already handles "no session → redirect to `/sign-in`," so the wizard's behaviour is consistent with the rest of the app. No deferred work here; just confirming the loop closes.

### `form.reset` with no `keepDirty` flag

After `getOrganization` resolves, `form.reset({ name: "", orgName: org.name })` resets `formState.isDirty` to `false`. If a user types fast enough to start editing before the org-name fetch completes, their input is wiped. Window: the time between the `getCurrentUser` resolution (when render flips to `ready`) and the `getOrganization` resolution. Currently both are awaited before render, so the window is zero — but a future refactor that splits them risks this race. Out of Phase 2 scope; flagged.

---

## Verification log

```
$ pnpm -C frontend type-check
> tsc --noEmit
(exit 0, no output)

$ pnpm -C frontend lint
> eslint
(exit 0, no output)
```

Manual end-to-end run-through is deferred to Phase 6 per plan §4 — at that point the chrome (Phase 3) is in place to verify the full sign-in → onboarding → dashboard happy path. Type-check and lint clean is the Phase 2 acceptance gate.

---

## What's next

Phase 3 — `(app)/` chrome layout. Wires the onboarding gate that auto-redirects unprovisioned/unnamed users to `/onboarding`, moves `dashboard/page.tsx` into the route group, and lays the sidebar + top bar primitives down. After Phase 3 lands, the wizard built here goes from "reachable by URL" to "the auto-flow target for new users."

Pre-flight check before Phase 3: nothing — Phase 2's two new files are additive only.
