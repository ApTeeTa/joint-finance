-- Beta product analytics: usage events only (no financial payloads).

CREATE TABLE IF NOT EXISTS public.beta_product_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  household_id uuid REFERENCES public.households (id) ON DELETE SET NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT beta_product_events_event_name_check CHECK (
    event_name IN (
      'signup',
      'signin',
      'household_created',
      'household_joined',
      'purchase_planner_opened',
      'purchase_simulation_completed',
      'purchase_simulation_cancelled',
      'purchase_reserve_affected',
      'savings_goal_created',
      'redistribution_performed',
      'feedback_submitted'
    )
  )
);

CREATE INDEX IF NOT EXISTS beta_product_events_event_name_idx
  ON public.beta_product_events (event_name);

CREATE INDEX IF NOT EXISTS beta_product_events_created_at_idx
  ON public.beta_product_events (created_at DESC);

CREATE INDEX IF NOT EXISTS beta_product_events_household_id_idx
  ON public.beta_product_events (household_id);

ALTER TABLE public.beta_product_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "beta_events_insert_authenticated" ON public.beta_product_events;
CREATE POLICY "beta_events_insert_authenticated"
  ON public.beta_product_events
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- No SELECT policy for clients: view aggregates in Supabase SQL Editor (service role).

CREATE OR REPLACE FUNCTION public.beta_product_events_set_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.user_id := auth.uid();
  IF NEW.household_id IS NOT NULL
     AND NOT public.is_household_member(NEW.household_id) THEN
    NEW.household_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS beta_product_events_set_user_id_trg ON public.beta_product_events;
CREATE TRIGGER beta_product_events_set_user_id_trg
  BEFORE INSERT ON public.beta_product_events
  FOR EACH ROW
  EXECUTE FUNCTION public.beta_product_events_set_user_id();
