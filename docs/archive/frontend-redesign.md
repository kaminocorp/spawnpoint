# Plan — Frontend redesign: pearlescent chrome × halftone substrate

**Status:** draft, awaiting approval
**Owner:** TBD
**Supersedes:** — (parts of `docs/refs/design-system.md` will be rewritten as Phase 5; this plan is the rewrite's authority)
**Related:**
- `docs/refs/design-system.md` (current visual contract — this plan retires its "brand green is primary" stance and introduces a two-material model)
- `docs/vision.md` §"admin/policy-setter model" (informs the "operator running complex systems" framing)
- `docs/blueprint.md` §11.4 (deferred features stub as real interfaces — applies to UI: `/fleet` and `/settings` `ComingSoon` shells stay as real grayed-out surfaces, not disabled buttons)
- `docs/blueprint.md` §10 (RPG character creation — the spawn flow is where this redesign's chrome motif will be most load-bearing once M4 ships its UI half)
- `docs/executing/spawn-flow.md` §2 decision 31 + 38 (status-badge color rules + deploy modal — both must be written *to* the new system from line 1, not retrofitted)
- `docs/changelog.md` §0.3.0 (the current FE shell — sign-in → onboarding → dashboard → catalog), §0.4.0 (the `/agents` catalog and `AgentTemplateCard`)
- `README.md` (the halftone/ASCII/isometric pixelart logo at `docs/assets/logo.png` — the substrate this redesign builds against)

---

## 1. Objective

Replace the frontend's current "shadcn neutral OKLch grayscale" visual identity with a **two-material design language**:

- **Substrate** — the Kamino-shared monochrome illustration grammar: black background, white halftone / ASCII / dithered pixelart illustration, hand-constructed feel. Anchors family kinship; carries thematic weight ("operators of machined systems"). Already embodied by `docs/assets/logo.png`; absent from live UI today.
- **Chrome** — Corellia-distinct pearlescent material: a slow-drifting, low-saturation iridescent gradient (silver / pearl / pale steel-blue / cool lavender), animated on a 20–40s cycle. The single "alive" visual register; the surface that signals "this system is running" without any other moving parts.

The two materials cover **different surfaces** and never overlap on the same element: substrate is illustration + atmospheric backdrop; chrome is logo wordmark, primary CTAs, focus rings, hero text. **Everything else stays monochrome** — terminal containers in gray-600 hairlines, body type in white/gray, status indicators in flat semantic colors (green for `RUNNING`, red for `FAILED`, gray for `STOPPED` — chrome and semantics are decoupled by design).

The redesign also reconciles three doc-vs-code drifts surfaced by the pre-work survey:

1. `design-system.md` describes a green-dominant system; live code has **zero green** — the OKLch tokens are pure neutrals (chart hues aside). The redesign embraces the monochrome reality and adds pearl as the only active register.
2. `design-system.md` claims shadcn New York style; `components.json` shows `"style": "base-nova"`. Doc updated to match.
3. `design-system.md` documents HSL CSS custom properties; live `globals.css` uses OKLch + Tailwind 4 `@theme inline`. Doc updated to match.

### What this redesign delivers concretely

1. **Two new CSS material primitives** in `globals.css` — `.pearl` (animated gradient, drift keyframes, `prefers-reduced-motion` fallback) and `.halftone-bg` (tileable noise/halftone overlay used for atmospheric backgrounds). Plus a small set of new OKLch tokens (`--pearl-stop-{1..5}`, `--pearl-drift-duration`).
2. **Five touched components** — `app-sidebar.tsx` (logo box), `app-top-bar.tsx` (avatar + brand wordmark), `agent-template-card.tsx` (icon box, "Deploy" CTA when wired), `ui/button.tsx` (a new `pearl` variant for primary CTAs without changing the existing `default`), `ui/avatar.tsx` (badge backing).
3. **Three new shared components** — `<PearlText>` (the wordmark / hero-title primitive), `<TerminalContainer>` (the signature `border-2 border-gray-600` + `[ BRACKETS ]` panel; ships unused but ready for `/fleet` and `/spawn`), `<StatusDot>` (semantic-color pulse-dot primitive; ships ready for M4's fleet table).
4. **Logo asset wired into the FE** — `docs/assets/logo.png` copied to `frontend/public/logo.png`, surfaced on sign-in, onboarding, and dashboard heroes as the monochrome anchor that establishes the substrate visually before any chrome appears.
5. **Per-route hero treatments** — sign-in, onboarding, and dashboard each get a single pearl wordmark + halftone backdrop; the four live routes (`/sign-in`, `/onboarding`, `/dashboard`, `/agents`) all read as one product family afterward.
6. **`design-system.md` rewritten** — the existing 2032-line doc is updated in place: §5.3 splits into "Brand Pearl + Semantic Green," new §5.X "The Pearlescent Material," new §5.Y "The Halftone Substrate," new §29.X "The Two Material Layers," §1 reframed from "Mission Control × Deep Space" to **"Mission Control × Deep Space, with pearlescent chrome on monochrome substrate."** All HSL → OKLch; "New York" → "base-nova"; brand-green claims downgraded to "semantic green only."

### What this redesign does *not* deliver

- **No spawn-modal UI work.** `docs/executing/spawn-flow.md` owns that; this plan ships the *primitives* (`<PearlText>`, `<TerminalContainer>`, `<StatusDot>`, the `pearl` button variant, the status-color rules) so M4's UI half consumes them from line 1 instead of building its own.
- **No new routes.** `/fleet` and `/settings` stay as `ComingSoon` shells; their redesign is just the new ComingSoon visual treatment.
- **No font swap to Space Mono yet.** The existing Geist Sans + Geist Mono stack stays. Space Mono is a future addition (Phase 5 doc-update flags it as deferred); introducing it requires `next/font/google` config + a new `--font-space-mono` token + audit of which surfaces switch. Out of scope for this plan; the chrome-vs-substrate primitives don't depend on it.
- **No light-mode pearl.** Pearl renders against `oklch(0.145 0 0)` dark substrate only. Light mode tokens stay as shadcn defaults; the chrome variant gracefully no-ops to the existing `default` button in light mode (we're dark-first per `design-system.md` §12).
- **No iridescent color picker / theming UI.** The pearl gradient stops are tuned once, locked in tokens, not user-configurable.
- **No motion when JavaScript is disabled.** The drift animation is pure CSS; it works without JS. But the `useReducedMotion` JS hook for component-level decisions (e.g., disabling the per-step glow in spawn flow) is post-redesign polish.

---

## 2. Decisions locked

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | The two-material model | **Substrate = monochrome halftone illustration + atmospheric grids; Chrome = pearlescent shine.** The two never overlap on the same element — chrome paints chrome surfaces, substrate paints background and illustration. Body content (text, terminal containers, status indicators, semantic colors) is monochrome and lives between the two | This is the load-bearing structural decision. The materials protect each other from kitsch: halftone keeps pearl honest (machined-hardware framing); pearl keeps halftone from feeling retro (alive-system framing). Without the separation we get either Y2K Winamp or a graveyard of zines |
| 2 | Pearl is *not* a Tailwind color | The pearlescent gradient is a CSS class (`.pearl`, `.pearl-text`) and a `pearl` button variant — never a token like `bg-pearl-500` | Iridescence isn't a hue, it's a *surface*. Encoding it as a Tailwind shade tempts contributors to write `text-pearl-300` or `border-pearl-500/30`, which don't render the gradient — they'd render a static midpoint color, and the result would look like dull silver on a slightly-dimmer background. The class form forces "use the material correctly or don't use it" |
| 3 | Pearl gradient stop count | **5 stops** — near-white `oklch(0.95 0.01 250)`, cool silver `oklch(0.82 0.02 240)`, warm pearl `oklch(0.85 0.015 70)`, steel blue `oklch(0.78 0.025 250)`, lavender white `oklch(0.92 0.01 290)` | 5 stops gives perceivable hue-drift across the gradient without crossing into "rainbow" territory. The hues span ~220° of the OKLch chromaticity wheel (250 → 70 → 290), all at low chroma (≤0.025) so the saturation reads as a pearl tint, not a saturated color. Picked in OKLch (not HSL) so each stop has roughly equal *perceptual* lightness — uniform brightness across the gradient is what reads as "polished surface" rather than "rainbow ramp" |
| 4 | Drift duration | **Default 28s; configurable via `--pearl-drift-duration` CSS variable.** Linear `background-position` interpolation, `ease-in-out` timing function | Slow enough that no single user session ever sees a full cycle (typical session is 5–15 minutes; 28s is below the conscious-loop-detection threshold but above the "screensaver" feel). Apple's visionOS environments cycle on the order of minutes; we're tighter because chrome is a smaller surface than a wallpaper. The CSS variable is the per-component tuning knob (e.g., the deploy-launch CTA might temporarily run at 8s during the click→spawn animation, then decay back) |
| 5 | Drift direction | `background-size: 200% 200%`; `background-position` animates from `0% 50%` → `100% 50%` → `0% 50%` | Horizontal drift only. Vertical or diagonal drift adds visual complexity without adding signal — chrome should look like *one* surface gently moving, not a roiling sea. The 200% size means the visible 100% window slides through the gradient at half-resolution, which makes the visible drift smooth rather than abrupt at the loop point |
| 6 | Reduced-motion fallback | `@media (prefers-reduced-motion: reduce) { .pearl, .pearl-text { animation: none; background-position: 50% 50%; } }` — render the static midpoint of the gradient | The static midpoint is the most "neutral" composition (warm pearl with cool flanks); it reads as a premium silver still image. Disabling the animation entirely without snapping to a fixed position would leave the gradient at whatever offset it was at when the user toggled the OS setting — non-deterministic. Snap to midpoint is the deterministic answer |
| 7 | Where pearl is allowed | **Only on chrome surfaces:** logo wordmark, hero titles (sign-in / onboarding / dashboard), primary CTAs (the `pearl` button variant), focus rings (`.pearl-ring`), the active step glow in spawn flow (post-M4) | Anything outside this list is wrong. This list is *enforced* by the absence of a Tailwind color (decision 2): the only path to pearl is one of the named primitives or classes |
| 8 | Where pearl is forbidden | **Status indicators (semantics), body text (legibility), terminal container borders/fills (would compete with the brutalist skeleton), feature wayfinding tints (cyan/violet/blue/rose stay flat), shadcn `Card` backgrounds (cards are content surfaces, not chrome)** | Each forbidden surface has a specific reason. Most load-bearing: status indicators stay flat semantic colors so motion = aliveness on the dot is uncorrupted by motion = chrome on the surface beneath it |
| 9 | Semantic green is preserved | `RUNNING`, `SPAWNING` use `bg-green-400 animate-pulse` exactly as `design-system.md` §35 specifies. **Pearl never replaces semantic colors anywhere.** | This is the inverse of the chrome rule. Chrome is brand identity; semantic colors are information. Conflating them makes both unreadable |
| 10 | Halftone substrate format | A single PNG asset at `frontend/public/logo.png` (copied from `docs/assets/logo.png`) for the logo, plus a **CSS-generated halftone pattern** (radial-gradient dot grid via `background-image`) for atmospheric backdrops where the survey's `schematic-grid` would otherwise sit. The CSS halftone is monochrome white-on-black, low opacity (`/10` to `/20`) | Two delivery formats because the use-cases differ: the logo is a hand-crafted illustration that has to ship as raster (no CSS recreates that); the atmospheric halftone is a tileable pattern that doesn't need a fixed image and benefits from being scalable + lightweight. Both register as the same family because both render as *dot patterns of black and white* — the eye reads them as the same material |
| 11 | Halftone CSS form | `radial-gradient(circle at center, white 0.5px, transparent 1px)` with `background-size: 6px 6px` and `opacity: 0.08` — applied via a `.halftone-bg` utility class | A 6×6px grid of 1px dots gives ~3% white-pixel density at full opacity; multiplied by the `0.08` opacity that's ~0.24% effective coverage — barely visible, registers as "texture" rather than "pattern." Tunable via CSS vars (`--halftone-density`, `--halftone-opacity`) for per-route adjustment |
| 12 | Substrate is *also* not a Tailwind color | The halftone backdrop is a CSS utility class (`.halftone-bg`), not a Tailwind plugin or token | Symmetry with decision 2. Same reasoning: classes force correct usage; tokens tempt misuse |
| 13 | Logo image surfaces (Phase 3) | `frontend/public/logo.png` mounted at three points in v1: (a) sign-in page hero — replaces today's bare "Sign in" h1 with `<img>` + pearl wordmark beneath; (b) onboarding page hero — top of the existing card; (c) dashboard layout — sidebar header, replacing the hardcoded "C" letter box; the wordmark stays in the sidebar but the icon becomes the halftone illustration scaled to `size-7` | Three uses ladder from prominent (sign-in) → secondary (onboarding) → permanent ambient (sidebar). Sidebar is the highest-traffic surface; reducing the logo to `size-7` there means the halftone reads as a tiny crystalline icon rather than a busy illustration. Sign-in is where the substrate-substrate-chrome composition is loudest because it's the user's first impression |
| 14 | The hardcoded "C" box gets removed | `app-sidebar.tsx` lines 40-42's `<div className="bg-primary text-primary-foreground"><span>C</span></div>` is replaced with `<img src="/logo.png" className="size-7" />` | Two reasons: (a) the "C" box was a placeholder per the M1 changelog entry; (b) the box uses `--primary` as flat chrome, which is exactly the surface this redesign upgrades to pearl — and pearl on a 28×28px logo box would look noisy. The illustration is the better answer at small sizes |
| 15 | `--primary` semantics in dark mode | `--primary` stays as `oklch(0.922 0 0)` (light gray) — **not changed**. The `pearl` button variant doesn't touch `--primary`; it's a separate class | shadcn primitives (badges, avatars, link buttons, the avatar's badge ring) read `--primary` for fallback chrome. Re-purposing `--primary` to pearl would cascade pearl into surfaces that shouldn't be pearl (decision 8). Cleaner: leave `--primary` alone, paint chrome via the explicit `pearl` variant |
| 16 | The new button variant | Add `pearl` to `ui/button.tsx`'s CVA. Classes: `bg-pearl text-foreground border border-border/40 hover:border-border/70 transition-all relative overflow-hidden`, plus the `.pearl` background-image animation. **Existing `default` variant stays untouched** | Additive, not destructive. Existing pages keep working with `default` until each is consciously upgraded. The `relative overflow-hidden` is required because the `background-image` animates outside its natural box; without `overflow-hidden` the gradient would spill on hover |
| 17 | Where the `pearl` variant is used in v1 | (a) Sign-in submit; (b) onboarding submit; (c) dashboard hero CTA (when one is added — none today); (d) the eventual `/agents` "Deploy" button when M4 wires it. **Not on `Cancel`, not on `Sign out`, not on dropdown items, not on sidebar nav** | Pearl is reserved for *commit* actions — the action where the user is about to make something happen. Cancel and sign-out are reverse actions; nav is movement. None of those are "commit" |
| 18 | Hero title primitive | New `<PearlText>` component — a `<span>` (not `<h1>`) wrapper applying `bg-pearl bg-clip-text text-transparent` plus the drift animation. Heading semantics come from the wrapping `<h1>`/`<h2>` element | Decoupling the visual material from the semantic element means `<PearlText>` works inside any heading level or even body text without forcing a tag choice. Critical for accessibility — heading hierarchy stays clean |
| 19 | Hero title fallback for unsupported browsers | `bg-clip-text` requires `-webkit-background-clip: text; -webkit-text-fill-color: transparent` (Safari) and the standard property (everyone else). Both shipped. **Fallback color (when `background-clip` fails)** is `oklch(0.92 0.01 290)` — the lavender-white midpoint of the gradient — applied via `color:` so the text is still legible | Modern browser support for `bg-clip-text` is ~99% (Can I Use, 2025); the fallback covers the long tail. The fallback color is picked from the gradient itself so degraded rendering still feels family-correct |
| 20 | Focus ring becomes pearl | New `.pearl-ring` utility: `outline: 2px solid; outline-offset: 2px; outline-color: transparent;` plus a `box-shadow` that paints the pearl gradient as a 2px ring with the drift animation. Applied via `focus-visible:` modifier | Today's `focus-visible:ring-3 focus-visible:ring-ring/50` is a flat shadcn ring at `--ring` (a flat gray). Replacing it with pearl means **every focused interactive element on the page shimmers**, which is the cheapest way to sell "alive system" without adding any other animated surface. Subtle, ambient, and accessibility-positive (the shimmer makes the focus state more visible, not less) |
| 21 | Active step glow in spawn flow (forward-only) | M4's spawn flow steps will use `box-shadow: 0 0 32px var(--pearl-glow)` where `--pearl-glow` cycles through the gradient stops on the same drift timing. **The step's accent color (cyan/violet/rose) stays on the border**, pearl is only the inner glow | Wayfinding (step accent color) and chrome (active-state glow) are kept separate. The user knows *which step* by border color and *that the step is active* by chrome motion. Two channels, two signals |
| 22 | `<TerminalContainer>` ships in this plan | Even though no live route uses it today, the `<TerminalContainer>` primitive ships now so M4's `/fleet` and `/spawn` UI builds on it from line 1 instead of inventing a one-off | Same reasoning as decision 21. The redesign is the right place to put the primitive in the codebase; M4 will be its first consumer |
| 23 | `<TerminalContainer>` shape | Props: `title: string` (rendered as `[ {title.toUpperCase()} ]` in the title bar); `children: ReactNode`; optional `accent?: 'cyan' \| 'violet' \| 'blue' \| 'rose' \| 'green'` (paints the title-bar bottom border and the chevron). Default accent is none (gray-600) | Matches the `design-system.md` §16 signature exactly — `border-2 border-gray-600 bg-black/80 backdrop-blur-sm`, no border-radius, brackets in `tracking-wider uppercase` Geist Mono (Space Mono is post-redesign). The accent prop encodes the §5.4 feature color map without forcing every consumer to know the class names |
| 24 | `<StatusDot>` primitive ships in this plan | Props: `status: 'pending' \| 'spawning' \| 'running' \| 'stopped' \| 'failed' \| 'destroyed'`. Renders the pulse-dot + label per `design-system.md` §35 verbatim. **Pulses only on `spawning` and `running`** | M4's fleet table is its first consumer. Shipping the primitive in this plan means M4's UI plan can reference it as a black-box dependency rather than re-deriving the §35 mapping |
| 25 | Halftone surface application | `.halftone-bg` is applied at the **layout level** in `(app)/layout.tsx`'s root `<div>` — a single ambient backdrop that covers all logged-in routes. Sign-in and onboarding get it via their own root wrappers | Layout-level application means content surfaces (cards, terminal containers, modals) sit on top of the halftone without each component re-applying it. The halftone is *atmospheric*, not per-component. Density tunes via CSS var per-route if needed |
| 26 | Sign-in / onboarding background atmosphere | Sign-in uses `.halftone-bg` + a single radial vignette (`radial-gradient(ellipse at center, transparent 40%, oklch(0.145 0 0) 80%)`) that anchors the logo to center. Onboarding inherits sign-in's atmosphere as it's a continuation of the same arrival flow | Consistent first-three-screens atmosphere. The vignette is a one-time treatment (sign-in is the only screen where the user is *arriving*); dashboard onward uses bare halftone |
| 27 | Dashboard hero is the smallest possible | A `<PearlText>` H1 — `text-2xl font-bold tracking-tight` — saying "Welcome back, {firstName}." Replaces today's `<h1 className="text-2xl ...">` from `dashboard/page.tsx` line 24. The H2 below stays as Geist Mono in `text-muted-foreground` | The dashboard is **operational** — the user is about to do work. Hero treatment should be minimal so the workspace state below it (cards, links, eventual fleet summary) is the focus. Pearl appears, registers as "this product is alive," then yields |
| 28 | Sidebar wordmark stays plain | `app-sidebar.tsx` line 43-45's "Corellia" `<span>` stays in the existing font and color. **Not pearl** | The wordmark in the sidebar is permanent ambient — pearl on a permanently-visible surface would be *too* alive (visual fatigue). Pearl belongs on heroes and one-shot CTAs. The sidebar logo image (decision 13c) carries family identity for the sidebar; the wordmark is plain text |
| 29 | Top-bar avatar | `ui/avatar.tsx`'s `bg-primary` badge ring stays as-is. **No pearl on avatars.** | The avatar is "this is you" — semantic identity, not chrome. Pearl on the avatar would imply user-as-brand which isn't the framing (admin running systems, not user being celebrated) |
| 30 | Coming-soon shells | `coming-soon.tsx` and `coming-soon-harness-card.tsx` get a single visual change: the muted icon backing becomes `.halftone-bg` instead of `bg-muted`. **No pearl** — these are *deliberately* not-yet-alive surfaces | Encodes blueprint §11.4 visually: deferred features render as real grayed-out surfaces, not disabled buttons. The halftone backing makes them feel like "real machined panels not yet powered on" rather than "broken UI" |
| 31 | The `agent-template-card.tsx` icon box | Today: `bg-primary/10 text-primary` icon box for the harness icon. New: `.halftone-bg` background plus the harness logo (currently a placeholder lucide icon; M2 punted on per-harness logos). **Not pearl.** Card-level chrome is too small a surface for animated material to register at | Per decision 8 — chrome is forbidden on shadcn cards. The card icon box becomes substrate (halftone), keeping the card's information density readable |
| 32 | The catalog "Deploy" button (post-M4) | When M4 wires it, the button uses the `pearl` variant. **The "Deploy 5" button uses `outline`.** | Per decision 17 — pearl is for the primary commit action; secondary fan-out is `outline`. Same pattern as the spawn-flow plan's decision 40 |
| 33 | Doc reconciliation in Phase 5 | `design-system.md` is rewritten in place — not retired in favor of a new file. The doc's section structure stays; content changes | The doc is the wrong size for two parallel files. One source of truth that gets updated as the system evolves matches CLAUDE.md's "live code is authoritative; docs follow" stance |
| 34 | What `design-system.md` Phase 5 *adds* | (a) §5.3 split: "Brand Pearl" (chrome) + "Semantic Green" (status); (b) new §5.X "The Pearlescent Material" — the gradient stops, the drift, the reduced-motion fallback, the four primitives that consume it; (c) new §5.Y "The Halftone Substrate" — the CSS pattern, the logo asset, where it applies; (d) new §29.X "The Two Material Layers" — explicit substrate/chrome separation, what each owns, the forbidden overlaps; (e) §1 Design Philosophy reframed: "Mission Control × Deep Space, with pearlescent chrome on monochrome substrate" | Five concrete edits, all additive except the §5.3 split. Section numbering preserved so existing cross-references in the doc body still resolve |
| 35 | What `design-system.md` Phase 5 *fixes* | (a) HSL → OKLch throughout §12 CSS Custom Properties; (b) "New York" → "base-nova" in shadcn config refs (§5 caption + §13.4); (c) §5.3 "Brand Green is Kamino-shared" → "Semantic Green is Kamino-shared on status indicators; Corellia's brand chrome is pearlescent (§5.X)"; (d) §11 z-index layer adds `z-30` for the focused-chrome layer (focus rings) above content but below modals; (e) §28 Animation gains the `pearl-drift` keyframe spec; (f) §35 Status Vocabulary stays unchanged (semantic green is preserved) | Six fixes from the survey's drift findings. None are user-visible regressions; all are doc-vs-code reconciliation |
| 36 | What `design-system.md` Phase 5 *keeps* | The terminal container pattern (§16), the bracket header convention (`[ FLEET ]`, `[ AGENT // <name> ]`), the feature color map (cyan/violet/blue/rose for wayfinding), §32 accessibility rules, §37 anti-patterns (with one new entry: "Pearl on status indicators or body text — pearl is brand chrome material, not semantics or content") | The doc's foundational decisions are correct; only the brand-color stance and the syntax surface need updating |
| 37 | Validation strategy | `pnpm -C frontend type-check && pnpm -C frontend lint && pnpm -C frontend build` clean per phase. **Visual validation** is per-route screenshot comparison (before/after) against the four live routes; captured in the per-phase completion docs. Reduced-motion + Safari fallback verified manually | No visual-regression tooling in v1 (matches the stack §13 deferral list — no Playwright, no E2E). Manual screenshots in completion docs are the audit trail |
| 38 | Per-phase completion docs | One doc per phase under `docs/completions/frontend-redesign-phase-{1..5}.md` per the M3 / M3.5 cadence. Each captures: what shipped, screenshots, validation matrix, drift from this plan with reasoning | Same precedent the codebase already follows |

### Decisions deferred (revisit when named caller arrives)

- **Space Mono font swap** — would change all `tracking-wider uppercase` chrome surfaces from Geist Mono to Space Mono. Crisp visual upgrade but cross-cuts every component using the chrome typography pattern. Defer until post-redesign polish; flag in Phase 5's doc update so the gap is named.
- **Light-mode pearl** — pearl renders against dark-only in v1. If we ever ship light mode (currently no v1 product target per `design-system.md` §12), pearl gets an inverted gradient with raised lightness and reduced chroma. Out of scope.
- **Per-component drift speed control** — exposed via `--pearl-drift-duration` CSS var, but no UI surface to override it. Components like the deploy-launch CTA might benefit from a click-triggered speed-up; that's a per-feature animation choice, not a redesign concern.
- **Iridescent on hover for cards** — feels potentially good but is exactly the kind of "decorative animation" §37 anti-patterns forbids. The chrome budget is logo + CTAs + focus rings + active-step glow; that is the entire surface area.
- **Replacing the `coming-soon.tsx` lucide `ConstructionIcon`** — the icon stays; just the backing surface gains halftone. A future polish pass could swap it for a custom halftone-rendered icon, but that's craft, not redesign.
- **Animated halftone substrate** — kept static. A drifting halftone would compete with pearl's drift; one alive layer at a time is the discipline.

### Follow-up plans (to be written after this lands)

- **`docs/plans/space-mono-adoption.md`** — the font swap, audit, and migration. Probably ~50 LOC of doc + ~20 LOC of code change, but cross-cutting enough to deserve its own plan.
- **`docs/plans/halftone-iconography.md`** — replacing the lucide harness/template icons with hand-crafted halftone-rendered icons matching the logo's vocabulary. Post-M4.

---

## 3. Pre-work checklist

Before Phase 1, confirm:

- [ ] `git status` clean; branch off `master`.
- [ ] **The current frontend builds and runs.** `cd frontend && pnpm install && pnpm build && pnpm dev`; visit `/sign-in`, `/onboarding`, `/dashboard`, `/agents` — verify all four render before any visual changes ship.
- [ ] **Survey assumptions still hold.** Re-grep `frontend/src` for `green-` (must return zero), `bg-primary` (must return ~3 sites: sidebar, agent-template-card, avatar), `animate-pulse` (must return one site: skeleton). If any drift since the survey, update this plan's per-component walkthrough before executing.
- [ ] **`docs/assets/logo.png` exists** — `ls -la docs/assets/logo.png` returns the file. Phase 3 copies it to `frontend/public/logo.png`.
- [ ] **Tailwind 4 confirmed** — `cat frontend/package.json | grep tailwindcss` shows v4. The plan's CSS uses Tailwind 4's `@theme inline` syntax exclusively; if drift to v3 happened we re-syntax.
- [ ] **No in-flight redesign branch** — `git branch -a` shows no other contributor has a parallel rewrite open. This redesign touches the OKLch tokens; concurrent edits would conflict messily.

---

## 4. Phase plan

Five phases. Each is independently mergeable (no broken intermediate state). Each ends with `pnpm type-check && pnpm lint && pnpm build` clean and screenshots of the four live routes.

### Phase 1 — Material primitives (CSS tokens, drift keyframes, halftone class)

**Where:** `frontend/src/app/globals.css` exclusively. Zero component changes.

**What ships:**

- New OKLch tokens in `:root` and inherited unchanged in `.dark` (the gradient is dark-mode-tuned and shouldn't shift in light mode if we ever ship it):

  ```css
  --pearl-stop-1: 0.95 0.01 250;   /* near-white */
  --pearl-stop-2: 0.82 0.02 240;   /* cool silver */
  --pearl-stop-3: 0.85 0.015 70;   /* warm pearl */
  --pearl-stop-4: 0.78 0.025 250;  /* steel blue */
  --pearl-stop-5: 0.92 0.01 290;   /* lavender white */
  --pearl-drift-duration: 28s;
  --pearl-fallback-color: oklch(0.92 0.01 290);

  --halftone-density: 6px;
  --halftone-opacity: 0.08;
  ```

- New `.pearl` utility class:

  ```css
  .pearl {
    background-image: linear-gradient(
      135deg,
      oklch(var(--pearl-stop-1)) 0%,
      oklch(var(--pearl-stop-2)) 25%,
      oklch(var(--pearl-stop-3)) 50%,
      oklch(var(--pearl-stop-4)) 75%,
      oklch(var(--pearl-stop-5)) 100%
    );
    background-size: 200% 200%;
    animation: pearl-drift var(--pearl-drift-duration) ease-in-out infinite;
  }

  @keyframes pearl-drift {
    0%, 100% { background-position: 0% 50%; }
    50%      { background-position: 100% 50%; }
  }

  @media (prefers-reduced-motion: reduce) {
    .pearl { animation: none; background-position: 50% 50%; }
  }
  ```

- New `.pearl-text` utility (text-clipped pearl + fallback color):

  ```css
  .pearl-text {
    background-image: /* same gradient */ ;
    background-size: 200% 200%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: var(--pearl-fallback-color); /* rendered when bg-clip fails */
    animation: pearl-drift var(--pearl-drift-duration) ease-in-out infinite;
  }
  ```

- New `.pearl-ring` utility (focus-visible's new chrome):

  ```css
  .pearl-ring {
    outline: 2px solid transparent;
    outline-offset: 2px;
    box-shadow: 0 0 0 2px transparent, 0 0 12px 0 oklch(var(--pearl-stop-3) / 0.3);
    /* gradient ring via animated background-image overlay; full impl in phase 1 commit */
  }
  ```

- New `.halftone-bg` utility:

  ```css
  .halftone-bg {
    background-image: radial-gradient(
      circle at center,
      white 0.5px,
      transparent 1px
    );
    background-size: var(--halftone-density) var(--halftone-density);
    opacity: var(--halftone-opacity);
  }
  ```

  Applied as a `::before` pseudo-element in real usage (so the underlying surface keeps its own color/content); see Phase 3 for the wrapper-class application pattern.

**Validation:**

- `pnpm build` clean.
- `pnpm dev`; visit any existing route — page must render unchanged (Phase 1 only adds tokens and classes; no consumers yet).
- Manual: in DevTools, apply `.pearl` to a test `<div>` on the dashboard; verify the gradient drifts smoothly; toggle "Reduce motion" in OS settings; verify the gradient snaps to midpoint and stops.
- Manual: apply `.pearl-text` to the dashboard's H1 in DevTools; verify Safari + Chromium both render the text-clip; verify with `-webkit-background-clip` removed the fallback color shows.

**Out of phase:** No component edits. No layout changes. No assets moved.

### Phase 2 — `pearl` button variant + `<PearlText>` + `<TerminalContainer>` + `<StatusDot>` primitives

**Where:**
- `frontend/src/components/ui/button.tsx` — extend CVA, add `pearl` variant.
- `frontend/src/components/ui/pearl-text.tsx` — new file (~30 LOC).
- `frontend/src/components/ui/terminal-container.tsx` — new file (~50 LOC).
- `frontend/src/components/ui/status-dot.tsx` — new file (~40 LOC).

**Button extension:**

```tsx
// Add to the variants.variant object in button.tsx CVA:
pearl: "pearl text-foreground border border-border/40 hover:border-border/70 transition-all relative overflow-hidden font-medium",
```

The `pearl` class from Phase 1 paints the gradient; the rest is borders + transition. The text color stays `--foreground` (gray) on top of the pearl gradient — high contrast against the lighter gradient stops.

**`<PearlText>`:**

```tsx
type Props = { children: ReactNode; className?: string };
export function PearlText({ children, className }: Props) {
  return <span className={cn("pearl-text", className)}>{children}</span>;
}
```

Simple. Wraps any text in the pearl-text class. Heading semantics come from the consumer's wrapping `<h1>`/`<h2>`.

**`<TerminalContainer>`:**

```tsx
type Props = {
  title: string;
  accent?: 'cyan' | 'violet' | 'blue' | 'rose' | 'green';
  children: ReactNode;
  className?: string;
};
```

Renders the §16 pattern: `border-2 border-gray-600 bg-black/80 backdrop-blur-sm`, no border-radius, title bar with `[ {title.toUpperCase()} ]` in `tracking-wider uppercase font-mono text-xs text-gray-500`. Optional accent paints the title-bar bottom border + the chevron.

**`<StatusDot>`:**

```tsx
type Status = 'pending' | 'spawning' | 'running' | 'stopped' | 'failed' | 'destroyed';
type Props = { status: Status; showLabel?: boolean };
```

Per `design-system.md` §35 verbatim: pulsing on `spawning` + `running`, static otherwise; gray for `pending`/`stopped`/`destroyed`, green for `spawning`/`running`, red for `failed`. `showLabel` defaults to `true` (label rendered next to dot in `text-xs uppercase tracking-wider font-mono`).

**Validation:**

- `pnpm type-check && pnpm lint && pnpm build` clean.
- Render each new primitive on a throwaway `/dev/preview` page (or in Storybook if added; otherwise a temporary page deleted before merge); screenshot all four primitives; verify drift on `pearl` variant; verify pulse on `running`/`spawning` `StatusDot`; verify terminal container's `[ BRACKETS ]` look right.
- No live route consumes the primitives yet.

### Phase 3 — Logo asset + sign-in / onboarding hero treatments

**Where:**
- `frontend/public/logo.png` — new file, copied from `docs/assets/logo.png` (~size: check; if >50KB, run through `pngquant` first).
- `frontend/src/app/sign-in/page.tsx` — replace bare h1 with logo + `<PearlText>` wordmark.
- `frontend/src/app/onboarding/page.tsx` — add logo above the existing card.
- `frontend/src/app/(app)/layout.tsx` — add `.halftone-bg` wrapper at root.
- `frontend/src/app/(app)/dashboard/page.tsx` — wrap the existing H1's text in `<PearlText>`.

**Sign-in shape (after):**

```tsx
<main className="halftone-bg min-h-screen flex flex-col items-center justify-center gap-8 p-8">
  <div className="flex flex-col items-center gap-4">
    <img src="/logo.png" alt="Corellia" width={160} height={160} className="opacity-90" />
    <h1 className="text-4xl font-bold tracking-tight">
      <PearlText>CORELLIA</PearlText>
    </h1>
  </div>
  {/* existing form unchanged */}
</main>
```

Vignette layered via the existing wrapper's `bg-gradient` (added in this phase).

**Onboarding shape (after):**

The existing card layout stays. New: `<img src="/logo.png" className="size-16 mx-auto mb-4" />` above the card's title. The card's title text wraps in `<PearlText>`.

**Dashboard shape (after):**

Existing line `<h1 className="text-2xl font-semibold tracking-tight">Welcome back, {firstName}.</h1>` becomes `<h1 className="text-2xl font-semibold tracking-tight"><PearlText>Welcome back, {firstName}.</PearlText></h1>`. Everything else unchanged.

**Layout root (after):**

`(app)/layout.tsx`'s outer `<div>` gains a sibling `::before` halftone overlay via a new `.with-halftone` wrapper class that applies `position: relative` and renders the halftone as a fixed `::before`. (Implementation detail: a single fixed-position halftone layer attached at body level is cheaper than per-route application.)

**Validation:**

- `pnpm build` clean.
- Visit `/sign-in` — logo visible, "CORELLIA" wordmark drifts; halftone backdrop barely-perceptible.
- Visit `/onboarding` (sign in if needed) — logo at top of card; card title drifts.
- Visit `/dashboard` — H1 drifts; halftone visible across the (app)-group routes.
- Visit `/agents` — same atmosphere as dashboard (halftone present); cards unchanged structurally.
- Toggle reduce-motion in OS; reload — no animations on any page; pearl text/background reads as static silver.
- Safari (macOS) — verify text-clip works; if not, the fallback lavender-white shows. (Should work; modern Safari is fine.)

### Phase 4 — Component upgrades (sidebar logo, primary CTAs, focus rings, coming-soon backings)

**Where:**
- `frontend/src/components/app-sidebar.tsx` — replace hardcoded "C" box with `<img src="/logo.png" className="size-7" />`. Lines ~40-43.
- `frontend/src/app/sign-in/page.tsx` — submit button changes from `default` to `pearl` variant.
- `frontend/src/app/onboarding/page.tsx` — submit button changes from `default` to `pearl`.
- `frontend/src/components/ui/button.tsx` — focus-visible classes change from `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50` to `focus-visible:pearl-ring`.
- `frontend/src/components/coming-soon.tsx` — icon backing div changes from `bg-muted` to `halftone-bg`.
- `frontend/src/components/coming-soon-harness-card.tsx` — same.
- `frontend/src/components/agent-template-card.tsx` — icon box backing changes from `bg-primary/10` to `halftone-bg`. Tile keeps `text-primary` for the icon glyph (icons stay monochrome white).

**Sidebar before:**

```tsx
<div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
  <span className="text-xs font-semibold">C</span>
</div>
```

**Sidebar after:**

```tsx
<img src="/logo.png" alt="Corellia" className="size-7" />
```

**Validation:**

- `pnpm type-check && pnpm lint && pnpm build` clean.
- Sign in: submit button drifts gently; on focus, the focus ring shimmers. Tab through the form — every focused field shimmers.
- Onboarding: submit button drifts.
- Sidebar: tiny halftone logo where the "C" used to be.
- `/fleet`: ComingSoon shell shows halftone-backed icon.
- `/agents`: card icon boxes show halftone backing; no green; cards otherwise visually unchanged.
- Manual: focus a sidebar nav button — pearl ring shimmers on the focused button.
- Manual: keyboard-only navigation through an entire page (Tab key) — every focus state is visibly pearl. WCAG focus-indicator contrast verified manually (the pearl ring's darkest gradient stop has lightness `~0.78`, well above the `4.5:1` requirement against `oklch(0.145 0 0)` background).

### Phase 5 — Doc rewrite (`design-system.md`)

**Where:** `docs/refs/design-system.md` exclusively.

**Edits in order:**

1. **§1 Design Philosophy** — add a paragraph after "Mission Control × Deep Space (Corellia's variant)" introducing the **two-material model**: substrate (Kamino-shared monochrome halftone illustration grammar) + chrome (Corellia-distinct pearlescent). Keep existing five principles; add a sixth: "Two materials, one product — substrate and chrome never overlap on the same element."
2. **§4 Corellia's Place in the Kamino Family** — update "What Corellia keeps identical" item 2 from "Brand green `#22c55e` for primary actions" to "Semantic green `#22c55e` for active/running/healthy status indicators only" with a cross-reference to the new §5.X. Add to "What Corellia customises" a new item 5: "Pearlescent chrome as the primary brand surface — a single alive register on top of the family's monochrome substrate."
3. **§5.3 Brand Green** → split into **§5.3 Semantic Green (Status, Kamino-shared)** + **§5.4 Brand Pearl (Chrome, Corellia-distinct, see §5.X)**. Existing feature color map renumbers from §5.4 → §5.5.
4. **New §5.X The Pearlescent Material** — full spec: 5 OKLch stops, drift duration, reduced-motion fallback, the four primitives that consume it (`<PearlText>`, `pearl` button variant, `.pearl-ring`, post-M4 active-step glow), where it's allowed (decision 7), where it's forbidden (decision 8). Cross-references to Phase 1's CSS.
5. **New §5.Y The Halftone Substrate** — full spec: the `radial-gradient` CSS pattern, density and opacity tokens, the `frontend/public/logo.png` raster asset, the three surfaces it appears on (sign-in, onboarding hero, sidebar header) plus the layout-level atmospheric application.
6. **§12 CSS Custom Properties** — full rewrite from HSL to OKLch matching `frontend/src/app/globals.css` verbatim. Add the Phase 1 tokens (`--pearl-stop-{1..5}`, `--pearl-drift-duration`, `--halftone-density`, `--halftone-opacity`).
7. **§13 Buttons** — §13.4 shadcn Button Variants table gains a `pearl` row. §13.1's "Primary Button (Terminal Green)" example is replaced with a "Primary Button (Pearlescent Commit Action)" example using the `pearl` variant.
8. **§16 Terminal Container** — no content change; cross-reference the new `<TerminalContainer>` primitive.
9. **§21 Status Indicators** + **§35 Status Vocabulary** — *unchanged*. Both are semantic green; the Phase 5 update keeps them verbatim, only adding a sentence reaffirming "status indicators are always flat semantic colors, never pearl."
10. **§28 Animation & Motion** — add the `pearl-drift` keyframe spec, the 28s default with rationale, the `prefers-reduced-motion` fallback.
11. **New §29.X The Two Material Layers** — explicit table of which surfaces are substrate, which are chrome, which are neither (body / semantic / chrome-and-semantic-coexist). The same table as decision 7 + 8 above.
12. **§37 Anti-Patterns** — add: "Pearl on status indicators or body text — pearl is brand chrome material, not semantics or content"; "Animated halftone substrate — substrate is static, chrome is alive; one alive layer at a time"; "Pearl on cards or terminal-container fills — chrome surfaces are explicitly enumerated in §5.X"; correct the existing "Brand green `#22c55e`" anti-pattern references to "Semantic green is preserved on status only."
13. **Top-of-doc Version field** — bump from `1.0` to `2.0`. New header line: `**Version**: 2.0 (Pearlescent chrome × halftone substrate)`. Old aesthetic name retained in the body for traceability.

**What stays exactly:** §6 Typography, §7 Spacing, §8 Border Radius, §9 Elevation, §10 Opacity Scale, §11 Z-Index (one new layer added), §14–§20 component specs (Inputs, Cards, Modals, Tables, Tooltips), §22–§27 patterns, §30 Scrollbars, §31 Responsive Design, §32 Accessibility (with one new rule about pearl contrast), §33 Page Motifs, §34 RPG Character Creation, §35 Status Vocabulary.

**Validation:**

- Doc renders as Markdown without breakage (links, tables, code blocks all valid).
- Cross-references resolve (no broken `§N.M` pointers).
- Live code is consistent with the doc rewrite — `globals.css` matches §12; `button.tsx` `pearl` variant matches §13.4 example; `<PearlText>` matches §5.X spec.

---

## 5. Per-route walkthrough

Quick reference for what each live route looks like before vs after.

### `/sign-in`

**Before:** Bare `<h1>Sign in</h1>` + email + password fields + submit button (`default` variant) on plain `bg-background`.

**After:** `<img src="/logo.png" />` (160px) + pearl-clipped `CORELLIA` wordmark above the form. Form fields unchanged in structure. Submit button = `pearl` variant. Background = `.halftone-bg` + center radial vignette. Focus rings = pearl shimmer on Tab.

**Files touched:** `app/sign-in/page.tsx`.

### `/onboarding`

**Before:** Centered Card with title "Welcome to Corellia." + body + form (name, workspace) + submit (`default`).

**After:** Logo (64px) above the Card. Card title wraps in `<PearlText>`. Submit = `pearl` variant. Atmosphere inherits from sign-in's halftone+vignette.

**Files touched:** `app/onboarding/page.tsx`.

### `/dashboard`

**Before:** "Welcome back, {firstName}." H1 + 2-column card grid linking to `/agents` and `/fleet`.

**After:** H1 text wraps in `<PearlText>`. Cards visually unchanged. Sidebar logo halftone-rendered (Phase 4). Background `.halftone-bg` ambient.

**Files touched:** `app/(app)/dashboard/page.tsx`, `app/(app)/layout.tsx`, `components/app-sidebar.tsx`.

### `/agents`

**Before:** Catalog with `AgentTemplateCard`s and `ComingSoonHarnessCard`s. Hermes card icon box uses `bg-primary/10`. Cards have working "Deploy" buttons (M4 wires them; today they're scaffolded).

**After:** Card icon boxes use `.halftone-bg` instead of `bg-primary/10`. ComingSoon cards' icon backing same. When M4 lands, "Deploy" buttons use `pearl`; "Deploy 5" uses `outline`. Cards otherwise unchanged.

**Files touched:** `components/agent-template-card.tsx`, `components/coming-soon-harness-card.tsx`.

### `/fleet`

**Before:** `<ComingSoon />` shell with lucide ConstructionIcon on `bg-muted`.

**After:** ConstructionIcon on `.halftone-bg`. Otherwise unchanged. (When M4 lands, `<TerminalContainer title="Fleet">` wraps the table; `<StatusDot>` paints rows. Both primitives ship in Phase 2.)

**Files touched:** `components/coming-soon.tsx`.

### `/settings`

**Before / After:** Same as `/fleet` — `<ComingSoon />` on halftone backing. No further v1 work.

---

## 6. Per-component walkthrough

| Component | LOC | Phase | Change |
|---|---|---|---|
| `app-sidebar.tsx` | 83 | 4 | Replace hardcoded "C" `<div>` with `<img src="/logo.png" />`. Wordmark span unchanged. |
| `app-top-bar.tsx` | 75 | — | Untouched. Avatar stays `bg-primary` (decision 29). |
| `agent-template-card.tsx` | 48 | 4 | Icon box backing `bg-primary/10` → `halftone-bg`. Icon glyph color unchanged. |
| `coming-soon-harness-card.tsx` | 39 | 4 | Icon backing → `halftone-bg`. |
| `coming-soon.tsx` | 39 | 4 | Icon backing → `halftone-bg`. |
| `ui/button.tsx` | 58 | 2 + 4 | Phase 2: add `pearl` variant. Phase 4: focus-visible classes → `pearl-ring`. |
| `ui/card.tsx` | 103 | — | Untouched. Cards are content surfaces, not chrome. |
| `ui/avatar.tsx` | 109 | — | Untouched. |
| `ui/badge.tsx` | 52 | — | Untouched. |
| `ui/sidebar.tsx` | 723 | — | Untouched. (The sidebar's hover/focus states inherit the new `.pearl-ring` via `ui/button.tsx`'s focus rules.) |
| `ui/skeleton.tsx` | 13 | — | Untouched. |
| `ui/input.tsx` | 20 | — | Untouched. (Input's focus ring inherits from the global `:focus-visible` rules; verify in Phase 4 validation.) |
| `ui/label.tsx`, `tooltip.tsx`, `dropdown-menu.tsx`, `select.tsx`, `separator.tsx`, `sheet.tsx`, `sonner.tsx` | various | — | Untouched. |
| **NEW** `ui/pearl-text.tsx` | ~30 | 2 | New file. |
| **NEW** `ui/terminal-container.tsx` | ~50 | 2 | New file. |
| **NEW** `ui/status-dot.tsx` | ~40 | 2 | New file. |

**Total touched:** 6 components edited, 3 new components, 1 CSS file. Roughly **~250 LOC of net change** across the FE plus ~600 LOC of doc rewrite.

---

## 7. Validation matrix

Per phase, the following checks run before merge:

| Check | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 |
|---|---|---|---|---|---|
| `pnpm type-check` | ✓ | ✓ | ✓ | ✓ | n/a |
| `pnpm lint` | ✓ | ✓ | ✓ | ✓ | n/a |
| `pnpm build` | ✓ | ✓ | ✓ | ✓ | n/a |
| `pnpm dev` boots | ✓ | ✓ | ✓ | ✓ | n/a |
| All four live routes render | ✓ | ✓ | ✓ | ✓ | n/a |
| Pearl drift visible (Chrome) | n/a | ✓ | ✓ | ✓ | n/a |
| Pearl drift visible (Safari) | n/a | ✓ | ✓ | ✓ | n/a |
| Pearl text-clip fallback (force) | n/a | ✓ | ✓ | ✓ | n/a |
| `prefers-reduced-motion` snaps to midpoint | ✓ | ✓ | ✓ | ✓ | n/a |
| Pearl ring visible on Tab | n/a | n/a | n/a | ✓ | n/a |
| WCAG AA on chrome surfaces | n/a | manual | manual | manual | n/a |
| Doc cross-refs resolve | n/a | n/a | n/a | n/a | ✓ |
| Doc matches live code | n/a | n/a | n/a | n/a | ✓ |
| Screenshot capture (4 routes) | optional | optional | ✓ | ✓ | n/a |

Screenshots from Phase 3 and Phase 4 are committed to the per-phase completion docs as the visual audit trail.

---

## 8. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Pearl gradient looks like Y2K Winamp / cheap automotive paint | Medium | High | OKLch low-chroma stops (≤0.025), 28s drift (slow), confined to chrome surfaces only, halftone substrate as compositional grounding. If Phase 3 screenshots read kitsch, abort and re-tune stops before Phase 4. |
| 2 | Animation jank from `background-position` interpolation on slow devices | Low | Medium | Single animated property (background-position) on a small number of surfaces (logo + heroes + CTAs + focus rings). All composited; no layout/paint cost. If a perf regression appears, cap simultaneous animated elements via `:not(:has(.pearl ~ .pearl ~ .pearl))` defensive CSS, or drop drift duration to 0 (static gradient) on `pointer: coarse` devices. |
| 3 | `bg-clip-text` rendering glitch in Safari | Low | Low | Fallback color is set explicitly; manual Safari verification in Phase 3 validation; visionOS / Safari Tech Preview spot-check. |
| 4 | Halftone `radial-gradient` performance on large background areas | Low | Medium | `.halftone-bg` applied at layout root only (one DOM node), not per-component. CSS pattern is cheap (browser caches the rendered tile). If slow, rasterize to a single PNG tile + `background-repeat`. |
| 5 | Reduced-motion users see static silver and miss the "alive" framing | Accepted | n/a | This is the correct trade. WCAG and OS preference take precedence over aesthetic intent; the static composition still reads as premium silver. Documented in §32 Accessibility. |
| 6 | Designer / contributor adds pearl to a forbidden surface (status, body text, card fill) | Medium | Medium | The `pearl` class is the only path; design-system.md §5.X explicitly enumerates allowed and forbidden surfaces; §37 anti-patterns gain matching entries. Code review catches additions. No tooling enforcement (lint rule) in v1; flag for post-redesign if it becomes a recurring drift. |
| 7 | Logo PNG file size bloats sign-in route | Low | Low | Pre-compress via `pngquant` if the source is >100KB; the README logo is already small (~600KB max guess; verify). Lazy-loading for the dashboard sidebar's `size-7` is unnecessary at that size. |
| 8 | M4's UI plan (`spawn-flow.md`) ships before this redesign and re-invents primitives | Medium | High | Communicate explicitly with M4 owner that `<TerminalContainer>` and `<StatusDot>` ship in this redesign's Phase 2 — M4's UI consumes them rather than building one-offs. If M4 is in flight, sequence this redesign's Phase 2 ahead of M4's UI half. |
| 9 | The doc rewrite (Phase 5) drifts from live code post-Phase 4 | Low | Medium | Phase 5 lands in the same merge train as Phases 1–4. Doc is updated to reflect what Phase 4 actually shipped, including any decision-drift captured in Phase 1–4 completion docs. |
| 10 | Existing `--primary` consumers (sidebar, badges, avatar) start looking inconsistent next to pearl chrome | Low | Low | Decision 15 keeps `--primary` as flat gray; pearl is a separate explicit class. The visual contrast between flat-gray chrome (badges, avatars) and animated-pearl chrome (CTAs, hero) is the *intended* hierarchy: pearl marks commit actions and brand identity; flat gray marks ambient UI furniture. If this hierarchy doesn't read clearly, re-evaluate in post-redesign polish. |

---

## 9. Open questions

| # | Question | Default if unanswered |
|---|---|---|
| OQ1 | Should the `(app)` group's halftone backdrop be fixed-position (covers viewport, doesn't scroll) or scroll with content? | Fixed-position (cheaper, looks correct on long pages). Re-evaluate if it makes the app feel "thin." |
| OQ2 | Do we ship pearl to the Vercel preview before user-facing deploy, or merge to master directly? | Master directly per the M3 / M3.5 cadence (no preview-pinning workflow exists in v1). |
| OQ3 | Should `<PearlText>` accept a `static` prop to disable drift on a per-instance basis? | No in v1 (YAGNI). Add later if a use case appears. |
| OQ4 | Should the sign-in vignette fade to absolute black (`oklch(0.145 0 0)`) or to the `--background` token? | `--background` token (theme-aware; safer if light mode ever ships). |
| OQ5 | Should focus-visible pearl ring be 2px or 3px? | 2px — narrower means less visual noise per focus, more elegant; the shimmer carries the prominence. Re-test in Phase 4 validation. |
| OQ6 | When Phase 3 ships, what's the canonical `width`/`height` for `<img src="/logo.png" />` on sign-in? | 160×160 px (logo's native ratio, scaled to fit above the form). |
| OQ7 | Should `<TerminalContainer>`'s accent border use the full feature color (`--cyan-500`) or a desaturated variant? | Full feature color. The wayfinding signal is the point; desaturation undermines it. |
| OQ8 | Do we add Storybook in this redesign for the new primitives? | No (matches stack §13 — no Storybook in v1). Throwaway `/dev/preview` page deleted before merge. |

---

## 10. Plan-as-built checklist

Tracked separately in per-phase completion docs:

- [ ] Phase 1 — `globals.css` extended; tokens + classes + keyframes + reduced-motion fallback. Build clean. No component changes.
- [ ] Phase 2 — `pearl` button variant; `<PearlText>`, `<TerminalContainer>`, `<StatusDot>` primitives. Build clean. No live route consumes them yet.
- [ ] Phase 3 — `frontend/public/logo.png` mounted; sign-in / onboarding / dashboard heroes upgraded; `(app)/layout.tsx` halftone wrapper. All four live routes render with the new atmosphere.
- [ ] Phase 4 — Sidebar logo image; primary CTAs use `pearl` variant; focus rings shimmer; coming-soon and template-card backings use halftone. All live routes pass screenshot review.
- [ ] Phase 5 — `design-system.md` rewritten (HSL→OKLch, "New York"→"base-nova", brand-green→semantic-green-only, pearl/halftone added). Cross-refs resolve. Doc matches live code.
- [ ] Changelog entry — `0.6.x` (TBD per the post-M4 sequencing). Version theme: "Pearlescent Chrome × Halftone Substrate."

When all five boxes are checked plus the changelog entry lands, the redesign is complete and the v1 frontend has its load-bearing visual identity. M4's UI half then consumes the primitives and the spawn-flow chrome closes the loop.
