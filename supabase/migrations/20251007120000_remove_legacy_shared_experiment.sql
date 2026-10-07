-- Remove legacy shared-experiment snapshot and read policy (beta household-only sync).
-- Run manually in Supabase SQL Editor when ready — NOT applied automatically by the app.

-- 1. Drop legacy read policy (authenticated users no longer need shared rows)
DROP POLICY IF EXISTS "household_snapshots_legacy_experiment_read" ON public.household_snapshots;

-- 2. Delete legacy experiment snapshot row (test data — safe to remove per product decision)
DELETE FROM public.household_snapshots
WHERE id IN ('shared-experiment', 'shared');

-- Optional: verify household snapshots remain
-- SELECT id, updated_at FROM public.household_snapshots WHERE id LIKE 'household_%' ORDER BY updated_at DESC;
