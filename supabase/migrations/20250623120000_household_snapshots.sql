-- Shared app state for cross-device sync (accounts, categories, history, etc.)
CREATE TABLE IF NOT EXISTS public.household_snapshots (
  id text PRIMARY KEY,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.household_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "household_snapshots_anon_select" ON public.household_snapshots;
CREATE POLICY "household_snapshots_anon_select"
  ON public.household_snapshots
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "household_snapshots_anon_insert" ON public.household_snapshots;
CREATE POLICY "household_snapshots_anon_insert"
  ON public.household_snapshots
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "household_snapshots_anon_update" ON public.household_snapshots;
CREATE POLICY "household_snapshots_anon_update"
  ON public.household_snapshots
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

INSERT INTO public.household_snapshots (id, payload)
VALUES ('shared', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
