# Joint Finance — Execution Safety Report

**Date:** 2026-06-21  
**Purpose:** Pre-migration readiness validation before removing legacy paths L-1 → L-10  
**Scope:** Read-only analysis of `src/` against lockdown design and enforcement plan  
**Branch reference:** `experiment-full-sync` (HEAD `7bb38b3`)  
**Constraint:** No code changes performed for this report.

---

## 1. SYSTEM READINESS OVERVIEW

### Assessment dimensions

| Dimension | Finding | Confidence |
|-----------|---------|------------|
| **financeGate coverage** | Money-moving and debt flows are largely gated. Entity CRUD (category/obligation create-update, account/saving orchestration, exchange rate) is **partially** gated — UI modules still mutate `state` directly before or after gate calls. | High (code-reviewed) |
| **stateRemote stability** | Snapshot pull/push/subscribe/clear is centralized in `stateRemote.js`. Debounced push, merge-on-pull, experiment seed, and `initialSyncDone` guard are implemented and coherent. | High |
| **Snapshot integrity reliability** | Primary persistence path (`saveState` → `schedulePushSharedState` → `household_snapshots` upsert) is functional and used by all tabs. **One parallel remote write** (`accounts` table insert) is the only integrity breach. | High |

### Supporting evidence

**financeGate** exports 24 mutation entry points covering expenses, reserves, accounts (deposit/transfer/record CRUD), savings (deposit/withdraw/spend/admin), obligations (pay/reserve/unreserve), debts (full lifecycle), category delete, and undo. `FINANCE_ENFORCEMENT_MODE = true`.

**stateRemote** is the only module performing `supabase.from('household_snapshots')` operations. Experiment isolation uses `SNAPSHOT_ID = 'shared-experiment'` and `SEED_SNAPSHOT_ID = 'shared'` with read-only production seed when experiment has no accounts.

**Snapshot push** is triggered exclusively through `storage.saveState()` → dynamic import of `schedulePushSharedState`. Display mode changes do not trigger push.

### Overall readiness status

## **PARTIALLY SAFE**

| Scope | Status | Rationale |
|-------|--------|-----------|
| **Phase 1 — L-1 removal (legacy Supabase write)** | **SAFE TO PROCEED** | Legacy insert is optional today; handler already falls back to local-only create on failure. Snapshot path is authoritative for UI. |
| **Phase 2 — L-6 → L-10 (gate consolidation)** | **REQUIRES PRE-GATE WORK** | Missing or incomplete gate exports for several CRUD flows; removing UI mutations without gate replacements would break features. |
| **Full lockdown L-1 → L-10 in one step** | **NOT SAFE** | Combining remote removal and gate refactors without sequencing risks regressions and untested interaction order. |

---

## 2. MUTATION COVERAGE AUDIT

Legend: **Gate** = goes through `financeGate.js` export with `runProtected` / gate context. **Bypass** = UI or non-gate module mutates shared fields directly.

### Accounts

| Mutation type | Trigger | Gate? | Bypass? | Notes |
|---------------|---------|-------|---------|-------|
| Create account | Add-account form | **PARTIAL** | **YES** | UI `state.accounts.push` + optional `depositAccount` (gate) + `recordAccountCreation` (gate import, transaction only). `financeGate.createAccount` exists but is **not** used as orchestrator. Legacy `persistAccountToSupabase` runs first (L-1). |
| Update account (name/balance) | Edit form | **PARTIAL** | **YES** | UI mutates `account.name` / `account.balance` **before** `updateAccountRecord` (gate). |
| Delete account | Delete button | **PARTIAL** | **YES** | `deleteAccountRecord` (gate) then UI `state.accounts.filter`. |
| Deposit (top-up) | Top-up modal | **YES** | NO | `depositAccount` via gate. |
| Transfer | Transfer modal | **YES** | NO | `transferAccount` via gate. |
| Exchange rate update | USD rate input | **NO** | **YES** | Direct `state.exchangeRate =` in `accounts.js` (L-10). Still reaches snapshot via `saveState`. |

### Categories

| Mutation type | Trigger | Gate? | Bypass? | Notes |
|---------------|---------|-------|---------|-------|
| Create category | Add modal | **NO** | **YES** | `state.categories.push` in UI (L-6). |
| Update category | Edit modal | **NO** | **YES** | Direct field assignment on category object (L-6). |
| Delete category | Menu delete | **PARTIAL** | **YES** | `deleteCategory` / `recordCategoryDeleted` (gate) for transaction; UI removes from array (L-6). |
| Reserve / unreserve | +/- actions | **YES** | NO | `reserveCategory`, `unreserveCategory`. |
| Fill to limit | Detail button | **YES** | NO | Calls `reserveCategory`. |
| Add expense | Expense modal | **YES** | NO | `createExpense`. |

### Savings

| Mutation type | Trigger | Gate? | Bypass? | Notes |
|---------------|---------|-------|---------|-------|
| Create saving | Add modal | **PARTIAL** | **YES** | UI `state.savings.push` then `recordSavingCreation` (gate `createSaving` — transaction only) (L-8). |
| Update saving (metadata) | Edit modal | **PARTIAL** | **YES** | UI direct field edits then `updateSavingRecord` (gate) (L-8). |
| Delete saving | Delete button | **PARTIAL** | **YES** | `deleteSavingRecord` (gate) + UI array filter. |
| Deposit / withdraw | Modals | **YES** | NO | `updateSavings` (gate). |
| Spend saving | Spend modal | **YES** | NO | `spendSaving`. |

### Obligations

| Mutation type | Trigger | Gate? | Bypass? | Notes |
|---------------|---------|-------|---------|-------|
| Create obligation | Add form | **NO** | **YES** | `state.obligations.push` (L-7). |
| Update obligation | Edit form | **NO** | **YES** | Direct field assignment (L-7). |
| Delete obligation | Delete button | **NO** | **YES** | UI `state.obligations.filter` only — **no transaction record** (L-7). |
| Pay obligation | Pay modal | **YES** | NO | `payObligation`. |
| Reserve / unreserve | +/- actions | **YES** | NO | `reserveObligation`, `unreserveObligation`. |

### Debts

| Mutation type | Trigger | Gate? | Bypass? | Notes |
|---------------|---------|-------|---------|-------|
| Create owed-to-us / we-owe | Add modals | **YES** | NO | `createDebtOwedToUs`, `createDebtWeOwe`. |
| Create manual debt event | Add modal | **YES** | NO | `createManualDebtEvent`. |
| Repay debt | Repay modal | **YES** | NO | `repayDebt`. |
| Write off debt | Write-off modal | **YES** | NO | `writeOffDebt`. |

### Exchange rate

| Mutation type | Trigger | Gate? | Bypass? | Notes |
|---------------|---------|-------|---------|-------|
| Update USD rate | Accounts section input | **NO** | **YES** | L-10; shared snapshot field. |

### History / metadata

| Mutation type | Trigger | Gate? | Bypass? | Notes |
|---------------|---------|-------|---------|-------|
| Undo transaction | History tab | **YES** | NO | `undoTransaction`. |
| Edit transaction comment/date | History edit modal | **NO** | **YES** | `updateTransactionMeta` in `transactions.js` — no gate; **does not change balances** (metadata only). |
| Reconcile legacy transactions | App bootstrap | N/A | Internal | `reconcileLegacyTransactions` — LEGACY_SAFE; metadata repair only. |

### UI / local preferences (non-financial shared snapshot)

| Mutation type | Trigger | Gate? | Bypass? | Notes |
|---------------|---------|-------|---------|-------|
| Profile switch (husband/wife) | Profile buttons | **NO** | **YES** | `state.profile` in `app.js`; localStorage only aspect; not in `exportSharedSnapshot`. |
| Active tab | Tab navigation | **NO** | **YES** | `state.activeTab`; device-local preference. |
| Display mode | Mode toggle | **NO** | **YES** | Separate localStorage keys; correct by design. |
| Reset all data | Profile reset | N/A | Via `clearState` + `clearRemoteSharedState` | Uses stateRemote; not a gate path. |

### Internal / engine mutations (gate-delegated layer)

| Mutation type | Location | Gate? | Notes |
|---------------|----------|-------|-------|
| Balance/reserve/debt side effects | `transactions.js` | Indirect | Called from gate; also contains `ensureObligationPaymentReserve` (LEGACY_SAFE). |
| Misc category bootstrap | `transactions.js` — `ensureMiscCategory` | Internal | Called during expense flows; pushes system category. |
| Inbound merge apply | `storage.applySharedSnapshot` | N/A | Sync path, not user mutation. |

### Coverage summary

| Category | Fully gated | Partial | Not gated |
|----------|-------------|---------|-----------|
| Account financial ops | deposit, transfer | create, update, delete | exchange rate |
| Categories | reserve, unreserve, expense | delete | create, update |
| Savings | deposit, withdraw, spend | create, update, delete | — |
| Obligations | pay, reserve, unreserve | — | create, update, delete |
| Debts | all primary ops | — | — |
| History | undo | — | meta edit |

---

## 3. LEGACY DEPENDENCY RISK MAP (L-1 → L-10)

### L-1 — `persistAccountToSupabase()` (direct `accounts` insert)

| Field | Assessment |
|-------|------------|
| **Classification** | **SAFE TO REMOVE** |
| **Active flow dependency** | Add-account submit awaits it, but **continues on failure** with message `continuing with local fallback`. Users already operate on snapshot-only path when insert fails. |
| **Hidden coupling** | Only caller is add-account submit handler. No read path from `accounts` table elsewhere in app. |
| **Risk if removed** | **Low** — provided snapshot push succeeds after create. |
| **Pre-condition** | Manual test: add account on experiment deploy; verify payload in `household_snapshots`. |

---

### L-2 — `remoteId` from legacy row

| Field | Assessment |
|-------|------------|
| **Classification** | **SAFE TO REMOVE** (with L-1) |
| **Active flow dependency** | Used only when L-1 succeeds; fallback is `createId('account')` — already default path. |
| **Hidden coupling** | No other references to `remoteId` in codebase. |
| **Risk if removed** | **Low** — IDs remain locally generated; sync via snapshot merge unchanged. |

---

### L-3 — Add-account handler awaits legacy insert

| Field | Assessment |
|-------|------------|
| **Classification** | **SAFE TO REMOVE** (with L-1) |
| **Active flow dependency** | Handler becomes synchronous gate + local create path. |
| **Hidden coupling** | `async` submit handler exists solely for L-1 await. |
| **Risk if removed** | **Low** — simplifies handler; removes latency and failure branch. |

---

### L-4 — Debug logging for legacy insert

| Field | Assessment |
|-------|------------|
| **Classification** | **SAFE TO REMOVE** |
| **Active flow dependency** | None functional. |
| **Hidden coupling** | None. |
| **Risk if removed** | **None**. |

---

### L-5 — `DEFAULT_HOUSEHOLD_ID`

| Field | Assessment |
|-------|------------|
| **Classification** | **SAFE TO REMOVE** |
| **Active flow dependency** | Only referenced in L-1 payload (`household_id: null` today). |
| **Hidden coupling** | DB migration exists making column nullable; app does not read table. |
| **Risk if removed** | **None**. |

---

### L-6 — Direct category create / update / delete

| Field | Assessment |
|-------|------------|
| **Classification** | **NEEDS GATE MIGRATION FIRST** |
| **Active flow dependency** | All category CRUD modals depend on UI-local functions. Delete uses gate for transaction but UI owns array removal. |
| **Hidden coupling** | `deleteCategory` gate export exists; **create/update have no gate exports**. Misc category logic in `transactions.js` may interact with category list. |
| **Risk if removed without replacement** | **High** — category add/edit would no-op or throw. |
| **Required before removal** | New gate exports: `createCategory`, `updateCategory`; refactor delete to single gate-owned flow. |

---

### L-7 — Direct obligation create / update / delete

| Field | Assessment |
|-------|------------|
| **Classification** | **NEEDS GATE MIGRATION FIRST** |
| **Active flow dependency** | All obligation CRUD forms use UI functions. Delete has **no gate and no audit transaction**. |
| **Hidden coupling** | Pay/reserve flows assume obligation exists in `state.obligations`. |
| **Risk if removed without replacement** | **High** — obligation management broken. |
| **Required before removal** | Gate exports for create, update, delete (delete should add transaction or documented admin rule). |

---

### L-8 — Direct saving create (partial gate)

| Field | Assessment |
|-------|------------|
| **Classification** | **NEEDS GATE MIGRATION FIRST** |
| **Active flow dependency** | Create modal calls UI `createSaving`; gate `createSaving` only records transaction, does not create entity. |
| **Hidden coupling** | `recordSavingCreation` requires saving object already in `state.savings`. Update/delete similarly split UI/gate. |
| **Risk if UI push removed without gate extension** | **High** — create would record transaction for non-existent entity or fail invariants. |
| **Required before removal** | Extend gate/transaction layer to own entity creation (or single orchestrating gate function). |

---

### L-9 — Direct account create (partial gate)

| Field | Assessment |
|-------|------------|
| **Classification** | **NEEDS GATE MIGRATION FIRST** (for strict lockdown; **not blocking L-1**) |
| **Active flow dependency** | Same split pattern as L-8: UI pushes account, gate records creation transaction. `depositAccount` (gate) used for initial balance. |
| **Hidden coupling** | Removing UI push without orchestrator breaks `recordAccountCreated` which expects existing `account.id`. |
| **Risk if changed concurrently with L-1** | **Medium** if L-9 refactor bundled in same PR without tests — **Low** if L-1 removed alone. |
| **Recommendation** | Remove L-1 first; schedule L-9 as separate Phase 2 step. |

---

### L-10 — Exchange rate inline edit

| Field | Assessment |
|-------|------------|
| **Classification** | **NEEDS GATE MIGRATION FIRST** |
| **Active flow dependency** | Accounts tab USD input; affects transfer calculations via `state.exchangeRate`. |
| **Hidden coupling** | `financeEngine`, transfer preview, USD account ops read rate from state. |
| **Risk if removed without replacement** | **Medium** — rate editing broken; not data-corruption risk if simply blocked. |
| **Required before removal** | Gate export `updateExchangeRate` (or settings gate). |

---

### Risk map summary

| ID | Classification |
|----|----------------|
| L-1 | SAFE TO REMOVE |
| L-2 | SAFE TO REMOVE |
| L-3 | SAFE TO REMOVE |
| L-4 | SAFE TO REMOVE |
| L-5 | SAFE TO REMOVE |
| L-6 | NEEDS GATE MIGRATION FIRST |
| L-7 | NEEDS GATE MIGRATION FIRST |
| L-8 | NEEDS GATE MIGRATION FIRST |
| L-9 | NEEDS GATE MIGRATION FIRST |
| L-10 | NEEDS GATE MIGRATION FIRST |

**None classified HIGH RISK (DO NOT TOUCH YET)** for L-1 alone — legacy path removal is isolated. L-6–L-10 are **do not remove UI mutations until gate replacements exist**.

---

## 4. SNAPSHOT INTEGRITY CHECK

### Experiment vs shared isolation

| Check | Status | Evidence |
|-------|--------|----------|
| `SNAPSHOT_ID` configured | **Valid** | `environment.js`: `shared-experiment` on experiment branch |
| Pull/push/subscribe target row | **Valid** | `stateRemote.js` uses `SNAPSHOT_ID` for all snapshot ops |
| Experiment seed read-only from production | **Valid** | `resolveExperimentSnapshotRow()` reads `SEED_SNAPSHOT_ID`, writes only `SNAPSHOT_ID` |
| Experiment never upserts `shared` | **Valid** | No code path writes to hardcoded `shared` on experiment branch |
| localStorage key scoped | **Valid** | `joint-finance-state-v2-shared-experiment` |

**Verdict:** Isolation model remains valid and unaffected by L-1 removal.

---

### stateRemote as single Supabase entry (snapshot operations)

| Check | Status | Evidence |
|-------|--------|----------|
| Snapshot read | **Pass** | `fetchSnapshotRow`, `pullSharedStateInto` |
| Snapshot write | **Pass** | `pushSharedState`, `upsertSnapshotRow`, experiment seed |
| Snapshot clear | **Pass** | `clearRemoteSharedState` |
| Realtime subscribe | **Pass** | Channel filter `id=eq.{SNAPSHOT_ID}` |
| Debounced push guard | **Pass** | `initialSyncDone`, `applyingRemote` flags |

**Verdict:** stateRemote is stable and sufficient as sole snapshot interface.

---

### Parallel persistence paths in runtime logic

| Path | Present? | Risk |
|------|----------|------|
| `household_snapshots` upsert via stateRemote | **Yes — authoritative** | Target path |
| localStorage via `storage.saveState` | **Yes — cache + push trigger** | By design (ARCH-2) |
| `accounts` table insert via `accounts.js` | **Yes — legacy** | **Only parallel remote write** (L-1) |
| Second push pipeline | **No** | — |
| UI direct Supabase | **Only L-1** | Remove in Phase 1 |

**Verdict:** One parallel remote path exists (L-1). No other Supabase write surfaces found in `src/`. `app.js` imports `./lib/supabase.js` for client initialization side effect only — not a write path.

---

### Snapshot integrity during L-1 removal

Removing L-1 **does not alter** export/merge/push semantics. Account entities already appear in snapshot payload from local create + `saveState`. Integrity **improves** by eliminating divergent legacy rows.

**Pre-flight checks before L-1 execution:**

1. Add account on experiment preview — confirm account in UI after refresh.
2. Inspect `household_snapshots.payload.accounts` — confirm new account present.
3. Second browser/device pull — confirm sync via realtime or visibility refresh.
4. Confirm DevTools network: no request to `accounts` table (baseline comparison after removal).

---

## 5. GATE COMPLETENESS ASSESSMENT

### Domain coverage

| Domain | Gate coverage | Gap |
|--------|---------------|-----|
| Transactions / expenses | Complete | — |
| Category reserve/unreserve/expense/delete-tx | Complete for financial ops | Create/update not in gate |
| Account deposit/transfer | Complete | Create/update/delete orchestration split with UI |
| Savings financial ops | Complete | Entity CRUD split with UI |
| Obligation pay/reserve/unreserve | Complete | Entity CRUD not in gate |
| Debts | Complete | — |
| Undo | Complete | — |
| Exchange rate | **Missing** | No gate export |
| Obligation delete | **Missing** | No gate, no audit tx |
| Category create/update | **Missing** | No gate exports |
| Obligation create/update | **Missing** | No gate exports |
| Transaction meta edit | **Missing** | Metadata only — lower priority for financial lockdown |

### Existing gate exports not used as sole orchestrators

| Gate export | Issue |
|-------------|-------|
| `createAccount(state, account, initialBalance, author)` | Records transaction only; UI creates entity first |
| `createSaving(state, saving, author)` | Same pattern |
| `deleteCategory(state, category, author)` | Does not remove from array; UI filters after |
| `deleteAccountRecord` / `deleteSavingRecord` | Transaction + invariants; UI removes entity from array |

These are **partial gates** — audit/logging layer without full entity lifecycle ownership.

### UI flows not mapped to gate

| UI flow | Module | Mapped? |
|---------|--------|---------|
| Add category | categories.js | **NO** |
| Edit category | categories.js | **NO** |
| Add obligation | obligations.js | **NO** |
| Edit obligation | obligations.js | **NO** |
| Delete obligation | obligations.js | **NO** |
| Add saving | savings.js | **PARTIAL** |
| Edit saving metadata | savings.js | **PARTIAL** |
| Add account | accounts.js | **PARTIAL** (+ L-1 legacy) |
| Edit account | accounts.js | **PARTIAL** |
| Exchange rate | accounts.js | **NO** |
| Edit history meta | history.js | **NO** (non-balance) |

### LEGACY_SAFE_OPERATIONS impact on completeness

| Operation | Affects lockdown? |
|-----------|-------------------|
| `ensureObligationPaymentReserve` | Internal chain from gated `payObligation` — acceptable short-term |
| `reconcileLegacyTransactions` | Startup metadata — no balance mutation |
| `recordSavingDelete_service` | Chained from gated spend — acceptable short-term |

These do not block L-1 removal; they should be scheduled for retirement during Phase 2 gate hardening.

### Gate completeness verdict

## **PARTIALLY COMPLETE**

- **Financial mutations** (money movement): ~**90%** gated through UI entry points.
- **Entity lifecycle CRUD**: ~**40%** fully owned by gate; majority is UI-direct with gate used for audit transactions or financial sub-steps.
- **Strict lockdown requirement** (all shared-field mutations via gate only): **NOT met** until L-6–L-10 gate work completes.

---

## 6. EXECUTION DECISION

### Pre-flight checklist (required before any migration PR)

| # | Item | Required for L-1 |
|---|------|------------------|
| 1 | Git tag `pre-architecture-lockdown` on current HEAD | Yes |
| 2 | Manual add-account test on experiment preview passes (snapshot payload) | Yes |
| 3 | Team agrees rollback = revert Phase 1 PR, **not** restore legacy insert | Yes |
| 4 | Phase 1 PR scope limited to L-1–L-5 only (no L-6–L-10 in same PR) | Recommended |
| 5 | Gate export design drafted for L-6–L-10 before starting Phase 2 | For Phase 2 |

---

### Decision matrix

| Migration scope | Verdict |
|-----------------|---------|
| **Remove L-1 (legacy Supabase `accounts` insert) + L-2–L-5** | **SAFE TO PROCEED WITH L-1 REMOVAL** |
| **Remove L-6–L-10 UI mutations without gate replacements** | **NOT SAFE — STOP** |
| **Full L-1 → L-10 in single release** | **NOT SAFE — STOP** |
| **Phased plan: Phase 1 then Phase 2 gate work** | **SAFE BUT REQUIRES PRE-GATE FIXES** (for Phase 2) |

---

### Final verdict

# **SAFE TO PROCEED WITH L-1 REMOVAL**

Phase 1 (L-1 through L-5) may begin **after pre-flight checklist** is satisfied.

Conditions:

1. **Scope discipline** — Phase 1 removes legacy remote write only; do not simultaneously refactor L-9 unless separately tested.
2. **L-1 is not load-bearing** — Application already operates on snapshot path when legacy insert fails; removal aligns runtime with actual source of truth.
3. **stateRemote and snapshot isolation are reliable** — No changes required to sync layer for L-1.
4. **Post-L-1 verification mandatory** — Add-account + snapshot payload + optional two-device sync test before Phase 2.

---

### What must NOT start yet

| Action | Reason |
|--------|--------|
| Delete UI `createCategory` / `createObligation` logic without gate replacements | **NOT SAFE** — breaks CRUD |
| Remove `state.accounts.push` (L-9) in same PR as L-1 without orchestrator | **NOT SAFE** — unnecessary coupling |
| Enable blocking CI grep for gate patterns before L-6–L-10 done | Will fail on intentional drift paths |
| Merge to `main` before L-1 removed | Legacy path must not reach production branch |

---

### Recommended execution sequence (from this validation)

```text
NOW (approved):     Phase 1 — L-1, L-2, L-3, L-4, L-5
NEXT (after gates): Phase 2 — L-9, L-6, L-7, L-8, L-10
THEN:               Phase 3 — CI enforcement + lock checklist
```

---

## Appendix — Documents cross-reference

| Document | Role in execution |
|----------|-------------------|
| `ARCHITECTURE_LOCKDOWN_DESIGN.md` | Target boundary |
| `ARCHITECTURE_ENFORCEMENT_IMPLEMENTATION_PLAN.md` | Phase order and L-1→L-10 mapping |
| `RULE_AUDIT_REPORT.md` | Baseline ARCH-6 violation |
| **This report** | Go/no-go for Phase 1 start |

---

*Execution safety validation — no application code was modified.*
