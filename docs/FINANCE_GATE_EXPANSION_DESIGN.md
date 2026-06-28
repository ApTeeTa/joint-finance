# Joint Finance — financeGate Expansion Design

**Date:** 2026-06-21  
**Status:** Design only — no code changes  
**Inputs:** `EXECUTION_SAFETY_REPORT.md`, `ARCHITECTURE_LOCKDOWN_DESIGN.md`, `ARCHITECTURE_ENFORCEMENT_IMPLEMENTATION_PLAN.md`  
**Target:** `UI → financeGate (ALL financial mutations) → State → stateRemote → Supabase snapshot`

---

## 1. CURRENT GATE LIMITATION ANALYSIS

### What financeGate handles well today

`financeGate.js` is a **protected façade** over `transactions.js` and related engines. It wraps operations in `runProtected(entryPoint, fn)` with:

- Entry point registry (`financeEntryRegistry.js`)
- Runtime enforcement (`FINANCE_ENFORCEMENT_MODE = true`)
- Invariant checks (`enforceFinancialInvariants`)
- Standard result shape `{ ok, error?, …entity refs }`

**Strong coverage domains:**

| Domain | Gate exports (current) | UI usage |
|--------|------------------------|----------|
| Category spending | `createExpense` | Direct gate call |
| Category reserve/unreserve | `reserveCategory`, `unreserveCategory` | Direct gate call |
| Category delete (audit half) | `deleteCategory` | Gate + UI array filter |
| Account deposit / transfer | `depositAccount`, `transferAccount` | Direct gate call |
| Account audit records | `createAccount`, `updateAccountRecord`, `deleteAccountRecord` | Called **after** UI mutates entity |
| Savings money ops | `updateSavings`, `spendSaving` | Direct gate call |
| Savings audit records | `createSaving`, `updateSavingRecord`, `deleteSavingRecord` | Called **after** UI mutates entity |
| Obligation money ops | `payObligation`, `reserveObligation`, `unreserveObligation` | Direct gate call |
| Debts (full lifecycle) | `createDebtOwedToUs`, `createDebtWeOwe`, `createManualDebtEvent`, `repayDebt`, `writeOffDebt` | Direct gate call — **reference pattern** |
| History undo | `undoTransaction` | Direct gate call |

**Debts module is the reference implementation:** UI handlers validate input, call one gate function, refresh on `{ ok: true }`. No `state.debts.push` in UI.

---

### What financeGate does NOT handle

| Gap | Current behavior | Legacy ID |
|-----|------------------|-----------|
| **Account entity lifecycle orchestration** | UI creates account object, pushes to `state.accounts`, optionally calls `depositAccount`, then `createAccount` (transaction record only) | L-9 |
| **Category create / update** | UI pushes/edits `state.categories` with no gate | L-6 |
| **Category delete completion** | Gate records deletion transaction; UI removes from array | L-6 (partial) |
| **Saving entity lifecycle orchestration** | UI pushes saving, then gate records creation; UI edits fields then gate records update | L-8 |
| **Saving delete completion** | Gate records delete; UI filters array (result not always checked) | L-8 (partial) |
| **Obligation create / update / delete** | UI pushes/edits/filters `state.obligations`; delete has **no** transaction | L-7 |
| **Exchange rate updates** | UI assigns `state.exchangeRate` directly | L-10 |
| **Transaction metadata edit** | `updateTransactionMeta` in `transactions.js`, no gate | Out of L-1–L-10; optional extension |
| **System category bootstrap** | `ensureMiscCategory` inside transactions on expense paths | Internal — not user action |

**Pattern:** Gate today is primarily a **financial transaction + audit logger**, not an **entity lifecycle manager**. Many exports assume the entity already exists in `state` and only append a transaction row plus run invariants.

---

### Why this split exists

1. **Historical layering** — Transaction journal and balance math were centralized first (`transactions.js`, A3.x enforcement lock). Display modules kept CRUD forms from an earlier architecture.

2. **Naming collision** — `financeGate.createAccount(state, account, …)` records an `ACCOUNT_CREATED` transaction but does **not** create the account entity. UI defines a separate local `createAccount()` that owns `state.accounts.push`. Same for `createSaving`.

3. **Low-risk CRUD assumption** — Create/update of categories and obligations were treated as “metadata only” because they do not immediately move money. They still mutate shared snapshot fields and bypass invariants at creation time.

4. **Incremental display refactor** — Display mode work focused on rendering; gate consolidation for CRUD was deferred (L-6–L-10).

5. **Partial gate adoption worked** — Snapshot push masked the architectural gap: all paths eventually reach `saveState`, so data sync continued while mutation discipline remained incomplete.

This split is **incompatible with architecture lockdown**, which requires financeGate as the **single mutation entry point** for all shared snapshot fields.

---

## 2. TARGET GATE MODEL (UNIFIED MUTATION LAYER)

### Design principle

> **Every user-initiated change to shared snapshot fields must enter through one financeGate export. The gate owns validation, entity mutation, transaction records, invariant enforcement, and returns a result — UI never mutates `state.accounts|categories|…|exchangeRate` directly.**

Shared snapshot fields (from `exportSharedSnapshot`):

`accounts`, `categories`, `transactions`, `obligations`, `savings`, `debts`, `exchangeRate`

**Explicit non-gate scope (unchanged):**

| Field / data | Reason |
|--------------|--------|
| `profile`, `activeTab` | Device-local UX preferences in localStorage |
| Display mode keys | Not in snapshot; ARCH-2 |
| `reconcileLegacyTransactions` on bootstrap | Internal metadata repair; not user action — stays in sync/bootstrap layer with LEGACY_SAFE documentation |

---

### Unified mutation flow

```text
UI handler
  → validate input (syntax only)
  → financeGate.<ACTION>(state, payload, author)
       → runProtected(entryPoint)
       → financeValidation / financeRulesEngine (as needed)
       → transactions.* (entity + journal + balances)
       → enforceFinancialInvariants
  → if result.ok: app.onStateChange() → saveState → stateRemote
  → if !result.ok: show result.error (UI)
```

Gate **never** calls Supabase. Gate **never** touches localStorage. Gate **only** mutates in-memory `state`.

---

### Concept: ACTION TYPES

An **action type** is a named, registered mutation intent — the stable contract between UI and gate.

Properties of an action type:

| Property | Purpose |
|----------|---------|
| **Action ID** | Stable string e.g. `ACCOUNT_CREATE` — maps to `FINANCE_ENTRY_POINTS` |
| **Domain** | accounts \| categories \| savings \| obligations \| debts \| settings \| history |
| **Mutates** | Which snapshot fields may change |
| **Money impact** | none \| reserve \| balance \| debt \| multi |
| **Transaction** | Whether a journal row is required |
| **Idempotent** | Whether repeat calls are safe (usually false) |

Action types are **not** display concerns (compact list `+`, ⋮ menu). Display maps **user gestures** → **action types**.

---

### Concept: MUTATION ROUTING

**Mutation routing** is the internal gate rule that maps an action type to the correct transaction/engine functions in one atomic unit.

```text
                    ┌─────────────────────────────────┐
                    │         financeGate.js          │
                    │  ┌───────────────────────────┐  │
  ACTION TYPE ─────>│  │   Mutation router         │  │
  + payload         │  │   (runProtected)          │  │
                    │  └───────────┬───────────────┘  │
                    │              │                  │
                    │   ┌──────────┼──────────┐       │
                    │   ▼          ▼          ▼       │
                    │ validate  transactions  invariants
                    │           financeEngine           │
                    └─────────────────────────────────┘
```

**Routing rules:**

1. **One UI call = one gate export = one atomic mutation** — entity change + transaction + balance side effects in single `runProtected` block.
2. **No split “UI push then gate record”** — deprecated pattern eliminated.
3. **Delete = gate removes entity** — UI does not filter arrays after gate call.
4. **Create = gate assigns ID** — UI does not call `createId` for financial entities.
5. **Update = gate applies changes** — UI passes desired fields, not object references to mutate.

---

### Target domains financeGate MUST handle

| Domain | Lifecycle | Financial ops | Status today |
|--------|-----------|---------------|--------------|
| Accounts | create, update, delete | deposit, transfer | Partial |
| Categories | create, update, delete | reserve, unreserve, expense | Partial |
| Savings | create, update, delete | deposit, withdraw, spend | Partial |
| Obligations | create, update, delete | pay, reserve, unreserve | Partial |
| Debts | (via create flows) | create, repay, write-off | **Complete** |
| Exchange rate | update | affects conversion | Missing |
| History | — | undo, (optional meta edit) | Undo complete |

---

## 3. REQUIRED GATE EXTENSIONS

Each extension: **action type**, **conceptual I/O**, **gate responsibility**.

**Standard result envelope (all actions):**

```text
{ ok: boolean, error?: string, …domainPayload }
```

On success, domain payload may include created/updated entity snapshot for UI refresh hints (optional — UI can re-read from `state`).

**Standard input cross-cutting fields:**

- `author` — from `state.profile`
- `date` — where journal date applies (ISO string)

---

### Accounts (`ACCOUNT_*`)

| Action type | Maps to L | Input (conceptual) | Output (conceptual) | Gate responsibility |
|-------------|-----------|-------------------|---------------------|---------------------|
| `ACCOUNT_CREATE` | L-9 | `{ name, currency, initialBalance?, comment?, date? }` | `{ ok, account?, transaction? }` | Validate name/currency/balance; generate `id`; push account; if initialBalance > 0 run deposit logic; add `ACCOUNT_CREATED` transaction; enforce invariants. **Replaces** UI `createAccount` + split `depositAccount` + `createAccount` record call. |
| `ACCOUNT_UPDATE` | L-9 | `{ accountId, name?, balance? }` | `{ ok, account?, transaction? }` | Validate; compute changes; apply to entity; add `ACCOUNT_UPDATED` transaction if material; invariants. **Replaces** UI pre-mutation of `account.name/balance`. |
| `ACCOUNT_DELETE` | L-9 | `{ accountId, confirmPolicy? }` | `{ ok, transaction? }` | Validate deletable; record deletion transaction; remove from `state.accounts`; handle balance policy per existing rules; invariants. **Replaces** UI filter after `deleteAccountRecord`. |
| `ACCOUNT_DEPOSIT` | exists | (unchanged) | — | Keep `depositAccount`. |
| `ACCOUNT_TRANSFER` | exists | (unchanged) | — | Keep `transferAccount`. |

**Deprecate / repurpose:**

- Current `createAccount(state, account, …)` → internal `_recordAccountCreated` or folded into `ACCOUNT_CREATE` orchestrator.
- Current `updateAccountRecord` / `deleteAccountRecord` → internal steps inside `ACCOUNT_UPDATE` / `ACCOUNT_DELETE` exports only; **not** callable from UI.

---

### Categories (`CATEGORY_*`)

| Action type | Maps to L | Input (conceptual) | Output (conceptual) | Gate responsibility |
|-------------|-----------|-------------------|---------------------|---------------------|
| `CATEGORY_CREATE` | L-6 | `{ name, limit }` | `{ ok, category? }` | Validate name/limit; reject reserved names (misc); generate id; push category with defaults (`reserved: 0`, `spent: 0`); optional journal row if product requires audit of admin creates; invariants. |
| `CATEGORY_UPDATE` | L-6 | `{ categoryId, name, limit }` | `{ ok, category? }` | Validate; reject misc category edit; apply fields; optional admin transaction; invariants. |
| `CATEGORY_DELETE` | L-6 | `{ categoryId }` | `{ ok, transaction? }` | Validate; reject misc; record `CATEGORY_DELETED` with snapshot; **remove from state**; return reserved funds policy per existing `recordCategoryDeleted` rules; invariants. **Merge** current gate + UI filter into one export. |
| `CATEGORY_RESERVE` | exists | — | — | Keep `reserveCategory`. |
| `CATEGORY_UNRESERVE` | exists | — | — | Keep `unreserveCategory`. |
| `CATEGORY_EXPENSE` | exists | — | — | Keep `createExpense`. |
| `CATEGORY_FILL_TO_LIMIT` | optional | `{ categoryId }` | `{ ok }` | Thin orchestrator: compute amount, call `CATEGORY_RESERVE` — can live in gate or UI calling reserve; prefer gate for single entry. |

---

### Savings (`SAVING_*`)

| Action type | Maps to L | Input (conceptual) | Output (conceptual) | Gate responsibility |
|-------------|-----------|-------------------|---------------------|---------------------|
| `SAVING_CREATE` | L-8 | `{ name, targetAmount?, deadlineType?, deadlineDate?, savingType? }` | `{ ok, saving?, transaction? }` | Validate; normalize; generate id; push saving; add `SAVING_CREATE` transaction; invariants. **Replaces** UI push + `recordSavingCreation`. |
| `SAVING_UPDATE` | L-8 | `{ savingId, name?, targetAmount?, deadlineType?, deadlineDate?, savingType? }` | `{ ok, saving?, transaction? }` | Validate against accumulated; apply fields; add update transaction if material; invariants. **Replaces** UI direct field assignment + `updateSavingRecord`. |
| `SAVING_DELETE` | L-8 | `{ savingId, comment? }` | `{ ok, transaction? }` | Validate; return accumulated to balance per rules; record delete; **remove from state**; invariants. **Replaces** UI filter after `deleteSavingRecord`. |
| `SAVING_DEPOSIT` | exists | via `updateSavings` | — | Keep. |
| `SAVING_WITHDRAW` | exists | via `updateSavings` | — | Keep. |
| `SAVING_SPEND` | exists | — | — | Keep `spendSaving`. |

---

### Obligations (`OBLIGATION_*`)

| Action type | Maps to L | Input (conceptual) | Output (conceptual) | Gate responsibility |
|-------------|-----------|-------------------|---------------------|---------------------|
| `OBLIGATION_CREATE` | L-7 | `{ name, targetAmount?, paidUntil, comment? }` | `{ ok, obligation? }` | Validate; normalize via `normalizeObligation`; generate id; push with `status: active`; sync stored status; invariants. |
| `OBLIGATION_UPDATE` | L-7 | `{ obligationId, name, targetAmount?, paidUntil, comment? }` | `{ ok, obligation? }` | Validate; apply fields; sync status; invariants. |
| `OBLIGATION_DELETE` | L-7 | `{ obligationId }` | `{ ok, transaction? }` | Validate; if reserve > 0 apply unreserve or block per product rule; add deletion/admin transaction (**new** — currently missing); remove from state; invariants. |
| `OBLIGATION_PAY` | exists | — | — | Keep `payObligation`. |
| `OBLIGATION_RESERVE` | exists | — | — | Keep `reserveObligation`. |
| `OBLIGATION_UNRESERVE` | exists | — | — | Keep `unreserveObligation`. |

---

### Debts (`DEBT_*`)

| Action type | Status | Notes |
|-------------|--------|-------|
| `DEBT_CREATE_OWED_TO_US` | **Complete** | Keep existing exports |
| `DEBT_CREATE_WE_OWE` | **Complete** | Keep |
| `DEBT_CREATE_MANUAL_EVENT` | **Complete** | Keep |
| `DEBT_REPAY` | **Complete** | Keep |
| `DEBT_WRITE_OFF` | **Complete** | Keep |

No new debt extensions required for lockdown. Debts define the **target UX/gate pattern** for other modules.

---

### Settings / rate (`RATE_*`)

| Action type | Maps to L | Input (conceptual) | Output (conceptual) | Gate responsibility |
|-------------|-----------|-------------------|---------------------|---------------------|
| `RATE_UPDATE` | L-10 | `{ exchangeRate }` | `{ ok, exchangeRate?, transaction? }` | Validate rate ≥ 1; apply to `state.exchangeRate`; optional `EXCHANGE_RATE_UPDATED` admin transaction for audit trail; invariants if rate affects derived totals consistency check. **Replaces** direct assignment in accounts input handler. |

**Design decision:** Exchange rate is a **shared snapshot field** — it belongs in gate as `SETTINGS` or `ACCOUNT` domain entry point. Recommend new entry point `FINANCE_ENTRY_POINTS.SETTINGS` or extend `ACCOUNT` if rate UI stays on accounts tab.

---

### History (optional completeness)

| Action type | Status | Notes |
|-------------|--------|-------|
| `TRANSACTION_UNDO` | **Complete** | Keep `undoTransaction` |
| `TRANSACTION_META_UPDATE` | **Optional** | Wrap `updateTransactionMeta` for full mutation surface coverage; low priority — no balance impact |

---

### Entry point registry extensions

New `FINANCE_ENTRY_POINTS` (conceptual):

| Entry point key | Action types routed |
|-----------------|---------------------|
| `ACCOUNT` | ACCOUNT_CREATE, UPDATE, DELETE, DEPOSIT, TRANSFER |
| `CATEGORY` | CATEGORY_CREATE, UPDATE, DELETE, RESERVE, UNRESERVE, EXPENSE, FILL_TO_LIMIT |
| `SAVING` | SAVING_* (merge current SAVING_ADMIN + updateSavings) |
| `OBLIGATION` | OBLIGATION_* (merge pay + CRUD) |
| `DEBT` | unchanged |
| `SETTINGS` | RATE_UPDATE |
| `UNDO` | unchanged |

Split overloaded `manageAccount` / `manageSaving` registry keys into explicit operation mapping in `OPERATION_TO_ENTRY_POINT` for audit clarity.

---

### Internal vs public gate surface

| Layer | Callable from UI | Callable from gate/transactions only |
|-------|------------------|--------------------------------------|
| Public exports | All `ACTION` orchestrators above | — |
| Internal record helpers | **Forbidden** | `recordAccountCreated`, legacy record-only functions after refactor |
| LEGACY_SAFE chains | **Forbidden** | `ensureObligationPaymentReserve`, `recordSavingDelete_service` — retire into explicit steps |

---

## 4. UI → GATE RESTRUCTURE MODEL

### How UI stops mutating state directly

**Rule:** UI modules (`accounts.js`, `categories.js`, etc.) may only:

1. Read `state` for rendering
2. Parse and syntactically validate form/handler input
3. Call `financeGate.<action>(state, payload, author)`
4. On `{ ok: true }`, invoke app callback (`onStateChange` / `refresh`) which triggers `saveState`
5. On failure, display `error` via `alert` or inline UI

**Forbidden in UI after migration:**

- `state.accounts.push`, `.filter`, direct property assignment on entities
- Same for categories, savings, obligations, debts, `exchangeRate`
- Import from `transactions.js`
- Import from `supabase.js`

**Validation split:**

| Layer | Validates |
|-------|-----------|
| UI | Required fields, trim strings, basic number parse |
| Gate | Business rules, balances, limits, invariants, entity existence |

---

### Mapping user gestures → gate actions

Display layer (`+`, ⇄, ⋮, edit, delete) triggers **handlers** — handlers call **gate actions**. Display CSS classes are irrelevant to gate.

#### Accounts

| UI gesture | Handler | Gate action |
|------------|---------|-------------|
| «Добавить счет» submit | add-account form | `ACCOUNT_CREATE` |
| Edit submit | edit-account form | `ACCOUNT_UPDATE` |
| Delete icon | delete handler | `ACCOUNT_DELETE` |
| `+` top up | open-topup → submit | `ACCOUNT_DEPOSIT` |
| `⇄` transfer | transfer form | `ACCOUNT_TRANSFER` |
| USD rate input | exchange-rate change | `RATE_UPDATE` |

#### Categories

| UI gesture | Gate action |
|------------|-------------|
| «Добавить категорию» | `CATEGORY_CREATE` |
| Edit submit | `CATEGORY_UPDATE` |
| ⋮ → delete | `CATEGORY_DELETE` |
| `+` reserve icon | `CATEGORY_RESERVE` |
| `−` unreserve | `CATEGORY_UNRESERVE` |
| «Пополнить до лимита» | `CATEGORY_FILL_TO_LIMIT` or `CATEGORY_RESERVE` |
| «Добавить расход» | `CATEGORY_EXPENSE` |

#### Savings

| UI gesture | Gate action |
|------------|-------------|
| «Добавить копилку» | `SAVING_CREATE` |
| Edit submit | `SAVING_UPDATE` |
| Delete | `SAVING_DELETE` |
| `+` deposit | `SAVING_DEPOSIT` |
| Detail «Пополнить» | `SAVING_DEPOSIT` |
| «Вернуть» | `SAVING_WITHDRAW` |
| «Потратить» | `SAVING_SPEND` |

#### Obligations

| UI gesture | Gate action |
|------------|-------------|
| «Добавить» | `OBLIGATION_CREATE` |
| Edit submit | `OBLIGATION_UPDATE` |
| Delete | `OBLIGATION_DELETE` |
| `+` / `−` reserve | `OBLIGATION_RESERVE` / `OBLIGATION_UNRESERVE` |
| «Оплатить» | `OBLIGATION_PAY` |

#### Debts

| UI gesture | Gate action |
|------------|-------------|
| (already compliant) | existing `DEBT_*` exports |

#### History

| UI gesture | Gate action |
|------------|-------------|
| Undo | `TRANSACTION_UNDO` |
| Edit meta submit | `TRANSACTION_META_UPDATE` (optional) |

---

### Display layer becomes purely declarative

After restructure:

```text
renderModule()
  → read state
  → renderDisplayItem({ summaryHtml, actionsHtml, detailHtml })
  → actionsHtml = buttons with data-action + entity ids ONLY
  → no createId, no format-side-effect, no state mutation in render path

initHandlers()
  → event delegation
  → map data-action → gate call
  → refresh on success
```

**Render functions must not:**

- Push to state arrays
- Call gate
- Import transactions

**Handler functions must not:**

- Build HTML strings with business logic beyond opening modals
- Mutate state except through gate success path

**Modal forms:**

- Collect input → submit handler → single gate action
- Modals remain in UI module; business logic moves to gate

---

## 5. MIGRATION COMPATIBILITY STRATEGY

### Guiding approach: strangler fig, module-by-module

Migrate **one domain at a time** after Phase 1 (L-1–L-5) completes. Do not big-bang all gate extensions in one PR.

**Recommended order** (matches risk and dependency):

```text
1. RATE_UPDATE          (smallest, isolated)
2. ACCOUNT_* orchestrators  (L-9; already has record helpers)
3. OBLIGATION_* CRUD    (L-7; delete needs new transaction design)
4. CATEGORY_* CRUD      (L-6)
5. SAVING_* orchestrators (L-8)
6. Optional TRANSACTION_META_UPDATE
7. Retire LEGACY_SAFE where absorbed
```

---

### How current UI continues working during migration

| Phase | Behavior |
|-------|----------|
| **Before any gate extension** | UI-direct mutations unchanged; snapshot sync works |
| **Gate extension added, UI not switched** | New export exists but unused — zero user impact |
| **Dual path window (short)** | Gate export implemented; UI switched in same PR or immediate follow-up — **avoid long dual paths** |
| **After UI switch** | Old local mutation functions deleted or reduced to thin deprecated wrappers calling gate (max one release) |

**Compatibility pattern per module:**

1. Implement new orchestrating gate export(s) in `financeGate.js` + `transactions.js` entity logic.
2. Register entry points.
3. Replace UI handler internals to call new export.
4. Delete UI local `createX` / `updateX` / array mutations.
5. Manual test matrix for that module.
6. Grep module for forbidden patterns before merge.

**No feature flags required** — experiment branch isolation allows direct migration on `experiment-full-sync`.

---

### Partial gate adoption support

During migration, system will temporarily be **mixed**:

| Module state | Allowed temporarily? |
|--------------|---------------------|
| Debts fully gated | Target |
| Accounts deposit/transfer gated, create not | Current — acceptable until step 2 |
| Categories reserve gated, create not | Current — acceptable until step 4 |

**Enforcement CI:**

- Enable blocking grep **after** all L-6–L-10 modules switched — not during partial adoption (see EXECUTION_SAFETY_REPORT).

**Documentation:**

- Track per-module status table in implementation PR descriptions until lock checklist complete.

---

### Rollback safety

| Scenario | Rollback |
|----------|----------|
| New gate export broken | Revert single module PR; UI returns to prior local mutation (pre-switch commit) |
| Phase 1 L-1 removal issue | Revert Phase 1 PR — **do not** restore legacy Supabase insert as permanent fix |
| Invariant too strict | Fix gate validation — do not bypass gate in UI |
| Snapshot push failure | Fix `stateRemote` — unrelated to gate expansion design |

**Safety nets:**

- Pre-migration git tag
- Per-module PRs keep blast radius small
- Manual test script per domain before merge

---

### Coexistence with L-1 removal

Phase 1 (L-1–L-5) and gate expansion (L-6–L-10) are **independent**:

- L-1 removal does not require new gate exports
- Gate expansion does not require legacy insert
- **Sequence:** L-1 first → gate extensions → UI restructure per module

---

## 6. FINAL TARGET STATE

### Canonical architecture

```text
┌──────────────────────────────────────────────────────────────────────────┐
│  UI (handlers + render)                                                  │
│  • read state                                                            │
│  • data-action → financeGate.<ACTION>                                    │
│  • NO state mutation • NO supabase • NO transactions import              │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  financeGate (ALL shared-field mutations)                                │
│  • ACTION TYPE routing                                                   │
│  • validation + invariants + journal                                     │
│  • entity lifecycle ownership                                            │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  State layer (in-memory state + storage.js)                              │
│  • saveState → localStorage cache + schedulePushSharedState              │
│  • merge/apply on inbound sync                                         │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  stateRemote.js (ONLY Supabase client for financial data)                │
│  • household_snapshots upsert/pull/subscribe                             │
└──────────────────────────────────────────────────────────────────────────┘
```

### No exceptions (financial mutations)

| Requirement | Target |
|-------------|--------|
| Shared field mutation | **financeGate only** |
| Supabase write | **stateRemote only** |
| Persistence trigger | **saveState only** |
| Entity ID assignment | **gate/transaction layer only** |
| Entity array push/filter in UI | **zero** |
| `transactions.js` import from UI modules | **zero** |

### Documented non-gate mutations (not exceptions to lockdown)

| Mutation | Layer | Reason |
|----------|-------|--------|
| Profile / activeTab | `app.js` | Not in shared snapshot export semantics for household truth |
| Display mode | `displayMode.js` | localStorage only |
| Bootstrap reconcile | `app.js` → transactions | Metadata repair; LEGACY_SAFE until retired |
| Internal misc category ensure | transactions (from gated expense) | System invariant maintenance inside gate call chain |

These are **not user financial actions** and do not weaken snapshot single-write model.

### Completion criteria (gate expansion done)

- [ ] All action types in Section 3 implemented as public gate exports
- [ ] `financeEntryRegistry` maps every export
- [ ] UI modules L-6–L-10 refactored — grep clean for direct state mutation
- [ ] Record-only gate exports (`createAccount` as tx-only) removed or made internal
- [ ] `OBLIGATION_DELETE` produces audit transaction
- [ ] `RATE_UPDATE` replaces inline exchange rate assignment
- [ ] Debts pattern replicated across accounts, categories, savings, obligations
- [ ] EXECUTION_SAFETY_REPORT gate completeness → **COMPLETE**
- [ ] ARCHITECTURE lock checklist Section G (mutation boundary) → satisfied

### End state statement

```text
UI → financeGate (ALL ACTIONS on shared snapshot data) → State → stateRemote → Snapshot
```

**No exceptions** for user-initiated changes to accounts, categories, transactions, obligations, savings, debts, or exchange rate.

The display system remains responsible for **how** actions appear; financeGate becomes solely responsible for **what** changes in financial truth.

---

## Appendix A — Current export → target mapping

| Current export | Target role |
|----------------|-------------|
| `createAccount` (gate) | Internal step of `ACCOUNT_CREATE` — not UI-facing |
| `createSaving` (gate) | Internal step of `SAVING_CREATE` — not UI-facing |
| `updateAccountRecord` | Internal step of `ACCOUNT_UPDATE` |
| `deleteAccountRecord` | Internal step of `ACCOUNT_DELETE` |
| `updateSavingRecord` | Internal step of `SAVING_UPDATE` |
| `deleteSavingRecord` | Internal step of `SAVING_DELETE` |
| `deleteCategory` | Expand to full `CATEGORY_DELETE` orchestrator |
| All debt exports | Keep as-is (public) |
| All pay/reserve/transfer/deposit exports | Keep as-is (public) |

---

## Appendix B — L-6 → L-10 traceability

| Legacy path | Gate extension |
|-------------|----------------|
| L-6 | `CATEGORY_CREATE`, `CATEGORY_UPDATE`, `CATEGORY_DELETE` (full) |
| L-7 | `OBLIGATION_CREATE`, `OBLIGATION_UPDATE`, `OBLIGATION_DELETE` |
| L-8 | `SAVING_CREATE`, `SAVING_UPDATE`, `SAVING_DELETE` (full) |
| L-9 | `ACCOUNT_CREATE`, `ACCOUNT_UPDATE`, `ACCOUNT_DELETE` (full) |
| L-10 | `RATE_UPDATE` |

---

*financeGate expansion design — no application code was modified.*
