# Beta — Supabase setup (B1 Auth & Households)

Run once in Supabase SQL editor (or CLI migrate) before testing beta auth on deploy.

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

## 6. Invite codes (B1)

Owners generate codes via `createInviteCode()` (UI for invites — next beta step). SQL/manual insert works for smoke tests.
