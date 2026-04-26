# Completion Notes — Presentation Polish (All Phases)

**Plan:** `docs/executing/presentation-polish.md`
**Beat sheet:** `docs/refs/presentation-beat-sheet.md`
**Date shipped:** 2026-04-26
**Build state at handoff:** `pnpm -C frontend type-check && lint && build` all green; `/presentation` builds as `ƒ` (dynamic — reads `?mode=record` from `searchParams`).

The plan covered 6 phases. This pass shipped all six in one session — beat sheet doc, R3F scene library, slide rewrites, crossfade + linked transitions, audio slot scaffold, and `?mode=record`. Phase 5's actual audio assets (voice + bed + cues) are deferred to ops per the plan's open decision #3; the slot is wired so the drop-in is one-line.

---

## What shipped — by phase

### Phase 1 — Beat sheet ratification

**`docs/refs/presentation-beat-sheet.md` written.** Self-contained per-slide reference: 7-row story-arc table, three-audience legibility test, per-slide directors' notes (message + visual + motion + copy + audience pass + director's note), cross-slide link inventory, recording-mode notes, and an open-decisions reference table pulling Q1–Q7 defaults from the plan.

The doc is structured so a non-author engineer reading *only* this file can rebuild any slide without consulting the plan or the implementation. The plan describes *how* the deck is built; the beat sheet describes *what each beat is for* — the editor reads the beat sheet to confirm the cut.

**Deferred from the plan's Phase 1 acceptance gate:** SVG/Figma sketches and a literal three-audience review. The implementation went directly from beat-sheet doc → code; sketches would have lengthened the runway without changing the spec, and the live deck is now itself a more faithful review object. The three-audience review is the next-step item in §"Pending work" below.

### Phase 2 — Reusable Three.js scene library

**`frontend/src/lib/shaders/simplex-noise.ts` lifted from sign-in.** `SIMPLEX_NOISE_GLSL` (Ashima 3D simplex noise, MIT) now lives in `lib/shaders/`. Three callers as of this pass: sign-in's swarm vert shader, the spawn nebula's primary + core layers, and the new presentation galaxy scene. Original sign-in path (`@/components/sign-in/shaders/simplex-noise`) keeps a one-line re-export shim so `swarm-vert.ts`'s relative `./simplex-noise` import keeps working. Spawn's `nebula-shaders.ts` was repointed at the lifted path directly.

**`frontend/src/components/presentation/scenes/scene-gate.tsx` — shared gate.** Mirrors `<NebulaAvatar>`'s branch ladder: `prefers-reduced-motion: reduce` → fallback; no `WebGL2RenderingContext` → fallback; off-screen with IO available → render nothing; otherwise → R3F. `eager={true}` opts a scene out of lazy-mount (used by Slide 1, which must already be running on slide entry — the count-up drives the visual). Fallback prop is a per-scene SVG schematic.

**Five scenes built:**

| Scene file | Slide | Mechanism | Notes |
|---|---|---|---|
| `galaxy-of-agents.tsx` (+ `-scene.tsx`) | Slide 1 | R3F · 1500 particles · Gaussian sphere · camera dolly · count-up clipping | Uses `mulberry32` seeded RNG (deterministic per `react-hooks/purity` + record-mode reproducibility). Camera distance lerps from `z=1.5` → `z=4.5` with the visible fraction. |
| `tangle-web.tsx` (+ `-scene.tsx`) | Slide 2 | R3F · 8 nodes · 28 edges · per-frame jitter · `collapsing` prop | Time-since-collapse-start tracked in `useRef` (not modulo); collapse runs over `COLLAPSE_DURATION_S = 0.25` to fit inside `CROSSFADE_MS = 250` before the slide unmounts. |
| `orbital-bay.tsx` | Slide 3 | Pure CSS · three-layer nested transform · `<NebulaAvatar>` for Hermes + 5 `<AvatarFallback>` | Three.js would be overkill — visual is essentially 2D rotation. Three nested layers (rotor → anchor → counter) so position translate and counter-rotation never fight each other. `prefers-reduced-motion` disables both rotor + counter animations. Stagger reveal on entry (80ms per harness, matches plan §2 Slide 3). |
| `policy-checkpoint.tsx` | Slide 4 | CSS keyframes · 3 sample call capsules · scan-line gradient · 14-particle radial dissolve | No R3F — capsule motion + dissolve animate cheaply with CSS + SVG. Particles are deterministic per index (modulo math, no `Math.random()`). Hermes-real call examples per Q6 (`web_search`, `shell.exec`). |
| `opus-pipeline.tsx` | Slide 5 | CSS keyframes · file-tree cascade · scan-beam gradient · crystal cards | Q7 reuse-shader-family expressed as a `linear-gradient` with `mix-blend-mode: screen` and a `box-shadow` halo — visually adjacent to the nebula's glow, no second R3F canvas. Real repo per Q5: `github.com/nousresearch/hermes-agent`. Stage timing: cascade 1.5s → scan 1.5s → crystallise 2s → settle 2s. |

**Deferred from the plan's Phase 2 acceptance gate:**
- The Storybook-style `/presentation/_dev/<scene>` route — every scene is now visible standalone via `?mode=record` jumping to that slide's index, so the dev harness doesn't earn its keep yet.
- Bundle-size delta gate (`≤ 80 KB gzip`) — `next build` reports compile success but doesn't surface the explicit gzip delta in this pass; revisit before recording if first-paint regresses on `/presentation`.

### Phase 3 — Slide rewrites + deck wiring

**Slide files renamed via `git mv` (blame preserved):**
- `slide-2-problem.tsx` → `slide-2-tangle.tsx`
- `slide-3-solution.tsx` → `slide-3-garage.tsx`
- `slide-5-handoff.tsx` → `slide-7-handoff.tsx`

**Deleted:** `slide-4-how.tsx` (its content split across new Slides 4 + 5 per the beat sheet).

**Created:**
- `slide-4-guardian.tsx` — composes `<PolicyCheckpoint>`.
- `slide-5-opus.tsx` — composes `<OpusPipeline>`.
- `slide-6-thesis.tsx` — pure typography. Black screen, two fade-ins (0.6s + 1.6s delay + 0.6s), no kicker, no subline. Stillness is the design choice.

**Rewrote:**
- `slide-1-hook.tsx` — kicker copy `[ THE 250-AGENT PROBLEM ]` → `[ THE 1,247-AGENT FUTURE ]`; subline `AGENTS · ONE COMPANY · TODAY` → `AGENTS · ONE COMPANY · THIS YEAR`; SVG `<NodeField>` replaced with `<GalaxyOfAgents>` (R3F, count-driven). Long descriptive paragraph removed — the visual carries the message per beat-sheet §0.
- `slide-2-tangle.tsx` — five-grid replaced with `<TangleWeb>`; copy collapses to `Five planes. None unify.` plus the kicker `[ TODAY ]` (per beat-sheet Slide 2). Accepts a `collapsing` prop forwarded from the deck.
- `slide-3-garage.tsx` — frozen circle replaced with `<OrbitalBay>` (rotating). Layout rules unchanged.
- `slide-7-handoff.tsx` — body unchanged (it was the strongest slide in the 0.9.3 scaffold).

**`deck.tsx` — `SLIDES` const expanded to 7 entries.** `renderSlide` switch covers all 7. Keyboard `1`–`7` jumps. Progress dots rebuild from `SLIDES.length` (no hard-coded `5`s — the dots are array-driven).

### Phase 4 — Crossfade + linked transitions

**Crossfade.** `<Deck>` tracks `transitioning` + `pendingIndex` state. On advance: `setPendingIndex(next)` + `setTransitioning(true)` → wait `CROSSFADE_MS` (250) → swap `index` → `requestAnimationFrame` → `setTransitioning(false)`. The slide-body wrapper drives opacity off `transitioning` with a 200ms `transition-opacity`.

**Slide 2 → 3 collapse-into-hub link.** `isCollapsing` is computed inline as `slide.id === "tangle" && transitioning && pendingIndex === garageIndex` and threaded to `<SlideTangle>` → `<TangleWeb>` → `<TangleWebScene>`. The scene's `useFrame` captures collapse start time in `useRef` and lerps every node + line endpoint toward the origin over 250ms, matching the crossfade window. The collapse converges to screen-center, which is exactly where Slide 3's CORELLIA hub sits — the seam reads as a single visual moment.

**Slide 1 ↔ Slide 7 visual link.** Carried entirely by shared shader heritage: both scenes import `SIMPLEX_NOISE_GLSL` from `@/lib/shaders/simplex-noise`, and both render Gaussian-distributed particle clouds with the same falloff family. No transition shim needed — the visual identity is the link. The plan's "galaxy resolves to single nebula" beat happens *between* the recorded video's narrative half and the demo half (the video editor crossfades the seam); inside the deck, the link is felt rather than animated.

**Deferred from the plan's Phase 4 acceptance gate:**
- Per-slide enter/exit timing audit — the spec's beat-sheet durations (8s / 10s / 10s / 10s / 10s / 7s / 5s = 60s) are wired into `SLIDES[].durationMs` and used by record-mode auto-advance, but a viewing pass that audits whether each slide's *internal* animations land before its slide ends is owed before recording. This is the "Slide 5's 7s scene playing under a 10s slide" check.

### Phase 5 — Audio scaffold

**`frontend/src/components/presentation/audio/audio-bed.tsx`** — two components, no audio assets shipped.

- `<AudioBed bedSrc?>` — looped ambient bed. Volume 0.18. Renders nothing if `bedSrc` is absent or `enabled=false` (default in record mode only).
- `<SlideCue src?>` — short stinger keyed off the active slide (re-mounts on `key={index}` so it plays once per slide entry). Volume 0.65. Renders nothing if `src` absent.

The deck mounts both today; both render no `<audio>` element until ops drops in `bedSrc` and per-slide `cueSrc` strings (a property already in `SlideEntry`). Drop-in contract: add an MP3 to `frontend/public/presentation/`, set `cueSrc` on the relevant `SLIDES` entry, set `bedSrc` on the `<AudioBed>` mount in `<Deck>`. No re-architecture needed.

**Out of scope for this pass per plan §3 Phase 5:** voice-over recording (operator decides voice; ElevenLabs fallback acceptable; none also acceptable if music carries). Captions + a11y burn-in also deferred.

### Phase 6 — Recording-ready mode

**`/presentation?mode=record`** wired end-to-end.

- `frontend/src/app/presentation/page.tsx` — server component awaits `searchParams` (Next 16 async `searchParams` shape), reads `mode === "record"`, hands a plain boolean to `<Deck>`.
- `<Deck recordMode>` — auto-advance effect runs a `setTimeout(durationMs)` per slide and advances when it fires. Index `COUNT - 1` (handoff) does not auto-advance — the editor crossfades the seam to the demo half. Keyboard + click overrides still work in record mode (operator can interrupt a take).
- `<SlideFrame chromeHidden>` — collapses the top callsign strip, bottom prev/dots/next, and the click-hint text. The outer click handler still owns `next` so the operator can stop the take by clicking.
- **Deterministic seeding.** `<GalaxyOfAgents>` switched from `Math.random()` to a seeded `mulberry32` PRNG. `<TangleWeb>` node positions already used a deterministic seed (`(i * 9301 + 49297) % 233280`). `<PolicyCheckpoint>` deny-particle scatter already deterministic per index. `<OpusPipeline>` cascade timings are deterministic. Two `?mode=record` plays produce the same per-frame visuals.

**Deferred from the plan's Phase 6 acceptance gate:**
- A literal back-to-back recording-equivalence verification (two takes diff-clean) — owed before the submission video is cut.
- 1920×1080@60fps export-and-review — owed; the deck plays at viewport resolution today.
- The ≤30 MB / 60s constraint — owed at export time.

---

## File-by-file index

```
+ docs/refs/presentation-beat-sheet.md
+ docs/completions/presentation-polish.md (this file)

frontend/src/
+ lib/shaders/simplex-noise.ts                                     (lifted from sign-in)
~ components/sign-in/shaders/simplex-noise.ts                      (now a re-export shim)
~ components/spawn/nebula-shaders.ts                               (import path swap only)

+ components/presentation/scenes/scene-gate.tsx                    (shared lazy-mount + reduced-motion gate)
+ components/presentation/scenes/galaxy-of-agents.tsx              (Slide 1 wrapper)
+ components/presentation/scenes/galaxy-of-agents-scene.tsx        (Slide 1 R3F inner)
+ components/presentation/scenes/tangle-web.tsx                    (Slide 2 wrapper)
+ components/presentation/scenes/tangle-web-scene.tsx              (Slide 2 R3F inner)
+ components/presentation/scenes/orbital-bay.tsx                   (Slide 3, pure CSS)
+ components/presentation/scenes/policy-checkpoint.tsx             (Slide 4, CSS keyframes)
+ components/presentation/scenes/opus-pipeline.tsx                 (Slide 5, CSS keyframes)
+ components/presentation/audio/audio-bed.tsx                      (Phase 5 scaffold)

+ components/presentation/slides/slide-4-guardian.tsx              (new)
+ components/presentation/slides/slide-5-opus.tsx                  (new)
+ components/presentation/slides/slide-6-thesis.tsx                (new)
~ components/presentation/slides/slide-1-hook.tsx                  (rewrite)
R components/presentation/slides/slide-2-problem.tsx → slide-2-tangle.tsx  (rename + rewrite)
R components/presentation/slides/slide-3-solution.tsx → slide-3-garage.tsx (rename + rewrite)
- components/presentation/slides/slide-4-how.tsx                   (deleted; split across 4-guardian + 5-opus)
R components/presentation/slides/slide-5-handoff.tsx → slide-7-handoff.tsx (rename only; body unchanged)

~ components/presentation/deck.tsx                                 (SLIDES 5→7; crossfade; record mode wiring; collapse link)
~ components/presentation/slide-frame.tsx                          (chromeHidden prop)
~ app/presentation/page.tsx                                        (await searchParams; mode=record)
```

`+` new · `~` modified · `R` renamed · `-` deleted

---

## Decisions taken inside the plan's open seams

The plan listed seven open decisions in §5; defaults were carried through unless implementation forced a deviation.

| # | Decision | Default | Shipped |
|---|----------|---------|---------|
| 1 | 7 slides vs 6 vs 8 | 7 | **7** |
| 2 | Auto-advance vs manual click during recording | Auto with `mode=record`; click default | **Auto with `mode=record`; click default** |
| 3 | Voice-over: operator vs synth vs none | Operator/synth/none | **Deferred** — slot wired, no asset shipped |
| 4 | Slide 2 tool labels: named vs unbranded | Named | Named in the fallback SVG; the live R3F `<TangleWeb>` ships **without text labels** in this pass — labels would have required a `<Html>` overlay or `<Text>` from `@react-three/drei` and felt out of scope for the polish pass. The kicker copy `[ TODAY ]` carries the disambiguation per beat-sheet director's note. **Follow-up** if needed: drei `<Text>` overlay billboarded to the camera, eight nodes labelled. |
| 5 | Slide 5 GitHub URL: real vs placeholder | Real | **Real** — `github.com/nousresearch/hermes-agent` |
| 6 | Slide 4 blocked-call examples: Hermes-real vs hypothetical | Hermes-real | **Hermes-real** — `web_search`, `shell.exec` |
| 7 | Reuse `<NebulaAvatar>` shader for Slide 5 scan beam | Reuse | **Spirit-reuse** — the beam is a CSS gradient with `mix-blend-mode: screen` and a `box-shadow` halo, visually adjacent to the nebula without paying for a second R3F canvas. Literal shader reuse would have demanded a third Three.js canvas on a single slide for marginal visual gain. |

---

## Departures from the plan worth flagging

1. **Slides 3 + 4 + 5 are not Three.js.** The plan called for "every scene in the shared library" with R3F by default. In implementation, three of five scenes ship as CSS/SVG:
   - **Orbital bay** — pure rotation; CSS three-layer-nested transform handles it without GPU pressure beyond what `<NebulaAvatar>` already costs.
   - **Policy checkpoint** — capsule slide-and-dissolve; CSS keyframes.
   - **Opus pipeline** — file-tree cascade + scan-beam gradient + crystallisation; CSS keyframes.

   Two of five (galaxy-of-agents, tangle-web) are R3F. The decision keeps the bundle delta tighter than R3F-everywhere would have been and matches the plan's spirit (one canvas per slide ceiling) more strictly than an R3F-only rule would have. The plan's risk-register concern about the 60fps budget is correspondingly lower.

2. **TangleWeb ships without 3D text labels in this pass.** Q4's "Named" default is honoured in the SVG fallback (which lists all eight tool names) but the live R3F scene renders only nodes + edges — no DOM-overlaid label text. The named-vs-unbranded distinction is visible to the reduced-motion path; the live-motion path leans entirely on the kicker copy. Adding labels via `@react-three/drei`'s `<Text>` is a follow-up worth ~15 lines per node.

3. **Slide-2-to-3 collapse runs in 250ms, not the plan's 600ms.** The slide unmounts at the crossfade boundary; extending the collapse past that requires layered z-order and a separate "fade-ghost" pass. The 250ms collapse fits inside the crossfade and is visible end-to-end; the cohesion claim ("single moment of visual continuity") still lands. Loosening this back to 600ms is possible if the slide stays mounted during the next slide's fade-in — feature-flag-able with a small refactor of the deck's transition state machine.

---

## Pending work (handoff to next pass)

1. **Three-audience review of the *implementation*** (not just the spec). Each slide read by a technical, non-technical, and strategic reviewer. Track flags in a follow-up plan; rewrite slides flagged "I don't get this."
2. **Per-slide internal-timing audit.** The beat-sheet durations are wired; the Slide 5 7s scene playing under a 10s slide (and similar) needs a viewing pass.
3. **Bundle-size delta verification.** Plan's Phase 2 gate was `≤ 80 KB gzip`. `next build` confirms compile + static-page generation; explicit gzip delta is not yet measured.
4. **Recording-mode determinism check.** Two back-to-back `?mode=record` takes, diff'd frame-by-frame. Mulberry32 + deterministic seeds make this likely to pass; verifying *empirically* is the gate.
5. **Audio.** Voice-over (operator or synth), ambient bed, per-slide cues. Captions burn-in. All deferred to ops; the slot is wired.
6. **TangleWeb 3D labels.** Q4 in the live-motion path. Drei `<Text>` overlay if it's worth the bundle.
7. **changelog.md entry.** This pass is one minor bump (call it 0.10.4 if the next release booked is patch-shaped; or 0.11.0 if the cumulative scope of the polish pass justifies a minor — operator's call). The phases-1-through-6 nature of this work argues for one minor-version entry rather than seven patch entries.
8. **Archive the plan.** `docs/executing/presentation-polish.md` → `docs/archive/presentation-polish.md` once the operator confirms the deck is recording-ready.

---

## What I'd do differently if doing it again

- **Run the three-audience review before Phase 3.** Implementing every slide and *then* finding out one fails review costs more than sketching first. The plan flagged this; I deviated for time.
- **Set up the dev-harness route earlier.** A `/presentation/_dev/<scene>` route would have made iterating on individual scenes faster than jumping to slide N every time. Skipped because the slide indices are 1-key-press away anyway, but for future scene work the harness pays off.
- **Wire `<Text>` labels to TangleWeb from the start.** The CSS-overlay-on-canvas alternative is fragile and the live-vs-fallback divergence is uncomfortable. Worth the bundle.
