# Joint Finance — Architecture Enforcement Implementation Plan

**Date:** 2026-06-21  
**Status:** Implementation migration plan — no code changes in this document  
**Target model:** `UI → financeGate → State Layer → stateRemote → Supabase snapshot`  
**Inputs:** `ARCHITECTURE_LOCKDOWN_DESIGN.md`, `RULE_ENFORCEMENT_PLAN.md`, `RULE_AUDIT_REPORT.md`, `30_ARCHITECTURE_RULES.md`  
**Branch reference:** `experiment-full-sync` (HEAD `7bb38b3`)

---

## 1. EXECUTIVE SUMMARY

### Current violation state

The codebase implements the target architecture for **most flows** but retains **two classes of breach**:

#### A. Legacy remote write path (critical)

| Item | Location | Violation |
|------|----------|-----------|
| `persistAccountToSupabase()` | `src/modules/accounts.js` | Writes to `public.accounts` via `supabase.from('accounts').insert()` |
| Add-account submit handler | `src/modules/accounts.js` ~L1204 | Awaits legacy insert before/alongside local create |
| `remoteId` coupling | `src/modules/accounts.js` — `createAccount(..., { remoteId })` | Local entity ID may depend on legacy row UUID |
| Debug instrumentation | `src/modules/accounts.js` | Legacy-path logging |

This is the **only confirmed Supabase write outside `stateRemote.js`**. It creates **dual truth**: legacy table rows vs `household_snapshots.payload`.

#### B. Gate drift paths (medium — snapshot-only but undisciplined)

| Item | Location | Violation |
|------|----------|-----------|
| L-6 | `categories.js` — `createCategory`, `updateCategory`, delete flows | Direct `state.categories` mutation in UI module |
| L-7 | `obligations.js` — create/update obligation | Direct `state.obligations.push` and field assignment |
| L-8 | `savings.js` — `createSaving` | `state.savings.push` before partial gate call |
| L-9 | `accounts.js` — `createAccount` | `state.accounts.push` in UI module; gate called after |
| L-10 | `accounts.js` — exchange rate input handler | Direct `state.exchangeRate =` |

These paths **do not bypass snapshot push** (they still reach Supabase via `saveState` → `stateRemote`). They **do bypass `financeGate`** as the sole mutation API (ARCH-5), making enforcement incomplete and inviting inconsistent invariants.

#### C. Bounded non-violations (no action in lockdown scope)

| Item | Notes |
|------|-------|
| L-11 | localStorage legacy key migration in `storage.js` — local bootstrap only |
| L-12 | `LEGACY_SAFE_OPERATIONS` — gate-internal exceptions; retire separately |
| L-13 | `app.js` imports `./lib/supabase.js` — review for init side effects only |

---

### Target enforcement state

When lockdown is complete:

```text
┌──────────┐    ┌──────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐
│    UI    │───>│ financeGate  │───>│ State Layer │───>│ saveState   │───>│ stateRemote.js ONLY │
│ handlers │    │  (sole API)  │    │ (in-memory) │    │ storage.js  │    │ household_snapshots │
└──────────┘    └──────────────┘    └─────────────┘    └─────────────┘    └─────────────────────┘
```

**Hard guarantees:**

1. **Zero** `supabase.from(` (read or write) outside `src/lib/stateRemote.js`
2. **Zero** shared-field mutation in `src/modules/*.js` UI handlers except via `financeGate` exports
3. **One** outbound remote pipeline: `saveState` → `schedulePushSharedState` → snapshot upsert
4. **One** snapshot row per environment: `SNAPSHOT_ID` (`shared` / `shared-experiment`)
5. **Automated checks** fail CI if boundaries are reintroduced

---

### Risk of not enforcing

| Risk | Impact if ignored |
|------|-------------------|
| **Dual truth** | Legacy `accounts` rows diverge from snapshot payload; debugging and merge become non-deterministic |
| **Identity fracture** | `remoteId` vs locally generated IDs cause broken references after sync or device switch |
| **Environment bleed** | Legacy table may not honor experiment isolation; production data touched from experiment builds |
| **Boundary erosion** | One tolerated Supabase call becomes template for the next feature |
| **Silent gate bypass** | Category/obligation CRUD without gate skips invariants; balances and reserves can desync logically before snapshot push |
| **False confidence** | ~90% compliance masks the 10% that causes production incidents at merge time |
| **Merge blocker** | `main` with `SNAPSHOT_ID = 'shared'` must not inherit legacy write path |

Enforcement is not cosmetic — it is the condition for declaring snapshot architecture **production-authoritative**.

---

## 2. ENFORCEMENT STRATEGY OVERVIEW

### Transition model: phased lockdown

Enforcement proceeds in **four phases**. Each phase ends with verifiable exit criteria before the next begins. Phases are ordered to **remove remote dual-write first**, then **consolidate gate API**, then **add mechanical guards**, then **declare locked**.

```text
Phase 0 ──> Phase 1 ──> Phase 2 ──> Phase 3 ──> LOCKED
 prep        remote       gate         guards       state
             boundary     consolidation enforcement  checklist
```

---

### Phase 0 — Preparation (no behavior change)

**Objective:** Baseline, inventory, and safety nets before any path removal.

| Activity | Output |
|----------|--------|
| Tag current experiment HEAD as pre-lockdown reference | Git tag for rollback |
| Document all Supabase import sites | Import inventory spreadsheet |
| Document all `state.{sharedField}` mutation sites in UI modules | Gate migration backlog |
| Confirm experiment snapshot has test data | Manual QA baseline on preview deploy |
| Define acceptance tests (manual script) | Add account, category, obligation, saving; verify snapshot payload only |

**Exit:** Signed inventory matching L-1–L-10; rollback tag exists.

---

### Phase 1 — Remote boundary lock (P0 critical)

**Objective:** Eliminate all Supabase communication outside `stateRemote.js`.

| Activity | Legacy IDs |
|----------|------------|
| Remove legacy account table insert and handler coupling | L-1, L-2, L-3, L-4, L-5 |
| Remove `supabase` import from `accounts.js` | L-1 |
| Audit and clean `app.js` supabase side-effect import | L-13 |
| Verify grep: only `stateRemote.js` references `supabase.from` | — |

**Exit:** Zero Supabase calls outside `stateRemote.js`; account create works via snapshot push only.

**Dependency:** Phase 2 account work (L-9) can overlap but Phase 1 must complete before merge to main.

---

### Phase 2 — Gate consolidation (ARCH-5)

**Objective:** Every user-initiated mutation of shared fields enters through `financeGate.js`.

| Activity | Legacy IDs |
|----------|------------|
| Add gate exports for missing CRUD operations | L-6, L-7, L-8, L-9, L-10 |
| Refactor UI handlers to call gate only | L-6–L-10 |
| Register new entry points in `financeEntryRegistry.js` | All new exports |
| Retire or schedule `LEGACY_SAFE_OPERATIONS` | L-12 (parallel track) |

**Exit:** UI modules contain no direct `state.{accounts|categories|…|exchangeRate}` assignment for user actions; mutation inventory clean.

---

### Phase 3 — Mechanical enforcement

**Objective:** Make violations **impossible to merge** without explicit override.

| Activity | Mechanism |
|----------|-----------|
| CI grep guard for `supabase.from` outside allowlist | Static |
| CI grep guard for `supabase` imports in `src/modules/` | Static |
| ESLint `no-restricted-imports` policy (documented rule) | Static |
| PR template + required reviewer checklist | Process |
| Optional: re-export barrier so `supabase.js` is not importable from modules path | Structural |
| Post-implementation audit re-run | Verification |

**Exit:** CI fails on boundary breach; checklist signed on release branch.

---

### Phase 4 — Declared lock

**Objective:** Update architecture docs; mark system LOCKED per Section 6 checklist.

---

### What makes the target architecture “inevitable”

| Layer | Inevitability mechanism |
|-------|-------------------------|
| Supabase | Only one module physically imports client for network ops; CI blocks others |
| Mutation | UI has no working code path to mutate shared fields — only gate exports compile/link |
| Persistence | All successful mutations flow through existing `saveState` callback in `app.js` — no second push API |
| Identity | IDs born only inside gate/transaction layer — no external table UUID |
| Environment | `SNAPSHOT_ID` remains single switch — unchanged by lockdown |

---

## 3. LEGACY REMOVAL PLAN (L-1 → L-10)

Each item: **file**, **current behavior**, **target replacement**, **migration order** (global sequence number).

---

### L-1 — Direct `accounts` table insert

| Field | Detail |
|-------|--------|
| **File / module** | `src/modules/accounts.js` — `persistAccountToSupabase()` |
| **Current behavior** | On add-account, inserts row into `public.accounts` with `name`, `balance`, `currency`, `household_id`. Returns Supabase-generated `id`. |
| **Target replacement** | **Remove entirely.** No adapter. Account persistence is exclusively: gate mutation → `saveState` → `exportSharedSnapshot` → `stateRemote` upsert to `household_snapshots`. |
| **Migration order** | **1** (first change in Phase 1 — stop dual remote write immediately) |

**Verification after migration:** Add account on experiment deploy; confirm `household_snapshots` payload gains account; confirm no network call to `accounts` table in DevTools.

---

### L-2 — `remoteId` from legacy row

| Field | Detail |
|-------|--------|
| **File / module** | `src/modules/accounts.js` — `createAccount(state, …, { remoteId })` |
| **Current behavior** | If legacy insert succeeds, uses Supabase UUID as `account.id`; otherwise generates local `createId('account')`. |
| **Target replacement** | **Remove `remoteId` option.** Account ID always assigned inside gate/transaction layer (`createId('account')` or centralized ID factory in gate). Ensures ID scheme consistent across devices via snapshot merge only. |
| **Migration order** | **2** (same PR as L-1 and L-3 — coupled removal) |

**Verification:** Create account on two devices; IDs stable after sync merge; no reference to legacy UUID in payload.

---

### L-3 — Add-account handler awaits legacy insert

| Field | Detail |
|-------|--------|
| **File / module** | `src/modules/accounts.js` — submit handler for `[data-form="add-account"]` |
| **Current behavior** | `await persistAccountToSupabase(...)` then `createAccount(..., { remoteId })` regardless of legacy success/failure. |
| **Target replacement** | Handler calls gate-based account creation only (see L-9); on `{ ok: true }`, close modal and `refresh` → `saveState`. No async Supabase call in handler. |
| **Migration order** | **2** (with L-1, L-2) |

---

### L-4 — Debug logging for legacy insert

| Field | Detail |
|-------|--------|
| **File / module** | `src/modules/accounts.js` — `🔥 SUPABASE INSERT`, `BEFORE_INSERT`, `AFTER_INSERT` logs |
| **Current behavior** | Console noise tied to legacy path; may leak payload in production consoles. |
| **Target replacement** | **Remove** with L-1. Any future sync debugging lives in `stateRemote.js` behind dev flag (future decision — not in lockdown scope). |
| **Migration order** | **2** (with L-1) |

---

### L-5 — `DEFAULT_HOUSEHOLD_ID` for legacy payload

| Field | Detail |
|-------|--------|
| **File / module** | `src/modules/accounts.js` — constant used in legacy insert payload |
| **Current behavior** | Supplies `household_id` to `accounts` table insert. |
| **Target replacement** | **Remove** when L-1 removed. Grep codebase for other usages; delete if orphaned. Snapshot model has no per-row household FK in app layer. |
| **Migration order** | **3** (cleanup immediately after L-1 removal in same Phase 1 PR) |

---

### L-6 — Direct category create / update / delete

| Field | Detail |
|-------|--------|
| **File / module** | `src/modules/categories.js` — `createCategory`, `updateCategory`, delete handlers |
| **Current behavior** | UI functions push/edit/splice `state.categories` directly; reserve/expense/unreserve already use `financeGate`. |
| **Target replacement** | **New or extended gate exports:** e.g. `createCategory`, `updateCategory`, `deleteCategory` in `financeGate.js` delegating to `transactions.js` (transaction records for delete already partially exist via `recordCategoryDeleted`). UI handlers call gate only; on success trigger refresh/`saveState`. |
| **Migration order** | **4** (Phase 2 — after Phase 1 complete; categories lower risk than accounts remote path) |

**Verification:** Create/edit/delete category; snapshot payload updates; gate context active (`FINANCE_ENFORCEMENT_MODE`).

---

### L-7 — Direct obligation create / update

| Field | Detail |
|-------|--------|
| **File / module** | `src/modules/obligations.js` — create/update obligation form handlers |
| **Current behavior** | `state.obligations.push`, direct field assignment on obligation object. Pay/reserve/unreserve already gated. |
| **Target replacement** | **Gate exports:** `createObligation`, `updateObligation` (and `deleteObligation` if not already gated). Entity normalization stays in transaction layer. |
| **Migration order** | **5** (Phase 2 — after L-6 or parallel if different owners) |

---

### L-8 — Direct saving create (partial gate)

| Field | Detail |
|-------|--------|
| **File / module** | `src/modules/savings.js` — `createSaving` |
| **Current behavior** | Pushes to `state.savings`, then calls `recordSavingCreation` (non-gate internal). Update/deposit/withdraw/spend largely gated. |
| **Target replacement** | **Consolidate into existing gate export** `createSaving` (or equivalent) so array mutation and transaction record occur inside single `runProtected` block. UI calls one gate function. |
| **Migration order** | **6** (Phase 2) |

---

### L-9 — Direct account create (partial gate)

| Field | Detail |
|-------|--------|
| **File / module** | `src/modules/accounts.js` — `createAccount` local function |
| **Current behavior** | Validates in UI module, `state.accounts.push`, conditional `depositAccount`, then `recordAccountCreation`. Overlaps with gate exports but UI owns orchestration. |
| **Target replacement** | **Single gate export** e.g. `createAccount(state, name, currency, initialBalance, comment, author)` wrapping validation, entity creation, initial deposit, and transaction record. UI handler becomes thin wrapper. Aligns with L-1–L-3 handler refactor. |
| **Migration order** | **3b** (Phase 1 PR if gate export already exists as `recordAccountCreation` — refactor UI to call gate-only; can ship with L-1 removal or immediately after in Phase 2 step **7**) |

*Recommended sequencing:* Remove L-1 first (stop legacy remote write), then L-9 in same or follow-up PR so account create is gate-owned before Phase 2 bulk CRUD.

---

### L-10 — Exchange rate inline edit

| Field | Detail |
|-------|--------|
| **File / module** | `src/modules/accounts.js` — exchange rate input change handler |
| **Current behavior** | `state.exchangeRate = Number(input.value)` on input/change; flows to snapshot via subsequent `saveState`. |
| **Target replacement** | **New gate export** e.g. `updateExchangeRate(state, rate, author)` with validation (min ≥ 1), optional transaction/audit record if product requires. UI handler calls gate only. |
| **Migration order** | **8** (Phase 2 — last gate item; shared field but low coupling) |

---

### Migration order summary (L-1 → L-10)

| Order | ID | Phase | Action type |
|-------|-----|-------|-------------|
| 1 | L-1 | 1 | Remove legacy Supabase write |
| 2 | L-2, L-3, L-4 | 1 | Remove handler coupling + logging |
| 3 | L-5 | 1 | Remove orphaned constants |
| 3b | L-9 | 1–2 | Refactor account create to gate-only |
| 4 | L-6 | 2 | Gate category CRUD |
| 5 | L-7 | 2 | Gate obligation CRUD |
| 6 | L-8 | 2 | Gate saving create consolidation |
| 7 | (L-9 if not done in 3b) | 2 | Confirm account create gate-only |
| 8 | L-10 | 2 | Gate exchange rate update |

**Parallel work allowed:** L-6, L-7, L-8 after Phase 1 exit. L-10 independent last.

---

## 4. BOUNDARY ENFORCEMENT MECHANISM

Three complementary layers: **static** (prevent merge), **structural** (reduce accident), **runtime** (detect drift). No code listed — policy and design only.

---

### 4.1 NO Supabase access outside `stateRemote.js`

#### Static enforcement

| Mechanism | Rule |
|-----------|------|
| **CI grep gate** | Fail if `supabase.from(` appears in any file under `src/` except `src/lib/stateRemote.js` |
| **CI import grep** | Fail if `from '../lib/supabase.js'`, `from './supabase.js'`, or `import './lib/supabase.js'` appears in `src/modules/` or `src/app.js` |
| **Allowlist file** | Document explicit allowlist: `src/lib/stateRemote.js` only for client usage |
| **PR checklist item** | “Confirm no new Supabase imports” — mandatory for architecture-touching PRs |
| **Pre-merge audit script** | Re-run import inventory; compare to Phase 0 baseline |

#### Structural enforcement

| Mechanism | Rule |
|-----------|------|
| **Module boundary convention** | `supabase.js` lives in `src/lib/`; comment header states “import only from stateRemote.js” |
| **Optional barrel restriction** | Do not re-export supabase from `storage.js`, `app.js`, or index |
| **Code review ownership** | Architecture PRs require reviewer familiar with lockdown doc |

#### Optional runtime safeguards

| Mechanism | Applicability |
|-----------|---------------|
| **Dev-only wrapper** | Supabase client proxy that throws if `from()` caller stack includes `modules/` — development builds only |
| **Not recommended for prod** | Runtime stack inspection is fragile; static CI is primary |

---

### 4.2 NO direct state mutation outside `financeGate`

#### Static enforcement

| Mechanism | Rule |
|-----------|------|
| **CI grep heuristics** | Warn/fail on patterns in `src/modules/*.js`: `state.accounts.push`, `state.categories.push`, `state.obligations.push`, `state.savings.push`, `state.debts.push`, `state.exchangeRate =` |
| **Allowlist exceptions** | None in UI modules after Phase 2 — grep allowlist empty |
| **Gate export registry diff** | PRs adding UI handlers that mutate state must add matching `financeEntryRegistry` entry |
| **Forbidden import rule** | UI modules must not import mutation functions from `transactions.js` directly — only `financeGate.js` |

#### Structural enforcement

| Mechanism | Rule |
|-----------|------|
| **transactions.js visibility** | Document as internal to gate; not part of public module API |
| **Thin handler template** | Standard pattern documented: validate → `gateFn(state, …)` → if ok → `refresh` → `saveState` via app callback |
| **Mutation inventory gate** | Phase 2 PRs must update mutation inventory doc to zero UI-module entries |

#### Optional runtime safeguards

| Mechanism | Applicability |
|-----------|---------------|
| **`FINANCE_ENFORCEMENT_MODE`** | Already true — keep enabled; expand entry registry for new gate exports |
| **Future: Proxy on state** | Read-only proxy in dev throwing on array mutation outside gate — high effort; optional |

---

### 4.3 NO bypass of `saveState` pipeline

#### Static enforcement

| Mechanism | Rule |
|-----------|------|
| **CI grep** | Fail if `schedulePushSharedState` imported/called outside `storage.js` and `stateRemote.js` |
| **CI grep** | Fail if `upsertSnapshotRow` or internal push helpers referenced outside `stateRemote.js` |
| **`skipRemote` audit** | Any `saveState(state, { skipRemote: true })` must appear only in inbound sync paths — grep + code review |

#### Structural enforcement

| Mechanism | Rule |
|-----------|------|
| **Dynamic import ownership** | Only `storage.js` dynamically imports `stateRemote` for push scheduling — already current pattern; preserve |
| **App callback contract** | `onStateChange` / refresh handlers in `app.js` always call `saveState(state)` after successful user mutations |
| **No direct push from modules** | Entity module refresh functions must not call remote layer |

#### Optional runtime safeguards

| Mechanism | Applicability |
|-----------|---------------|
| **Push counter assert** | Dev assert: user mutation without subsequent saveState within same tick — diagnostic only |

---

### Enforcement rollout timing

| Guard type | Introduce when |
|------------|----------------|
| Manual PR checklist | Phase 0 |
| Grep scripts (non-blocking) | Phase 1 start — report only |
| Grep scripts (blocking CI) | Phase 3 — after L-1–L-10 migrated |
| Import allowlist | Phase 3 |
| Registry discipline | Phase 2 ongoing |

Blocking CI before migration completes will fail the build on known legacy code — run guards in **report mode** until Phase 2 exit.

---

## 5. SAFE MIGRATION STRATEGY

### 5.1 Remove legacy writes without breaking UI

**Principle:** User-visible behavior unchanged; **remote side effect** removed.

| Step | Strategy |
|------|----------|
| 1 | **Decouple UI from legacy success** — Today UI already continues on legacy failure. Removing legacy path matches existing fallback behavior users already see. |
| 2 | **Keep local create logic until gate refactor** — Phase 1 can remove L-1–L-5 while L-9 still uses local push temporarily *if* snapshot push remains functional. Prefer L-9 in same release as L-1. |
| 3 | **Preview deploy verification** | After Phase 1 deploy to experiment URL: add account, refresh, second device/browser pull — account appears from snapshot only. |
| 4 | **No data migration from legacy table** | Do not backfill `accounts` table into snapshot — snapshot is authoritative. Legacy rows become orphaned ops concern, not app concern. |
| 5 | **Communicate to operators** | Legacy `public.accounts` table deprecated; DB cleanup is separate ops task |

**UI continuity checklist:**

- Add account modal still opens/closes
- Balances and initial deposit still correct
- Transfer/topup unchanged (already gated)
- No new error surfaces if snapshot push succeeds

---

### 5.2 Snapshot integrity during transition

| Concern | Mitigation |
|---------|------------|
| **Partial Phase 1 deploy** | Experiment branch only until checklist complete; do not merge to `main` mid-Phase 1 |
| **Push race during refactor** | Keep debounced push in `stateRemote.js` unchanged during UI/gate refactors |
| **Merge conflicts on concurrent edits** | Existing `mergeSharedSnapshots` behavior unchanged; document prefer-local for testers |
| **Experiment seed** | Do not modify seed logic during Phase 1; `shared-experiment` isolation preserved |
| **Payload shape** | Gate refactors must not rename snapshot fields without architecture addendum |
| **Verification hook** | After each phase, export payload JSON from Supabase dashboard or debug log and confirm entity counts match UI |

**Integrity invariant to preserve:**

```text
exportSharedSnapshot(state) === payload written by push
```

Gate refactors move *where* mutation happens, not *what* is exported.

---

### 5.3 Rollback strategy

| Trigger | Rollback action |
|---------|-----------------|
| Account create broken after Phase 1 | Revert Phase 1 PR; redeploy preview from pre-lockdown tag |
| Category CRUD regression after L-6 | Revert L-6 PR only; Phase 1 remote boundary stays locked |
| CI false positive | Temporarily downgrade grep to warn; fix pattern; re-enable block |
| Snapshot push failures | Investigate `stateRemote.js` — do **not** reintroduce legacy insert as fix |
| Production merge needed urgently | Merge only if Phase 1–3 checklist complete; never merge with L-1 present |

**Rollback artifacts:**

- Git tag: `pre-architecture-lockdown` (create in Phase 0)
- Backup branch already exists: `backup/experiment-full-ui-clean-2026-06-27` / tag `backup-experiment-ui-clean`
- Document revert order: Phase 3 guards off → Phase 2 revert → Phase 1 revert (last resort)

**Forbidden rollback:** Restoring `persistAccountToSupabase` to “fix” sync — fixes must go through `stateRemote` pipeline.

---

### 5.4 Testing strategy (manual — no test code in this plan)

| Scenario | Phase | Pass criteria |
|----------|-------|---------------|
| Add account | 1 | Snapshot payload contains account; no legacy network call |
| Add category / obligation / saving | 2 | Gate entry logged; snapshot updated |
| Edit exchange rate | 2 | Rate in payload; changed via gate |
| Two-device sync | 1–2 | Second device receives realtime update |
| Offline add → online | 1–2 | localStorage cache pushes on reconnect |
| Experiment isolation | 1 | Only `shared-experiment` row written on experiment branch |

---

## 6. FINAL TARGET STATE CHECKLIST

System is **LOCKED** when every item below is true. Use as merge-to-main gate for architecture work.

---

### Remote boundary (Supabase)

- [ ] **S-1** Zero files under `src/` contain `supabase.from(` except `src/lib/stateRemote.js`
- [ ] **S-2** Zero files in `src/modules/` import `supabase.js`
- [ ] **S-3** `src/app.js` does not import `supabase.js` unless proven init-only and documented (L-13 resolved)
- [ ] **S-4** All remote writes target `household_snapshots` only
- [ ] **S-5** `SNAPSHOT_ID` drives all pull/push/subscribe; experiment never writes `shared`
- [ ] **S-6** Legacy `persistAccountToSupabase` and related code **removed** (L-1–L-5)

---

### Mutation boundary (financeGate)

- [ ] **G-1** No user-initiated mutation of shared fields in `src/modules/*.js` outside gate calls (L-6–L-10 complete)
- [ ] **G-2** UI modules import mutation API from `financeGate.js` only — not `transactions.js`
- [ ] **G-3** All gate exports registered in `financeEntryRegistry.js`
- [ ] **G-4** `FINANCE_ENFORCEMENT_MODE` remains `true` on experiment and main-bound release
- [ ] **G-5** `LEGACY_SAFE_OPERATIONS` each has retirement date or formal permanent status (L-12)
- [ ] **G-6** Account create fully owned by gate export (L-9)

---

### Persistence boundary (saveState pipeline)

- [ ] **P-1** All successful user mutations trigger `saveState(state)` via app refresh pattern
- [ ] **P-2** `schedulePushSharedState` called only from `storage.js` / `stateRemote.js`
- [ ] **P-3** `saveState(..., { skipRemote: true })` used only for inbound sync apply paths
- [ ] **P-4** Display preferences remain in separate localStorage keys — never in snapshot payload
- [ ] **P-5** L-11 localStorage migration unchanged and documented as bounded bootstrap only

---

### Mechanical enforcement

- [ ] **E-1** CI blocking grep for Supabase boundary active
- [ ] **E-2** CI blocking grep (or warn-then-block) for UI direct state mutation patterns active
- [ ] **E-3** PR template includes architecture lockdown checklist
- [ ] **E-4** `RULE_AUDIT_REPORT` re-run shows ARCH-6 violation **closed**
- [ ] **E-5** `30_ARCHITECTURE_RULES.md` updated to reference lockdown boundary (doc task post-implementation)

---

### Operational verification

- [ ] **O-1** Experiment preview: full manual test matrix passed (Section 5.4)
- [ ] **O-2** Two-device sync test passed on experiment snapshot
- [ ] **O-3** No orphaned dependency on `public.accounts` table in application code
- [ ] **O-4** Pre-lockdown git tag exists; team knows revert procedure

---

### Lock declaration

When all **S**, **G**, **P**, **E**, and **O** items are checked:

```text
ARCHITECTURE STATUS: LOCKED
Model: UI → financeGate → State Layer → stateRemote → household_snapshots
Remote writes: stateRemote.js ONLY
Mutation API: financeGate.js ONLY
Persistence trigger: saveState ONLY
```

Update `ARCHITECTURE_LOCKDOWN_DESIGN.md` header status from “Design” to “Enforced” and record lock date + commit SHA.

---

## Appendix A — Phase ↔ Legacy mapping

| Phase | Legacy items | Primary deliverable |
|-------|--------------|---------------------|
| 0 | — | Inventory, tag, test script |
| 1 | L-1, L-2, L-3, L-4, L-5, L-9 (preferred), L-13 | No Supabase outside stateRemote |
| 2 | L-6, L-7, L-8, L-10, L-9 (if deferred), L-12 | Gate-only mutations |
| 3 | — | CI guards + checklist |
| 4 | — | Lock declaration |

---

## Appendix B — Document chain

| Document | Relationship |
|----------|--------------|
| `ARCHITECTURE_LOCKDOWN_DESIGN.md` | Target boundary definition |
| `RULE_ENFORCEMENT_PLAN.md` | Broader UI/UX + ARCH priorities |
| `RULE_AUDIT_REPORT.md` | Baseline violations |
| **This document** | Step-by-step migration to make lockdown inevitable |

---

*Architecture enforcement implementation plan — no application code was modified.*
