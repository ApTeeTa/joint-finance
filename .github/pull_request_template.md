## Summary

<!-- What changed and why -->

## Architecture checklist (required for `src/modules/` or sync changes)

- [ ] Shared-field mutations go through `dispatch()` → `financeGate` (no direct `state.*` push/filter in UI handlers)
- [ ] No `supabase.from(` outside `src/lib/stateRemote.js`
- [ ] No static `supabase` import in `src/modules/`
- [ ] `LOCAL_ONLY_TEST_MODE = false` before merge to `main` (if touching `environmentConfig.js`)
- [ ] Ran `powershell -File scripts/architecture-lock-check.ps1` locally (or CI green)

## Test plan

- [ ] Local smoke on `http://127.0.0.1:8080/`
- [ ] Relevant tab tested (accounts / categories / obligations / savings / debts)
