-- +goose Up

-- 1. Schema primer for onboarding wizard.
ALTER TABLE public.users ADD COLUMN name TEXT NULL;

-- 2. Provisioning trigger.
--
-- On new auth.users row, create a fresh organization and the matching
-- public.users row linked to it. Runs in the same transaction as the
-- auth.users INSERT, so either both rows land or neither does — no
-- dangling auth users without a public record.
--
-- SECURITY DEFINER + fixed search_path is required: the function is
-- invoked in the auth role's context but writes public.*, and without
-- an explicit search_path it is a classic privilege-escalation target.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_org_id UUID;
BEGIN
  INSERT INTO public.organizations (name)
  VALUES (split_part(NEW.email, '@', 1) || '''s Workspace')
  RETURNING id INTO new_org_id;

  INSERT INTO public.users (auth_user_id, email, org_id, role)
  VALUES (NEW.id, NEW.email, new_org_id, 'admin');

  RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- 3. Cleanup trigger.
--
-- On auth.users DELETE, remove the matching public.users row, then
-- remove the org iff it has no other members. Pattern-A-correct
-- (one admin per org; deleting the admin removes the workspace) and
-- Pattern-C-safe (if v2 adds invitations, multi-member orgs survive
-- because the IF EXISTS check fires).

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.handle_deleted_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_org_id UUID;
BEGIN
  SELECT org_id INTO old_org_id
  FROM public.users
  WHERE auth_user_id = OLD.id;

  DELETE FROM public.users WHERE auth_user_id = OLD.id;

  IF old_org_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users WHERE org_id = old_org_id
  ) THEN
    DELETE FROM public.organizations WHERE id = old_org_id;
  END IF;

  RETURN OLD;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_deleted_auth_user();

-- +goose Down
DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
DROP FUNCTION IF EXISTS public.handle_deleted_auth_user();
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_auth_user();
ALTER TABLE public.users DROP COLUMN IF EXISTS name;
