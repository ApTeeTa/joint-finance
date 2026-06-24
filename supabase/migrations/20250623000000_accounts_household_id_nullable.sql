-- Allow accounts without household until household logic is implemented.
ALTER TABLE public.accounts
ALTER COLUMN household_id DROP NOT NULL;
