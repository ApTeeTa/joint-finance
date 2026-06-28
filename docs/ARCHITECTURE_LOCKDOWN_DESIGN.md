# Joint Finance — Architecture Lockdown Design

**Date:** 2026-06-21  
**Status:** Design only — no code changes  
**Inputs:** `/docs/00_PROJECT_PRINCIPLES.md`, `30_ARCHITECTURE_RULES.md`, `RULE_AUDIT_REPORT.md`, `RULE_ENFORCEMENT_PLAN.md`  
**Branch reference:** `experiment-full-sync` (HEAD `7bb38b3`)

---

## 1. CURRENT PROBLEM MODEL

### Why multiple write paths exist

Joint Finance evolved in phases. The current system is a **snapshot-first architecture** built on top of an **earlier relational model**:

| Phase | Persistence model | Remnant in codebase |
|-------|-------------------|---------------------|
| Early | Direct Supabase rows (`accounts` table, household-scoped inserts) | `persistAccountToSupabase()` in `accounts.js` |
| Current | JSON document in `household_snapshots.payload` | `stateRemote.js` upsert/pull/subscribe |
| Local | Offline cache and first paint | `storage.js` → localStorage |
| In-memory | Single `state` object in `app.js` | All tabs read/write this object |

Migration to snapshots was **partial**. Account creation still performs a legacy table insert **before** updating in-memory state and pushing the snapshot. Other entities never had a parallel Supabase table path — they were born in the snapshot model — but several UI modules still mutate `state` arrays directly instead of exclusively through `financeGate.js`.

The result is not one write path but **three conceptual paths**:

```text
Path A (target):  UI handler → financeGate → transactions/engine → state → saveState → stateRemote → household_snapshots
Path B (legacy):  UI handler → supabase.from('accounts').insert()  [parallel remote truth]
Path C (drift):   UI handler → direct state.* mutation → saveState → stateRemote  [no gate, snapshot-only]
```

Paths B and C coexist with Path A. Path C does not break Supabase boundary but breaks mutation discipline (ARCH-5). Path B breaks both ARCH-1 and ARCH-6.

---

### How legacy Supabase writes coexist with the snapshot system

Today, adding an account triggers **both**:

1. **Legacy remote write** — `supabase.from('accounts').insert()` with `household_id`, returning a row `id` used optionally as `remoteId` for the local account entity.
2. **Snapshot remote write** — `createAccount()` mutates `state.accounts`, calls `recordAccountCreation()` via gate, then UI refresh triggers `saveState()` → `schedulePushSharedState()` → upsert of full `payload` to `household_snapshots` where `id = SNAPSHOT_ID`.

These writes are **not transactional with each other**. They target **different Supabase surfaces**:

| Surface | Table | Row identity | Content |
|---------|-------|--------------|---------|
| Legacy | `public.accounts` | Per-account UUID | Single account row |
| Snapshot | `public.household_snapshots` | `shared` or `shared-experiment` | Full household JSON payload |

Local state reconciles primarily through the snapshot pipeline. The legacy insert can succeed or fail independently (`continuing with local fallback` on failure). A remote account row may exist with no guaranteed link to snapshot merge semantics, or a snapshot account may exist without a matching legacy row.

Experiment isolation (`SNAPSHOT_ID = shared-experiment`) applies to snapshot rows. Legacy `accounts` inserts do not inherently respect the same environment boundary unless the table and RLS policies are explicitly scoped — creating **cross-environment contamination risk** if the legacy table is shared across deployments.

---

### Risks of current architecture

| Risk | Severity | Mechanism |
|------|----------|-----------|
| **Dual source of truth** | Critical | Legacy table vs snapshot payload can diverge; no merge between them |
| **Identity confusion** | High | `remoteId` from legacy insert may not match snapshot entity IDs used elsewhere |
| **Boundary erosion** | High | One proven direct Supabase call invites copy-paste in new features |
| **Gate bypass** | Medium | Category/obligation/saving CRUD and exchange-rate edits mutate `state` in UI modules without gate |
| **Undetected local-only truth** | Medium | User sees data from local state; legacy insert fails silently; snapshot push may lag or fail |
| **Audit incompleteness** | Medium | `FINANCE_ENFORCEMENT_MODE` is true but not all mutation paths enter gate context |
| **Experiment/production bleed** | Medium–High | Legacy path may not honor `SNAPSHOT_ID` isolation model |
| **Operational opacity** | Low | Debug logging (`🔥 SUPABASE INSERT`) indicates path was experimental, not production-final |

The system is ~90% architecturally solid because **read path, merge, subscribe, and most financial operations** already follow Path A. The remaining 10% is concentrated in **one legacy remote write** and **several UI-local state mutations** that skip the gate.

---

## 2. TARGET ARCHITECTURE (SINGLE WRITE MODEL)

### Principle

**All household financial truth flows through one document, one remote table row, one push pipeline.**

There is exactly **one remote write surface** for shared financial data:

```text
household_snapshots.payload  (keyed by SNAPSHOT_ID)
```

There is exactly **one local persistence trigger** after in-memory mutation:

```text
saveState(state)  →  localStorage cache  +  schedulePushSharedState(state)
```

There is exactly **one module allowed to call Supabase for financial persistence:**

```text
src/lib/stateRemote.js
```

---

### ONLY valid mutation flow (step-by-step)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. USER ACTION                                                              │
│    Tap, submit form, confirm dialog — captured in UI handler (module or app)│
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. VALIDATION (UI-allowed)                                                  │
│    Input validation, escapeHtml, display formatting — no balance math for   │
│    persistence decisions beyond calling gate                                │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. FINANCE GATE (mandatory for financial / entity mutations)                │
│    financeGate.js — entry point registry, invariant checks, gate context    │
│    Delegates to transactions.js / financeEngine.js for balance-side effects │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. IN-MEMORY STATE MUTATION                                                 │
│    Single `state` object — accounts, categories, transactions, etc.       │
│    Only gate (or gate-delegated modules) may mutate shared financial fields │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. PERSIST LOCALLY + SCHEDULE REMOTE                                        │
│    saveState(state) in storage.js                                           │
│    • localStorage: joint-finance-state-v2[-SNAPSHOT_ID]                     │
│    • dynamic import → schedulePushSharedState(state)                        │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 6. SNAPSHOT EXPORT + PUSH (debounced)                                       │
│    exportSharedSnapshot(state) → payload JSON                               │
│    upsert household_snapshots WHERE id = SNAPSHOT_ID                        │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 7. REMOTE RECONCILE (inbound — not a user mutation path)                    │
│    pull / realtime subscribe → mergeSharedSnapshots → applySharedSnapshot   │
│    → re-render UI                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Inbound sync** (steps 7) is read/merge, not an alternate write path. The only remote **writer** for user-initiated changes is step 6.

---

### Allowed modules for writing data

| Layer | Module(s) | May mutate | May call Supabase |
|-------|-----------|------------|-------------------|
| **UI handlers** | `accounts.js`, `categories.js`, …, `app.js` | ❌ financial fields directly | ❌ never |
| **Finance gate** | `financeGate.js` | ✅ via delegated record functions | ❌ never |
| **Transaction / engine** | `transactions.js`, `financeEngine.js`, `financeRulesEngine.js` | ✅ when called from gate | ❌ never |
| **State persistence** | `storage.js` | ✅ apply merge to state on inbound; serialize on outbound | ❌ never (delegates to stateRemote) |
| **Remote sync** | `stateRemote.js` | ✅ apply remote snapshot to state (inbound) | ✅ **only** `household_snapshots` |
| **Display prefs** | `displayMode.js` | ✅ localStorage display keys only | ❌ never |
| **Analytics read** | `analyticsReadModel.js`, `stats.js` | ❌ read-only derived views | ❌ never |

**Configuration:** `environment.js` — read-only constants (`SNAPSHOT_ID`); no writes.

---

### Forbidden write paths

| Forbidden action | Example in current code | Rule violated |
|------------------|-------------------------|---------------|
| UI module imports Supabase client for writes | `accounts.js` → `supabase.from('accounts').insert()` | ARCH-6, ARCH-1 |
| Any write to tables other than `household_snapshots` | Legacy `accounts` insert | ARCH-1 |
| Direct push to Supabase bypassing `saveState` | Hypothetical `stateRemote.push()` from UI | ARCH-4, ARCH-6 |
| Mutating shared financial fields outside gate | `categories.js` `createCategory` → `state.categories.push` | ARCH-5 |
| Mutating balances/reserves in card renderers | None confirmed — must stay forbidden | ARCH-6, ARCH-7 |
| Syncing display preferences to Supabase | Not present — must stay forbidden | ARCH-2, UX-8 |
| Writing production snapshot from experiment code | Prevented by `SNAPSHOT_ID` — must stay enforced | ARCH-3 |
| Blind replace of remote snapshot without merge | Not current behavior — forbidden by design | ARCH-4 |

---

## 3. MUTATION BOUNDARY DEFINITION

### Boundary statement

> **No code outside `financeGate.js` (and modules it explicitly delegates to) may mutate shared financial fields on `state`. No code outside `stateRemote.js` may perform Supabase network writes. No Supabase write may target anything other than `household_snapshots` for household financial data.**

Shared financial fields (from `exportSharedSnapshot`):

- `accounts`, `categories`, `transactions`, `obligations`, `savings`, `debts`, `exchangeRate`

Local-only fields (not in snapshot payload export semantics for merge, or device-local):

- `profile`, `activeTab` — persisted in localStorage with state but not synced as shared truth in the same way (profile is local preference in current model)
- Display mode keys — separate localStorage keys, never Supabase

*Note: `exchangeRate` is in shared snapshot today; mutation must go through gate in target model even though current UI edits it inline in `accounts.js`.*

---

### Single entry point (conceptual)

**User mutation entry:** `financeGate.js` exported functions — the only public API for changing financial truth.

Examples of valid gate entry points (existing):

- `createExpense`, `reserveCategory`, `depositAccount`, `transferAccount`, `payObligation`, `createSaving` (gate export), `recordDebtRepayment`, etc.

UI handlers **orchestrate** — they parse forms, show alerts, call gate, then call `saveState` on success. They do **not** implement financial side effects.

**Persistence entry:** `saveState(state)` in `storage.js` — the only trigger for local cache + remote push scheduling.

**Remote entry:** `schedulePushSharedState(state)` / internal push in `stateRemote.js` — the only path to Supabase upsert.

---

### What is allowed

| Operation | Allowed where | Notes |
|-----------|---------------|-------|
| Read `state` for rendering | Any UI module | Read-only |
| Format money for display | `formatUi.js`, module renderers | No persistence |
| Validate form input | UI handlers | No balance computation for persistence |
| Mutate financial entities | `transactions.js` etc. **inside gate context** | Via `financeGate.js` |
| Merge remote + local | `storage.js` (`mergeSharedSnapshots`), `stateRemote.js` | Inbound sync |
| Experiment seed copy | `stateRemote.js` | One-time read `shared`, write `shared-experiment` only |
| Cache to localStorage | `storage.js` | Financial cache key scoped by `SNAPSHOT_ID` |
| Store display density pref | `displayMode.js` | Non-financial |
| Debounced snapshot upsert | `stateRemote.js` | `household_snapshots` only |
| Realtime subscribe | `stateRemote.js` | Filter `id=eq.{SNAPSHOT_ID}` |
| Startup metadata repair | `reconcileLegacyTransactions` (documented exception) | No balance mutation |
| Gate-documented internal chains | `LEGACY_SAFE_OPERATIONS` | Time-bounded; must retire |

---

### What is forbidden

| Operation | Forbidden where | Target state |
|-----------|-----------------|--------------|
| `supabase.from(...)` write calls | All except `stateRemote.js` | Immediate removal |
| `supabase.from('accounts')` | Entire codebase after lockdown | Remove |
| `state.accounts.push`, direct entity CRUD | UI modules (`accounts.js`, `categories.js`, `obligations.js`, `savings.js`) | Refactor through gate |
| `state.exchangeRate =` in UI handler | `accounts.js` input handler | Refactor through gate or settings API |
| Direct `localStorage` for financial entities | Any module except `storage.js` | Forbidden |
| Second push pipeline | Any new module | Forbidden |
| Writing `shared` from experiment branch | Any | Forbidden (ARCH-3) |
| Card renderer mutating state | Display modules | Forbidden (ARCH-7) |
| Stats/analytics mutating state | `stats.js` | Forbidden (read-only) |

---

### Boundary diagram

```text
                    ┌──────────────────────────────────────┐
                    │           FORBIDDEN ZONE             │
                    │  UI modules ──✕──> Supabase          │
                    │  UI modules ──✕──> state.* mutation  │
                    │  Any module ──✕──> non-snapshot tables│
                    └──────────────────────────────────────┘

┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│     UI      │────>│ financeGate │────>│    state    │────>│  saveState  │
│  handlers   │ ok  │  (+ engine) │ ok  │  (in-memory)│ ok  │  storage.js │
└─────────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                   │
                                                                   ▼
                                                            ┌─────────────┐
                                                            │ stateRemote │
                                                            │  .push()    │
                                                            └──────┬──────┘
                                                                   │
                                                                   ▼
                                                            household_snapshots
```

---

## 4. LEGACY DEPRECATION PLAN

### Inventory of legacy / non-conforming write paths

| ID | Path | Location | Classification | Target disposition |
|----|------|----------|----------------|-------------------|
| **L-1** | Direct `accounts` table insert | `accounts.js` — `persistAccountToSupabase()` | **Remove** | Delete function and Supabase import from UI module. Account creation uses gate + snapshot only. |
| **L-2** | `remoteId` from legacy row | `accounts.js` — `createAccount(..., { remoteId })` | **Remove** | Entity IDs generated locally (`createId('account')`) or assigned only inside gate/transaction layer. No dependency on legacy table UUID. |
| **L-3** | Add-account handler awaits legacy insert | `accounts.js` submit handler ~L1204 | **Remove** | Handler calls gate-only flow; no await of parallel remote insert. |
| **L-4** | Debug logging for legacy insert | `accounts.js` — `🔥 SUPABASE INSERT` | **Remove** | Delete with L-1. |
| **L-5** | `DEFAULT_HOUSEHOLD_ID` for legacy payload | `accounts.js` | **Remove** | Obsolete when L-1 removed unless reused elsewhere (verify and delete). |
| **L-6** | Direct category create/update/delete | `categories.js` — `createCategory`, `updateCategory`, etc. | **Refactor into gate** | New or existing gate exports; UI calls gate only. |
| **L-7** | Direct obligation create/update | `obligations.js` — `state.obligations.push`, field edits | **Refactor into gate** | Gate exports for CRUD; payment/reserve already gated. |
| **L-8** | Direct saving create (partial gate) | `savings.js` — `state.savings.push` then `recordSavingCreation` | **Refactor into gate** | Single gate export owns entity creation + transaction record. |
| **L-9** | Direct account create (partial gate) | `accounts.js` — `state.accounts.push` before gate calls | **Refactor into gate** | `createAccount` gate export owns array mutation entirely. |
| **L-10** | Exchange rate inline edit | `accounts.js` — `state.exchangeRate = Number(input.value)` | **Refactor into gate** | New gate export e.g. `updateExchangeRate(state, rate, author)` or settings gate. |
| **L-11** | Legacy localStorage key migration | `storage.js` — copy `joint-finance-state-v2` → experiment key | **Keep (bounded)** | One-time bootstrap; not a remote write. Document as migration-only; no extension. |
| **L-12** | `LEGACY_SAFE_OPERATIONS` internals | `financeEnforcement.js`, gate helpers | **Redirect / retire** | Each operation either absorbed into formal gate flow or removed with deadline. |
| **L-13** | `supabase.js` side-effect import in `app.js` | `app.js` line 1 | **Review** | If only needed for client init globally, restrict; UI must not depend on it for writes. |

---

### Classification summary

| Action | Count | Paths |
|--------|-------|-------|
| **Remove** | 5 | L-1 through L-5 (legacy Supabase account table path) |
| **Refactor into gate** | 5 | L-6 through L-10 (UI-direct state mutation) |
| **Keep (bounded)** | 1 | L-11 (localStorage migration — not remote) |
| **Redirect / retire** | 1 | L-12 (documented gate exceptions) |
| **Review** | 1 | L-13 (import hygiene) |

**No adapter to legacy `accounts` table** is recommended. An adapter would preserve dual truth. The lockdown model requires **remove**, not bridge.

Experiment seed (`shared` → `shared-experiment` copy) is **not legacy** — it is a documented read-only bootstrap (ARCH-3) and remains the only exception allowing read from production row, with write only to experiment snapshot.

---

### Deprecation sequence (design order)

1. **Stop writing** — Remove L-1/L-3/L-4 (no new legacy rows).
2. **Consolidate create flows** — L-9, L-2 through gate-only account creation.
3. **Gate CRUD** — L-6, L-7, L-8, L-10 through finance gate exports.
4. **Retire exceptions** — L-12 with dated removals per operation.
5. **Verify zero Supabase imports** in modules except `stateRemote.js`.
6. **Archive legacy table policy** — Document that `public.accounts` is deprecated and unused by app (DB drop is ops decision outside app scope).

---

## 5. ENFORCEMENT STRATEGY

No code in this section — policy and process only.

### 5.1 Prevent direct Supabase writes

| Mechanism | Description |
|-----------|-------------|
| **Import allowlist** | Code review + optional lint rule: only `stateRemote.js` may import `supabase.js` for client usage. Exception: none for writes. |
| **CI grep gate** | Fail build if `supabase.from(` appears outside `stateRemote.js`. |
| **Module boundary in docs** | ARCHITECTURE_LOCKDOWN (this doc) + update to `30_ARCHITECTURE_RULES.md` stating closed boundary. |
| **PR checklist** | “No new Supabase imports in `src/modules/` or `src/app.js`.” |
| **Runtime** | No runtime guard can fully block Supabase SDK if imported; structural prevention is import restriction. |

---

### 5.2 Prevent bypassing state layer

| Mechanism | Description |
|-----------|-------------|
| **Mandatory saveState** | All successful gate mutations must be followed by `saveState(state)` from app callback pattern — document in module handler template. |
| **No skipRemote abuse** | `saveState(state, { skipRemote: true })` only for inbound apply during merge — not for user actions. Review any usage. |
| **Single state object** | App owns one `state` reference; no shadow copies of financial arrays in modules. |
| **Push debounce ownership** | Only `stateRemote.schedulePushSharedState` schedules remote upsert — no alternate timers. |

---

### 5.3 Prevent UI-level financial mutations

| Mechanism | Description |
|-----------|-------------|
| **Finance gate as sole API** | UI modules may only import mutation functions from `financeGate.js`, not `transactions.js` directly. |
| **Entry point registry** | `financeEntryRegistry.js` + `FINANCE_ENFORCEMENT_MODE` — keep enabled in experiment and production. |
| **Expand gate coverage** | Every path in L-6–L-10 gets a named gate export before UI refactor. |
| **Audit on merge** | Re-run mutation inventory from RULE_ENFORCEMENT_PLAN Step 1.4 before main merge. |
| **LEGACY_SAFE sunset** | Each exception has owner + removal milestone; no new entries without architecture review. |

---

### 5.4 Prevent display / cache confusion

| Mechanism | Description |
|-----------|-------------|
| **localStorage key registry** | Financial: `storage.js` only. Display: `displayMode.js` keys only. Document in ARCH-2. |
| **exportSharedSnapshot contract** | Only listed fields enter Supabase payload — UI cannot add ad-hoc persisted fields without schema rule update. |

---

### 5.5 Environment isolation

| Mechanism | Description |
|-----------|-------------|
| **`SNAPSHOT_ID` single switch** | All remote ops derive from `environment.js` — no hardcoded `'shared'` in modules. |
| **Branch policy** | Experiment branch must not merge to main without `SNAPSHOT_ID` review (ARCH-11). |
| **Seed once** | Experiment bootstrap from production is read-only source, write-once to experiment row — no repeated overwrite logic in UI. |

---

### 5.6 Verification gates (release checklist)

Before declaring lockdown complete:

- [ ] Zero `supabase.from` outside `stateRemote.js`
- [ ] Zero `state.{sharedField}` mutation in `src/modules/*.js` UI handlers (except via gate-called functions)
- [ ] All gate exports listed in `financeEntryRegistry.js`
- [ ] `LEGACY_SAFE_OPERATIONS` empty or fully justified with retirement dates
- [ ] RULE_AUDIT_REPORT ARCH-6 violation closed
- [ ] Snapshot push succeeds for account create without legacy insert

---

## 6. FINAL ARCHITECTURAL MODEL

### Canonical flow

```text
UI  →  Actions  →  State Layer  →  Snapshot  →  Supabase
```

Each arrow is a strict interface. No skips. No parallel branches.

---

### Layer responsibilities

#### Layer 1: UI

**Modules:** `accounts.js`, `categories.js`, `savings.js`, `obligations.js`, `debts.js`, `history.js`, `stats.js`, `displayMode.js`, `app.js`, `modalLayer.js`

| Responsibility | Detail |
|----------------|--------|
| Render | Read `state`; produce HTML; display modes and formatting |
| Capture intent | Clicks, forms, confirmations |
| Validate input | Names, amounts, required fields — syntactic validation only |
| Orchestrate | Call finance gate; on `{ ok: true }`, trigger app refresh + `saveState` |
| Display prefs | Write display mode to localStorage only |

| Must NOT |
|----------|
| Import Supabase client |
| Mutate `accounts`, `categories`, `transactions`, `obligations`, `savings`, `debts`, `exchangeRate` directly |
| Compute balances for persistence |
| Call `schedulePushSharedState` directly |
| Write financial data to localStorage |

---

#### Layer 2: Actions (Finance Gate)

**Modules:** `financeGate.js`, `financeGateHelpers.js`, `financeEntryRegistry.js`, `financeEnforcement.js`, `financeValidation.js`, `financeCoreInvariants.js`

| Responsibility | Detail |
|----------------|--------|
| Single mutation API | All user-initiated financial changes enter here |
| Context enforcement | `withGateContext`, entry point registry |
| Invariant protection | Reject invalid transfers, overdrafts, etc. |
| Delegate | Call `transactions.js` / `financeEngine.js` for effects |

| Must NOT |
|----------|
| Touch Supabase |
| Touch localStorage |
| Render HTML |
| Know about display modes |

---

#### Layer 3: State Layer

**Modules:** `transactions.js`, `financeEngine.js`, `financeRulesEngine.js`, `storage.js`, in-memory `state` in `app.js`

| Responsibility | Detail |
|----------------|--------|
| Apply mutations | Update arrays and derived totals on `state` when called from gate |
| Serialize | `pickPersistedFields`, `exportSharedSnapshot` |
| Local cache | `loadState`, `saveState`, `clearState` |
| Merge | `mergeSharedSnapshots`, `applySharedSnapshot` on inbound sync |
| Trigger push | `saveState` → dynamic import → `schedulePushSharedState` |

| Must NOT |
|----------|
| Import Supabase (storage delegates to stateRemote via dynamic import) |
| Accept calls from UI handlers directly for mutation functions in `transactions.js` |

*Lockdown tightens this layer:* `transactions.js` mutations reachable only from gate, not from UI.*

---

#### Layer 4: Snapshot

**Conceptual contract implemented in:** `storage.js` (`exportSharedSnapshot`, `mergeSharedSnapshots`) + `stateRemote.js` (push/pull payload)

| Responsibility | Detail |
|----------------|--------|
| Document shape | JSON payload: accounts, categories, transactions, obligations, savings, debts, exchangeRate |
| Versioning | `updated_at` on snapshot row |
| Merge semantics | prefer-local / timestamp rules — not blind replace |
| Environment key | Row `id` = `SNAPSHOT_ID` |

| Must NOT |
|----------|
| Split payload across multiple tables |
| Include display preferences |

---

#### Layer 5: Supabase

**Module:** `stateRemote.js` only (+ shared client in `supabase.js`)

| Responsibility | Detail |
|----------------|--------|
| Pull | `fetchSnapshotRow(SNAPSHOT_ID)` |
| Push | Upsert `household_snapshots` with exported payload |
| Subscribe | Realtime filter on `SNAPSHOT_ID` |
| Seed | One-time experiment bootstrap from `SEED_SNAPSHOT_ID` |
| Clear | Admin/debug clear of snapshot row if implemented |

| Must NOT |
|----------|
| Expose write API to other modules |
| Write to `accounts` or any other table |
| Write production row from experiment code |

---

### End-to-end example (target): Add account

```text
1. User submits «Добавить счет» form
2. accounts.js handler validates name, currency, balance
3. Handler calls financeGate.createAccount(...)  [not state.accounts.push]
4. Gate → transactions: create entity, deposit if initial balance, record transaction
5. Gate returns { ok: true }
6. app.js onStateChange → saveState(state)
7. storage.js writes localStorage + schedulePushSharedState
8. stateRemote.js debounced upsert of payload to household_snapshots
9. Other devices receive realtime update → merge → re-render
```

No step inserts into `accounts` table. No step bypasses gate. No step writes Supabase from UI module.

---

### Read path (unchanged, compliant)

```text
Supabase → stateRemote.pull / subscribe → mergeSharedSnapshots → applySharedSnapshot(state)
         → loadState on boot → render UI
```

Reads may enter through localStorage first for fast paint; sync reconciles to remote truth.

---

### Lockdown completion definition

The architecture is **locked down** when:

1. **Single remote write model** — only `household_snapshots` via `stateRemote.js`.
2. **Single mutation API** — only `financeGate.js` for user-initiated financial changes.
3. **Single persistence trigger** — only `saveState` for outbound local + remote schedule.
4. **Zero legacy paths** — L-1 through L-5 removed; L-6 through L-10 refactored.
5. **Enforcement strategy active** — review checklist + optional CI guards in place.

Until then, the documented **breach surface** is:

- **Remote:** `persistAccountToSupabase` (ARCH-6)
- **Gate:** UI-direct CRUD in categories, obligations, savings, accounts, exchange rate (ARCH-5)

---

## Related documents

| Document | Role |
|----------|------|
| `30_ARCHITECTURE_RULES.md` | Should be amended after lockdown implementation to reference this boundary |
| `RULE_ENFORCEMENT_PLAN.md` | Step 1 executes L-1–L-5; Step 1.4 + ARCH-G3 executes L-6–L-12 |
| `RULE_AUDIT_REPORT.md` | Baseline violations motivating this design |

---

*Architecture lockdown design — no application code was modified.*
