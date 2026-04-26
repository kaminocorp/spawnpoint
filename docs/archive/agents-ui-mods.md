# Plan — Spawn page redesign (RPG character selection)

**Status:** draft, awaiting approval
**Owner:** TBD
**Related:**
- `docs/refs/design-system.md` §34 (RPG Character Creation Flow — already specified, never built), §33.5 (`/spawn` page motif), §3 anti-pattern "no glowing orbs / generic AI imagery"
- `docs/refs/elephantasm-animation.md` (volumetric particle nebula recipe — R3F + drei, custom GLSL)
- `docs/executing/fleet-control.md` (M5; this plan's wizard slots its Deployment + Review steps cleanly into M5's modal expansion)
- `docs/blueprint.md` §10 ("RPG character creation"), §11.4 (deferred features as real interface stubs)
- `docs/changelog.md` 0.7.1 (mission-control implementation; existing tokens + `TerminalContainer` etc. stay), 0.7.2 (the rename precedent: `Catalog → Agents` was the same shape of move)

---

## 1. Brief (operator's words)

> Three asks (verbatim from the top of this file before this plan was written):
>
> 1. Rename the AGENTS page to **SPAWN** (or similar) — it reads more like a launchpad than a list.
> 2. Redesign the page as **RPG character selection** — harnesses are characters/roles; the layout should reflect that.
> 3. Each harness gets a **3D animation as its avatar** — see `docs/refs/elephantasm-animation.md` for technique.
>
> Then deploying becomes a **character configuration wizard**, designed to absorb the upcoming `fleet-control.md` knobs. "Almost an onboarding wizard."

The proposal below is one coherent slice that addresses all three plus the wizard, sequenced so each phase is independently shippable.

---

## 1.1 Resolutions (operator answers, 2026-04-26)

Inputs that shifted the plan since the first draft:

- **Q1.** Route name: **`/spawn`** confirmed.
- **Q2.** Nebula avatar: agreed; concern about "generic AI imagery" acknowledged. Mood-per-harness is the differentiator; shape stays consistent across the family.
- **Q3.** Deep-linking is **not critical**. The wizard still lives at `/spawn/[templateId]` (route, not modal — the 5-step layout demands the vertical real estate), but URL-encoded step state (`?step=N&name=…`) is downgraded from "feature" to "nice-to-have"; we keep the URL clean and rely on in-memory state. Refresh loses progress; that's acceptable.
- **Q4.** Step-name regrouping accepted **with renames**: `Loadout` → **`MODEL`**, `Posture` → **`DEPLOYMENT`**. Both more explicit. New step list: `HARNESS → IDENTITY → MODEL → DEPLOYMENT → REVIEW`.
- **Q5.** **Single-spawn only** in this plan's v1. Spawn-N is **dropped from the wizard scope**; deferred to a follow-up. Step 2 (Identity) becomes a single `name` field — the radio + prefix + count UI from the original plan are gone.
- **Q6.** Locked-slot animation: operator's call, performance-gated. **Resolved: locked slots use the static SVG fallback** (decision 4's fallback path), not a desaturated nebula. Reasoning: rendering 4 desaturated nebulas alongside 1 active = 5 simultaneous WebGL contexts, exhausts the per-page GPU budget on mid-range hardware. Static fallbacks keep performance flawless and are visually honest ("not yet built" reads cleaner than "alive but greyed").
- **Q7.** Both. **R3F is kept** (the imperative-three rewrite would slow Phase 2 by ~1 day for a marginal bundle win). Performance is enforced by decisions 15 (lazy-mount) + new decision 21 (one-active-canvas-only ceiling).
- **Q8.** Sequencing **(a)** confirmed: this plan ships first; M5 absorbs Step 4's stubs.
- **Q9.** Synthesized streaming log accepted for v1.
- **Q10.** Roster vocabulary: **`HARNESSES`** (not `OPERATORS` / `CHARACTERS`). Threaded consistently — `[ AVAILABLE HARNESSES ]` in the page header, "Pick a harness" as the wizard's Step 1 verb, etc.
- **Q11.** Roster slimmed to **6 harnesses** total (Hermes active + 5 locked). See §3.5.
- **Q12.** `/agents` redirect shim: **one release only**, then deleted (clean codebase wins). Tracked in Phase 6.
- **Q13.** Lineup resolved to **Hermes / OpenClaw / Claude Agent SDK / DeepAgents / SuperAGI / OpenFang**. LangGraph dropped (subsumed by DeepAgents, which is built on it). OpenClaw vendor + one-liner pending at Phase 3 — non-blocking; the card ships with placeholder copy and gets backfilled.

---

## 2. Objective

Promote `/agents` from "list page + modal form" to **"character roster + character creation flow"** — a Mission Control × Deep Space launchpad where:

- The **roster** (today's catalog) reads as a row of selectable **operators / characters**, each represented by a unique 3D nebula avatar that visually encodes the harness's identity.
- The **creation flow** is a multi-step wizard that builds the agent the way an RPG builds a character: pick class (harness) → name → loadout (model + key) → deployment posture (M5 knobs) → review → launch.
- Coming-soon harnesses are visible as **locked character slots** (per blueprint §11.4 — real interface stubs, not disabled buttons).

This is the page that closes the gap between blueprint §10 ("RPG character creation") + design-system §34 (RPG flow already specified) and what's actually shipped (one card + a 4-field modal).

### What this plan delivers

1. **Route + label rename.** `/agents` → `/spawn`. Sidebar nav label `Agents` → `Spawn`. Page H1 `AGENTS` → `SPAWN`. The decorative section tag `[ DEPLOY ]` → `[ LAUNCHPAD ]` (intent-as-label, mirrors 0.7.2's `[ DEPLOY ]` rationale).
2. **Top-5 harness roster** — replaces today's "1 active + 3 coming-soon" stack with a slimmed, curated **5-card roster**: Hermes active, 4 most-popular locked. One focused card per harness (~3× today's card surface), each with a 3D nebula avatar (active) or static SVG schematic (locked), a spec-sheet underbelly, and a single "› SELECT" CTA on the active card.
3. **3D nebula avatars (active harnesses only)** — adapted recipe from `elephantasm-animation.md`, downsized to ~3K particles per avatar, one R3F `<Canvas>` per active card, mood palette per harness (Hermes = green-dominant per design-system §5.4). All avatars share the GLSL noise function; per-harness divergence is in the mood palette + Gaussian sigma + rotation speed. Locked harnesses get the static SVG fallback (Q6 resolution — performance ceiling).
4. **Multi-step character-configuration wizard** — replaces today's single `<Dialog>`. Five steps in a single full-screen route (`/spawn/[templateId]`) styled per design-system §34, each step in its own `TerminalContainer`, only one active at a time, others rendered at `opacity-40` with a "› step ready" acknowledgement gating progression. Step list: `HARNESS → IDENTITY → MODEL → DEPLOYMENT → REVIEW`. **Single-agent spawn only**; Spawn-N is out of scope for this plan (Q5 resolution).
5. The wizard is **shape-compatible with M5's coming Deployment + Review fields** (see §5) — Step 4 (`DEPLOYMENT`) ships today as a thin lifecycle/replicas stub and absorbs M5's region/size/volume/restart knobs without restructure.

### What this plan does NOT deliver

- **M5's deployment knobs themselves.** Region / size / volume / replicas / restart / lifecycle land in M5's plan (`fleet-control.md`). This plan **reserves the slot** for them as Step 4 of the wizard, with a single "DEPLOYMENT" panel that today defaults everything (matching M4 behavior). When M5 lands, that panel fills out without a wizard restructure.
- **Spawn-N (fan-out deploy of N agents from one form).** Dropped from the wizard scope per Q5. The roster card's `Deploy 5` CTA goes away with this redesign; if "deploy 5" remains a needed demo moment, it returns as a separate post-M5 plan (most likely as a "duplicate this agent" action on the fleet page, which composes better with M5's bulk-apply pattern than as a wizard variant).
- **Avatar customization.** No user-editable avatar palette in v1. Each harness ships with a fixed mood signature.
- **`/spawn` redirect from `/agents` (long-term).** Old route 308-redirects to new for **one release only**, then the shim is deleted (Q12 resolution).
- **Mobile-first wizard.** Wizard is desktop-primary (matches the operator/admin mental model). Mobile gets a stacked single-column fallback that loses the parallel-step affordance — acceptable per design-system §31.
- **Animated transitions between wizard steps.** Steps unlock with opacity + accent-glow change only; no slide / fade-in chrome. Honest motion register per design-system §28.
- **Avatar interactivity beyond hover.** OrbitControls is *off* — operator drag-rotating an avatar doesn't serve mission-control framing. Auto-rotate only.
- **URL-encoded wizard step state.** Per Q3 — refresh resets the wizard. The route `/spawn/[templateId]` carries which harness is selected; everything past that is in-memory.

---

## 3. Decisions locked

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | **Route rename: `/agents` → `/spawn`** | `frontend/src/app/(app)/agents/` directory moves to `frontend/src/app/(app)/spawn/`. Sidebar nav label flips. A `frontend/src/app/(app)/agents/page.tsx` shim issues `redirect("/spawn")` for one release | "Spawn" matches the user's mental model and the wizard's verb. The redirect shim costs ~5 LOC and prevents broken bookmarks during the changeover; removable in the next minor |
| 2 | **3D avatars: R3F + drei, dynamic-imported with `ssr: false`** | New deps: `three`, `@react-three/fiber`, `@react-three/drei`. One shared `<NebulaAvatar harness={...}>` component; per-harness palette + sigma + rotation as props. ~3K particles per avatar (vs Elephantasm's 17K) — three avatars rendering simultaneously stays under 10K total | Three.js + R3F is the canonical recipe per design-system. SSR disable is mandatory (WebGL needs a browser context). 3K-per-avatar comes from the elephantasm doc's "mobile reduction" guidance (7K/1.2K/400) scaled down further; we render 3 avatars not one, so per-avatar budget is tight |
| 3 | **One `<Canvas>` per avatar, not a shared canvas** | Each card hosts its own `<Canvas>` element. Three cards = three WebGL contexts | A shared canvas with multiple scenes would need a portal + view system (drei's `<View>`); one canvas per card is simpler, isolates failure (one avatar dying doesn't black out the rest), and three contexts is well within browser limits (16 typical). Cost: 3× shader compile at mount; mitigate by lazy-mounting on viewport intersection |
| 4 | **Avatars are a visual layer, not a data dependency** | The page renders without avatars (graceful degrade): if WebGL is unavailable / `prefers-reduced-motion` is on / the dynamic import fails, each card falls back to a static SVG schematic placeholder (a hairline vector "pearl" shape with the harness's accent color) | Per design-system §28 "honest motion" + §32 a11y. The avatar is mood; the spec sheet is the data. The page must function fully without WebGL |
| 5 | **Per-harness mood palette is the *only* per-harness avatar variable that matters** | Particle counts, sigma, rotation speed, octave amplitudes are shared constants. Each harness ships a `MoodPalette` (4 RGB tints + 4 frequencies + spatial weights) | Keeps the visual "family" coherent — every avatar reads as part of the same visual language, which matches the schematic / spec-sheet aesthetic. Per-harness divergence in shape would read as gimmicky |
| 6 | **Hermes' palette: terminal green dominant, with cyan + violet accents** | `pearl=(0.93,0.91,0.96)`, `green=(0.45,0.72,0.50)` (Corellia primary), `cyan=(0.40,0.75,0.78)`, `violet=(0.55,0.45,0.80)`, `amber=(0.85,0.65,0.35)`. Mix intensities matched to elephantasm's tuning | Per design-system §5.4: Agents = green, Catalog = cyan, Adapters = violet. Hermes' palette samples the harness's *touchpoints* in the system. Each future harness gets its own palette derived the same way |
| 7 | **Wizard lives at `/spawn/[templateId]`, not in a modal** | Click `› SELECT` on a roster card → router push to `/spawn/[templateId]`. The wizard is a full-page route, not an overlay | Modals don't fit a 5-step character-creation flow — too cramped, no deep-link, no back-button semantics, no SSR. A route gives Next.js layout, prefetch, and bookmark-able state. Aligns with design-system §34 (terminal containers stacked vertically, not nested in a `<Dialog>`) |
| 8 | **Wizard step state is in-memory only** *(reversed per Q3)* | The route segment `/spawn/[templateId]` carries the harness selection. Everything past that — name, provider, model, API key, posture — lives in client component state. Refresh resets the wizard | Q3: deep-linking isn't a real user need. Cleanest URL, no secrets-in-URL footgun, simpler `useSearchParams`-free implementation. Trade-off: accidental refresh during a long wizard session loses progress — acceptable since the wizard fits in one screen and isn't a long form |
| 9 | **Step gating: each step has a `confirmStep()` action; later steps are `opacity-40` until previous is confirmed** | `Confirm` is the design-system §34.2 "ready" acknowledgement. Editing a confirmed step un-confirms it AND every step downstream | Tactile mission-prep feel per design-system §34. Re-editing cascading invalidation prevents stale-config submissions ("I picked Anthropic, then changed model to a Claude variant, then changed provider to OpenAI but kept the model field"). Same pattern as Stripe Checkout / GitHub release-create |
| 10 | **Step 4 (Deployment) is a single "Posture" panel today, not the M5 expansion** | Step 4 ships as a stub that exposes only `lifecycle` (always-on default) and `replicas` (1 default), with the rest of M5's knobs as `Coming with fleet control` real-interface stubs (per blueprint §11.4 — grayed-out fields with tooltips, not disabled buttons or invisible) | This plan slots in front of M5; M5's Phase 6 (`fleet-control.md` §4) replaces the panel's contents. Both fields default to today's M4 behavior, so shipping this plan first does not regress |
| 11 | **Single-spawn only in this plan** *(per Q5)* | The wizard deploys exactly one agent per run. No spawn-N toggle, no `count` field, no `prefix`. `spawnNAgents` RPC stays on the wire (M4 already shipped it) but is unreachable from this UI. Step 2 (IDENTITY) is just `name` | Q5: focus on one-at-a-time for now. Removes the radio-mode bifurcation that complicated Step 2 in the first draft, and removes the `key={mode}` form-remount dance from today's `deploy-modal.tsx`. If a "deploy 5" demo-moment shortcut is needed later, it composes more naturally with M5's bulk-apply on the fleet page than as a wizard variant |
| 12 | **Roster card primary CTA: `› SELECT`, not `› Deploy`** | One CTA per active card. Locked cards have no CTA — just a `[ LOCKED ]` badge | "Deploy" on a roster card overpromises (you haven't picked a name, model, or key yet). "Select" is what RPG character selection actually offers — pick the class, configure later |
| 13 | **Locked slots use static SVG fallbacks, NOT desaturated nebulas** *(reversed per Q6)* | Coming-soon harnesses get the same card chrome (header, "avatar" slot, spec-sheet, footer) but the avatar slot renders the SVG fallback from decision 4 (a hairline pearl ellipse with a muted accent), permanently — no canvas, no shader compile. CTA replaced with `[ LOCKED ]` non-interactive badge; spec-sheet rows show `n/a` for ADAPTER and an ETA hint where known | Q6: performance ceiling. With one active nebula + four locked slots in the roster, animating all five would mean 5 simultaneous WebGL contexts on page mount — exhausts mid-range GPU budget and risks initial-paint jank. Static fallbacks for locked slots keep the page snappy AND read more honestly ("not yet built") than greyed-out animation. The visual hierarchy is preserved: the active card's avatar is the only thing moving, which draws the eye correctly |
| 14 | **Deploy submission: same RPCs as M4 + future M5; UX is "streaming log → fleet"** | `Deploy` button on Step 5 calls `spawnAgent` (or `spawnNAgents`). Wizard transitions to a streaming log surface (design-system §34.3 — live mono lines: `› creating fly app…` `› setting secrets…` `› launching machine…` `› awaiting health…`). On success: redirect to `/fleet` (M4 behavior preserved) | Matches the existing M4 deploy flow on the wire — this plan is FE-only. Streaming log is a UI affordance over the same single RPC; no proto change |
| 15 | **Lazy-mount avatars on viewport intersection** | `<NebulaAvatar>` only mounts its `<Canvas>` when its parent enters the viewport (IntersectionObserver). Above-the-fold cards mount immediately; off-screen locked slots stay as static placeholders until scrolled into view | 9 locked harnesses × 3K particles = 27K particles if all mount at once on a small fleet page. Lazy-mount keeps the initial paint to ~3 active canvases (Hermes + 2 visible locked slots) |
| 16 | **`prefers-reduced-motion` collapses avatars to static placeholders** | Media-query check at `<NebulaAvatar>` mount; if reduced-motion → render the SVG fallback from decision 4. No partial / "frozen frame" middle ground | Per design-system §28 + §32. Honest motion register: animated or not, never half |
| 17 | **No proto / backend changes in this plan** | Pure FE. Routes, components, deps, styles only | This is a UX/visual layer over the M4 wire that's already shipping. Decoupling lets it ship in parallel with M5; M5's protocol changes drop into Step 4 cleanly |
| 18 | **Bundle-size budget: ≤200 KB gzip added by R3F + three** | Audit via `pnpm -C frontend build` before/after. If over budget, drop drei (use plain `three` + manual `OrbitControls`-equivalent — but auto-rotate is in our hands, OrbitControls is unused per decision otherwise) | R3F + drei is ~250KB gzip; we don't need most of drei. We use no `<OrbitControls>`, no helpers — only `<Canvas>` + `useFrame`. We can ship just R3F + three for ~150KB if drei pulls weight |
| 19 | **5-step wizard with explicit names: `HARNESS → IDENTITY → MODEL → DEPLOYMENT → REVIEW`** *(per Q4)* | Step 3 collapses provider + model + API key into one panel labelled `MODEL` (not "Loadout"). Step 4 collapses M5's deployment knobs into one panel labelled `DEPLOYMENT` (not "Posture"). Both terms are explicit — they name the thing the operator is configuring, not a metaphor for it | Q4: "Loadout" / "Posture" too vague. `MODEL` is what Step 3 is *about* (model + the credentials and provider that scope it). `DEPLOYMENT` is what Step 4 is *about* (where + how the agent runs). Design-system §34.1's original 5 steps (Pick / Name / Provider / Key / Model) split coupled fields into separate ceremonies — same total step count here, better cohesion + plainer names |
| 20 | **No localStorage / persistent draft** | Wizard state is in-memory only (decision 8). Closing or refreshing the tab loses progress | Same posture as M4 (decision 39 — no localStorage). Combined with decision 8's no-URL-state, the wizard is a fully ephemeral session. The API key MUST never persist anywhere outside of the in-flight RPC; making the entire wizard ephemeral is the simplest way to honor that without a special-case for one field |
| 21 | **Page-level "active canvas" ceiling: at most one nebula `<Canvas>` mounted at a time on the spawn page** | Roster page mounts exactly one canvas (Hermes, the active harness). Locked harnesses are static SVGs (decision 13). The wizard route also mounts at most one canvas (the selected harness's avatar in Step 1's confirmation panel). No page in this plan ever has more than one WebGL context live | Performance ceiling per Q7. R3F + three is kept (Q7), so the budget gate is "how many simultaneous canvases can a mid-range GPU drive without jank." The honest answer is "few" once you factor in shader compile time on initial paint. One-canvas-per-page is conservative and forgiving — and visually it's correct, since the active harness should be the only thing alive on the screen |

### Decisions deferred (revisit when named caller arrives)

- **Per-user avatar customization.** Not in v1.
- **Avatar palette tied to the agent's chosen model provider.** Today the palette is per-harness; coupling it to provider would mean Hermes-on-Anthropic looks different from Hermes-on-OpenAI — an interesting visual move, premature in v1.
- **Wizard step animation chrome.** No slide/fade transitions in v1; opacity-only step gating per design-system §28.
- **Avatar interactivity (drag-rotate, click-zoom).** Auto-rotate only in v1.
- **A "saved drafts" surface** for half-finished spawns. Decision 20 closes the door; M6 if a real user complains.
- **Spawn-N from the spawn page.** Re-introduce later as a fleet-page "duplicate" or "scale-out" action, composing with M5's bulk-apply pattern.

---

## 3.5 Roster lineup — top-6 harnesses (Q11 / Q13 resolved)

Operator-ratified lineup for `frontend/src/lib/spawn/harnesses.ts`. Six cards (1 active + 5 locked) — one more than the original "top-5" framing because the operator provided six defensible entries; the layout absorbs the extra card cleanly (2-col on `md+`, 3-col on `xl+`, so 6 = 2×3 or 3×2, both balanced grids).

| # | Harness | Vendor | Status | One-line spec-sheet description |
|---|---|---|---|---|
| 1 | **Hermes Agent** | Nous Research | `AVAILABLE` | Green-dominant nebula per design-system §5.4. v1's only shipped harness |
| 2 | **OpenClaw** | (TBD by operator) | `LOCKED` | Operator-anchored. Final vendor / one-liner supplied at Phase 3 |
| 3 | **Claude Agent SDK** | Anthropic | `LOCKED` | General-purpose harness with automatic context compaction, file ops, code execution, MCP extensibility. Anthropic-native; benchmarks cited (Opus 4.5: 78% on CORE vs 42% w/ smolagents) |
| 4 | **DeepAgents** | LangChain (Harrison Chase) | `LOCKED` | Opinionated context-management + long-term memory + observability harness on LangGraph. Model-agnostic — works with any tool-calling LLM (Claude, GPT, Gemini) |
| 5 | **SuperAGI** | SuperAGI | `LOCKED` | Multi-agent orchestration framework (~15K GitHub stars). Dedicated memory + planning per agent; parallel specialist agents (Agent A monitors inbox; Agent B updates CRM) |
| 6 | **OpenFang** | OpenFang | `LOCKED` | Rust-based "Agent Operating System" (14.2K GitHub stars). 7 autonomous "Hands," 38 built-in tools, 40 messaging channels, 26+ LLM providers, 1,700+ tests |

**Replaces** today's `COMING_SOON_HARNESSES` (LangGraph + CrewAI + AutoGen) wholesale. LangGraph drops off because **DeepAgents is built on LangGraph** — listing both reads as redundant; DeepAgents is the higher-abstraction surface that operators are more likely to want as a pluggable harness, while LangGraph is the runtime underneath. CrewAI and AutoGen don't make the v1 cut for the same reason as the first draft (mindshare, not architecture).

**Per-harness mood palette assignments** (decision 6 generalized):

| Harness | Mood signature | Why |
|---|---|---|
| Hermes | green-dominant, cyan + violet accents | Per decision 6; ships first; agents-feature green |
| OpenClaw | TBD with operator | Vendor brand colour if any |
| Claude Agent SDK | warm amber + indigo | Anthropic brand-adjacent without using Anthropic's exact orange |
| DeepAgents | cool teal + violet | LangChain green-blue family, leans cool to differentiate from Hermes |
| SuperAGI | rose + amber | Warm, multi-agent "swarm" reading |
| OpenFang | steel-blue + indigo | Rust + "operating system" framing → cold, structural |

Mood divergence is the one per-card variable that matters; shape, sigma, particle count are shared (decision 5). Locked cards use the static SVG fallback (decision 13), so the moods above only render if a harness is later promoted to `AVAILABLE`.

---

## 4. Phasing

Vertical-slice phases. Each phase ends with `pnpm -C frontend type-check && lint && build` green. Each phase is independently shippable.

### Phase 1 — Route rename + sidebar copy + redirect shim

**Goal:** `/agents` becomes `/spawn` everywhere, with no behavior change. The page still renders the M4-shape grid + modal — visual redesign lands in Phase 2.

- Move `frontend/src/app/(app)/agents/page.tsx` → `frontend/src/app/(app)/spawn/page.tsx` (one-line component rename).
- New shim `frontend/src/app/(app)/agents/page.tsx`: `import { redirect } from "next/navigation"; export default function() { redirect("/spawn"); }`.
- `frontend/src/components/app-sidebar.tsx`: `label: "Agents", href: "/agents"` → `label: "Spawn", href: "/spawn"`.
- `frontend/src/app/(app)/spawn/page.tsx` H1: `AGENTS` → `SPAWN`; section tag `[ DEPLOY ]` → `[ LAUNCHPAD ]`.
- Search-and-update: any other internal `/agents` Link or router.push (sweep with `grep -rn "\"/agents\"" frontend/src`).
- **Phase 1 exit:** type-check + lint + build green; navigating to `/agents` 308-redirects to `/spawn`; nav highlights correctly on both URLs during the redirect window.

### Phase 2 — `<NebulaAvatar>` component (visual scaffold, no integration yet)

**Goal:** A drop-in `<NebulaAvatar harness="hermes" size={240} />` component that renders a green-dominant volumetric particle nebula, lazy-mounted on intersection, gracefully degrading to SVG.

- Add deps to `frontend/package.json`: `three@^0.160`, `@react-three/fiber@^8`. (Drop drei unless decision 18's audit requires it for `<OrbitControls>` — we don't use OrbitControls per decision 16.)
- New `frontend/src/components/spawn/nebula-avatar.tsx`:
  - Default-export `NebulaAvatar` wrapper: handles `prefers-reduced-motion`, IntersectionObserver lazy-mount, and the SVG fallback.
  - Inner `NebulaScene` is dynamic-imported with `ssr: false`.
  - Two layers (vs Elephantasm's three): `PrimaryCloud` (~2.5K pts) + `CoreMotes` (~500 pts). Wisp Tendrils dropped — too soft for a card-sized avatar.
  - Uniforms (`uTime`, `uLowAmp`, `uMidAmp`, `uCoherence`) per the recipe; animation loop matches elephantasm's irrational-frequency pattern.
  - Auto-rotate via `useFrame` (`y = t * 0.05; x = t * 0.02`); no `<OrbitControls>`.
  - `prefers-reduced-motion` short-circuits before the dynamic import — fallback renders.
- New `frontend/src/lib/spawn/mood-palettes.ts`: typed `MoodPalette` per harness key. Hermes per decision 6.
- New `frontend/src/components/spawn/avatar-fallback.tsx`: SVG schematic — a hairline pearl ellipse with the harness's accent color, static.
- Storybook-style harness if desired (NOT shipped): a `frontend/src/app/(app)/spawn/_dev/page.tsx` that renders three avatars side-by-side for visual review. Delete before merge.
- **Phase 2 exit:** type-check + lint + build green; bundle-size delta within decision 18 budget; visual review confirms nebula renders + degrades correctly with `prefers-reduced-motion: reduce`.

### Phase 3 — Roster page (replaces today's two-grid stack)

**Goal:** The Spawn page reads as a character roster — five cards (1 active + 4 locked) with `HARNESSES` framing per Q10.

- Rewrite `frontend/src/app/(app)/spawn/page.tsx`:
  - Header: `[ LAUNCHPAD ]` / `SPAWN` per Phase 1.
  - Single `TerminalContainer` titled `[ AVAILABLE HARNESSES ]` (Q10 vocabulary).
  - One `<RosterCard>` per template (active); one `<RosterCard locked />` per entry in `frontend/src/lib/spawn/harnesses.ts` (the slimmed top-5 list — see §3.5).
  - Layout: 1-col on `<md`, 2-col on `md+`, 3-col on `xl+`. Each card is ~440px tall (avatar/fallback = 240px square; spec strip = 200px).
- New `frontend/src/components/spawn/roster-card.tsx` (replaces today's `agent-template-card.tsx`):
  - Header: harness name + status pill (`AVAILABLE` cyan / `LOCKED` muted).
  - Body: 240×240 slot — `<NebulaAvatar>` for active cards, `<AvatarFallback>` (static SVG) for locked cards (decision 13). Per decision 21, only one canvas mounts page-wide.
  - Spec-sheet strip: 3 rows (HARNESS / ADAPTER / DEPLOY) for active; 3 rows (VENDOR / STATUS=`COMING SOON` / ETA where known) for locked.
  - Footer: single `› SELECT` button (active) or `[ LOCKED ]` static badge (locked).
- Replace `frontend/src/lib/agents/coming-soon.ts` with `frontend/src/lib/spawn/harnesses.ts` — the curated top-5 list per §3.5.
- Delete `frontend/src/components/agent-template-card.tsx` and `frontend/src/components/coming-soon-harness-card.tsx`.
- The empty / loading / error branches inside the page reuse design-system patterns (skeletons, terminal error line) — no new shapes.
- **Phase 3 exit:** type-check + lint + build green; spawn page renders the 5-card roster with exactly one nebula canvas mounted (Hermes); clicking the active card's `› SELECT` navigates to `/spawn/[templateId]`; clicking a locked card is a no-op (no cursor change, no hover lift); Lighthouse Performance score on the page ≥90 on a mid-range desktop profile.

### Phase 4 — Wizard route + step shell

**Goal:** `/spawn/[templateId]` renders a 5-step wizard skeleton per design-system §34, with step gating and in-memory state (no URL params per Q3). Steps are stub-content — real fields land in Phase 5.

- New `frontend/src/app/(app)/spawn/[templateId]/page.tsx`. Server component: fetches the template by ID (via the existing `listAgentTemplates` + filter; a dedicated `getAgentTemplate` RPC is a future cleanup, not in scope). 404 if not found.
- New `frontend/src/components/spawn/wizard.tsx` — client component owning step state in `useState` / `useReducer`. No `useSearchParams`. State: `{ confirmed: Set<StepKey>, current: StepKey, fields: WizardFields }`.
- 5 step containers, each a `TerminalContainer`:
  1. `[ STEP 1 // HARNESS ]` — read-only confirmation (template name + adapter digest), with the harness's `<NebulaAvatar>` rendered at ~180px to anchor the wizard visually (the *one* canvas allowed on this route per decision 21). Single `› Confirm` button.
  2. `[ STEP 2 // IDENTITY ]` — single `name` input. No spawn-N (Q5).
  3. `[ STEP 3 // MODEL ]` — provider select + model input + API key field (the three coupled credentials-of-the-model fields, one panel).
  4. `[ STEP 4 // DEPLOYMENT ]` — `lifecycle` (always-on default) + `replicas` (1 default). Other M5 knobs (region, size, volume, restart) rendered as real-interface `[ COMING WITH FLEET CONTROL ]` stub rows per blueprint §11.4.
  5. `[ STEP 5 // REVIEW ]` — read-only summary table (Harness / Name / Provider / Model / Lifecycle / Replicas — API key surfaces as `••••••••` with the last 4 chars only); `› DEPLOY AGENT` primary CTA per design-system §34.3 ("READY TO LAUNCH" green block).
- Step gating: only the current step is at full opacity; later steps `opacity-40 pointer-events-none`. Each step's `Confirm` advances; clicking a confirmed earlier step un-confirms it + every step after it.
- Step accent colors per design-system §34.1 with substitutions for the renamed steps: `STEP 3 // MODEL` → violet, `STEP 4 // DEPLOYMENT` → blue (matches Deploy Targets feature color §5.4).
- **Phase 4 exit:** type-check + lint + build green; navigating to `/spawn/<hermes-id>` shows all 5 steps with Step 1 active; confirming each advances; refresh resets the wizard to Step 1 (Q3 / decision 8).

### Phase 5 — Wizard fields wired to the existing RPC

**Goal:** The wizard actually deploys. Same `spawnAgent` RPC as today's modal; the UX is the wrapper.

- Step 2 field uses the same Zod schema as today's `deploy-modal.tsx` (`name min(1) max(80)`). No `namePrefix` / `count` (Q5).
- Step 3 fields use today's schemas for `provider`, `modelName`, `apiKey`. The API-key inline copy from today's modal carries over verbatim ("Forwarded once to the agent's secret store. Never written to Corellia's database.").
- Step 4 today: `lifecycle = "always-on" | "manual"` (default always-on); `replicas = 1` default. Both ignored by the existing M4 RPC — they're tracked in wizard state but **not sent on the wire** (the M4 `SpawnAgentRequest` has no fields for them). M5's wider proto adds them; this plan's Phase 5 then becomes a one-line `request.deployConfig = { lifecycle, replicas }` addition.
- Step 5 builds the request from accumulated state and calls `api.agents.spawnAgent` (single-spawn only — `spawnNAgents` is unreached from this UI per decision 11).
- **Streaming-log surface** per design-system §34.3 + decision 14: on `Deploy` click, the wizard transitions to a fixed-height terminal container with 4–6 live log lines synthesized client-side from the RPC lifecycle (`creating app… secrets set… launching… health-check…`). Real per-step events from the BE arrive in M5+ via streaming RPCs (decision 26 in fleet-control.md keeps polling); v1 of this plan synthesizes the log lines from RPC start + the existing fleet-page polling redirect.
- On success: same redirect-to-`/fleet` as today.
- **Phase 5 exit:** type-check + lint + build green; an end-to-end wizard run spawns Hermes successfully; an error in any step surfaces inline (per-field) or as a streaming-log error line on the deploy step.

### Phase 6 — Cleanup, docs, validation matrix

- Delete `frontend/src/components/agents/deploy-modal.tsx` (replaced by the wizard route).
- Delete `frontend/src/components/agent-template-card.tsx` if not already in Phase 3.
- Delete `frontend/src/lib/agents/coming-soon.ts` if moved in Phase 3.
- Update CLAUDE.md frontend layout note (one-line: spawn page is `/spawn`, wizard is `/spawn/[templateId]`).
- Update design-system.md §33.5 + §34 if any of the prescriptions diverged in implementation (e.g. step regrouping per decision 19 — re-paragraph §34.1).
- Add changelog entry per the existing convention (`0.X.0 — Spawn redesign: Roster + Character-Creation Wizard`). Match the structure of 0.7.1's entry.
- **Phase 6 exit:** full validation matrix green; manual smoke pass — sign in → `/spawn` → click Hermes → walk through the 5 steps → land on `/fleet` with the new agent.

---

## 5. Compatibility with M5 (`fleet-control.md`)

This plan is sequenced to land **before or independently of M5**. The wizard's Step 4 (Posture) is the integration point:

- **Today (post this plan):** Step 4 surfaces `lifecycle` + `replicas` only. Other M5 knobs render as `[ COMING WITH FLEET CONTROL ]` stub rows per blueprint §11.4. RPC payload uses M4 shape.
- **Post-M5 Phase 5:** the wider `DeployConfig` proto message arrives. Step 4's stub rows fill out (region dropdown, size preset, volume size, restart policy). M5's "Review" step (fleet-control.md Phase 6, decision 27) **collapses into this plan's Step 5** — the wizard already had a review step; M5's content slots into it.
- **No double-build:** the wizard structure remains 5 steps before and after M5. M5 changes the *contents* of Steps 4–5, not their existence.

If this plan ships *after* M5, Phase 5 of this plan adopts the M5 proto directly without the stub-row intermediate.

---

## 6. Out-of-scope clarifications (anti-scope-creep)

If any of these come up during execution, route to a separate plan; do not absorb here.

- **Per-harness avatar shape divergence** beyond palette + sigma. Out of v1.
- **Avatar interactivity** (drag, click-zoom). Out of v1.
- **Step transition animations** beyond opacity gating. Out of v1.
- **Saved-draft / resume-later flow.** Out of v1.
- **Wizard-from-fleet** (re-spawn an existing agent's config as a wizard prefill). M6+.
- **Per-org default loadouts** (paste API key once, default-into-every-spawn). v1.5+ (touches secrets architecture).
- **Mobile-first wizard layout.** Stacked-column fallback only.
- **A11y audit beyond `prefers-reduced-motion` and WCAG AA contrast.** Same posture as the rest of v1.

---

## 7. Validation matrix (Phase 6 acceptance)

- `pnpm -C frontend type-check && lint && build` clean.
- Bundle-size delta within decision 18 budget (audit `next build` output before / after).
- `/agents` → `/spawn` redirect works during the one-release shim window; shim deleted by Phase 6 close.
- Spawn page renders 5 cards (Hermes active + 4 locked per §3.5); Hermes avatar animates; locked cards show static SVG fallbacks (decision 13).
- **Exactly one `<canvas>` element in the DOM on the spawn page** (decision 21). DevTools verification.
- `prefers-reduced-motion: reduce` (DevTools rendering pane) collapses the active avatar to its SVG fallback.
- Wizard 5-step walkthrough end-to-end against a live BE — single-spawn path only (decision 11).
- Each step's `Confirm` gating works; editing Step 2 after confirming Steps 3–5 un-confirms 3–5.
- Refresh during the wizard resets to Step 1 (Q3 / decision 8). API key never appears in URL or browser history at any point.
- Streaming log surface renders 4+ lines on a successful spawn; surfaces an error line on a deliberate-fail (e.g. malformed API key).
- WCAG AA contrast holds on `#000000` for all text.
- **Performance gate: Lighthouse Performance score ≥90** on a mid-range desktop profile, both for the roster page and the wizard route (Q7 — UX flawless or it doesn't ship).

---

## 8. Open questions

All questions resolved (see §1.1). Plan is ready for Phase 1 on operator approval.

**Single non-blocking item:** OpenClaw's vendor + one-line description for the spec-sheet strip — backfillable at Phase 3 from a homepage link or GitHub README; the card renders with placeholder copy in the meantime so it doesn't gate the milestone.
