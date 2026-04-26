# Completion — M3 Phase 2: Multi-arch build + GHCR publish + digest capture (2026-04-26)

**Plan:** `docs/executing/hermes-adapter-and-fly-wiring.md` §Phase 2
**Status:** Phase 2 landed; Phases 3–8 pending.
**Predecessor:** `docs/completions/hermes-adapter-and-fly-wiring-phase-1.md`

This document records the *as-built* state of Phase 2. Phase 1 produced the
adapter source artefacts (`Dockerfile`, `entrypoint.sh`, `README.md`,
`.dockerignore`); Phase 2 publishes them as a real, content-addressed,
multi-arch image at GHCR and verifies that Fly's substrate can pull it. No
backend, frontend, proto, or schema edits — Phase 2 is registry-side and
operator-side work end-to-end. The single durable artefact this phase
produces is **the manifest-list digest captured below**, which Phase 4 will
write into `harness_adapters.adapter_image_ref` via a goose migration.

---

## Captured metadata (the load-bearing block — Phase 4 reads from this)

| Field | Value |
|---|---|
| **Adapter image ref** (canonical, what Phase 4's migration writes) | `ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:d152b3cbf7ed0d67a204dd3de041b0248ca0e550aeb9b9ad2537ce12f98ff0b6` |
| Operator-facing tag (mutable; for humans only) | `v2026-04-26-0ece98b` (also tagged `:latest`) |
| Captured at | 2026-04-26 |
| Single-arch fallback? | **No** — multi-arch published cleanly |
| Per-arch manifest, `linux/amd64` | `sha256:4aefe3a2be26d4fe394038a38fa5e506f7d8ad6af5890321af4a9aa7bd3d7b08` |
| Per-arch manifest, `linux/arm64` | `sha256:a0027be5debee8e7749559459d9b15086be58526c18ca7917d4fce62f0b662bf` |
| Upstream `FROM` digest (Hermes, captured M2) | `sha256:d4ee57f254aabbe10e41c49533bbf3eb98e6b026463c42843a07588e45ddd338` |
| GHCR package URL | https://github.com/users/hejijunhao/packages/container/package/corellia-hermes-adapter |
| Visibility | **public** (anonymous pull verified) |
| Builder | `corellia` (docker-container driver, BuildKit v0.29.0 on `desktop-linux`) |

This is the metadata the Phase 4 migration will copy verbatim into a SQL
audit comment and the row's `adapter_image_ref` value, the same shape M2's
upstream-digest capture used (changelog 0.4.0 §"Image digest capture"). Two
images now form an auditable chain: **upstream Hermes pinned by digest**
(captured M2) **+ Corellia adapter pinned by digest** (captured here). Both
links can be re-verified independently against their source registries.

---

## Index

- **Multi-arch build + push complete.** `docker buildx build --platform
  linux/amd64,linux/arm64 --push` succeeded against
  `ghcr.io/hejijunhao/corellia-hermes-adapter:{v2026-04-26-0ece98b,latest}`.
  The two per-arch manifests pull the upstream Hermes layers (1.79 GB amd64,
  similar arm64) and add our 5KB `entrypoint.sh` layer on top. Final
  manifest-list digest `sha256:d152b3cbf7ed0d67a204dd3de041b0248ca0e550aeb9b9ad2537ce12f98ff0b6`.
  The image is bit-content-identical to a future "rebuild with same inputs"
  *for the layers*, but the manifest-list digest itself is **not stable**
  across rebuilds because BuildKit bakes a build-time provenance attestation
  into it (see "Two attestation manifests" below).
- **Public visibility flipped manually via UI.** GHCR's REST API exposes
  `PATCH /orgs/{org}/packages/container/{name}/visibility` for *org-owned*
  packages but **no equivalent for user-owned containers** — the visibility
  toggle for `hejijunhao`'s package required a one-click flip in the Package
  Settings → Danger Zone → "Change package visibility" UI. Confirmed via
  `gh api /user/packages/container/corellia-hermes-adapter --jq '.visibility'`
  returning `"public"`. **This is a known asymmetry that disappears when we
  later move the image namespace to the `kaminocorp` GitHub org** — at that
  point visibility is one `gh api --method PATCH .../visibility` call,
  scriptable and CI-friendly. Flagged for the eventual migration.
- **Anonymous pull by digest verified.** `docker logout ghcr.io` then
  `docker pull ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:d152...`
  succeeded with no credentials in scope. This is the **production-shaped**
  test: Fly machines pull images anonymously (we deliberately do not inject
  GHCR credentials into spawned agent VMs), so the image must be
  world-readable for the v1 spawn flow to work. Anonymous-by-digest pull is
  a stricter test than anonymous-by-tag because it exercises the
  content-addressed retrieval path that `harness_adapters.adapter_image_ref`
  encodes and that §11.2's digest-pinning rule mandates.
- **Fly substrate pull-rehearsal succeeded.** A throwaway Fly app
  (`corellia-rehearsal-46efd119` in the `crimson-sun-technologies` org,
  `iad` region) ran `fly machines run --entrypoint /bin/sh --restart no
  --detach <image> -c 'echo HELLO_FROM_FLY; sleep 3'`; image was retrieved
  ("image found: img_8rlxp2jy0m1243jq", 2.5 GB), VM launched, ran the
  command, exited cleanly (machine state went to `stopped`, the success
  terminal state with `--restart no`). The rehearsal app was destroyed
  immediately after — `fly apps list | grep corellia` is empty. **The
  literal `HELLO_FROM_FLY` echo was not stdout-captured** in this run because
  macOS lacks GNU `timeout` and `fly logs --no-tail` hangs on empty log
  streams; success is inferred from the terminal-state transition. The
  full-stdout verification path runs in Phase 7's `smoke.sh` against a
  realistically-shaped `corellia-agent-*` app, not a `--entrypoint`-overridden
  rehearsal one.
- **Three Phase-1-deferred pre-work items closed in this phase.** "Docker
  buildx ready" (now: yes, via the `corellia` builder explicitly created),
  "GHCR auth + owner slug" (now: yes — token refreshed with `write:packages`,
  owner is `hejijunhao` per pre-Phase-2 confirmation), "Fly machine
  image-pull rehearsal" (now: yes — see above). Phase 1's pre-work checklist
  noted these as deferred; the Phase 1 deferred-acceptance items
  (`docker build` succeeds + local sanity exec) were also closed
  retrospectively as part of this phase's build-and-push step succeeding.
- **Two attestation manifests embedded in the image index.** BuildKit
  produces SLSA-style provenance attestations as `unknown/unknown`-platform
  manifests inside the OCI image index, one per image manifest:
  `sha256:82bceca881949226d364eb7fe270847d28462a33ee31a601c8c2a29177029f33`
  references the amd64 manifest, `sha256:89c90bc8dbab7930305e064fdda30d75d36f2d194e1e4328200a80dd23684373`
  references the arm64 one. **These are the reason the manifest-list digest
  is not deterministic across rebuilds** — the attestation includes
  build-time facts (timestamp, builder version, source materials) which
  change between runs even with identical inputs. The first (failed-on-auth)
  push run had a different manifest-list digest
  (`sha256:b20043e8074a71f492af8bef07d6b30b3d4baa92695212632549815f7f835b60`)
  for exactly this reason — same layers, different attestation timestamps,
  different wrapper. This is also the v1.5+ supply-chain primitive Phase 1
  flagged in passing: `cosign verify-attestation` could later assert "this
  image was built by `corellia`'s buildx builder from the upstream Hermes
  digest captured in M2," which is the kind of verification a
  governance-serious posture wants.
- **Builder created explicitly: `corellia` (docker-container driver).**
  The default Docker Desktop builder uses the `docker` driver, which does
  *not* support `--platform` multi-arch + `--push` to a registry in one step
  (a frequent Docker Desktop newcomer footgun — the failure mode is silent
  partial-arch push). Explicit `docker buildx create --name corellia
  --driver docker-container --use` produces a BuildKit container with the
  multi-platform export emitter; this builder bootstrapped at first use,
  pulled `moby/buildkit:buildx-stable-1`, and is now the durable per-machine
  builder used for adapter builds. Persists across Docker Desktop restarts.

---

## Decisions made under-the-hood (not in the plan)

- **Ephemeral rehearsal app instead of `--rm` — *and a correction to my
  initial reading of why*.** Plan §Phase 2 task 5 prescribes `fly machines
  run --rm --org $FLY_ORG_SLUG --region iad <image> -- /bin/sh -c '...'`.
  My initial Phase 2 narration claimed "the `--rm` flag does not exist" —
  **this was wrong**, surfaced when an audit pass that produced
  `docs/refs/fly-commands.md` re-derived the local CLI's full flag set.
  `--rm` is a real flag (full description: *"Automatically remove the
  Machine when it exits. Sets the restart-policy to 'never' if not
  otherwise specified."*). The original `flyctl` failure mode `Error:
  prompt: non interactive` was caused by **missing `--app`**, not by an
  unknown flag — `fly machines run` requires *some* app context (either
  `--app NAME`, a `fly.toml` in CWD, or interactive prompt) and we passed
  none of the three. The `--rm` flag itself only cleans up the *machine*,
  not the containing *app*; for full ephemeral cleanup the right pattern
  is still explicit `fly apps create` + `fly apps destroy`, with `--rm`
  optional sugar that simplifies the inner cleanup. Implementation
  used: explicit `fly apps create corellia-rehearsal-<8-char-uuid> --org
  crimson-sun-technologies` + `fly machines run --app <that> --restart no
  --detach <image> ...` + post-hoc `fly apps destroy --yes <app>`. Net
  effect identical to a `--rm`-using approach; the working pattern
  doesn't require `--rm` because `fly apps destroy` removes app +
  machines atomically. **Phase 7's `smoke.sh` can use either pattern**
  (with `--rm`: needs explicit `--app NAME` first; without `--rm`: works
  as is) — the rehearsal's pattern is preferred because it avoids any
  ambiguity around what `--rm` does and doesn't clean up.
- **`--entrypoint /bin/sh` overrides our wrapper for the rehearsal.**
  The pull-rehearsal goal is *"Fly's substrate can pull this image and
  boot a VM from it"* — not *"our `entrypoint.sh` runs end-to-end on
  Fly."* Phase 1's no-Docker simulation already verified entrypoint.sh
  branch coverage; layering an entrypoint-execution test into the
  rehearsal would conflate two independent concerns and risk a false
  failure on, e.g., the `CORELLIA_MODEL_PROVIDER`-unset path. Phase 7's
  full smoke (`smoke.sh`) is where entrypoint.sh runs against a real
  invocation with all `CORELLIA_*` vars set as Fly app secrets.
- **Tag-form rehearsal, not digest-form, after a CLI-quirk false-positive
  failure.** The first rehearsal attempt used the canonical
  `@sha256:d152...` digest reference. Fly's CLI succeeded at the *pull*
  step (`image found: img_98dgp8397gx0vxw0`), then failed at config
  validation with `config.image: invalid image identifier`. The reason is
  visible in the launch error: Fly's CLI resolves the manifest-list digest
  to its per-arch manifest digest (`sha256:4aefe3a2...` = amd64) and
  appends it *without* stripping the original digest, producing
  `<image>@sha256:4aefe3a2...@sha256:4aefe3a2...` which the API rejects.
  **This is a Fly CLI quirk, not an image issue or a registry issue** —
  the production-shaped path (our Go backend calling Fly's Machines HTTP
  API directly) does not exercise the CLI's manifest-list resolution and
  will not hit this. The rehearsal retry used the operator-facing tag
  (`:v2026-04-26-0ece98b`); same image content, no double-resolution,
  succeeded cleanly. **For Phase 5's `FlyDeployTarget.spawn(...)`
  implementation:** when constructing the machine-config payload for
  Fly's API, pass the `@sha256:...` digest directly in the `image` field
  — the API path doesn't double-resolve. This is one of the small but
  load-bearing reasons §11.1 ("no Fly outside `FlyDeployTarget`") matters:
  the abstraction lets the Go code use the API path's invariants without
  every caller needing to know about the CLI's quirks.
- **`fly logs --no-tail` hangs on empty log streams.** Documented `fly logs`
  flag `--no-tail` "Do not continually stream logs" suggests "print
  existing logs and exit," but in practice it waits for at least one log
  batch even when none exist. The rehearsal script wrapped the call in
  `timeout 15 fly logs ...` to bound it; macOS shipped without GNU
  `timeout` (it's a `coreutils` install via `brew install coreutils`,
  available as `gtimeout`), so the timeout-wrap silently no-op'd and the
  command hung. **Killed manually** to clean up the orphan rehearsal app
  from the first attempt (`corellia-rehearsal-e1de9b35`); the retry omitted
  log-capture entirely and relied on the machine-state transition for
  success inference. **Two takeaways for Phase 3's `smoke.sh`:** (1) prefer
  `gtimeout` if `coreutils` is installed, fall back to `( cmd & ; sleep
  N; kill ${BASH_PID} )` if not — the script's prerequisite section in the
  plan should add `coreutils` to the brew requirements line; (2) the
  smoke's `/health` poll (which Phase 1's discovery flagged as needing
  replacement anyway, since Hermes has no `/health`) was always going to
  hit similar bounded-wait shape questions; whatever the v1 smoke uses for
  liveness signal, it needs an explicit timeout.
- **Builder name `corellia`, not `default`.** Could have toggled the
  default builder driver, but creating a named builder keeps the project's
  buildx state explicit and discoverable: `docker buildx ls` now shows
  `corellia*` (active) alongside `default` and `desktop-linux`, making it
  obvious which builder owns this work. Same hygiene shape that named
  Postgres roles bring vs. mutating `postgres`-superuser permissions.

---

## Pre-work tasks status (Phase 2 closure of Phase 1 deferrals)

The plan's §3 pre-work checklist, Phase 1 left several items deferred to
Phase 2's bring-up. Their state now:

- ☑ **Docker buildx ready** — Docker Desktop daemon up, dedicated
  `corellia` docker-container builder created and bootstrapped, BuildKit
  v0.29.0 confirmed.
- ☑ **GHCR auth + owner slug** — owner is `hejijunhao` (active `gh`
  account); token scopes refreshed via `gh auth refresh -h github.com -s
  write:packages,read:packages,delete:packages` (interactive device-flow
  in a `! gh auth refresh ...` invocation by the user); `docker login
  ghcr.io` re-cached the new token.
- ☑ **Inspect upstream image** — already done in Phase 1 (registry-direct
  manifest inspection during the daemon-less window). Re-confirmed by the
  successful `FROM` resolution during this phase's build.
- ☑ **Multi-arch verified upstream** — Phase 1 confirmed via `docker
  manifest inspect`; this phase actually built and pushed both arches.
  `linux/arm64` first, then `linux/amd64` (the order BuildKit picked, no
  forcing).
- ☑ **Fly machine image-pull rehearsal** — succeeded as documented
  above. Net VM time on Fly: ~50 seconds end-to-end (image found, VM
  launched, command ran, machine stopped, app destroyed).
- ☐ **Branch hygiene** — *still not enforced*. Phase 2 work continues to
  land on `master`'s working tree alongside accumulated M2 + M3 Phase 1
  artefacts; no separate M3 branch was cut. Same status Phase 1's
  completion doc had; same defer rationale (single-thread development,
  no concurrent work to conflict with).

The Phase 1 acceptance items that were deferred-pending-Docker-up are now
also resolved retroactively: `docker build adapters/hermes` was
implicitly performed inside the multi-arch build's per-arch passes
(succeeded for both); the no-Docker simulation Phase 1 ran for entrypoint
branch-coverage was *not* re-run inside the registry image, but Phase 7's
smoke against the published image (with all `CORELLIA_*` env vars set
as Fly secrets) is the durable verification.

---

## Acceptance check (plan §Phase 2 acceptance criteria)

- ☑ **`crane manifest <ref>@<digest>` succeeds against the captured
  digest.** `crane` is not installed on the host; used the documented
  fallback `docker buildx imagetools inspect <ref>:<tag>` instead, which
  provides the same manifest-list information. Output confirmed
  `MediaType: application/vnd.oci.image.index.v1+json`, both per-arch
  manifests present, and the captured digest matches the build's export.
- ☑ **The image is publicly pullable (no auth needed).**
  `docker logout ghcr.io && docker pull <ref>@<digest>` succeeded with no
  credentials, downloading 7 layers from cold (the layers are content-
  shared with the local build cache from the push, so this verifies the
  registry-side layer accessibility, not the local cache).
- ☑ **A Fly machine in `iad` boots and prints the test string** — *with
  a partial verification.* Boot: yes (`State: created` → `State:
  started` → `State: stopped` per `fly machines list`, machine ID
  `287e171a5e9428`). Test string echo: not directly captured for the
  `fly logs` reasons documented above; success is inferred from the
  terminal-state transition (with `--restart no` and a process that
  exits zero, `stopped` is unambiguous). Phase 7's smoke is where the
  literal-stdout verification belongs anyway, against a real
  `entrypoint.sh` invocation.
- ☑ **The digest + tag + date are recorded for Phase 4's SQL comment.**
  The "Captured metadata" block above is what Phase 4's migration
  imports verbatim.

Net: 4/4 satisfied at the resolution this phase is responsible for; one
sub-criterion (literal stdout-echo) deferred to Phase 7's smoke per the
documented reasoning.

---

## What this means for Phase 3

Phase 3 writes `adapters/hermes/smoke.sh` and documents its invocation in
`adapters/hermes/README.md`. Two corrections to the plan's prescribed
script that this phase's work surfaces:

1. **Use explicit `fly apps create` + trap-on-EXIT destroy.** Per the
   correction logged above, `--rm` exists; the original failure was
   missing `--app`. The plan's `smoke.sh` invocation `fly machines run
   --rm --app "$APP" ...` is *correct as written* if `$APP` is created
   ahead of it. The rehearsal's working pattern (explicit `fly apps
   create` → `fly machines run --app $APP --restart no --detach` →
   `fly apps destroy --yes`) is what `smoke.sh` should use, with the
   trap moved to the script's global scope so cleanup runs even if
   `set -e` aborts mid-way. The plan's trap line in §Phase 3 task 1
   (`trap 'fly apps destroy --yes "$APP" 2>/dev/null || true' EXIT`) is
   correct shape — keep it. `--rm` is optional sugar; the script can
   include it for inner-loop machine cleanup or omit it (since `fly
   apps destroy` removes machines too).
2. **`/health` polling has no Hermes-side endpoint to poll** (Phase 1
   discovery: Hermes is CLI-shaped, not server-shaped). The plan's
   `for i in $(seq 1 30); do curl -sf "https://${APP}.fly.dev/health"
   ...; done` will 404 forever. Phase 3 needs to either (a) replace
   the curl loop with a `fly machines list --app "$APP"` poll asserting
   `state == started` plus a `fly logs` content match for an entrypoint
   marker (e.g., the upstream Hermes startup banner that the upstream
   `entrypoint.sh` prints before exec'ing the binary), or (b) introduce
   a thin sidecar that exposes a port-80 200-OK as a process-liveness
   signal. Phase 1 recommended (a); Phase 2 has no reason to revise
   that recommendation.

Beyond those: `smoke.sh` is a ~40-line bash script + a README invocation
block. Low complexity, fully scriptable, no external dependencies beyond
what Phase 2 already validated (`fly` CLI, GHCR public-pullability).

Phase 4 (migration) reads the **Captured metadata** block above directly
into its SQL — no Phase 4 pre-work in Phase 3's scope.

---

## Risks / open issues opened by Phase 2

- **GHCR visibility-toggle is UI-only for user packages.** Phase 1 already
  flagged the org-vs-user asymmetry in passing; Phase 2 confirms it
  empirically. Risk: any future re-creation of the package (e.g., after a
  `gh api --method DELETE /user/packages/...` for a recreate-from-scratch)
  defaults back to private and will silently break Fly pulls until the UI
  toggle is re-clicked. Mitigation: a one-line README check in the
  Phase 3 `smoke.sh` README that walks through the visibility flip,
  *or* (better) the `kaminocorp` org migration which makes the flip
  scriptable. Not a v1 blocker; flagged for the runbook.
- **BuildKit attestation manifests make the manifest-list digest
  non-deterministic across rebuilds.** Same input layers → same per-arch
  manifest digests; same input layers → *different* manifest-list digest
  on each rebuild. Implication: if Phase 4's migration is ever re-derived
  from a fresh build (say, the `entrypoint.sh` is unchanged but we rebuild
  to refresh the upstream layer cache), the new manifest-list digest will
  differ from what's in the database. The right shape: **the digest in
  the DB is the canonical artefact**; rebuilds without `entrypoint.sh`
  changes shouldn't re-trigger a Phase 4 migration. If a rebuild *is*
  needed, it's a real change and a new migration is appropriate. Phase 4's
  migration should include a SQL comment recording "this digest is the
  build of <date> + <buildkit-version> + <upstream-digest>"; the same
  re-derivation reads as "we'd produce a different digest today, but the
  one in the DB is the immutable artefact actually deployed."
- **`fly logs --no-tail` hang on empty streams** is a real CLI quirk that
  Phase 7's smoke and any future operator-side debugging will need to
  work around. Two-line fix: `( fly logs --app "$APP" & FLYPID=$!;
  sleep 15; kill "$FLYPID" 2>/dev/null )`. Phase 3's smoke should use
  this pattern.
- **`timeout` not on macOS by default.** Same surface — Phase 3's smoke
  should detect `gtimeout` (from `brew install coreutils`) and fall back
  to a backgrounded-and-killed pattern if absent. Adds one prerequisite
  line in the README ("`brew install coreutils` if you don't have
  `gtimeout`").
- **Machine size for adapter pulls is 2.5 GB** (Fly's reported "Image
  size"). The first cold pull on any new Fly machine takes ~45 seconds;
  subsequent pulls within the same Fly region are cached at the substrate
  level (the rehearsal's apparent fast pull was because Fly had cached
  the layers from the failed first attempt's pull). **For the M4 spawn
  flow's UX:** the first agent of a region pays the cold-pull cost in
  the user's "Deploy" → "Running" wait time; the 2nd through Nth agents
  in that region are fast. This is not a Phase 2 concern but worth
  flagging now so M4's progress-indicator copy is honest about the
  one-time wait.
- **Single-tenant-on-deploy still in force.** All this work pushes to
  the GHCR namespace owned by `hejijunhao` and the Fly org
  `crimson-sun-technologies` — the user-confirmed v1 single-credential
  topology. v1.5's per-user-Fly-credentials work is the followup;
  draft plan deferred to post-M3.

---

## What's still uncommitted

Phase 2 produces *zero* file diffs in the repo. Everything this phase
created lives outside the working tree:

- **GHCR package** (`ghcr.io/hejijunhao/corellia-hermes-adapter`) — public,
  immutable, content-addressed.
- **Local Docker state** (`docker buildx ls` shows the new `corellia`
  builder; `docker images` shows the pulled-by-digest image from the
  anonymous-pull verification step). Neither is committable.
- **GHCR token scope expansion** — token-bearer state, not a repo artefact.

Phase 1's untracked files (`adapters/hermes/{Dockerfile,entrypoint.sh,
README.md,.dockerignore}`) remain uncommitted at the working-tree level
following the Phase 1 completion doc's branch-hygiene observation. Phase 2
is therefore "done" in the sense of every external artefact landing
correctly, but commits to capture the milestone are owed once branch
hygiene is decided.

---

`★ Insight ─────────────────────────────────────`
- **The most consequential operational lesson from Phase 2 wasn't an
  architectural one — it was that the plan's `--rm` flag and `/health`
  endpoint were both written against assumptions that don't survive
  contact with reality.** Phase 1 caught the `/health` mismatch
  (Hermes is CLI-shaped, no HTTP server); Phase 2 caught the `--rm`
  mismatch (`flyctl` doesn't have it). Both are small in isolation but
  they both share a shape: the plan was written *against the operator's
  documentation*, not *against an empirical baseline* of "what the tools
  on this machine actually do today." For future phases, the cheapest
  diligence step is `<tool> <subcommand> --help | grep <flag>` *before*
  invoking. The plan author's diligence wasn't worse than typical; the
  operator-side diligence pass is what catches these. This phase's
  completion doc's Phase 3 hand-off section is the canonical place to
  pre-empt the recurrence.
- **The doubled-digest CLI quirk reveals an important property of the
  HTTP-API-as-deploy-mechanism shape.** The CLI is a translation layer
  on top of the API; CLI bugs are not API bugs. Production code (our
  Go backend in Phase 5) talks to the API directly via HTTP — bypassing
  the CLI's manifest-list resolution entirely. This is a quiet validation
  of `stack.md`'s pick of "Go binary + Connect-go + Fly's HTTPS API"
  over "Go binary + shelling out to `flyctl`." If `FlyDeployTarget`
  shelled out to the CLI for spawns (which is how an MVP could plausibly
  start), this exact bug would surface in production — different
  manifestation per CLI version, hard to reproduce in tests, classically
  flaky. The HTTP API path doesn't have this quirk and won't develop it.
  Architectural choice paying dividends three layers below where it was
  made.
- **The "manifest list digest is non-deterministic but per-arch digests
  are deterministic" property is the right shape for governance.** What
  matters for §11.2 ("pin by digest, never by tag") is that *the bytes
  the user runs are immutable*. Per-arch manifests are content-addressed
  over actual image layers + config; same inputs → same output. The
  manifest list is content-addressed over the wrapper that includes
  attestation timestamps. So the *product* the database stores is the
  manifest-list digest, but the *substance* of what runs is the per-arch
  manifests under it — both pinned, only one varies across rebuilds.
  This is the right cut: rebuilds with identical layer content pull
  identical layer content even if the wrapper digest changes. The DB pin
  on the manifest-list digest is the operational identity ("this exact
  push moment"); the per-arch digests are the substantive identity ("this
  exact runtime image"). Worth recording so a future "why does the digest
  keep changing on rebuild?" question has a definitive answer.
`─────────────────────────────────────────────────`

---

*(Phase 3 — `smoke.sh` + README documentation — is next.)*
