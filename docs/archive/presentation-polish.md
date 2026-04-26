# Implementation Plan — Presentation Polish (Hackathon Submission Deck)

**Status:** ready for review; awaiting kick-off
**Owner:** TBD
**Target end-state:** the `/presentation` deck is a 60-second narrative half of the 3-min hackathon submission video, hitting impactful, atmospheric, and clear at every beat — legible to the Anthropic CEO, an AI research engineer, and a non-technical viewer simultaneously.

**Plan inputs (the "why" — do not relitigate here):**
- Existing scaffold (0.9.3): `frontend/src/app/presentation/`, `frontend/src/components/presentation/`, `docs/archive/presentation-plan.md` (deferred-polish list)
- Vision: `docs/vision.md` (the "garage of harnesses" + admin model)
- Strategic framing: `docs/blueprint.md` §15 ("Deployment is a commodity; governance is the product.")
- Reusable visual primitives: `<NebulaAvatar>` (R3F shader nebula), `<TerminalContainer>`, `<AvatarFallback>`, login-page particle field, design-system colour tokens

---

## 0. Goal + the three-audience test

The 0.9.3 deck shipped as a navigable scaffold ("copy + layout + timing locked first; 3D scene polish deferred to the design phase"). This plan **closes the polish gap** — and uses the closure to revisit the beat sheet, because the deferred polish exposes a deeper issue: a slide whose visual is "five bordered boxes lighting up in sequence" was never going to do the rhetorical work the slide claimed to.

**Every slide must pass three legibility tests simultaneously:**

| Audience | What they need | Test for each slide |
|---|---|---|
| **Anthropic CEO** (or a partner-level GP) | Market thesis, leverage, defensibility, why now, why us | Could a non-technical investor describe the company in one sentence after this slide? |
| **AI research engineer** | Technical correctness, novel architecture, governance primitive, the harness contract | Does the technical claim hold up to a skeptical second look? Is anything overstated? |
| **Non-technical viewer** | What does this *do for someone*; is it real | Could a domain non-expert picture themselves (or their team) using it? |

A slide that passes one test and fails the other two is rewritten, not patched. **Visual carries the message; copy is captioning.** If the slide's animation doesn't *embody* the claim, the claim doesn't land — viewers don't read decks, they feel them.

---

## 1. Story beat sheet (the *what* before the *how*)

The narrative half of the video is **60 seconds** for ~7 slides — averaging 8–9 seconds per slide. Tight beats, tension-then-release rhythm. The other 120 seconds of the 3-min video belong to the demo half (live `/spawn` walkthrough recorded separately) — the deck's job is to **set up** the demo, not show it.

```
0:00 ─ 0:08   HOOK         "The future is a thousand agents per company."
0:08 ─ 0:18   TANGLE       "Today, governing them is a mess."
0:18 ─ 0:28   GARAGE       "Corellia is one place. Any harness."
0:28 ─ 0:38   GUARDIAN     "Per-agent scopes. Revoke without restart."
0:38 ─ 0:48   OPUS LOOP    "Any agent on GitHub. Adapter by Opus 4.7."
0:48 ─ 0:55   THESIS       "Deployment is a commodity. Governance is the product."
0:55 ─ 1:00   HANDOFF      "Let's spawn one."  →  /spawn
```

The current deck's slide 4 ("How it works") collapsed two ideas (architecture + Opus) into a single slide that under-served both. This split — Garage / Guardian / Opus as three discrete beats — gives each idea a beat of its own and lets the animation *be* the metaphor.

---

## 2. Recommended deck — slide-by-slide spec

7 slides. Each slide gets: **message** (one sentence), **visual** (what fills the screen), **motion** (the animation that *is* the metaphor), **copy** (what text appears), **audience pass** (which test it carries).

### Slide 1 — HOOK · "1,247"

**Message:** the future of work has a thousand AI agents per company, and that future is already arriving.
**Visual:** **Three.js galaxy of agents.** A single point of light at screen-center; the camera dollies back as ~1,247 particles materialise one-by-one in 3D space, scattering in a soft volumetric cloud. By the end the viewer is looking at a galaxy from outside.
**Motion:** 2.2s count-up overlaid on the materialisation; particles spawn at the rate of the count, easing-cubic. Camera distance scales linearly with count. Final state: galaxy slowly rotating, viewer at rest.
**Copy:** `[ THE 1,247-AGENT FUTURE ]` (kicker) · `1,247` (count, oversized) · `agents · one company · this year` (subline). No paragraph block — the visual carries the weight.
**Audience pass:** non-technical (the number *is* the message), CEO (scale = market). Research engineer accepts it as setup, not technical claim.

### Slide 2 — TANGLE · "Today this looks like a mess."

**Message:** the current toolchain doesn't unify; it sprawls.
**Visual:** **Chaotic 3D web.** Eight tool labels (LangGraph, Composio, Portkey, LangSmith, Fly, AWS, AgentOps, LiteLLM) drift in 3D as semi-transparent panels. ~80 dashed lines tangle between them — many-to-many, no center, deliberately ugly. The whole structure jitters faintly, as if straining.
**Motion:** lines draw in over the first 2s in a rapid scribble; once drawn, the structure pulses with low-amplitude noise (the "this is barely holding together" feel). On exit, the tangle collapses inward to a single point, transitioning into Slide 3's Corellia hub.
**Copy:** `[ TODAY ]` · `Five planes. None unify.` (single sentence, top-anchored so the chaos is the focus). No tool-name lighting sequence — the *tangle itself* is the message.
**Audience pass:** non-technical (visual chaos = problem), CEO (no incumbent owns this), research engineer (sees tools they recognise without us editorialising about them).

### Slide 3 — GARAGE · "Pick a harness. Like picking a car."

**Message:** Corellia unifies that mess into one place; harnesses are pluggable.
**Visual:** **Orbiting bay of 6 harnesses around the CORELLIA hub.** Reuses `<NebulaAvatar>` for Hermes (lit, 140 px); five `<AvatarFallback>` SVG schematics for the locked harnesses (dimmed, 100 px). Hub is a luminous monolith at center.
**Motion:** the bay slowly rotates (~30s/turn — perceptible, not distracting). Connection lines from hub to each harness draw in sequence as the slide enters (left-to-right, 80ms stagger). Hermes pulses faintly (alive). The other five drift quietly. **The diagram is no longer frozen.**
**Copy:** `[ THE GARAGE ]` · `One control plane.` (large) · `Any harness. Any provider.` (subline, muted). Bottom caption: `pick a harness like picking a car`.
**Audience pass:** non-technical (the metaphor lands instantly), CEO (multi-vendor positioning visible), research engineer (sees the harness-interface concept architecturally).

### Slide 4 — GUARDIAN · "Per-agent scopes. Revoke without restart."

**Message:** the substantive product claim — Corellia governs *what each agent can do*, not just deploys them.
**Visual:** **Tool-call inspection visualised as a checkpoint.** A horizontal flow: agent (left) → checkpoint icon (center, the `corellia_guard` plugin) → tool target (right). Three sample requests stream through one at a time:
  - `web_search("wiki.acme.com")` → ✓ allowed (green, passes through)
  - `shell.exec("rm -rf /")` → ✗ blocked (red, dissolves at the checkpoint)
  - `web_search("evil.com")` → ✗ blocked (red, dissolves)
**Motion:** each request appears as a small text capsule that slides left-to-right, pauses at the checkpoint for ~150ms while a hairline scan-line crosses it, then either passes (cyan) or dissolves into pixels (failed-red). 3-call sequence over ~6s.
**Copy:** `[ THE GUARDIAN ]` · `Per-agent scopes.` (large) · `Revoke without restart.` (subline). Bottom caption: `every tool call passes through a policy you wrote.`
**Audience pass:** research engineer (this is the technically novel part — the in-Hermes plugin, `pre_tool_call`, scope.json hot-reload), CEO (governance = enterprise sale), non-technical (the green/red metaphor needs no decoding).

### Slide 5 — OPUS LOOP · "Any agent on GitHub."

**Message:** Corellia integrates *any* harness from a public repo; Opus 4.7 reads the repo and writes the adapter.
**Visual:** **The Anthropic angle, rendered as visual magic.** Three-stage scene:
  1. A GitHub URL appears (`github.com/<any-agent-repo>`). The URL "unfolds" into a 3D file tree (animated tree-sitter parse — small file glyphs cascading downward).
  2. A horizontal scan beam labelled `OPUS 4.7` sweeps across the tree, top-to-bottom. Each file glyph dims as it's read. ~1.2s sweep.
  3. Two artefacts crystallise on the right: `corellia.yaml` and `adapter image` — both materialise from particles condensing into rectangular cards.
**Motion:** stages 1→2→3 in 7s total. Tree cascade (1.5s), scan sweep (1.5s), crystallisation (2s), settle (2s). The scan beam uses the same shader family as the nebula (visual-language continuity).
**Copy:** `[ OPUS IN THE LOOP ]` · `Any agent on GitHub.` (large) · `Adapter generated by Opus 4.7.` (subline, accent-violet). Bottom caption: `tree-sitter + readme + dockerfile → validated manifest.`
**Audience pass:** research engineer (programmatic adapter generation is a real architectural decision per `blueprint.md` §4), CEO (the Anthropic-angle hackathon judge sees themselves in the product), non-technical (input → magic → output is universally legible).

### Slide 6 — THESIS · "Deployment is a commodity. Governance is the product."

**Message:** the strategic mic-drop. Why this is the right wedge.
**Visual:** **Black screen. White text. Nothing else.** Two lines, large, centered. `Deployment is a commodity.` (line one, top, slightly muted). `Governance is the product.` (line two, bottom, full-bright).
**Motion:** line one fades in over 0.6s, holds 1s, then line two fades in over 0.6s. Both hold for 4s. **Stillness is the design choice** — every other slide moves; this one doesn't, and the contrast lands the line.
**Copy:** as above. No kicker, no subline.
**Audience pass:** CEO (the framing they'd want to repeat), research engineer (recognises the Stripe/Linear-style positioning bet), non-technical (one short sentence; understands without deconstruction).

### Slide 7 — HANDOFF · "Let's spawn one."

**Message:** the deck *becomes* the product. Demo follows.
**Visual:** **Hermes `<NebulaAvatar size={320}>` center-stage**, single CTA below.
**Motion:** the nebula is already alive (continuous shader animation from `<NebulaAvatar>`). On entry, the kicker + headline crossfade in over 0.8s; the CTA button lifts in 0.3s later.
**Copy:** `[ HANDOFF ]` · `Let's spawn one.` (huge, centred) · `› ENTER THE CONTROL PLANE` (button, routes to `/spawn`) · `(live demo follows)` (footnote).
**Audience pass:** universal — the product picks up where the deck leaves off.

---

## 3. Phasing

Each phase has a goal, a concrete deliverable, an acceptance gate, and an explicit out-of-phase list. Ship cadence: **one minor version per phase** (per the project's existing 0.x cadence), with patch hotfixes inside phases.

### Phase 1 — Beat sheet ratification + visual brief

**Goal:** lock the *story* before any code. The 0.9.3 scaffold's mistake was building before the beats were tested.
**Deliverables:**
- `docs/refs/presentation-beat-sheet.md` — the table from §1 + per-slide one-paragraph director's note. **Not** a re-statement of this plan; a self-contained reference for the implementer.
- Story-board sketches (SVG or Figma mock per slide, just shapes + arrows + text) — sufficient for a non-author engineer to build to.
- Three-audience test results: each slide reviewed by reading-level proxies (one technical, one non-technical, one strategic). Notes recorded.
**Acceptance gate:** the 7-slide beat sheet survives the three-audience review without a slide being flagged "I don't get this." If a slide gets flagged, it's rewritten before Phase 2 starts.
**Out of phase:** any code, any 3D scenes, any motion. Pure narrative.

### Phase 2 — Reusable Three.js scene library

**Goal:** every slide that needs a 3D scene reaches into a shared component library. No per-slide ad-hoc R3F setup.
**Deliverables:**
- `frontend/src/components/presentation/scenes/galaxy-of-agents.tsx` — particle galaxy with `count` prop and camera-pullback animation. Used by Slide 1.
- `frontend/src/components/presentation/scenes/tangle-web.tsx` — 3D tool-label panels + dashed line web with strain-noise pulse. Slide 2.
- `frontend/src/components/presentation/scenes/orbital-bay.tsx` — rotating harness bay around a hub. Slide 3.
- `frontend/src/components/presentation/scenes/policy-checkpoint.tsx` — horizontal request-stream + scan-line + dissolve effect. Slide 4.
- `frontend/src/components/presentation/scenes/opus-pipeline.tsx` — file-tree cascade + scan beam + crystallisation. Slide 5.
- All scenes share the `IntersectionObserver` lazy-mount pattern from `<NebulaAvatar>`, the WebGL2 + reduced-motion gates, and the design-system colour tokens. Common shader utilities live in `frontend/src/lib/shaders/` (lift `SIMPLEX_NOISE_GLSL` here per the 0.9.0 open seam).
**Acceptance gate:** each scene renders standalone in a Storybook-style harness route (`/presentation/_dev/<scene>`) at 60fps on an M-series MacBook; reduced-motion fallback is a static SVG schematic per scene; bundle size delta ≤ 80 KB gzip total (R3F + three are already loaded).
**Out of phase:** the slide compositions themselves (Phase 3); audio (Phase 5).

### Phase 3 — Slide rewrites

**Goal:** rewrite each existing slide to its Phase-1 spec, composing Phase-2 scenes.
**Deliverables:**
- `slide-1-hook.tsx` rewritten — count-up still drives the beat, but the SVG node-field is replaced with `<GalaxyOfAgents>`.
- `slide-2-problem.tsx` rewritten — five-grid replaced with `<TangleWeb>`; copy collapses to one sentence.
- `slide-3-solution.tsx` rewritten — frozen circle replaced with `<OrbitalBay>`; layout rules unchanged but the diagram is now alive.
- `slide-4-how.tsx` **deleted** — its content splits across new Slides 4 (Guardian) and 5 (Opus Loop).
- New: `slide-4-guardian.tsx` — composes `<PolicyCheckpoint>`.
- New: `slide-5-opus.tsx` — composes `<OpusPipeline>`.
- New: `slide-6-thesis.tsx` — pure typography, no scene.
- `slide-5-handoff.tsx` renamed to `slide-7-handoff.tsx`. Body unchanged (it's the strongest slide today).
- `deck.tsx` — `SLIDES` const updated to 7-entry list; keyboard `1`–`7` jumps; progress dots rebuild from the array (no hard-coded `5`s).
**Acceptance gate:** click-through end-to-end at 60fps; reduced-motion fallback works for every slide; type-check + lint + build green; manual three-audience review of the *implementation* (not just the spec) flags zero "I don't get this."
**Out of phase:** audio (Phase 5); video-export tuning (Phase 6).

### Phase 4 — Transitions + pacing pass

**Goal:** the slide-to-slide seams stop feeling like cuts and start feeling like a single sustained sequence.
**Deliverables:**
- Crossfade between slides (250ms) replacing today's hard mount/unmount.
- **Slide-2-to-3 collapse-into-hub transition** (the tangle compresses into a point that becomes Slide 3's hub — single moment of cohesion across slides).
- **Slide-7's nebula present from Slide 1's galaxy** (the "1,247 agents" visual *resolves* into the single Hermes nebula at handoff — story-arc unity).
- Per-slide enter/exit timing audit; any animation longer than its slide duration shortened or paced down.
**Acceptance gate:** the deck plays end-to-end at the keyboard's auto-advance pace and reads as a single piece, not seven; the Slide-2→3 and Slide-1↔7 visual links are noticeable on a second viewing.
**Out of phase:** audio (Phase 5).

### Phase 5 — Audio + voice (optional but recommended)

**Goal:** the deck is a hackathon submission *video* — sound carries half the impact.
**Deliverables:**
- A 60-second voice-over track recorded against the locked timing. Owner: ops decides voice (operator vs synth — see open decision #3).
- A subtle ambient bed under the entire deck (low-frequency drone or pad, design-system mood).
- Per-slide audio cues: a soft chime at Slide 1's "1,247" landing, a low hit at Slide 6's mic-drop, a swell at Slide 7's CTA.
- Captions burned in (accessibility + audience can mute).
**Acceptance gate:** plays cleanly at 50% volume; captions readable; reduced-motion users get the full audio (audio is not a motion preference).
**Out of phase:** none — this is the polish phase.

### Phase 6 — Recording-ready

**Goal:** the deck is ready to record into the submission video.
**Deliverables:**
- A `/presentation?mode=record` query-param mode that disables the keyboard hints, hides the progress dots, auto-advances on a fixed timeline, and ensures deterministic frame-by-frame motion (no `Math.random()`-driven variation between recordings).
- A sanity-check recording at 1920×1080@60fps, exported, reviewed by all three audiences.
- Final go / no-go on whether the deck is the narrative half of the submission video.
**Acceptance gate:** recording plays back identically across two recordings (no nondeterminism); video file is ≤30 MB at the 60s length; three-audience final viewing produces zero substantive notes.
**Out of phase:** video editing of the deck recording with the demo recording — that's the submission-assembly task, not this plan.

---

## 4. Out of scope

- **The demo half** of the video (`/spawn` walkthrough). That's a separate recording task; this plan covers narrative only.
- **Localisation.** English only.
- **Mobile responsive.** The deck is a presentation surface; portrait-mobile is not a target.
- **Public marketing site.** `/presentation` stays as the hackathon-submission surface; a polished marketing site is post-hackathon.
- **A/B variants.** One canonical deck.

---

## 5. Open decisions

| # | Decision | Where it lands | Default |
|---|---|---|---|
| 1 | 7 slides vs 6 (cut Thesis) vs 8 (re-add a Pivot/Question text slide) | Phase 1 | 7 — Thesis stays; Pivot folds into the Tangle-to-Garage transition |
| 2 | Auto-advance during recording vs manual click-through baked in | Phase 6 | Auto-advance with `mode=record` query param; default mode stays click-advance |
| 3 | Voice-over: operator's own voice vs synthesised (ElevenLabs) vs none | Phase 5 | Operator's voice if available; ElevenLabs fallback; none is acceptable if music carries |
| 4 | Slide 2's tool labels — name competitors (current) vs unbranded ("orchestration / observability / routing") | Phase 1 | Named — recognisability trumps neutrality for the research-engineer audience |
| 5 | Slide 5's GitHub URL — real repo (e.g. `nousresearch/hermes-agent`) vs generic placeholder | Phase 3 | Real repo — the "any agent on GitHub" claim is concrete only when the URL is real |
| 6 | Should Slide 4's blocked-call examples be Hermes-real (`shell.exec`, `web_search`) or hypothetical? | Phase 3 | Hermes-real — the research engineer recognises them; the non-technical viewer doesn't lose anything |
| 7 | Reuse `<NebulaAvatar>` shader for Slide 5's scan beam vs a separate shader | Phase 2 | Reuse — visual-language continuity is worth the modest constraint |

---

## 6. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Three.js scenes ship over-engineered and the 60fps budget breaks | Medium | Recording artifacts | Per-scene `<PerformanceMonitor>` with a hard particle-count ceiling; reduced-motion fallback exercised in CI |
| Bundle size balloons past 80 KB delta | Medium | First-paint regression on `/presentation` | Code-split each scene; preload only Slide 1's scene on route mount |
| Animation lengths drift past slide durations during pacing pass | High | Beats run together | Phase 4 acceptance includes per-slide timing audit; any motion exceeding its slide is shortened |
| Audio recording misaligns with locked timing | Medium | Recording redo | Lock motion timing in Phase 4 *before* Phase 5 records voice; voice records to the timeline, not vice versa |
| The Tangle slide's chaos reads as "broken UI" rather than "fragmented landscape" | Medium | Audience misreads the slide | Three-audience review in Phase 1 (sketch) and Phase 3 (implementation); kicker copy `[ TODAY ]` disambiguates |
| Slide 6 (Thesis) feels self-important rather than confident | Low | Mic-drop misfires | Stillness + brevity is the design hedge; if it lands wrong in review, cut to 6 slides |
| The deck-to-demo seam (Slide 7 → `/spawn`) doesn't read as continuous in a recorded video (since it's a route transition, not a continuous scene) | High in video, low in live | Submission video looks like two halves, not one piece | The video editor crossfades the recording at the seam; the *live* version's continuity remains a feature for in-person demos |

---

## 7. Done definition

The plan is "done" when:

1. ✅ All 6 phases shipped per their acceptance gates.
2. ✅ End-to-end deck plays at 60fps on M-series; reduced-motion fallback exercised; bundle delta ≤ 80 KB gzip.
3. ✅ Three-audience review passes on the recorded video (not just the live deck).
4. ✅ The submission video's narrative half is the deck recording, full stop — no slide pulled at the last minute and substituted with text.
5. ✅ A 5-minute internal walk-through can be done by a non-author engineer reading only the beat sheet + this plan.
6. ✅ `pnpm -C frontend type-check && lint && build` green.

---

## 8. Quick reference — files this plan touches

```
frontend/src/
├── app/presentation/{layout,page}.tsx              [Phase 6 — record-mode flag]
├── components/presentation/deck.tsx                [Phase 3 — 5→7 slide list]
├── components/presentation/slide-frame.tsx         [Phase 4 — crossfade transitions]
├── components/presentation/slides/
│   ├── slide-1-hook.tsx                            [Phase 3 — rewrite]
│   ├── slide-2-tangle.tsx                          [Phase 3 — rename + rewrite]
│   ├── slide-3-garage.tsx                          [Phase 3 — rename + rewrite]
│   ├── slide-4-guardian.tsx                        [Phase 3 — new]
│   ├── slide-5-opus.tsx                            [Phase 3 — new (replaces slide-4-how)]
│   ├── slide-6-thesis.tsx                          [Phase 3 — new]
│   └── slide-7-handoff.tsx                         [Phase 3 — rename, body unchanged]
├── components/presentation/scenes/
│   ├── galaxy-of-agents.tsx                        [Phase 2]
│   ├── tangle-web.tsx                              [Phase 2]
│   ├── orbital-bay.tsx                             [Phase 2]
│   ├── policy-checkpoint.tsx                       [Phase 2]
│   └── opus-pipeline.tsx                           [Phase 2]
├── components/presentation/audio/                  [Phase 5]
├── lib/shaders/simplex-noise.ts                    [Phase 2 — lift from sign-in]

docs/
├── refs/presentation-beat-sheet.md                 [Phase 1]
├── archive/presentation-plan.md                    [reference only — superseded by this plan]
├── completions/presentation-polish-phase-{1..6}.md [each phase]
```

---

End of plan.
