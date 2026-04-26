# M-chat Hermes Chat Sidecar — Phase 7 completion notes

**Plan:** `docs/executing/hermes-chat-sidecar.md` §4 Phase 7.
**Date:** 2026-04-27.
**Scope:** Operator-collaboration + code. One new migration, smoke.sh rewrite, four doc reconciliations. Zero Go, TS, proto, or sqlc changes — all backend/frontend work was completed in Phases 1–6. The migration contains a `<IMAGE-DIGEST-PENDING>` placeholder that the operator fills in after the buildx push.

---

## What shipped

### New files

- **`backend/migrations/20260427130000_bump_hermes_adapter_for_chat.sql`** — `UPDATE harness_adapters SET adapter_image_ref = 'ghcr.io/hejijunhao/corellia-hermes-adapter@sha256:<IMAGE-DIGEST-PENDING>' WHERE harness_name = 'hermes'`. Inline operator instructions for the buildx push and digest capture. The `adapter_image_ref_digest_pinned` CHECK constraint rejects the literal placeholder on `goose up` — an intentional gate. `+goose Down` reverts to `sha256:d152b3cb…`.

### Modified files

- **`adapters/hermes/smoke.sh`** (full rewrite) — removes the M3-era "no /health, no --port" header caveat. Adds `CORELLIA_CHAT_ENABLED=true` + `CORELLIA_SIDECAR_AUTH_TOKEN=$(openssl rand -hex 32)` to the staged secrets block. Adds `--port 443:8642/tcp:http:tls` to `fly machines run`. Adds a `/health` probe loop (up to 60s). Adds a `/chat` bearer probe. Machine-state poll and log dump retained.
- **`adapters/hermes/README.md`** — Known Limitations §1 struck through and replaced with the sidecar's actual capabilities. Smoke section updated. Pinning section gains a history table.
- **`docs/blueprints/adapter-image-blueprint.md`** — Runtime contract claim and smoke description updated for post-M-chat reality.
- **`docs/refs/fly-commands.md`** — `--port` entry updated from "M4: not used" to accurate M-chat usage.
- **`docs/changelog.md`** — 0.11.6 index entry and body added.

---

## Operator exit gate

Docker is not running on the workstation that implemented this phase. The following operator steps are required to complete Phase 7:

```sh
# 1. Build and push the M-chat adapter image
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/hejijunhao/corellia-hermes-adapter:v2026-04-27-mchat \
  --push adapters/hermes

# 2. Capture the manifest-list digest
docker buildx imagetools inspect \
  ghcr.io/hejijunhao/corellia-hermes-adapter:v2026-04-27-mchat \
  | grep "Digest:" | head -1
# → Digest: sha256:<64-char-hex>

# 3. Fill in <IMAGE-DIGEST-PENDING> in two files:
#      backend/migrations/20260427130000_bump_hermes_adapter_for_chat.sql
#      adapters/hermes/smoke.sh  (IMAGE= line)
#    Also update the README.md adapter history table's pending row.

# 4. Run the migration
goose -dir backend/migrations postgres "$DATABASE_URL_DIRECT" up

# 5. Run the smoke test
export FLY_ORG_SLUG=<your-org-slug>
export CORELLIA_SMOKE_API_KEY=sk-or-v1-<key>
./adapters/hermes/smoke.sh
# Expected: five-step output ending with ">> smoke complete"
```

---

## What I deliberately did NOT do

- **Did not build or push the Docker image.** Docker was not running on the implementation workstation. The migration file is written with the correct SQL shape and a `<IMAGE-DIGEST-PENDING>` placeholder that the CHECK constraint will reject until the operator fills it in.
- **Did not add `harness_adapters.supports_chat` column.** Risk register §6 proposed this for v2+ (when multiple harnesses land, to hide the chat checkbox for non-chat-capable harnesses). With only one harness in v1, the column adds no value and is deferred.
- **Did not implement the `UpdateAgentDeployConfig` services-block toggle.** Known pending item from Phase 3. Toggling chat on a running agent still requires destroy-and-respawn. Deferred to v1.5.
- **Did not add streaming.** Anti-scope-creep §5. v1.6.

---

## Definition of done — status

| Item | Status |
|---|---|
| Chat-enabled agent spawned via FE wizard exposes `/chat` with bearer auth | ✅ Phases 3–5 |
| Operator can chat from FE; multi-turn via `session_id` | ✅ Phase 5 |
| Chat-disabled agent byte-equivalent to pre-M-chat | ✅ Phase 3 |
| `Health()` HTTP probe for chat-enabled instances | ✅ Phase 6 |
| Bearer token never in logs / errors / client surfaces | ✅ Phases 1, 4 |
| `go vet / test`, FE type-check + lint + build clean | ✅ Phases 3–6 |
| Adapter image rebuilt + pushed to GHCR | ⏳ Operator-gated |
| `adapter_image_ref` migration applied | ⏳ Operator-gated (after digest filled in) |
| End-to-end smoke (`./adapters/hermes/smoke.sh`) passing | ⏳ Operator-gated |
| `docs/changelog.md` entry filed | ✅ This phase |
| Docs reconciled (`README`, blueprint, fly-commands) | ✅ This phase |
