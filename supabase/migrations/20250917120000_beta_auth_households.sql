-- Beta: auth profiles, households, members, invites + secured household_snapshots RLS

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text,
  display_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Households
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  snapshot_id text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT 'My household',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS households_owner_user_id_idx ON public.households (owner_user_id);
CREATE INDEX IF NOT EXISTS households_snapshot_id_idx ON public.households (snapshot_id);

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Household members
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.household_members (
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);

CREATE INDEX IF NOT EXISTS household_members_user_id_idx ON public.household_members (user_id);

ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Invite codes (reusable until expiry; inviter's household data is shared)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.household_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households (id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  inviter_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS household_invites_household_id_idx ON public.household_invites (household_id);
CREATE INDEX IF NOT EXISTS household_invites_code_idx ON public.household_invites (code);

ALTER TABLE public.household_invites ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_household_member(target_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.household_members hm
    WHERE hm.household_id = target_household_id
      AND hm.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_household_snapshot_member(snapshot_row_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.households h
    JOIN public.household_members hm ON hm.household_id = h.id
    WHERE h.snapshot_id = snapshot_row_id
      AND hm.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i integer;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email, 'user'), '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS: households
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "households_select_member" ON public.households;
CREATE POLICY "households_select_member"
  ON public.households FOR SELECT
  TO authenticated
  USING (public.is_household_member(id));

DROP POLICY IF EXISTS "households_insert_owner" ON public.households;
CREATE POLICY "households_insert_owner"
  ON public.households FOR INSERT
  TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RLS: household_members
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "household_members_select_member" ON public.household_members;
CREATE POLICY "household_members_select_member"
  ON public.household_members FOR SELECT
  TO authenticated
  USING (public.is_household_member(household_id));

DROP POLICY IF EXISTS "household_members_insert_self_or_owner" ON public.household_members;
CREATE POLICY "household_members_insert_self_or_owner"
  ON public.household_members FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.households h
      WHERE h.id = household_id AND h.owner_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "household_members_update_self" ON public.household_members;
CREATE POLICY "household_members_update_self"
  ON public.household_members FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RLS: household_invites
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "household_invites_select_member" ON public.household_invites;
CREATE POLICY "household_invites_select_member"
  ON public.household_invites FOR SELECT
  TO authenticated
  USING (public.is_household_member(household_id));

DROP POLICY IF EXISTS "household_invites_select_by_code" ON public.household_invites;
CREATE POLICY "household_invites_select_by_code"
  ON public.household_invites FOR SELECT
  TO authenticated
  USING (expires_at > now());

DROP POLICY IF EXISTS "household_invites_insert_owner" ON public.household_invites;
CREATE POLICY "household_invites_insert_owner"
  ON public.household_invites FOR INSERT
  TO authenticated
  WITH CHECK (
    inviter_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.households h
      WHERE h.id = household_id AND h.owner_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- RLS: household_snapshots — replace open anon policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "household_snapshots_anon_select" ON public.household_snapshots;
DROP POLICY IF EXISTS "household_snapshots_anon_insert" ON public.household_snapshots;
DROP POLICY IF EXISTS "household_snapshots_anon_update" ON public.household_snapshots;

DROP POLICY IF EXISTS "household_snapshots_auth_select" ON public.household_snapshots;
CREATE POLICY "household_snapshots_auth_select"
  ON public.household_snapshots FOR SELECT
  TO authenticated
  USING (public.is_household_snapshot_member(id));

DROP POLICY IF EXISTS "household_snapshots_auth_insert" ON public.household_snapshots;
CREATE POLICY "household_snapshots_auth_insert"
  ON public.household_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (public.is_household_snapshot_member(id));

DROP POLICY IF EXISTS "household_snapshots_auth_update" ON public.household_snapshots;
CREATE POLICY "household_snapshots_auth_update"
  ON public.household_snapshots FOR UPDATE
  TO authenticated
  USING (public.is_household_snapshot_member(id))
  WITH CHECK (public.is_household_snapshot_member(id));

-- Legacy shared rows: keep readable for authenticated during migration window
DROP POLICY IF EXISTS "household_snapshots_legacy_experiment_read" ON public.household_snapshots;
CREATE POLICY "household_snapshots_legacy_experiment_read"
  ON public.household_snapshots FOR SELECT
  TO authenticated
  USING (id IN ('shared', 'shared-experiment'));
