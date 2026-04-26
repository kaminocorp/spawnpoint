# Presentation Plan — Hackathon Demo Video

## Context

Corellia is a submission to the Anthropic Opus 4.7 hackathon (one of 500 teams selected from 20,000+ applicants).

### Submission requirements
- **3-minute demo video** (YouTube, Loom, or similar)
- GitHub repository or code link
- Written description / summary
- Project must be built entirely during the hackathon — no pre-existing work

### Video budget (3 min total)
- **~60s presentation** — narrative + thesis (this plan)
- **~90–120s live screenshare** — the working product (M4 spawn flow + fleet view)

### Judging criteria (what the presentation must serve)

| Criterion | Weight | Where it's earned |
|---|---|---|
| **Impact** — real-world potential, who benefits, would people use it | 30% | Slides 1–3 |
| **Demo** — working, impressive, holds up live, cool to watch | 25% | Live screenshare (carries on its own) |
| **Opus 4.7 use** — vivid, beyond basic integration, surprising capabilities | 20% | Slide 4 |
| **Depth & Execution** — pushed past first idea, sound engineering, real craft | 20% | Slide 4 + Slide 5 transition |

The presentation's job: land *why this matters* (Impact), plant *we built this for real* (Depth), plant *Opus 4.7 in a non-obvious way* (Opus use). The demo carries the Demo bucket.

### Delivery surface

Built natively under a `/presentation` public route (no Canva). Same Next.js app, same dark register, same nebula visual language, same `<TerminalContainer>` typography as `/spawn` — so the seam from slide 5 → live product reads as *the deck is the product*. R3F is already in the bundle (sign-in swarm + nebula avatars), so the 3D scenes don't add a dependency.

---

## Skeleton — 5 slides, ~60s

12s/slide average. Each slide gets one job and one visual.

### Slide 1 — Hook (10s) · "The 250-agent problem"

**On-screen:** *"A 250-person company wants every employee to have an AI agent. That's 1,000+ agents, each with different models, tools, and access. Today, there is no way to govern that."*

**Visual:** count-up from 1 → 1,247 agents materialising as nodes in 3D space. Camera pulls back; the mass becomes overwhelming. The problem made physical.

**Why this slide:** Impact criterion asks "how much does it matter" — a number you can see beats a number you read.

---

### Slide 2 — Problem (12s) · "Every tool picks one lane"

**On-screen:** five tool labels arranged in a row — `LangGraph` (orchestration), `Composio` (tool perms), `Portkey` (routing), `LangSmith` (observability), `Fly / AWS` (deploy). Each lights up briefly, isolated. Then they fragment apart.

**Narration:** *"LangGraph deploys. Composio governs tools. Portkey routes models. None of them unify. None are vendor-neutral. Admins are stuck wiring five planes together — and still can't see what their fleet is doing."*

**Why this slide:** sets up the "unified control plane is itself the product" thesis without saying it yet.

---

### Slide 3 — Solution (15s) · "One control plane. Any harness. Any provider."

**Visual — the centerpiece:** the "garage of harnesses" rendered literally. Circular bay; six harness "vehicles" parked around the perimeter (Hermes lit up + 5 locked silhouettes — same lineup as the `/spawn` roster: Hermes, OpenClaw, Claude Agent SDK, DeepAgents, SuperAGI, OpenFang). Center spotlight. A CORELLIA badge sits at the hub with lines connecting to all six. Camera orbits slowly.

**On-screen / narration:** *"Corellia is the centralized control plane. Pick a harness like picking a car. We govern lifecycle, secrets, deployment, and access — across any model, any provider, any framework."*

**Why this slide:** the *thesis* slide. The visual the judges will remember. Reuses the `<NebulaAvatar>` component (or a beefier 3D variant) for visual continuity with the demo.

---

### Slide 4 — How (15s) · "The harness contract + Opus in the loop"

**Visual:** split-screen 3D diagram.
- **Left:** stack diagram — `Frontend (Next.js)` → `Connect-go RPC` → `Domain (Go)` → `DeployTarget interface` → `Fly.io`. Each box snaps in.
- **Right:** the killer angle — a GitHub repo URL flying in, hitting an "Opus 4.7" node, emerging as a generated `corellia.yaml` manifest + adapter image. Caption: *"Any harness on GitHub becomes a Corellia adapter — Opus 4.7 reads the repo, extracts the contract, builds the wrapper."*

**Narration:** *"Built on a strict harness interface contract — runtime, configuration, packaging, metadata. We hand-wrote the first adapter for Hermes. Then we taught Opus 4.7 to write the rest. Point Corellia at any agent repo on GitHub and it generates the adapter for you."*

**Why this slide:** the **Opus 4.7 (20%)** play. Programmatic adapter generation isn't basic chat integration — it's Opus reading code structure (tree-sitter + README + Dockerfile) and emitting a validated manifest. Architecture is already real in the schema (`HarnessAdapter.source = hand_written | generated`, validation pipeline scaffolded). This signals depth, not surface integration. Also covers **Depth & Execution** — name-drop two or three blueprint §11 rules (digest pinning, Connect-go contract boundary, sqlc) to prove this isn't a hack.

---

### Slide 5 — Handoff to demo (8s) · "Let's spawn one."

**Visual:** the Hermes harness from slide 3 lights up; camera dollies into it; transition wipes directly into the `/spawn/[templateId]` wizard. The presentation *becomes* the live product. No black-frame cut.

**Narration:** *"Let's spawn one."*

**Why this slide:** the seam between presentation and demo is where most hackathon videos lose energy. If `/presentation` and `/spawn` share the dark register, nebula visual language, and typography (which they will, since they're the same app), this transition reads as *the slide deck is the product* — itself a depth signal.

---

## Narrative arc

| Slide | Beat | Criterion served |
|---|---|---|
| 1 Hook | Scale of the problem | Impact |
| 2 Problem | Why current tools fail | Impact |
| 3 Solution | Garage of harnesses | Impact + memorable visual |
| 4 How | Contract + Opus 4.7 generates adapters | Opus 4.7 + Depth |
| 5 Handoff | Slide → live product | Demo + craft |

---

## Open decisions (resolve before designing)

### Q1 — Opus 4.7 angle: product or process?
- **Product (recommended):** Opus generates adapters. Strong on "surprised even us" criterion. Requires the adapter pipeline to read as architecturally real even though it's post-v1 stubbed.
- **Process:** Opus 4.7 was the dev partner throughout the build (design-system.md, the wizard, etc.). More honest if the adapter pipeline isn't believable.
- Could combine: lead with product on slide 4, mention process briefly.

### Q2 — `/presentation` route shape
- **(a) Scrolling page** — scroll-triggered 3D scene transitions (Apple product pages). Most impressive, hardest to time.
- **(b) Discrete slides** — spacebar/click advance, full-canvas R3F between slides. Middle ground.
- **(c) Auto-advancing timeline** — fixed pacing (10/12/15/15/8s), record voiceover over one take. Safest for a 3-min video deadline.

### Q3 — Voiceover or on-screen-text only?
Voiceover is more engaging but adds a recording step + retake risk. On-screen text + ambient soundtrack is a fallback if recording slips.

### Q4 — Slide 5 transition mechanism
Either a real route transition (`router.push('/spawn/hermes')` triggered at the end of slide 5) or a recorded-video splice. Real route transition is the depth signal; splice is the safety net.

---

## Out of scope for this plan
- Visual design system for the 3D scenes (color grading, particle counts, motion curves) — design phase
- Voiceover script (final word-level copy) — comes after structure lock
- Recording / encoding / upload mechanics — production phase
- Repo README and written description — separate submission artefact
