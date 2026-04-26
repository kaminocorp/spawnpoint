# corellia/hermes-adapter

> v1 hand-written adapter wrapping `nousresearch/hermes-agent`. Do not
> edit casually — this is the first member of `adapters/<name>/` per
> `docs/blueprint.md` §4 and the working example future adapters
> follow.

## What this is

A thin shim layer that conforms Nous Research's [Hermes Agent](https://github.com/NousResearch/hermes-agent)
to Corellia's harness interface. Implemented as a Docker image layered
on the upstream Hermes image, with a single POSIX-shell wrapper
(`entrypoint.sh`) that translates `CORELLIA_*` env vars into the names
Hermes natively consumes, then `exec`s the upstream entrypoint.

See `docs/blueprint.md` §3 (harness interface contract — runtime,
configuration, packaging, metadata sub-contracts), §4 (adapter
strategy: v1 hand-written) and §11.3 (the `CORELLIA_*` env-var rule
this adapter implements).

## Pinning

The upstream digest in the `Dockerfile`'s `FROM` line is bit-identical
to the value seeded in
`backend/migrations/20260425170000_agent_catalog.sql` (column
`harness_adapters.upstream_image_digest`). The single source of truth
for the upstream digest is the database; the Dockerfile *quotes* it.
Per `docs/blueprint.md` §11.2, mutable tags are never used.

When the upstream digest is bumped: a new migration changes
`upstream_image_digest` and `adapter_image_ref` in lockstep, the
Dockerfile's `FROM` line is updated to match in the same PR, the
adapter is rebuilt, the new image's manifest-list digest is captured
into the same migration. Both columns stay coherent atomically.

## Env-var translation

| `CORELLIA_*` | Hermes-native | Notes |
|---|---|---|
| `CORELLIA_AGENT_ID` | `AGENT_ID` (passthrough rename) | No native consumer in Hermes 0.x; retained for observability — logs / Fly metadata / subprocess hooks can read either name. |
| `CORELLIA_MODEL_PROVIDER` | `HERMES_INFERENCE_PROVIDER` | Documented Hermes runtime override for `config.yaml`'s `model.provider`. Supported values: `openrouter`, `anthropic`, `openai`, `gemini`, `nous-api`. Unknown values exit 64 (EX_USAGE). |
| `CORELLIA_MODEL_API_KEY` | provider-conditional: `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` / `NOUS_API_KEY` | Hermes uses provider-specific names rather than a single generic credential; the wrapper branches on `CORELLIA_MODEL_PROVIDER` to pick the right one. |
| `CORELLIA_MODEL_NAME` | *(no native env-var hook in Hermes 0.x)* | The deprecated `LLM_MODEL` was removed; selection lives in `$HERMES_HOME/config.yaml` under `model.default` or via the `--model` CLI flag. **v1.5 follow-up**: write a minimal `config.yaml` fragment from the entrypoint. Today this var is observability-only at the adapter; Hermes defaults to `anthropic/claude-opus-4.6` per `cli-config.yaml.example`. |

## Local build

Single-arch (host platform), for sanity checks during development:

```sh
docker build -t corellia/hermes-adapter:dev adapters/hermes
```

Multi-arch publish (Phase 2 of the M3 plan) — see
`docs/executing/hermes-adapter-and-fly-wiring.md` Phase 2 for the full
buildx + GHCR push command.

## Local sanity exec — env-var rename verification

After a successful local build:

```sh
docker run --rm \
  -e CORELLIA_AGENT_ID=test-1 \
  -e CORELLIA_MODEL_PROVIDER=openrouter \
  -e CORELLIA_MODEL_NAME=anthropic/claude-3.5-sonnet \
  -e CORELLIA_MODEL_API_KEY=sk-fake \
  --entrypoint /bin/sh \
  corellia/hermes-adapter:dev \
  -c '/corellia/entrypoint.sh /bin/sh -c "env | grep -E \"^(CORELLIA|OPENROUTER|HERMES_INFERENCE|AGENT)_\" | sort"'
```

Expected output (order may vary):

```
AGENT_ID=test-1
CORELLIA_AGENT_ID=test-1
CORELLIA_MODEL_API_KEY=sk-fake
CORELLIA_MODEL_NAME=anthropic/claude-3.5-sonnet
CORELLIA_MODEL_PROVIDER=openrouter
HERMES_INFERENCE_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-fake
```

The trick is overriding the upstream entrypoint twice: once with our
wrapper (`/corellia/entrypoint.sh`), and once for the *target* the
wrapper `exec`s into (`/bin/sh -c "env | ..."` instead of upstream's
own entrypoint). This isolates the rename behaviour from any Hermes
boot logic.

## Smoke test

`smoke.sh` boots the registry-pushed adapter image on a real Fly
machine end-to-end, polls for `state == started`, dumps the tail of
logs, and destroys the app on EXIT (trap-guarded — runs even if
`set -e` aborts mid-script).

```sh
export FLY_ORG_SLUG=<your-org-slug>            # e.g. crimson-sun-technologies
export CORELLIA_SMOKE_API_KEY=sk-or-v1-<key>   # OpenRouter free-tier is fine
./adapters/hermes/smoke.sh
```

Optional overrides:

- `CORELLIA_HERMES_ADAPTER` — a different `<image>@sha256:<digest>` ref
  (defaults to the GHCR-published Phase 2 digest).
- `REGION` — a different Fly region (defaults to `iad`).

Notes on what the smoke does *not* probe (and why):

- **No `/health` poll.** Hermes 0.x is a CLI-shaped agent — it does
  not expose `/health` (see "Known limitations" below). The smoke
  asserts `fly machines list --json` reports `state == started` and
  prints the recent log tail for an operator eyeball-check.
- **No `--port` binding** in the `fly machines run` invocation. Hermes
  has no HTTP listener, so port-binding would only confuse Fly's
  proxy-attached health checks.
- **`fly logs --no-tail`** hangs on empty log streams; the script
  bounds it to 15s using `gtimeout` (from `brew install coreutils`)
  with a backgrounded-and-killed fallback when `gtimeout` is absent.

## Known limitations

1. **No HTTP runtime contract.** Hermes 0.x is a CLI-shaped agent; it
   does not expose the `/health` and `/chat` endpoints `blueprint.md`
   §3.1 describes. The adapter today exec's into Hermes's CLI mode.
   Phase 7's smoke test (per the M3 plan) and M4's `Health()` polling
   currently have no `/health` endpoint to probe — Phase 7 needs to
   fall back to "Fly machine state == started" and a process-liveness
   check via `fly logs`. Closing this gap (likely via a sidecar HTTP
   wrapper in front of `hermes chat`) is a v1.5 concern; flagged here
   so the next plan reader does not assume the contract is fully
   implemented.

2. **Model name not wired.** `CORELLIA_MODEL_NAME` is currently
   observability-only at the adapter (no native env-var consumer in
   Hermes 0.x). Wiring a `config.yaml` fragment generator into
   `entrypoint.sh` is a v1.5 follow-up.

3. **Single base-arch dependency.** The adapter inherits whatever
   architectures the upstream image publishes. Per the M3 pre-work
   inspection, upstream is multi-arch (`linux/amd64` + `linux/arm64`)
   on the pinned digest, so the adapter can be built multi-arch too.

## Bumping the upstream digest

Outline of the post-v1 process when Nous publishes a new Hermes image:

1. Capture the new manifest-list digest:
   `crane digest docker.io/nousresearch/hermes-agent:<new-tag>`.
2. Verify multi-arch: `docker manifest inspect <digest>` shows the
   architectures we want.
3. Write a new goose migration that updates *both*
   `upstream_image_digest` and `adapter_image_ref` (a coordinated
   change — see `docs/blueprint.md` §5).
4. Update the `FROM` line in this directory's `Dockerfile` to match.
5. Rebuild the adapter (M3 plan §Phase 2 commands), capture the new
   adapter-image digest, paste into the migration's UPDATE.
6. Apply the migration, push the new image, redeploy.
7. Existing AgentInstances continue running the *old* digest until
   rolled forward explicitly per blueprint §5.

A `corellia adapter bump <harness> <new-digest>` operator CLI is the
next-write of `adapters.Service.UpdateImageRef` (introduced in M3
Phase 5); a separate plan covers it post-v1.
