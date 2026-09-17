-- Fix invite join: users must read their own membership rows (upsert / multi-household).

DROP POLICY IF EXISTS "household_members_select_self" ON public.household_members;
CREATE POLICY "household_members_select_self"
  ON public.household_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Optional hardened join path (SECURITY DEFINER bypasses RLS for validated invite inserts).
CREATE OR REPLACE FUNCTION public.join_household_by_invite(
  p_code text,
  p_display_name text DEFAULT 'Member'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.household_invites%ROWTYPE;
  v_household public.households%ROWTYPE;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_invite
  FROM public.household_invites
  WHERE code = upper(trim(p_code))
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite code not found or expired';
  END IF;

  v_name := coalesce(nullif(trim(p_display_name), ''), 'Member');

  INSERT INTO public.household_members (household_id, user_id, display_name, role)
  VALUES (v_invite.household_id, auth.uid(), v_name, 'member')
  ON CONFLICT (household_id, user_id) DO UPDATE
  SET display_name = excluded.display_name,
      role = 'member';

  SELECT * INTO v_household
  FROM public.households
  WHERE id = v_invite.household_id;

  RETURN json_build_object(
    'household_id', v_household.id,
    'snapshot_id', v_household.snapshot_id,
    'name', v_household.name,
    'owner_user_id', v_household.owner_user_id,
    'role', 'member',
    'display_name', v_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_household_by_invite(text, text) TO authenticated;
