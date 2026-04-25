# Auth User Provisioning — Phase 1 Completion

**Plan:** `docs/executing/auth-user-provisioning.md`
**Phase:** 1 of 4 — Schema migration (plan §4 Tasks 1 + 2)
**Status:** complete (with one manual smoke test deferred to the operator)
**Date:** 2026-04-24

---

## What landed

A single goose migration (`backend/migrations/20260424140000_auth_user_provisioning.sql`), applied against the target Supabase project. Three atomic changes:

1. **`public.users.name` column** — `TEXT NULL`, primer for the onboarding wizard follow-up plan.
2. **Provisioning trigger** — `public.handle_new_auth_user()` + `on_auth_user_created AFTER INSERT ON auth.users`. Creates a fresh `organizations` row and a matching `public.users` row on every new auth user.
3. **Cleanup trigger** — `public.handle_deleted_auth_user()` + `on_auth_user_deleted AFTER DELETE ON auth.users`. Removes the `public.users` row, and the org iff no other users reference it.

## Files touched

| File | Change |
|---|---|
| `backend/migrations/20260424140000_auth_user_provisioning.sql` | New — 80-line migration with Up + Down blocks |

No code changes. No doc changes outside this completion file.

## Deviations from the plan

1. **Pre-work assumption off.** Plan §3 assumed `20260424120000_initial_schema.sql` was already `Applied`. `goose status` at execution time showed it as `Pending`. Running `goose up` applied both migrations in sequence (initial first, then the new one). No corrective action needed — target state is identical either way.
2. **`direnv` not installed on this machine.** Plan assumes direnv auto-sources `backend/.env`. Workaround used: `set -a; source .env; set +a` before each `goose`/`psql` invocation, which is the explicit fallback documented in `CLAUDE.md §Environment`. No impact on the migration itself.

## Verification performed

```
$ cd backend && set -a; source .env; set +a
$ goose -dir migrations postgres "$DATABASE_URL_DIRECT" up
OK   20260424120000_initial_schema.sql (180.36ms)
OK   20260424140000_auth_user_provisioning.sql (228.26ms)
```

Schema-level checks (via `psql "$DATABASE_URL_DIRECT"`):

- **`\d public.users`** — `name` column present, type `text`, nullable (no `not null` marker).
- **`SELECT proname FROM pg_proc WHERE proname IN ('handle_new_auth_user', 'handle_deleted_auth_user');`** — 2 rows returned.
- **`SELECT tgname FROM pg_trigger WHERE tgname IN ('on_auth_user_created', 'on_auth_user_deleted');`** — 2 rows returned.

All three match plan §4 Task 2 acceptance criteria for schema state.

## What is NOT verified in this phase

**Trigger-firing smoke test (plan §4 Task 2).** Requires creating + deleting a user via the Supabase dashboard UI. Must be run manually by the operator:

1. Supabase dashboard → Authentication → Users → "Add user" → enable "Auto-confirm".
2. From psql:
   ```sql
   SELECT u.id, u.email, u.name, u.role, o.name AS org_name
   FROM public.users u
   JOIN public.organizations o ON u.org_id = o.id
   WHERE u.email = '<smoke-test-email>';
   ```
   Expect: one row; `name IS NULL`; `role = 'admin'`; `org_name = '<email-local-part>''s Workspace'`.
3. Delete the user via the dashboard. Re-run:
   ```sql
   SELECT count(*) FROM public.users WHERE email = '<smoke-test-email>';
   SELECT count(*) FROM public.organizations WHERE name = '<expected-workspace-name>';
   ```
   Expect: both `0`.

The trigger *wiring* is verified (function bodies exist, triggers are installed on the right events). The trigger *semantics* — that SECURITY DEFINER context actually lets `public.handle_new_auth_user()` write to `public.organizations` and `public.users`, and that the search_path lock-down doesn't break the inserts — can only be confirmed by exercising the real path. Direct `INSERT INTO auth.users` from a psql session with the superuser role was considered and rejected: Supabase's `auth` schema has a strict constraint surface (encrypted_password, instance_id, email confirmation triggers of its own) that a hand-crafted INSERT is likely to violate, giving a false-positive failure that has nothing to do with our triggers.

## Why this shape — the non-obvious decisions

- **`SECURITY DEFINER` + pinned `search_path`.** The function runs in the context of the role that executes the INSERT into `auth.users` — typically Supabase's `supabase_auth_admin` role, which has no grant on `public`. `SECURITY DEFINER` makes the function run with the *owner's* privileges (postgres superuser, since goose applied the migration with `DATABASE_URL_DIRECT`). Without a locked `search_path`, a malicious schema entry on the search path could shadow `public.organizations` and execute under elevated privileges — the classic `SECURITY DEFINER` escalation pattern. `SET search_path = public, pg_temp` closes it.
- **Pattern-A + Pattern-C-safe cleanup.** The delete-side trigger unconditionally removes the `public.users` row, then conditionally removes the org iff `NOT EXISTS` another user referencing it. Today that condition is always true (Pattern A: one admin per org), so the cleanup is total. When invitations land (Pattern C: multi-member orgs), the condition becomes *sometimes* true and multi-member orgs survive the deletion of any one member. The trigger doesn't need to change between the two patterns — this is the point of decision §10 in the plan.
- **Workspace name from email local-part.** `split_part(NEW.email, '@', 1) || '''s Workspace'` gives `alice's Workspace` for `alice@example.com`. Cheap, no null handling needed (email is NOT NULL on `auth.users`), and the onboarding wizard will let users rename the org anyway — this is only the boot-strap default.
- **No backfill for existing `auth.users` rows.** Triggers fire on future INSERT/DELETE events, not retroactively. If the target project had pre-existing `auth.users` rows with no matching `public.users`, they would still fail `GetCurrentUser` with `ErrNotProvisioned` after Phase 3. Not handled here; out of scope per plan §8. If it becomes an issue, a one-shot backfill script is the right fix.

## Rollback

```
cd backend && set -a; source .env; set +a
goose -dir migrations postgres "$DATABASE_URL_DIRECT" down
```

Runs the Down block: drops both triggers, both functions, and the `name` column. Migrates back to `20260424120000`. `IF EXISTS` guards make the Down block idempotent. Data in `public.users` / `public.organizations` is not touched (those are data, not schema artefacts).

## What this unblocks for Phase 2

With the column in place, Phase 2 can:
- Regenerate `sqlc` — `models.User` picks up the new `Name` field (expected `*string` because `emit_pointers_for_null_types: true` is already set).
- Add `UpdateUserName` query (writes the new column).
- Add `CreateUser` query including the `name` parameter so the invitation-flow placeholder is schema-aligned from day one.
