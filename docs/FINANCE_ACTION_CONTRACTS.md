# Joint Finance — financeGate Action Contract System

**Date:** 2026-06-21  
**Status:** Formal specification — no code changes  
**Inputs:** `FINANCE_GATE_EXPANSION_DESIGN.md`, `ARCHITECTURE_LOCKDOWN_DESIGN.md`, `financeCoreInvariants.js`, `transactions.js`  
**Target flow:** `UI → ACTION CONTRACTS → financeGate → State → stateRemote → Snapshot`

---

## 1. ACTION SYSTEM OVERVIEW

### financeGate as deterministic action router

`financeGate` is not a collection of helper functions — it is a **deterministic action router** that accepts **immutable action intents** and produces **predictable state transitions**.

Properties:

| Property | Meaning |
|----------|---------|
| **Deterministic** | Same `(state snapshot, action)` → same outcome or same structured failure |
| **Single entry** | Every shared-field mutation enters through one registered action type |
| **Registered** | Every action type maps to a `FINANCE_ENTRY_POINTS` key and audit name |
| **Closed** | Unknown action types are rejected; UI cannot invent parallel mutation paths |

Routing model:

```text
ActionIntent { type, payload, author, …meta }
        │
        ▼
financeGate.dispatch(state, intent)
        │
        ├── resolve handler by type
        ├── validate (no mutation)
        ├── apply side effects (atomic block)
        ├── journal (transactions[])
        ├── enforce invariants
        └── return ActionResult
```

The router **does not** render UI, **does not** call Supabase, **does not** write localStorage.

---

### Actions as immutable intent objects

An **action** is an immutable description of *what the user intended*, not a reference to live state objects.

Conceptual shape:

```text
ActionIntent {
  type: ActionType,           // e.g. "ACCOUNT_CREATE"
  payload: PayloadSchema,     // plain data only — no DOM, no state refs
  author: "husband" | "wife", // from state.profile at dispatch time
  date?: ISODate,             // journal date when applicable
  idempotencyKey?: string     // optional future — not required v1
}
```

Rules:

1. **Payload is serializable** — JSON-safe primitives and plain objects.
2. **Payload never contains entity references** — use IDs (`accountId`, `categoryId`, …).
3. **Intent is read-only** — gate must not mutate the intent object.
4. **One intent → one dispatch** — UI must not chain multiple mutations without separate dispatches (or define explicit composite action types).

---

### Requirement of atomic execution

Each action is **atomic**: from the caller’s perspective, either:

- **Success** — all specified state mutations, journal entries, and derived totals are applied; invariants hold; `{ ok: true, … }` returned, or
- **Failure** — no durable effect of this action remains in `state` when `{ ok: false, error }` returns.

Atomicity scope = **single in-memory `state` object** before next `saveState`. Persistence (localStorage + snapshot push) happens **after** successful dispatch via app callback — not inside the action router.

**Non-atomic legacy paths (to be eliminated):** UI mutates entity, then calls gate for audit only. Contracts forbid this pattern for all actions in Section 3.

---

## 2. ACTION CONTRACT FORMAT

Every action type MUST be documented with the following **contract sections**. Section 3 applies this template to each domain action.

### 2.1 Contract template

```text
ACTION: <ACTION_TYPE>
Entry point: <FINANCE_ENTRY_POINTS.*>
Domain: accounts | categories | savings | obligations | settings

── type ──
Stable string identifier. Immutable once published.

── payload schema ──
Required and optional fields with types and constraints.

── validation rules ──
Ordered checks BEFORE any state mutation.
Failure returns { ok: false, error: string }.

── side effects ──
Explicit list of state fields / entities that may change.

── journaling behavior ──
Transaction type(s), fields recorded, cancellable yes/no.

── snapshot update rules ──
Which keys in exportSharedSnapshot() change after success.

── result envelope ──
Success/failure shape returned to UI.
```

---

### 2.2 Standard payload cross-fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `author` | `'husband' \| 'wife'` | Yes | Passed at dispatch, not in payload body (convention) |
| `date` | ISO date string | Conditional | Required when journal row created |

---

### 2.3 Standard result envelope

```text
ActionResult {
  ok: boolean,
  error?: string,              // user-facing Russian message on failure
  entity?: object,             // created/updated entity snapshot (optional)
  transaction?: object,        // primary journal row (optional)
  transactions?: object[]      // when multiple rows (optional)
}
```

On `ok: false`, `entity` and `transaction` MUST be absent.

---

### 2.4 Standard validation phases

| Phase | Order | Mutates state? |
|-------|-------|----------------|
| **V0 — Gate context** | 1 | No — `FINANCE_ENFORCEMENT_MODE` entry point check |
| **V1 — Schema** | 2 | No — required fields, types, enum values |
| **V2 — Existence** | 3 | No — IDs resolve to entities |
| **V3 — Business rules** | 4 | No — balances, limits, reserved names, misc category |
| **M — Mutation** | 5 | Yes — entity + balance changes |
| **J — Journal** | 6 | Yes — append transaction(s) |
| **I — Invariants** | 7 | Yes — `enforceFinancialInvariants`; failure rolls back entire action |

---

### 2.5 Snapshot update rules (global)

After successful action + subsequent `saveState`:

| Snapshot key | Updated when |
|--------------|--------------|
| `accounts` | Account lifecycle / deposit / transfer / debt account ops |
| `categories` | Category lifecycle / reserve / expense |
| `transactions` | Any journaled action |
| `obligations` | Obligation lifecycle / pay / reserve |
| `savings` | Saving lifecycle / deposit / withdraw / spend |
| `debts` | Debt actions |
| `exchangeRate` | `RATE_UPDATE` |

`profile`, `activeTab`, display prefs — **never** in snapshot export.

---

## 3. DOMAIN ACTIONS SPECIFICATION

Notation:

- **R** = required payload field  
- **O** = optional  
- **Tx** = transaction journal row  
- **Inv** = post-action invariant check (always runs)

Existing financial actions (`ACCOUNT_DEPOSIT`, `CATEGORY_EXPENSE`, `OBLIGATION_PAY`, `DEBT_*`, etc.) remain governed by current gate exports; this section specifies **lifecycle and settings contracts** from gate expansion design.

---

### Accounts

#### ACCOUNT_CREATE

| Contract field | Specification |
|----------------|---------------|
| **Entry point** | `FINANCE_ENTRY_POINTS.ACCOUNT` |
| **Payload schema** | `name: string (R)`, `currency: 'RUB' \| 'USD' (R)`, `initialBalance: number (O, default 0)`, `comment: string (O)`, `date: ISO (O, default today)` |
| **Validation** | V1: non-empty trimmed name; currency enum; `initialBalance ≥ 0` finite. V3: if `initialBalance > 0`, `validateAvailableFunds` not required (deposit creates balance); deposit amount > 0 if > 0. |
| **Side effects** | Push new account to `state.accounts` with `id` generated in gate, `balance: 0` then credit if initialBalance > 0; update account balance if deposit; update derived totals via engine. |
| **Journaling** | If `initialBalance > 0`: Tx `account_deposit`. Always: Tx `account_created` with amount = initialBalance. |
| **Snapshot** | `accounts`, `transactions` |
| **Invariants** | Inv: no negative account balance; free ≥ 0; reserved ≤ total. |
| **Result** | `{ ok, account, transaction? }` |

**Replaces:** UI `state.accounts.push`, split `depositAccount` + record-only `createAccount`.

---

#### ACCOUNT_UPDATE

| Contract field | Specification |
|----------------|---------------|
| **Entry point** | `FINANCE_ENTRY_POINTS.ACCOUNT` |
| **Payload schema** | `accountId: string (R)`, `name: string (R)`, `balance: number (R)` |
| **Validation** | V2: account exists. V1: name non-empty; balance ≥ 0 finite. V3: balance change allowed (direct set — existing product behavior). |
| **Side effects** | Mutate `account.name`, `account.balance` on resolved entity. |
| **Journaling** | Tx `account_updated` if name or balance changed; captures old/new values. |
| **Snapshot** | `accounts`, `transactions` |
| **Invariants** | Inv: account balance ≥ 0; global free/reserved consistency. |
| **Result** | `{ ok, account, transaction? }` |

**Prohibition:** UI must not assign `account.name` / `account.balance` before dispatch.

---

#### ACCOUNT_DELETE

| Contract field | Specification |
|----------------|---------------|
| **Entry point** | `FINANCE_ENTRY_POINTS.ACCOUNT` |
| **Payload schema** | `accountId: string (R)` |
| **Validation** | V2: account exists. V3: per product rules — block if balance > 0 without policy, or allow with balance removal (match current `deleteAccountRecord` behavior). |
| **Side effects** | Remove account from `state.accounts`. Adjust balances/reserves per existing deletion semantics. |
| **Journaling** | Tx `account_deleted` with final balance snapshot. |
| **Snapshot** | `accounts`, `transactions` |
| **Invariants** | Inv after removal. |
| **Result** | `{ ok, transaction? }` |

**Prohibition:** UI must not `state.accounts.filter` after gate.

---

### Categories

#### CATEGORY_CREATE

| Contract field | Specification |
|----------------|---------------|
| **Entry point** | `FINANCE_ENTRY_POINTS.CATEGORY` (new registry key) |
| **Payload schema** | `name: string (R)`, `limit: number (R, ≥ 0)` |
| **Validation** | V1: non-empty name; limit ≥ 0. V3: name ≠ «Прочее» (reserved misc name); no duplicate name (if enforced). |
| **Side effects** | Push category: `{ id, name, limit, reserved: 0, spent: 0, createdAt }`. |
| **Journaling** | **None required v1** (admin metadata — optional future `category_created` Tx). |
| **Snapshot** | `categories` |
| **Invariants** | Inv: category reserved ≥ 0. |
| **Result** | `{ ok, entity: category }` |

---

#### CATEGORY_UPDATE

| Contract field | Specification |
|----------------|---------------|
| **Entry point** | `FINANCE_ENTRY_POINTS.CATEGORY` |
| **Payload schema** | `categoryId: string (R)`, `name: string (R)`, `limit: number (R)` |
| **Validation** | V2: category exists. V3: not misc/system category; name not «Прочее»; limit ≥ 0; limit ≥ reserved (if enforced when lowering limit). |
| **Side effects** | Update `name`, `limit` on entity. |
| **Journaling** | Optional v1 none; optional future admin Tx. |
| **Snapshot** | `categories` |
| **Invariants** | Inv: reserved ≥ 0; reserved ≤ limit (product rule if applicable). |
| **Result** | `{ ok, entity: category }` |

---

#### CATEGORY_DELETE

| Contract field | Specification |
|----------------|---------------|
| **Entry point** | `FINANCE_ENTRY_POINTS.CATEGORY_DELETE` |
| **Payload schema** | `categoryId: string (R)` |
| **Validation** | V2: exists. V3: not misc category. |
| **Side effects** | Return reserved funds per `recordCategoryDeleted` rules; remove from `state.categories`. |
| **Journaling** | Tx `category_deleted` with category snapshot; amount = reserved at delete. |
| **Snapshot** | `categories`, `transactions` |
| **Invariants** | Inv: global balance consistency after reserve release. |
| **Result** | `{ ok, transaction? }` |

**Prohibition:** UI must not filter categories array after gate.

---

### Savings

#### SAVING_CREATE

| Contract field | Specification |
|----------------|---------------|
| **Entry point** | `FINANCE_ENTRY_POINTS.SAVING_ADMIN` |
| **Payload schema** | `name: string (R)`, `targetAmount: number \| null (O)`, `deadlineType: string (O)`, `deadlineDate: ISO \| null (O)`, `savingType: 'recurring' \| 'single_use' (O)` |
| **Validation** | V1: non-empty name. V3: normalize via `normalizeSaving`; targetAmount if set ≥ 0. |
| **Side effects** | Push saving with `accumulated: 0`, generated `id`, normalized deadline fields. |
| **Journaling** | Tx `saving_create`. |
| **Snapshot** | `savings`, `transactions` |
| **Invariants** | Inv: accumulated ≥ 0. |
| **Result** | `{ ok, entity: saving, transaction }` |

---

#### SAVING_UPDATE

| Contract field | Specification |
|----------------|---------------|
| **Entry point** | `FINANCE_ENTRY_POINTS.SAVING_ADMIN` |
| **Payload schema** | `savingId: string (R)`, `name: string (R)`, `targetAmount: number \| null (O)`, `deadlineType (O)`, `deadlineDate (O)`, `savingType (O)` |
| **Validation** | V2: saving exists. V3: name non-empty; if targetAmount set and > 0, must be ≥ current accumulated. |
| **Side effects** | Apply metadata fields on saving entity. |
| **Journaling** | Tx `saving_update` if material changes (match existing `recordSavingUpdate` diff logic). |
| **Snapshot** | `savings`, `transactions` |
| **Invariants** | Inv: accumulated ≥ 0; accumulated ≤ target if target set. |
| **Result** | `{ ok, entity: saving, transaction? }` |

---

#### SAVING_DELETE

| Contract field | Specification |
|----------------|---------------|
| **Entry point** | `FINANCE_ENTRY_POINTS.SAVING_ADMIN` |
| **Payload schema** | `savingId: string (R)`, `comment: string (O)` |
| **Validation** | V2: saving exists. |
| **Side effects** | Return accumulated to free balance per `recordSavingDelete`; remove from `state.savings`. |
| **Journaling** | Tx `saving_delete`. |
| **Snapshot** | `savings`, `transactions`, possibly `accounts`/aggregates |
| **Invariants** | Inv: no negative accumulated; free ≥ 0. |
| **Result** | `{ ok, transaction? }` |

---

### Obligations

#### OBLIGATION_CREATE

| Contract field | Specification |
|----------------|---------------|
| **Entry point** | `FINANCE_ENTRY_POINTS.OBLIGATION` (extend registry) |
| **Payload schema** | `name: string (R)`, `paidUntil: ISO date (R)`, `targetAmount: number \| null (O)`, `comment: string (O)` |
| **Validation** | V1: non-empty name; valid paidUntil. V3: targetAmount null or ≥ 0. |
| **Side effects** | Push obligation: `{ id, name, reserveAmount: 0, targetAmount, paidUntil, comment, status: 'active', createdAt }`; normalize via `normalizeObligation`; sync stored status. |
| **Journaling** | **New Tx type recommended:** `obligation_created` (v1 contract — currently none in codebase). Minimum: none if product accepts; preferred: admin Tx for audit integrity. |
| **Snapshot** | `obligations` [, `transactions`] |
| **Invariants** | Inv: reserveAmount ≥ 0. |
| **Result** | `{ ok, entity: obligation }` |

---

#### OBLIGATION_UPDATE

| Contract field | Specification |
|----------------|---------------|
| **Entry point** | `FINANCE_ENTRY_POINTS.OBLIGATION` |
| **Payload schema** | `obligationId: string (R)`, `name: string (R)`, `paidUntil: ISO (R)`, `targetAmount: number \| null (O)`, `comment: string (O)` |
| **Validation** | V2: exists. V1: name, paidUntil required. |
| **Side effects** | Update fields; `syncStoredStatus(obligation)`. |
| **Journaling** | Recommended: `obligation_updated` admin Tx (new type). |
| **Snapshot** | `obligations` [, `transactions`] |
| **Invariants** | Inv: reserve ≥ 0. |
| **Result** | `{ ok, entity: obligation }` |

---

#### OBLIGATION_DELETE

| Contract field | Specification |
|----------------|---------------|
| **Entry point** | `FINANCE_ENTRY_POINTS.OBLIGATION` |
| **Payload schema** | `obligationId: string (R)` |
| **Validation** | V2: exists. V3: if `reserveAmount > 0` — must unreserve first OR gate runs `OBLIGATION_UNRESERVE` equivalent internally before delete (contract **requires** no orphaned reserve). |
| **Side effects** | Release reserve to free balance if any; remove from `state.obligations`. |
| **Journaling** | **Required:** new Tx `obligation_deleted` with snapshot (closes audit gap in current code). |
| **Snapshot** | `obligations`, `transactions`, aggregate balances |
| **Invariants** | Inv: no obligation with negative reserve; free/reserved consistency. |
| **Result** | `{ ok, transaction? }` |

---

### Settings

#### RATE_UPDATE

| Contract field | Specification |
|----------------|---------------|
| **Entry point** | `FINANCE_ENTRY_POINTS.SETTINGS` (new) |
| **Payload schema** | `exchangeRate: number (R)` |
| **Validation** | V1: finite; `exchangeRate ≥ 1` (matches `validateExchangeRate`). |
| **Side effects** | Set `state.exchangeRate`. |
| **Journaling** | Recommended new Tx: `exchange_rate_updated` with old/new values (audit). Optional v1: none if product accepts metadata-only shared field change. |
| **Snapshot** | `exchangeRate` [, `transactions`] |
| **Invariants** | Inv: re-run global checks (rate itself does not break invariants; USD conversions use new rate on next op). |
| **Result** | `{ ok, exchangeRate }` |

**Prohibition:** UI must not assign `state.exchangeRate` directly.

---

### Existing financial actions (reference — already contracted in code)

These remain part of the unified system; UI already maps 1:1 for debts and most money ops:

| Action type | Gate export | Notes |
|-------------|-------------|-------|
| `ACCOUNT_DEPOSIT` | `depositAccount` | Fully contracted |
| `ACCOUNT_TRANSFER` | `transferAccount` | Fully contracted |
| `CATEGORY_RESERVE` | `reserveCategory` | Fully contracted |
| `CATEGORY_UNRESERVE` | `unreserveCategory` | Fully contracted |
| `CATEGORY_EXPENSE` | `createExpense` | Fully contracted |
| `SAVING_DEPOSIT` / `WITHDRAW` | `updateSavings` | Action sub-type in payload |
| `SAVING_SPEND` | `spendSaving` | Fully contracted |
| `OBLIGATION_PAY` | `payObligation` | Journals as expense + payment side effects |
| `OBLIGATION_RESERVE` / `UNRESERVE` | `reserveObligation` / `unreserveObligation` | Fully contracted |
| `DEBT_*` | debt exports | Reference pattern |
| `TRANSACTION_UNDO` | `undoTransaction` | Fully contracted |

---

## 4. ATOMIC EXECUTION RULE

### Execution model (`runProtected` equivalent)

Every dispatch runs inside a **protected execution context**:

```text
dispatch(state, intent):
  1. assert entry point allowed (FINANCE_ENFORCEMENT_MODE)
  2. handler = registry[intent.type]
  3. runProtected(entryPoint, () => {
       a. validation phases V0–V3  → return { ok:false } on failure
       b. snapshotState = shallowCopyForRollback(state)  [implementation target]
       c. apply mutations M + journal J
       d. enforceFinancialInvariants(state, { operation: intent.type, … })
       e. return { ok:true, … }
     })
  4. on FinanceInvariantError → rollback to snapshotState; return { ok:false, error }
  5. on thrown non-invariant error → rollback; rethrow or wrap
```

**Current codebase note:** Today some paths mutate before invariant check without copy-on-write rollback. **Contract requirement for migration:** refactored handlers MUST satisfy observable atomicity (failure → no net change from action).

---

### Rollback behavior on failure

| Failure stage | Required behavior |
|---------------|-------------------|
| V0–V3 validation | No mutation; `{ ok: false, error }` |
| M/J mid-handler | Rollback entire action; `{ ok: false, error }` |
| Invariant failure (I) | Rollback entire action; `{ ok: false, error: invariant message }` |
| Success | Commit all M + J; invariants pass |

**Forbidden:** Partial entity in array without matching journal when action returns `ok: false`.

---

### Consistency guarantees

| Guarantee | Scope |
|-----------|-------|
| **Action-local consistency** | After `ok: true`, all contract side effects applied |
| **Invariant consistency** | `checkFinancialInvariants(state)` passes after every successful action |
| **Journal integrity** | Every balance/reserve change traceable to Tx row(s) except explicit no-journal admin creates (categories create/update v1) |
| **Persistence consistency** | `saveState` exports merged snapshot matching in-memory state |
| **Cross-device consistency** | `stateRemote` push sends `exportSharedSnapshot(state)` — no partial field writes |

**Ordering:** Multiple actions in sequence (user clicks) = multiple dispatches. Each dispatch is atomic; the system is **sequentially consistent**, not transactional across dispatches.

---

## 5. UI → ACTION MAPPING RULES

### Core rules

1. **Exactly one action per user commit** — form submit, confirm delete, single button click that persists = one `ActionIntent`.
2. **No direct state mutation in UI** — forbidden patterns: `.push`, `.filter`, property assignment on shared entities, `state.exchangeRate =`.
3. **Modals collect payload only** — open/close is not an action; submit dispatches action.
4. **Render is read-only** — `data-action` + entity IDs on buttons; handlers resolve IDs to payload.
5. **Failure display** — UI shows `result.error`; does not partially refresh entity lists from local edits.

### Mapping table by gesture

| Gesture | UI pattern | Action mapping rule |
|---------|------------|---------------------|
| **Primary `+`** | `.display-list-action` compact | Maps to **domain primary financial action**, not generic «+»: accounts → open deposit flow → `ACCOUNT_DEPOSIT`; savings → `SAVING_DEPOSIT`; categories → `CATEGORY_RESERVE`; obligations → `OBLIGATION_RESERVE`. **Never** maps to CREATE unless button is explicitly «Добавить» in toolbar. |
| **Transfer `⇄`** | accounts list only | Opens transfer modal → `ACCOUNT_TRANSFER` on submit. |
| **Edit (✎ / pencil icon)** | `.display-card-action` or card modes | Opens edit modal → `*_UPDATE` on submit. **Never** inline-edits entity in state. |
| **Delete (trash icon)** | accounts, savings, obligations | Confirm dialog → `*_DELETE` single dispatch. |
| **Delete (⋮ → delete)** | categories menu | Close menu → confirm → `CATEGORY_DELETE`. **Same contract** as trash — only presentation differs. |
| **Toolbar «Добавить»** | section header | Opens create modal → `*_CREATE` on submit. |
| **Detail panel buttons** | expanded `.display-item-detail` | Same action types as modals (e.g. «Пополнить» → `ACCOUNT_DEPOSIT` / `SAVING_DEPOSIT`) — duplicate affordance, **same contract**. |
| **Exchange rate input** | accounts section | blur/change commit → `RATE_UPDATE` (debounced single dispatch per commit). |

### Prohibited UI patterns

| Pattern | Violation |
|---------|-----------|
| `state.accounts.push` in handler | Bypasses ACCOUNT_CREATE |
| Edit form assigns entity fields then calls record-only gate | Bypasses *_UPDATE |
| Delete calls gate then `filter` in UI | Bypasses full *_DELETE contract |
| Multiple gate calls for one logical user operation without composite action | Non-deterministic partial failure |

### Declarative display layer

Buttons MUST expose:

```text
data-action="<handler-key>"     // maps 1:1 to handler → ActionType
data-<entity>-id="<id>"         // payload key source
```

Handler registry (conceptual):

```text
"submit-add-account"     → ACCOUNT_CREATE
"submit-edit-account"    → ACCOUNT_UPDATE
"confirm-delete-account" → ACCOUNT_DELETE
"submit-deposit"         → ACCOUNT_DEPOSIT
…
```

Display mode, icons, and CSS classes **do not** appear in action contracts.

---

## 6. SYSTEM INVARIANTS

Global invariants MUST hold after **every** successful action (from `checkFinancialInvariants`):

### Balance invariants

| ID | Rule |
|----|------|
| **INV-1** | `calculateReservedBalance(state) ≤ calculateTotalBalance(state)` |
| **INV-2** | `calculateFreeBalance(state) ≥ 0` |
| **INV-3** | `calculateReservedBalance(state) ≥ 0` |
| **INV-4** | Every `account.balance ≥ 0` |

### Entity field invariants

| ID | Rule |
|----|------|
| **INV-5** | Every `category.reserved ≥ 0` |
| **INV-6** | Every saving `accumulated ≥ 0` |
| **INV-7** | Every `obligation.reserveAmount ≥ 0` |

### Snapshot consistency

| ID | Rule |
|----|------|
| **INV-8** | `exportSharedSnapshot(state)` reflects all entity arrays in memory — no shadow copies |
| **INV-9** | Only `saveState` triggers push schedule — no action skips persistence when user expects save |
| **INV-10** | Experiment code writes only `SNAPSHOT_ID` row — never production `shared` from experiment branch |

### Audit integrity

| ID | Rule |
|----|------|
| **INV-11** | Every balance/reserve/free change from financial action has ≥1 Tx row (except explicitly documented no-journal admin creates) |
| **INV-12** | Tx `id` unique; cancelled txs marked `CANCELLED` via `TRANSACTION_UNDO`, not deleted |
| **INV-13** | Delete actions produce deletion Tx with entity snapshot where applicable (accounts, categories, savings, obligations) |

### No orphan entities

| ID | Rule |
|----|------|
| **INV-14** | No Tx references `accountId` / `categoryId` / … for deleted entity without deletion Tx precedent in journal ordering (soft rule — undo system dependency) |
| **INV-15** | No obligation with `reserveAmount > 0` exists after `OBLIGATION_DELETE` success |
| **INV-16** | Misc category «Прочее» always exists when expenses possible — maintained inside gated expense path (`ensureMiscCategory`), not UI |

### Action-system invariants

| ID | Rule |
|----|------|
| **INV-17** | UI modules never import `transactions.js` |
| **INV-18** | Only `stateRemote.js` performs Supabase network I/O for financial data |
| **INV-19** | Every action type registered in `FINANCE_ENTRY_POINTS` / `OPERATION_TO_ENTRY_POINT` |

---

## 7. FINAL MODEL

### Architecture

```text
┌─────────────┐
│     UI      │  renders state; emits ActionIntent on user commit
└──────┬──────┘
       │ ActionIntent { type, payload, author }
       ▼
┌─────────────┐
│   ACTION    │  formal contracts (this document)
│  CONTRACTS  │  validation · side effects · journal · snapshot rules
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ financeGate │  deterministic router · runProtected · invariants
└──────┬──────┘
       │
       ▼
┌─────────────┐
│    State    │  in-memory household state
└──────┬──────┘
       │ saveState
       ▼
┌─────────────┐
│ stateRemote │  household_snapshots only
└──────┬──────┘
       ▼
   Snapshot (Supabase)
```

### Closed system statement

```text
UI → ACTION CONTRACTS → financeGate → State → stateRemote → Snapshot
```

| Layer | Responsibility |
|-------|----------------|
| **UI** | Intent collection + dispatch + display |
| **Action contracts** | Formal spec — deterministic behavior |
| **financeGate** | Enforcement + routing + atomic execution |
| **State** | Single in-memory truth before persist |
| **stateRemote** | Single remote write path |
| **Snapshot** | Serialized household document |

**No exceptions** for user mutations of shared snapshot fields. Device-local prefs and bootstrap metadata repair remain outside action contracts (documented in lockdown design).

### Contract registry completeness checklist

Implementation is contract-complete when:

- [ ] All Section 3 action types have registered handlers
- [ ] All handlers pass through validation → mutation → journal → invariants sequence
- [ ] All UI commits map 1:1 to Section 5 table
- [ ] System invariants INV-1–INV-19 verifiable after each action
- [ ] New transaction types (`obligation_created`, `obligation_deleted`, `exchange_rate_updated`) added if audit rules require

---

## Appendix A — Action type index

| Action type | Domain | Money impact |
|-------------|--------|--------------|
| `ACCOUNT_CREATE` | accounts | optional initial deposit |
| `ACCOUNT_UPDATE` | accounts | balance may change |
| `ACCOUNT_DELETE` | accounts | yes |
| `CATEGORY_CREATE` | categories | no |
| `CATEGORY_UPDATE` | categories | no |
| `CATEGORY_DELETE` | categories | releases reserve |
| `SAVING_CREATE` | savings | no |
| `SAVING_UPDATE` | savings | no |
| `SAVING_DELETE` | savings | returns accumulated |
| `OBLIGATION_CREATE` | obligations | no |
| `OBLIGATION_UPDATE` | obligations | no |
| `OBLIGATION_DELETE` | obligations | may release reserve |
| `RATE_UPDATE` | settings | indirect (FX) |

---

## Appendix B — Document chain

| Document | Role |
|----------|------|
| `FINANCE_GATE_EXPANSION_DESIGN.md` | What to build |
| **This document** | Formal contracts for how actions behave |
| `ARCHITECTURE_ENFORCEMENT_IMPLEMENTATION_PLAN.md` | Migration order |
| `EXECUTION_SAFETY_REPORT.md` | Go/no-go for Phase 1 vs Phase 2 |

---

*Action contract specification — no application code was modified.*
