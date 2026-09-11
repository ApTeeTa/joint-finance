# Architecture Lock Declaration

**Status:** LOCKED (action contract migration complete on experiment branch)

```text
ACTION CONTRACT MIGRATION: COMPLETE
Date: 2026-09-11
Branch: experiment-full-sync
Tag: v2026-phase-5-enforcement-lock
Model: UI → ACTION CONTRACTS → financeGate → State → stateRemote → Snapshot
Dual system: OFF
Legacy L-1–L-10: REMOVED
```

## Phase completion tags

| Phase | Tag |
|-------|-----|
| 0–1 baseline | `v2026-baseline-secured`, contracts foundation |
| Data clean | `v2026-data-clean` |
| 2 Gate complete | `v2026-phase-2-gate-complete` |
| 3 UI dispatch | `v2026-phase-3-ui-dispatch` |
| 4 Legacy removed | `v2026-phase-4-legacy-removed` |
| 5 Enforcement lock | `v2026-phase-5-enforcement-lock` |

## Static guards

Run before merge:

```powershell
powershell -File scripts/architecture-lock-check.ps1
```

CI workflow: `.github/workflows/architecture-lock.yml`

## Allowed mutation zones

| Layer | May mutate shared snapshot fields |
|-------|----------------------------------|
| `transactions.js` | Yes — gate record functions |
| `storage.js` | Yes — merge / apply snapshot |
| `mutationContract.apply` | Yes — accounts/savings entity apply only |
| UI modules (categories, obligations, debts) | No — dispatch only |
| `stateRemote.js` | Yes — remote I/O only |

## Remaining documented exceptions (not user mutations)

- `LEGACY_SAFE_OPERATIONS` — bootstrap reconcile, obligation payment reserve chain, single_use saving spend delete
- `accounts.js` render — default `exchangeRate` bootstrap when undefined

## Pre-main merge

- [ ] Re-run full manual regression on experiment preview
- [ ] Set `ACTIVE_ENVIRONMENT = 'production'` only when merging to `main`
- [ ] Set `LOCAL_ONLY_TEST_MODE = false`
- [ ] Two-device sync smoke test on target snapshot row
