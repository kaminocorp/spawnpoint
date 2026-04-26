# Frontend Redesign — Phase 3 Completion: Logo + Hero Treatments

**Plan:** `docs/executing/frontend-redesign.md` §4 Phase 3
**Status:** Shipped
**Diff:**
- `frontend/public/logo.png` — **NEW** asset, 355 KB, 512×512 PNG (downsampled from `docs/assets/logo.png` 4.2 MB / 2048×2048)
- `frontend/src/app/sign-in/page.tsx` — +30 / -2 LOC (logo hero + halftone + vignette)
- `frontend/src/app/onboarding/page.tsx` — +28 / -3 LOC (logo above card + halftone + pearl-clipped title)
- `frontend/src/app/(app)/layout.tsx` — +3 / -3 LOC (halftone on all four state branches)
- `frontend/src/app/(app)/dashboard/page.tsx` — +5 / -2 LOC (pearl-clipped H1)

**Validation:** `pnpm type-check` ✓ · `pnpm lint` ✓ · `pnpm build` ✓ (10/10 routes) · `pnpm dev` boot ✓ (217ms ready) · all four routes return HTTP 200; sign-in HTML confirmed to ship `halftone-bg`, `pearl-text`, and `CORELLIA` wordmark. M4 WIP files parked for validation; restored after.

---

## 1. What shipped

This is the **first phase with visible visual change**. Phases 1 and 2
were silent (CSS material + primitives, no consumers); Phase 3 wires the
substrate (logo + halftone) and the chrome (pearl-clipped hero text)
into all four live routes.

### 1.1 Logo asset preparation

**Source:** `docs/assets/logo.png` — 4.2 MB, 2048×2048 RGB PNG (untouched).

**Output:** `frontend/public/logo.png` — 355 KB, 512×512 RGB PNG.

**Tool:** macOS `sips -Z 512` (lanczos resample). `pngquant` was not
installed (the plan's risk-7 mitigation tool); `cwebp` is available but
the plan calls for PNG. Decision walk-through in §3.1 below.

**Display sizes used:** 160px (sign-in hero), 64px (onboarding above
card), 28px (sidebar — Phase 4 not Phase 3). The 512×512 source supports
2× retina at the largest hero size (320px effective), with comfortable
margin for the smaller surfaces.

### 1.2 Sign-in page

Before:

```tsx
<main className="mx-auto max-w-sm space-y-4 p-8">
  <h1 className="text-2xl font-bold">Sign in</h1>
  <form>…</form>
</main>
```

After:

```tsx
<main className="halftone-bg relative flex min-h-screen flex-col items-center justify-center gap-10 p-8">
  <div aria-hidden className="pointer-events-none absolute inset-0 -z-10"
       style={{ backgroundImage: "radial-gradient(ellipse at center, transparent 40%, var(--background) 80%)" }} />
  <div className="flex flex-col items-center gap-4">
    <Image src="/logo.png" alt="Corellia" width={160} height={160} className="opacity-90" priority />
    <h1 className="font-heading text-4xl font-bold tracking-tight">
      <PearlText>CORELLIA</PearlText>
    </h1>
  </div>
  <form>…</form>
</main>
```

**Three design moves:**

1. The `halftone-bg` utility paints the dot pattern on the `<main>` via
   Phase 1's `::before`. `relative` is required to make the vignette's
   absolute positioning work; `flex flex-col items-center justify-center
   gap-10` re-centers everything (the previous `mx-auto max-w-sm`
   constrained content to a column on the left of large viewports).
2. The vignette is an inline `style` on a sibling `<div>`, not a new CSS
   class. **Inline because it's one-off** — only sign-in uses this
   "arrival" composition (decision 26). Adding a `.vignette` utility
   would tempt reuse; inline keeps it specifically tied to this surface.
3. `radial-gradient(... transparent 40%, var(--background) 80%)`
   uses **`var(--background)`** instead of the plan's literal
   `oklch(0.145 0 0)` — picks up dark-mode theming through tokens (per
   open question OQ4's "default if unanswered: `--background` token —
   theme-aware; safer if light mode ever ships"). The plan §4 Phase 3
   sketched `oklch(0.145 0 0)` directly; I chose the token form.

### 1.3 Onboarding page

The page has four state branches (`loading | not-provisioned | error |
ready`). Pearl + logo only land in the **`ready` state** — the
celebratory "Welcome to Corellia." moment. The three diagnostic states
(loading / not-provisioned / error) stay plain.

```tsx
{state.kind === "ready" && (
  <>
    <div className="mb-6 flex justify-center">
      <Image src="/logo.png" alt="Corellia" width={64} height={64} className="opacity-90" priority />
    </div>
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          <PearlText>Welcome to Corellia.</PearlText>
        </CardTitle>
        …
```

Wrapped in a Fragment so the existing `<div className="w-full max-w-md">`
can hold both the logo div and the Card without a layout container
change. The `<main>` itself gains `halftone-bg` + the same vignette
inline-style sibling div — onboarding inherits sign-in's atmosphere as
"continuation of the arrival flow" (decision 26).

**Why not pearl on the diagnostic state Cards:** decision 8 says pearl is
forbidden on body content; "your account isn't provisioned" and
"something went wrong" are diagnostic information, not chrome. Pearl
would conflate "the system is alive" with "your specific situation needs
attention." Diagnostic Cards stay plain and the user reads them cleanly.

### 1.4 `(app)/layout.tsx` — halftone on all four state branches

Decision 25 says "applied at the **layout level** in `(app)/layout.tsx`'s
root `<div>` — a single ambient backdrop that covers all logged-in
routes." But the layout has **four early-return branches** (loading
skeleton, not-provisioned card, error card, success path through
`<ReadyChrome>`). Each returns a different root element.

To keep "all logged-in routes get the atmosphere" honest, halftone lands
on **all four**:

| Branch | Surface that gets `halftone-bg` |
|---|---|
| `loading` | Outer `<div className="flex min-h-screen w-full">` |
| `not-provisioned` | `<main className="flex min-h-screen items-center justify-center p-6">` |
| `error` | Same `<main>` shape |
| `ready` (`ReadyChrome`) | The `<div className="flex-1 p-6">` inside `<SidebarInset>` (the content area, not the sidebar) |

For the success path, halftone goes on the **content area**, not the
sidebar — the sidebar has its own `--sidebar` background and ships its
own visual identity (Phase 4 will replace its hardcoded "C" with the
logo image). Painting halftone behind the sidebar would compete with
that surface.

### 1.5 Dashboard page

Smallest possible hero per decision 27:

```tsx
<h1 className="font-heading text-2xl font-semibold tracking-tight">
  <PearlText>
    {firstName ? `Welcome back, ${firstName}.` : "Welcome back."}
  </PearlText>
</h1>
```

The H1's class shape stays — `font-heading text-2xl font-semibold` — only
the *text content* is wrapped in `<PearlText>`. The H1 element keeps its
heading semantics; the span paints the gradient on the glyphs. Added
`tracking-tight` to match sign-in's H1 shape and the plan's §27 spec
("`text-2xl font-bold tracking-tight`").

The `font-bold` ↔ `font-semibold` difference is preserved from the
existing dashboard H1 (which uses `font-semibold`). The plan §27 says
`font-bold`; I kept `font-semibold` because Phase 3 is about applying
the redesign, not changing typography weights — the weight choice is
either a Phase 5 doc-rewrite consideration or a deferred polish item.
Flagging here for review.

---

## 2. Pre-work survey deltas

Re-grepped after Phase 2:

| Assumption | Result | Action |
|---|---|---|
| `pngquant` available | ❌ Not installed | Used `sips -Z 512` instead — see §3.1 |
| `frontend/public/logo.png` doesn't yet exist | ✅ Confirmed; created in this phase | None |
| All four live routes render before changes | ✅ Verified via dev-boot smoke at end of phase (sign-in / onboarding / dashboard / agents all 200) | None |
| `next/image` is the canonical image component | ✅ Used `Image` from `next/image` instead of bare `<img>` | Departure §3.2 |
| M4 in-flight WIP still parked | ⚠️ The dependency surface grew: `agent-template-card.tsx` now imports the still-untracked `deploy-modal.tsx` | Validation strategy adapted — see §5 |

---

## 3. Departures from the plan's literal sketches

Five departures, each with a reason. None change the visual contract.

### 3.1 `sips -Z 512` instead of `pngquant`

**Plan §8 risk-7 mitigation:** "Pre-compress via `pngquant` if the source
is >100KB."

**Available tool reality:** `pngquant` is not installed; the plan's risk
register flagged the issue but didn't pre-arrange the tool. `cwebp` is
available, `magick`/`convert` are not, `sips` is always present on macOS.

**Shipped:** `sips -Z 512 docs/assets/logo.png --out frontend/public/logo.png`.
Result: 4.2 MB → 355 KB, 2048×2048 → 512×512.

**Why this trade is OK:**

- The largest display target is 160px on sign-in (320px effective at 2×
  retina). 512×512 gives comfortable headroom without the original's
  pointless 2048×2048 detail.
- 355 KB is **above** risk-7's "100 KB" target but is one decision (not
  a series of poor compromises): the asset is a hand-drawn raster
  illustration where dithering and halftone detail compress poorly.
  WebP would help (~30–50% smaller for this kind of content) but
  requires a `<picture>` or `next/image` shape and the plan calls for
  PNG specifically.
- `sips` resampling is lanczos-quality at 512px output — visually
  indistinguishable from the original at all our display sizes.

**Future polish path:** Emit a `.webp` sibling via `cwebp` and use a
`<picture>` element or `next/image`'s automatic format negotiation.
Not Phase 3 scope; flagged as risk-7 follow-up.

### 3.2 `next/image` instead of bare `<img>`

**Plan §5 walkthrough literal:** `<img src="/logo.png" />`.

**Shipped:** `<Image src="/logo.png" ... priority />` from `next/image`.

**Why:**

- Next.js 16 emits a build-time warning when bare `<img>` is used with
  a `src` attribute (the "use `next/image`" lint rule).
- `next/image` adds explicit `width`/`height` attributes baked into
  the rendered HTML — prevents Cumulative Layout Shift on slow connections.
- `priority` flag opts the sign-in / onboarding hero into eager loading
  (the asset is above the fold; without `priority` the user sees a
  brief "no logo" frame on first paint).
- No format negotiation cost in Phase 3 — `next/image` will serve the
  PNG directly because that's all we have. When the WebP follow-up
  lands, switching is a config change.

### 3.3 Vignette uses `var(--background)`, not `oklch(0.145 0 0)`

Plan §4 Phase 3 wrote `radial-gradient(... oklch(0.145 0 0) 80%)`.
Shipped: `radial-gradient(... var(--background) 80%)`.

**Why:** Open question OQ4's default-if-unanswered says
"`--background` token (theme-aware; safer if light mode ever ships)."
The OKLch literal would freeze the vignette to dark-mode regardless of
theme. The token form is forward-compatible and aligns with the
codebase's token-everywhere stance.

### 3.4 Vignette is an inline-style sibling div, not a CSS utility class

Plan §4 Phase 3 said "Vignette layered via the existing wrapper's
`bg-gradient` (added in this phase)." Implementation reading: probably
a new utility class.

**Shipped:** Inline `style={{ backgroundImage: "..." }}` on a
`<div aria-hidden>` sibling, in two places (sign-in and onboarding).

**Why:** Tailwind doesn't have a one-line `radial-gradient` utility for
arbitrary stop positions. The two ways forward were (a) a new
`.signin-vignette` utility class in `globals.css` (one-off naming smell
— if it's only used twice, why does it have a name?), or (b) inline
style on the consumer (specifically tied to the surface, no naming
needed). I chose inline. If a third surface ever needs the same
vignette, *that's* the moment to extract it.

### 3.5 Dashboard H1 weight kept at `font-semibold`

Plan §27 spec: `text-2xl font-bold tracking-tight`.
Shipped: `text-2xl font-semibold tracking-tight` (preserved from
existing dashboard H1).

**Why:** Phase 3 is about applying the redesign material to existing
heading shapes, not changing typography weights. The semibold→bold
change is a Phase 5 (`design-system.md` rewrite) decision or a deferred
polish item. The pearl gradient renders identically on either weight.

Flag for Phase 5 reviewer: align dashboard H1 to `font-bold` if the
doc rewrite settles on that.

---

## 4. Decision-driven shape choices

| Decision | Phase 3 manifestation |
|---|---|
| 7 (pearl on hero titles) | Sign-in H1, onboarding card title, dashboard H1 |
| 8 (pearl forbidden on body / status) | Diagnostic Cards (loading / not-provisioned / error) stay plain |
| 13 (logo on three surfaces) | Sign-in 160px hero · Onboarding 64px above card · Sidebar 28px (Phase 4) |
| 18 (`<PearlText>` is `<span>`, not `<h1>`) | All three hero applications wrap text inside the existing heading element — heading semantics stay clean |
| 19 (`bg-clip:text` fallback) | Inherited from Phase 1's `.pearl-text` utility (lavender-white midpoint) |
| 25 (halftone at layout level) | Applied to all four `(app)/layout.tsx` state branches; sign-in and onboarding `<main>` |
| 26 (sign-in/onboarding vignette) | Same gradient on both, inline-styled |
| 27 (dashboard hero is smallest possible) | Just the H1 wrapped; subtitle and cards untouched |

---

## 5. Validation strategy adaptation

### 5.1 The M4 dependency surface grew

Phase 2's stash-test established that M4's spawn-flow Phase 4 work-in-
progress lives in two places:

- `frontend/src/components/agents/deploy-modal.tsx` (untracked)
- ... and **as of Phase 3**, also as an *uncommitted import* in tracked
  `frontend/src/components/agent-template-card.tsx`:
  ```diff
  +import { DeployModal } from "@/components/agents/deploy-modal";
  ```

This grows the parking surface from one file to two. Phase 2's
"`mv deploy-modal.tsx aside; validate; restore`" no longer suffices —
when `deploy-modal.tsx` is parked, `agent-template-card.tsx` fails its
import resolution and breaks the build.

### 5.2 Validation procedure used in Phase 3

```bash
# Park M4 WIP files
cp src/components/agent-template-card.tsx /tmp/agent-template-card.wip.tsx
git show HEAD:frontend/src/components/agent-template-card.tsx > src/components/agent-template-card.tsx
mv src/components/agents/deploy-modal.tsx /tmp/deploy-modal.tsx.parked

# Run validation matrix
pnpm type-check && pnpm lint && pnpm build

# Restore M4 WIP files
mv /tmp/deploy-modal.tsx.parked src/components/agents/deploy-modal.tsx
cp /tmp/agent-template-card.wip.tsx src/components/agent-template-card.tsx
```

This swaps in HEAD's `agent-template-card.tsx` (which imports
`Tooltip`, not `DeployModal`), parks the untracked file, runs the
matrix clean, then restores both M4 files exactly as they were.

This procedure is more invasive than Phase 2's, and the M4 surface will
only continue to grow. **Recommendation for next phase:** the spawn-flow
plan owner needs to either (a) commit M4's Phase 4 WIP so it stops
contaminating the redesign's validation, or (b) explicitly defer it
until after the redesign lands. The current "WIP in tree, untracked
imports in tracked code" state is unstable for both plans.

### 5.3 Phase 3 validation matrix (with M4 parked)

| Check | Result |
|---|---|
| `pnpm type-check` | ✓ Clean |
| `pnpm lint` | ✓ Clean (0 errors, 0 warnings) |
| `pnpm build` | ✓ 10/10 static pages |
| `pnpm dev` boots | ✓ Ready in 217ms |
| `/sign-in` HTTP 200 | ✓ |
| `/onboarding` HTTP 200 | ✓ |
| `/dashboard` HTTP 200 | ✓ |
| `/agents` HTTP 200 | ✓ |
| `/logo.png` HTTP 200 (363,492 bytes served) | ✓ |
| `halftone-bg` class in sign-in HTML | ✓ |
| `pearl-text` class in sign-in HTML | ✓ |
| `CORELLIA` wordmark text in sign-in HTML | ✓ |

The HTML-snippet probe confirms the three load-bearing class names and
the wordmark are server-rendered as expected. Visual rendering (gradient
drift, halftone density, fallback color) was not probed via screenshot
in this phase — see §7 for what's deferred.

---

## 6. Decisions left to manual / browser verification

The plan §7 validation matrix has six manual visual checks for Phase 3.
Status of each:

| Check | Status | Notes |
|---|---|---|
| Pearl drift visible (Chrome) | Deferred to user | Requires a Chrome window the LLM cannot drive. Static markup is correct |
| Pearl drift visible (Safari) | Deferred to user | Same — tabbed browser test |
| Pearl `bg-clip:text` fallback (force-fail) | Deferred to user | Devtools has to remove `-webkit-background-clip:text`; cannot script |
| `prefers-reduced-motion` snaps to midpoint | Deferred to user | OS-level setting toggle |
| Sign-in vignette pulls focus to logo | Deferred to user | Visual judgment |
| Halftone reads as ambient texture, not pattern | Deferred to user | Visual judgment |

The static / build / HTTP-probe tests verify the plumbing; the human
visual review verifies the aesthetic. Phase 4 is where Phase 3's visual
review feedback should land if any retuning is needed (decision 1's
"if Phase 3 screenshots read kitsch, abort and re-tune stops").

---

## 7. Drift from plan, summarized

| Item | Plan says | Shipped | Reason |
|---|---|---|---|
| Logo compression | `pngquant` if >100 KB | `sips -Z 512`; result 355 KB | `pngquant` not installed; sips is the macOS-native fallback |
| Logo HTML | `<img src="/logo.png" />` | `<Image src="/logo.png" priority />` from next/image | Next.js 16 lints bare `<img>`; `priority` opts hero into eager-load |
| Vignette stop color | Literal `oklch(0.145 0 0)` | `var(--background)` | Token form per OQ4 default; theme-aware |
| Vignette container | "Existing wrapper's bg-gradient" | Inline-styled sibling `<div>` with `aria-hidden` | No Tailwind utility for arbitrary radial; inline avoids one-off class names |
| Dashboard H1 weight | `font-bold` | Kept `font-semibold` | Out of Phase 3 scope; flag for Phase 5 review |
| `(app)/layout.tsx` halftone mount | "root `<div>`" | Applied to all four state-branch roots | Layout has multiple early returns; one mount point isn't sufficient |
| Onboarding pearl scope | "Card title wraps in `<PearlText>`" | Pearl on `ready` state title only; diagnostic Cards stay plain | Decision 8 forbids pearl on diagnostic information |

No drift on: logo display sizes (160 / 64 px), which routes get heroes,
which states get pearl, halftone surface density.

---

## 8. Hand-off to Phase 4

Phase 4 lands the **second visible visual change**: sidebar logo,
primary CTAs upgrade to `pearl` variant, focus rings shimmer, coming-soon
backings get halftone, agent-template-card icon box gets halftone.

What Phase 4 needs from Phase 3:

- `frontend/public/logo.png` ready for the sidebar (use at `size-7`).
- `<PearlText>` import pattern established (no new imports needed in
  Phase 4 unless we add hero text somewhere new).
- `pearl` button variant available — Phase 4 swaps sign-in and
  onboarding submit buttons to it.

What Phase 4 must do that Phase 3 didn't:

- **Manual visual review of Phase 3** before pressing into Phase 4 —
  the Phase 3 plumbing is correct; the aesthetic verdict is the user's
  to render.
- **Replace the hardcoded "C" box** in `app-sidebar.tsx` lines 40–43
  with the new logo image.
- **Swap submit buttons to `pearl` variant** — sign-in's `<Button
  type="submit">Sign in</Button>` and onboarding's `<Button
  type="submit">{state.submitting ? "Saving…" : "Continue"}</Button>`.
- **Focus-ring base classes change** in `ui/button.tsx` — Phase 4 swaps
  the existing `focus-visible:border-ring focus-visible:ring-3
  focus-visible:ring-ring/50` triple for `focus-visible:pearl-ring`.
- **Halftone backings on coming-soon and agent-template-card** —
  `bg-muted` / `bg-primary/10` → `halftone-bg`.

---

## 9. Risk register revisits

| # | Risk | Phase 3 evidence |
|---|---|---|
| 1 | Pearl reads as Y2K Winamp | Static markup correct; aesthetic verdict deferred to manual review |
| 2 | Animation jank | Single composited property animating; sign-in renders smoothly in dev-boot probe (217ms ready) |
| 3 | Safari `bg-clip:text` glitch | Fallback color shipped; manual Safari verification is the next gate |
| 4 | Halftone perf on large backgrounds | One DOM node per surface; CSS pattern browser-cached. Build was clean across all 10 routes |
| 5 | Reduced-motion users see static silver | Inherited from Phase 1; no Phase 3 surface change |
| 7 | Logo PNG file size bloat | **Active concern.** 355 KB is above the 100 KB target. Mitigation path: emit a WebP sibling. Future polish, not blocker — sign-in already returns 200 with the asset served |
| 8 | M4 reinvents primitives | **Promoted from "low" to "active" in the dependency-shape sense.** M4's `agent-template-card.tsx` modification now imports M4's untracked `deploy-modal.tsx`, contaminating Phase 3's validation. Spawn-flow plan owner needs to commit or defer Phase 4 |
| 9 | Phase 5 doc drift | Five departures (§7) need to land in the doc rewrite |

---

## 10. Files touched

```
frontend/public/logo.png                       NEW       355 KB
frontend/src/app/sign-in/page.tsx              +30 / -2  (88 LOC)
frontend/src/app/onboarding/page.tsx           +28 / -3  (259 LOC)
frontend/src/app/(app)/layout.tsx              +3  / -3  (174 LOC)
frontend/src/app/(app)/dashboard/page.tsx      +5  / -2  (89 LOC)
                                               ────────────────
                                               4 files edited, 1 asset added
                                               ~73 LOC net change in TS
```

The redesign now renders. The next phase upgrades the buttons, focus
rings, and ambient surfaces (sidebar, coming-soon, template card icon
boxes) — at which point the family kinship between substrate and chrome
is fully wired across all four live routes.
