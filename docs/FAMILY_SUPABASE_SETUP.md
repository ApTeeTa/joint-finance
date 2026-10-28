# Family Mode — Supabase setup

Closed two-person app: **no Supabase Auth**. Financial data in `household_snapshots` row `id = 'family'`, accessed only via Edge Functions.

## 1. Edge Function secrets (Dashboard → Edge Functions → Secrets)

Set **before** deploy:

| Secret | Description |
|--------|-------------|
| `FAMILY_PASSPHRASE` | Long random passphrase (you + spouse share verbally) |
| `FAMILY_TOKEN_SECRET` | Random string ≥ 32 chars for signing device JWTs |

Do **not** commit these values to Git.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically for Edge Functions.

## 2. Deploy functions

From repo root (with [Supabase CLI](https://supabase.com/docs/guides/cli) linked to project):

```bash
supabase functions deploy family-session
supabase functions deploy family-snapshot
```

Or upload via Dashboard.

## 3. SQL migration

Run once in SQL Editor:

`supabase/migrations/20251008220000_family_mode_rls_and_cleanup.sql`

This closes RLS on `household_snapshots` and drops beta auth/household tables.

## 4. Auth providers (Dashboard)

- Disable **Email sign-up**
- Disable **Google OAuth**
- No app users required

## 5. CORS origins

Edit `supabase/functions/_shared/cors.ts` if your Vercel URL differs, then redeploy functions.

## 6. Vercel

Enable **Deployment Protection** (password) on production and preview deployments.

## 7. Verify

- `GET /rest/v1/household_snapshots` with anon key → empty / denied
- `POST /functions/v1/family-session` wrong password → 401
- Correct password → `access_token`
- `GET /functions/v1/family-snapshot` with Bearer token → payload
