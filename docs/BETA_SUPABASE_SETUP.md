# Beta — Supabase setup (B1 Auth & Households)

Run once in Supabase SQL editor (or CLI migrate) before testing beta auth on deploy.

**Smoke tests:** see [BETA_CHECKLIST.md](./BETA_CHECKLIST.md).

## 1. Apply migration

File: `supabase/migrations/20250917120000_beta_auth_households.sql`

Creates: `profiles`, `households`, `household_members`, `household_invites`, secured RLS on `household_snapshots`.

## 2. Enable Auth providers

Supabase Dashboard → Authentication → Providers:

- **Email** — enabled (confirm email optional for closed beta)
- **Google** — enabled; add OAuth client id/secret; redirect URLs:
  - `http://127.0.0.1:8080/`
  - `https://<your-vercel-preview>.vercel.app/`
  - production URL when ready

## 3. Site URL

Authentication → URL configuration:

- Site URL: your primary deploy URL
- Redirect URLs: same list as Google OAuth

## 4. Verify RLS

After migration, anon users must **not** write `household_snapshots`. Authenticated users only access snapshots for households they belong to.

## 5. Local dev

- `LOCAL_ONLY_TEST_MODE = false` in `environmentConfig.js` to test auth gate (or keep `true` to skip auth locally).
- Run `start.bat` → sign up → create household → second browser/account → join via invite code.

## 6. Invite join RLS fix (B2.1)

After B2.1, run once in SQL editor:

File: `supabase/migrations/20250917180000_household_invite_join_rls.sql`

Adds `household_members_select_self` policy and optional `join_household_by_invite()` RPC.

The app uses plain INSERT for join (not UPSERT) — this migration is recommended but the code fix alone may be enough if join already works.

## 7. Invite codes

Owners share codes from the **Invite** button in the app header. Partners use **Join** in the header or the onboarding screen.
