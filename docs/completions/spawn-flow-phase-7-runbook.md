# Spawn Flow — Phase 7 Runbook

**Plan:** `docs/executing/spawn-flow.md` §Phase 7
**Goal:** confirm the M4 demo loop works end-to-end against a real Fly account + a real provider API key.

Pre-conditions already verified by the assistant: backend `vet`/`build`/`test` clean; frontend `tsc`/`eslint` clean; all 5 migrations applied including `20260426150000_spawn_flow.sql`; `deploy_targets` has the `fly` seed; `agent_templates` has `Hermes`; `harness_adapters.adapter_image_ref` set; `agent_instances` table empty (clean slate).

**You need on hand:**
- A real provider API key (OpenRouter / Anthropic / OpenAI)
- ~10 minutes
- A browser signed in (or ready to sign in) as your test user
- A Fly dashboard tab open at <https://fly.io/dashboard> for cross-checks

---

## Step 0 — Boot the stack

In a fresh terminal at the repo root:

```bash
cd "/Users/philippholke/Crimson Sun/corellia"
overmind start
```

**Expect within ~2s:**

```
api  | jwks initialised ...
api  | deploy targets initialised kinds=aws,fly,local fly_org=<your-slug>
api  | listening addr=:8080
web  | ▲ Next.js 15.x  - Local: http://localhost:3000
```

**Do NOT expect:** any `slog.Warn reaped stale pending instances …` line (clean slate confirmed; if you see one, flag it).

✅ when both processes are live and the kinds line reads `aws,fly,local` (alphabetical = M3 Phase 8 `sort.Strings` contract holds).

---

## Step 1–3 — Sign in → /agents → Deploy

1. Open <http://localhost:3000>, sign in.
2. Navigate to `/agents` (sidebar link).
3. Hermes card visible with two active buttons: **Deploy** (default) + **Deploy 5** (outline).
4. Click **Deploy** — modal opens with: Name, Provider (Select), Model (text), API Key (password + Show toggle).

✅ when the modal renders with all five inputs.

---

## Step 4 — Single spawn (`smoke-01`)

Fill:

| Field | Value |
|---|---|
| Name | `smoke-01` |
| Provider | OpenRouter / Anthropic / OpenAI (pick one matching your key) |
| Model | provider-specific (e.g. `anthropic/claude-opus-4.6` for OpenRouter, `claude-opus-4-7` for Anthropic, `gpt-5` for OpenAI) |
| API Key | your real provider key |

Click **Submit**.

**Expect:**
- Modal closes; success toast.
- `router.push('/fleet')` redirects within ~1s.
- `smoke-01` row appears in `Pending` (gray secondary badge).
- Within **90s** the badge flips `Pending → Running` (gray → emerald) via the 3s FE poll.
- Logs link (external icon) becomes clickable; opens `https://fly.io/apps/corellia-agent-<12char>/monitoring` in a new tab.

**Cross-check in Fly dashboard:** new app `corellia-agent-<12char>` exists; one machine in `started` state.

✅ when row reads Running and the Fly machine is started.

---

## Step 5 — Confirm no error noise on the wire

In a third terminal:

```bash
cd "/Users/philippholke/Crimson Sun/corellia/backend" && set -a && source .env && set +a
psql "$DATABASE_URL_DIRECT" -At -c "SELECT id, name, status, deploy_external_ref, last_started_at FROM agent_instances ORDER BY created_at DESC LIMIT 5;"
```

**Expect:** the `smoke-01` row with `status=running`, non-null `deploy_external_ref`, non-null `last_started_at`.

In the BE log stream:
- Zero `slog.Error` lines.
- Zero raw Fly error blobs (e.g. `fly api: 4xx ... rate-limit ...`) — if anything failed, decision 25's redaction layer should mask it as a generic `Unavailable` to the FE.

✅ when DB state matches FE state and BE logs are quiet.

---

## Step 6 (optional) — `curl /chat`

**Skippable** — Hermes 0.x is CLI-shaped per blueprint §3.1 gap (M3 Phase 1 discovery). If skipped, document in the completion doc as "deferred to v1.5 sidecar."

If your adapter image *does* expose an HTTP endpoint, get the machine address from Fly dashboard and `curl https://<machine>.fly.dev/chat …`.

---

## Step 7–8 — Deploy 5 fan-out (`fanout-01..05`)

1. Back to `/agents` → click **Deploy 5**.
2. Modal opens in N-mode: Name field replaced by **Name prefix**, Count field appears.
3. Fill: prefix=`fanout`, count=`5`, same provider + model + API key. Submit.

**Expect:**
- Redirected to `/fleet`.
- Five new rows appear: `fanout-1` … `fanout-5` (one-digit width because `len("5") == 1` per decision 28).
- All start `Pending`; all flip `Running` over ~30–90s.
- BE log shows roughly a wave-of-3-then-wave-of-2 cadence (decision 29's semaphore-of-3).

**Cross-check in Fly dashboard:** five new `corellia-agent-*` apps; total now six (smoke-01 + 5).

✅ when all five flip to Running.

---

## Step 9 — Stop one running agent

1. Pick any running row (say `fanout-1`).
2. Click **Stop** → AlertDialog opens with "Stop fanout-1?" copy.
3. Click **Confirm**.

**Expect:**
- Button shows `Stopping…` for 1–3s.
- Row badge flips `Running → Stopped` (emerald → outline-muted).
- Toast confirms success.

**Cross-check Fly:** machine for that app is at `stopped` state (not destroyed — config preserved per decision 23).

✅ when row is Stopped and Fly machine is stopped.

---

## Step 10 — Destroy `smoke-01`

1. Click **Destroy** on `smoke-01` row → AlertDialog opens with "Destroy smoke-01?" copy and a destructive-styled confirm button.
2. Click **Confirm**.

**Expect:**
- Button shows `Destroying…` for 1–3s.
- Row badge flips `Running/Stopped → Destroyed` (muted line-through styling).
- Row stays in the table (soft-delete per decision 24 — audit trail).
- Toast confirms.

**Cross-check Fly:** the `corellia-agent-<smoke-01-id>` app is **gone** from `fly apps list`.

```bash
fly apps list | grep corellia-agent-
```

Should show 5 apps remaining (the four fanout-* still up + the one stopped).

✅ when row is Destroyed (line-through) and the Fly app is gone.

---

## Step 11 (optional) — Boot-sweep verification

**Skippable** — brittle to script; worth doing once if curious.

1. Click **Deploy** on Hermes again, fill `name=sweep-bait`, submit.
2. Within 1s of the redirect, in the overmind terminal hit **Ctrl-C** to kill the BE (the `pending` row is now stranded).
3. Manually age the row in the DB:
   ```bash
   cd "/Users/philippholke/Crimson Sun/corellia/backend" && set -a && source .env && set +a
   psql "$DATABASE_URL_DIRECT" -c "UPDATE agent_instances SET created_at = now() - interval '6 minutes' WHERE name='sweep-bait';"
   ```
4. `overmind start` again. Within ~1s of boot expect:
   ```
   api  | reaped stale pending instances count=1
   ```
5. The `sweep-bait` row should now be `Failed` in `/fleet`.

**Don't forget:** the Fly app for `sweep-bait` *was* created (the row only stays pending if the BE crashed *between* Fly create and the poll completing). Check `fly apps list` and `fly apps destroy corellia-agent-<id> --yes` if so.

✅ when the sweep log fires and the row is Failed.

---

## Cleanup — destroy all remaining smoke Fly apps

Either:
- Click **Destroy** on every remaining `fanout-*` row in `/fleet` (slow but exercises the path), **or**
- One-shot CLI wipe:

```bash
fly apps list | awk '/corellia-agent-/ {print $1}' | xargs -n1 -I{} fly apps destroy {} --yes
```

Then confirm the table is clean:

```bash
fly apps list | grep corellia-agent- || echo "✅ clean"
```

---

## What to report back

Per step, please tell me:

1. **Step 0:** the three boot log lines (jwks / deploy targets / listening), and the Next.js boot line.
2. **Step 4:** observed `Pending → Running` latency for `smoke-01` (seconds). Provider+model used.
3. **Step 7–8:** observed `Pending → Running` latency for the 5-spawn fan-out (seconds, fastest + slowest).
4. **Step 9:** Stop latency (seconds from confirm-click to badge flip).
5. **Step 10:** Destroy latency + confirmation that Fly app is gone.
6. **Step 11 (if run):** boot-sweep log line, exact text.
7. **Anywhere:** any `slog.Error`, any raw Fly error visible in the FE, any UI glitch (badge stuck, button doesn't disable, modal doesn't close, etc.).

Once you report, I'll write `docs/completions/spawn-flow-phase-7.md` capturing the run, then we proceed to Phase 8 (cleanup, docs, validation matrix, changelog).
