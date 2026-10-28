-- Family Mode: close client access to household_snapshots; remove beta auth/household objects.
-- Run in Supabase SQL Editor after deploying Edge Functions.
-- Does NOT drop household_snapshots (single row id = 'family' via Edge Function).

-- ---------------------------------------------------------------------------
-- 1. Drop ALL RLS policies on household_snapshots (anon/auth/legacy)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'household_snapshots'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.household_snapshots',
      pol.policyname
    );
  END LOOP;
END $$;

ALTER TABLE public.household_snapshots ENABLE ROW LEVEL SECURITY;
-- No new policies: PostgREST clients (anon/authenticated) are denied by default.

-- ---------------------------------------------------------------------------
-- 2. Beta analytics (table CASCADE drops trigger; safe if already removed)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.beta_product_events CASCADE;
DROP FUNCTION IF EXISTS public.beta_product_events_set_user_id();

-- ---------------------------------------------------------------------------
-- 3. Auth profile trigger (no Supabase Auth users in family mode)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 4. Household / invite graph
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.join_household_by_invite(text, text);
DROP TABLE IF EXISTS public.household_invites CASCADE;
DROP TABLE IF EXISTS public.household_members CASCADE;
DROP TABLE IF EXISTS public.households CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- ---------------------------------------------------------------------------
-- 5. Helper functions (only used by removed RLS)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.is_household_member(uuid);
DROP FUNCTION IF EXISTS public.is_household_snapshot_member(text);
DROP FUNCTION IF EXISTS public.generate_invite_code();

-- Optional: legacy accounts table (app no longer uses it)
-- DROP TABLE IF EXISTS public.accounts CASCADE;
