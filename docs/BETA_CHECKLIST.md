# Closed beta — smoke checklist

Run on **beta Vercel preview** with two real accounts (two browsers or phone + desktop).

## Before testing

- [ ] `LOCAL_ONLY_TEST_MODE = false` in `environmentConfig.js` (committed)
- [ ] Supabase migration `20250917120000_beta_auth_households.sql` applied
- [ ] Optional: `20250917180000_household_invite_join_rls.sql` applied (join already works without it)
- [ ] Beta preview URL in Supabase → Authentication → Redirect URLs
- [ ] Email **Confirm email** OFF for easier signup (recommended for closed beta)

## Account A (owner)

- [ ] Sign up / Sign in
- [ ] Create household + enter display name
- [ ] App loads (accounts tab, balances)
- [ ] Add account or category (local change)
- [ ] **Invite** → copy code

## Account B (partner)

- [ ] Sign in (separate browser / incognito)
- [ ] **Join** with invite code + display name
- [ ] Sees **Account A data** (not empty / not solo test data)
- [ ] Add operation as partner → visible on Account A after refresh

## Sync both ways

- [ ] A changes data → B sees after refresh or tab focus
- [ ] B changes data → A sees after refresh or tab focus

## Profile names (B3)

- [ ] Header shows both display names (not Муж/Жена)
- [ ] Click partner name → switch profile for operations
- [ ] Click own name while partner selected → switch back to self
- [ ] Click own name while self selected → edit name modal
- [ ] Partner sees new name after page reload

## Account actions (B2.1)

- [ ] **Sign out** → login screen
- [ ] Sign in again → same household, same data

## Pass criteria

All boxes checked = **closed beta core ready** for 2–3 external couples.

## Known limits (not blockers)

- Google OAuth not enabled yet (B4)
- No feedback link yet (B5)
- Partner name updates require reload on other device
- No leave household / delete account
