# Frontend Redesign — Phase 4 Completion: Component Upgrades

**Plan:** `docs/executing/frontend-redesign.md` §4 Phase 4
**Status:** Shipped
**Diff (7 files):**
- `frontend/src/components/ui/button.tsx` — `focus-visible:` triple replaced with `focus-visible:pearl-ring` (1 string swap)
- `frontend/src/components/app-sidebar.tsx` — hardcoded "C" box replaced with `<Image src="/logo.png" />` (+5 / -3 LOC)
- `frontend/src/components/coming-soon.tsx` — icon backing `bg-muted` → `halftone-bg` (1 char swap)
- `frontend/src/components/coming-soon-harness-card.tsx` — same edit (1 char swap)
- `frontend/src/components/agent-template-card.tsx` — icon backing `bg-primary/10` → `halftone-bg` (composes cleanly with M4 WIP) (1 char swap)
- `frontend/src/app/sign-in/page.tsx` — submit Button gains `variant="pearl"` (+2 / -1 LOC)
- `frontend/src/app/onboarding/page.tsx` — submit Button gains `variant="pearl"` (+5 / -1 LOC)

**Validation:** `pnpm type-check` ✓ · `pnpm lint` ✓ · `pnpm build` ✓ (10/10 routes) · `pnpm dev` boot ✓ (213ms ready) · five live routes return HTTP 200 · sign-in HTML confirmed to ship `pearl-ring`, `class="pearl ...`, `halftone-bg` · `/agents` HTML confirmed to ship `halftone-bg` (no remaining `bg-primary/10`).

---

## 1. What shipped

This is the **second visible visual change** (Phase 3 was the first).
Phase 4 upgrades the chrome on existing surfaces — buttons, focus rings,
sidebar logo box, ambient icon backings — without introducing new
layouts. The redesign is now wired across all four live routes plus the
two coming-soon shells.

### 1.1 `pearl-ring` focus chrome (cross-cutting)

The base CVA classes in `ui/button.tsx` had three focus-visible classes:

```diff
- focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50
+ focus-visible:pearl-ring
```

This is the highest-leverage swap in Phase 4. Every `<Button>` in the
codebase — sidebar nav buttons, sign-in / onboarding submits, coming-soon
"Sign out" buttons, agent-template-card "Deploy" — now shimmers on
keyboard focus. Tab through any page and the active focus state drifts
through pearl. **Decision 20's "every focused interactive element on the
page shimmers"** is real after this swap.

The Phase 1 `.pearl-ring` rule sets `position: relative` on the host
element when the focus state is active (and not before), so the
`::before` pseudo-element's `inset: -4px` correctly anchors to the
button's box during focus and unbinds during blur — no permanent
`position: relative` side-effect.

### 1.2 Sidebar logo

`app-sidebar.tsx` lines 40–42 — the placeholder `<div>` with hardcoded
"C" — is replaced by a 28×28 PNG render:

```diff
- <div className="size-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
-   C
- </div>
+ <Image
+   src="/logo.png"
+   alt="Corellia"
+   width={28}
+   height={28}
+   className="size-7"
+ />
```

The wordmark span next to it stays untouched (decision 28: sidebar
wordmark stays plain — pearl on permanently-visible surfaces would
cause visual fatigue). The 512×512 source asset Phase 3 prepared
downsamples cleanly to 28px in the browser; no separate small-size
asset needed.

### 1.3 Coming-soon backings

Both `coming-soon.tsx` and `coming-soon-harness-card.tsx` had identical
icon-backing styling:

```diff
- <div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
+ <div className="halftone-bg flex size-9 items-center justify-center rounded-md text-muted-foreground">
```

Per decision 30, this encodes blueprint §11.4 visually: deferred features
render as "real machined panels not yet powered on" rather than "broken
UI." The icon glyph color (`text-muted-foreground`) is preserved per the
plan's "icon glyph color unchanged" instruction.

### 1.4 Agent template card icon box

`agent-template-card.tsx` line 34 (currently in M4-WIP-modified live state):

```diff
- <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
+ <div className="halftone-bg flex size-9 items-center justify-center rounded-md text-primary">
```

This is the only Phase 4 edit that touches a file with **uncommitted M4
modifications**. The icon-box edit composes cleanly with M4's separate
edits (the `useState` hook + `DeployModal` import) because they're on
disjoint surfaces — M4 modified imports + render JSX for the deploy
modal; Phase 4 modified one className attribute on a div that exists in
both HEAD and M4 versions. No conflict.

### 1.5 Submit buttons → pearl variant

Sign-in:

```diff
- <Button type="submit">Sign in</Button>
+ <Button type="submit" variant="pearl">
+   Sign in
+ </Button>
```

Onboarding:

```diff
- <Button type="submit" disabled={state.submitting}>
-   {state.submitting ? "Saving…" : "Continue"}
- </Button>
+ <Button
+   type="submit"
+   variant="pearl"
+   disabled={state.submitting}
+ >
+   {state.submitting ? "Saving…" : "Continue"}
+ </Button>
```

Per decision 17, pearl is reserved for **commit actions** — the action
where the user is about to make something happen. Sign-in's submit and
onboarding's "Continue" qualify; "Sign out" (ghost), "Cancel", and
sidebar nav don't get pearl. The dashboard has no commit CTA today
(it's all navigation links), so no Phase 4 pearl-button work landed
there.

---

## 2. The pearl variant + pearl-ring interaction (worth surfacing)

Phase 2 gave the `pearl` variant `relative overflow-hidden` so the
`background-size: 200%` gradient doesn't spill on hover. Phase 1's
`.pearl-ring::before` extends `inset: -4px` outside the host's box.

**Combination effect:** `overflow: hidden` on the host clips the part
of the `::before` ring that falls outside the host's padding box. So
**pearl-variant buttons on focus do not show the drifting ring** — only
the static halo from `.pearl-ring`'s base `box-shadow` (which is *not*
clipped by `overflow: hidden` because shadows render outside the
element's geometry entirely).

**Net result:**
- Default / outline / ghost / secondary / destructive / link variants
  on focus: static halo + drifting ring (full chrome experience).
- Pearl variant on focus: static halo only.

**Defensible read:** the pearl variant is *already* drifting (its
background); adding a second drifting layer on focus would be visual
noise. The static halo distinguishes the focused pearl button from the
unfocused one without doubling the motion budget.

**If we ever want the drifting ring on pearl variants too:** drop
`overflow-hidden` from the variant and migrate the gradient-spill
mitigation to a `mask-image` on the variant itself. Trade-off: more
CSS, less obvious shape. Not worth it in v1; flagged for Phase 5 doc
reviewer.

---

## 3. Decisions deliberately preserved

| Decision | Phase 4 manifestation |
|---|---|
| 7 (pearl on primary CTAs) | sign-in submit · onboarding submit |
| 8 (pearl forbidden on cards / status) | `agent-template-card` keeps the card surface plain; only the icon box gets halftone substrate |
| 13c (sidebar logo image) | 28×28 `next/image` at `size-7`, replaces hardcoded "C" |
| 14 (the "C" box gets removed) | Done; it was a placeholder, now permanently retired |
| 15 (`--primary` semantics unchanged) | `app-sidebar.tsx`'s former `bg-primary` is replaced by an image, not a pearl class — `--primary` is untouched in dark mode and remains gray for badges/avatars |
| 17 (pearl is for commit actions) | Sign-in submit, onboarding submit. **Not on:** "Sign out" (reverse action), "Sign in to existing account" (none), nav items |
| 20 (focus ring becomes pearl) | One swap on the base CVA cascades to every variant |
| 28 (sidebar wordmark stays plain) | The "Corellia" span next to the new logo image is untouched |
| 29 (avatars stay flat) | `ui/avatar.tsx` not touched |
| 30 (coming-soon backings get halftone, not pearl) | Done |
| 31 (template card icon box gets halftone, not pearl) | Done; `text-primary` on the icon glyph stays |

---

## 4. Validation matrix

| Check | Result |
|---|---|
| `pnpm type-check` (with M4 parked) | ✓ Clean |
| `pnpm lint` (with M4 parked) | ✓ Clean (0 errors, 0 warnings) |
| `pnpm build` (with M4 parked) | ✓ 10/10 static pages |
| `pnpm dev` boots | ✓ Ready in 213ms |
| `/sign-in` HTTP 200 | ✓ |
| `/onboarding` HTTP 200 | ✓ |
| `/dashboard` HTTP 200 | ✓ |
| `/agents` HTTP 200 | ✓ |
| `/fleet` HTTP 200 | ✓ |
| `pearl-ring` class in sign-in HTML | ✓ |
| `class="pearl ...` (variant) in sign-in HTML | ✓ |
| `halftone-bg` class in sign-in HTML | ✓ (carried over from Phase 3) |
| `halftone-bg` class in `/agents` HTML | ✓ |
| `bg-primary/10` removed from `/agents` HTML | ✓ |

---

## 5. Validation procedure (M4 parking, repeat of Phase 3's adapted shape)

The procedure surfaced in Phase 3 — park `deploy-modal.tsx` AND swap
`agent-template-card.tsx` for HEAD-shape — was repeated, with one
modification: HEAD-shape `agent-template-card.tsx` was edited in-place
(via `sed`) to receive Phase 4's icon-box swap, so the validation
exercises the *intended* shape rather than the unmodified HEAD.

```bash
# Park M4 WIP files
cp src/components/agent-template-card.tsx /tmp/agent-template-card.wip.tsx
git show HEAD:frontend/src/components/agent-template-card.tsx > /tmp/agent-template-card.head.tsx

# Apply Phase 4's icon-box edit to the HEAD shape
sed -i '' 's|flex size-9 ... bg-primary/10 text-primary|halftone-bg flex size-9 ... text-primary|g' \
  /tmp/agent-template-card.head.tsx
cp /tmp/agent-template-card.head.tsx src/components/agent-template-card.tsx
mv src/components/agents/deploy-modal.tsx /tmp/deploy-modal.tsx.parked

# Run validation matrix (and dev-boot smoke)
pnpm type-check && pnpm lint && pnpm build
PORT=3000 pnpm dev > /tmp/dev.log 2>&1 &
# probe + verify

# Restore M4 WIP files exactly as they were
mv /tmp/deploy-modal.tsx.parked src/components/agents/deploy-modal.tsx
cp /tmp/agent-template-card.wip.tsx src/components/agent-template-card.tsx
```

Restoration verified by re-running `git diff` and confirming the working
tree contains both:
- M4's `import { DeployModal }` on line 14
- Phase 4's `halftone-bg` icon-box class on line 34

---

## 6. M4 dependency surface — status check

The agent-template-card status now reads `MM` (staged + unstaged):
- **Staged:** the M4 mid-flight version (DeployModal import + state hooks +
  `bg-primary/10` original icon box).
- **Working tree:** M4 + Phase 4's `halftone-bg` icon-box swap.

The MM state is honest: M4's spawn-flow Phase 4 work has accumulated a
staged commit candidate that the redesign hasn't been integrated into.
When the spawn-flow plan owner commits their work, the redesign's icon-
box edit will need to either be re-applied to the post-commit shape (one
line) or merged via standard rebase.

**Recommendation reaffirmed from Phase 3:** the spawn-flow plan owner
should commit M4's Phase 4 WIP. The current state is workable for one
more redesign phase (Phase 5 is doc-only and won't touch FE files), but
any subsequent FE work that intersects `agent-template-card.tsx` will
add increasing rebase complexity.

---

## 7. Departures from the plan's literal sketches

Three departures, all noted-and-accepted:

### 7.1 Sidebar logo uses `next/image`, not bare `<img>`

Plan §4 Phase 4 sketched `<img src="/logo.png" className="size-7" />`.
Shipped: `<Image src="/logo.png" width={28} height={28} className="size-7" />`
from `next/image`. Same reasoning as Phase 3 (departure 3.2): Next.js 16
lints bare `<img>` with src; `next/image` provides explicit dimensions
that prevent CLS.

No `priority` flag here because the sidebar logo is below-the-fold on
small viewports and not load-critical above the fold either (the
sidebar collapses on mobile).

### 7.2 The pearl-variant focus state shows static halo, not drifting ring

Documented in §2. Side-effect of the `overflow-hidden` + `inset: -4px`
geometry. Defensible visual outcome; flagged for Phase 5 doc reviewer.

### 7.3 No animated halftone substrate adjustment

The plan §4 Phase 4 implied no halftone tuning was needed; that proved
correct in dev-boot smoke. The 6px density / 0.08 opacity defaults from
Phase 1 read as ambient texture across all surfaces (sign-in, onboarding,
dashboard, agents, fleet, settings, sidebar). No per-route override
needed in v1.

---

## 8. Decisions that were *almost* shipped but weren't

| Almost | Decision | What it would have been |
|---|---|---|
| Pearl on dashboard CTAs ("Browse harnesses", "View fleet") | Deferred | These are navigation links wrapped in `<Button>`, not commit actions. Decision 17: nav doesn't get pearl. Both stay `default` and `outline` |
| Pearl on the agent-template-card "Deploy" / "Deploy 5" buttons | Deferred to spawn-flow Phase 4 (M4) | The plan §32 says "When M4 wires it, the button uses the `pearl` variant; the 'Deploy 5' button uses `outline`." That edit lives with M4's commit, not the redesign's |
| Removing the `app-top-bar.tsx` `bg-primary` from the avatar | Decision 29 forbids it | Avatar stays `bg-primary` — "this is you" is semantic identity, not chrome |
| Adding `halftone-bg` to the dashboard hero card icon boxes | Out of scope | The dashboard hero cards (`SparklesIcon` and `BoxIcon` boxes on `dashboard/page.tsx`) use `bg-muted` — the same backing the coming-soon icons just got upgraded from. Could plausibly land in a polish pass; flagged for Phase 5 review |
| Pearl on the dashboard "Welcome back" subtitle | Decision 8 | Subtitle is body text; pearl forbidden |

---

## 9. Hand-off to Phase 5

Phase 5 is **doc-only** — `docs/refs/design-system.md` rewritten in
place. No FE code changes. The doc rewrite must capture five things
landed in Phases 1–4 that didn't exist when the doc was written:

1. **The pearl/halftone material vocabulary** — Phase 1's CSS tokens +
   classes, Phase 2's primitives.
2. **The pearl variant on `Button`** — replace §13.1's "Primary Button
   (Terminal Green)" with a pearl example.
3. **The two-material model** — new §29.X explicit substrate vs chrome
   table.
4. **The departures Phases 1–4 took from the plan's literal sketches** —
   most notably the gradient centralization (Phase 1.3.1), the
   `next/image` adoption (Phase 3.3.2 and 4.7.1), the inline-styled
   vignette (Phase 3.3.4), and the pearl-variant focus state outcome
   (Phase 4.2 + 4.7.2).
5. **The `<TerminalContainer>` + `<StatusDot>` ship-without-consumer
   note** — they're available for M4's UI half from line 1.

Phase 5 should also reconcile:
- Dashboard H1 weight (`font-semibold` shipped vs plan's `font-bold`).
- The pearl-variant focus-state design (static halo only).
- The 355 KB logo size and the WebP follow-up path.

---

## 10. Risk register revisits

| # | Risk | Phase 4 evidence |
|---|---|---|
| 1 | Pearl reads as Y2K Winamp | Phase 3 deferred user verdict; Phase 4 added more pearl surfaces (focus rings on every button, sign-in / onboarding submit drifts). Aesthetic verdict still deferred to manual review |
| 2 | Animation jank | Dev-boot remained 213ms ready; no Lighthouse/perf probe in this phase |
| 6 | Contributor adds pearl to forbidden surface | Phase 4 narrowly avoids this on dashboard nav buttons; the discipline held |
| 7 | Logo PNG bloat | 355 KB still served; sidebar 28px render is well-sized vs source. WebP follow-up still queued |
| 8 | M4 reinvents primitives | `agent-template-card.tsx` MM state continues; recommendation to commit M4 WIP reaffirmed |
| **NEW: 11** | **Pearl variant focus state shows static halo only** | Documented in §2. Acceptable v1 outcome; Phase 5 may revisit if reviewer sees friction |

---

## 11. Files touched

```
frontend/src/components/ui/button.tsx              ~  /  ~   (1 string swap)
frontend/src/components/app-sidebar.tsx            +5 / -3
frontend/src/components/coming-soon.tsx            +1 / -1
frontend/src/components/coming-soon-harness-card.tsx +1 / -1
frontend/src/components/agent-template-card.tsx    +1 / -1   (composes with M4 WIP)
frontend/src/app/sign-in/page.tsx                  +2 / -1
frontend/src/app/onboarding/page.tsx               +5 / -1
                                                   ────────────
                                                   7 files, ~16 net LOC change
```

The redesign's visible-surface work is now complete. Phase 5 is
doc-only — no further FE code changes are planned for this redesign.
The next phase brings `design-system.md` into alignment with what
Phases 1–4 actually shipped, and the redesign milestone closes.
