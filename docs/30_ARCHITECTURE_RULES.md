# Joint Finance — Architecture Rules

Structural rules for data, sync, and module boundaries. Reflects the current codebase on the experiment branch.

---

## 1. Supabase Is the Only Source of Truth

Household financial data lives in:

**Table:** `public.household_snapshots`

| Column | Role |
|--------|------|
| `id` | Snapshot environment key (`shared` or `shared-experiment`) |
| `payload` | JSON document with all shared entities |
| `updated_at` | Version timestamp for sync |

No parallel truth in UI state, display preferences, or ad-hoc globals.

---

## 2. localStorage Is Cache Only

**Financial data cache:**

- Key `joint-finance-state-v2` (production / `shared`)
- Key `joint-finance-state-v2-shared-experiment` (experiment)

Legacy key `joint-finance-state-v2` may be migrated once into experiment cache if experiment cache is empty — bootstrap convenience only.

**Display preferences (not synced):**

- `accountsDisplayMode`, `categoriesDisplayMode`, `savingsDisplayMode`, `debtsDisplayMode`, `obligationsDisplayMode`

localStorage survives offline and speeds first paint; sync layer reconciles with Supabase on load and on remote changes.

---

## 3. Snapshot Isolation

Configured in `src/config/environment.js`:

| Environment | `SNAPSHOT_ID` | Writes |
|-------------|---------------|--------|
| Production (main) | `shared` | `shared` only |
| Experiment | `shared-experiment` | `shared-experiment` only |

**Rules:**

- `stateRemote.js` uses `SNAPSHOT_ID` for pull, push, clear, and realtime filter
- Experiment never upserts row `shared`
- Realtime subscription filters `id=eq.{SNAPSHOT_ID}`

**Experiment bootstrap (implemented):**

If `shared-experiment` has no accounts but `shared` has data, experiment may copy payload from `shared` → `shared-experiment` once (read-only read from production). Prevents empty experiment UI after isolation switch.

---

## 4. Sync Layer Responsibilities

`src/lib/stateRemote.js` + `src/modules/storage.js`:

- **Export** shared fields from in-memory state (`exportSharedSnapshot`)
- **Merge** local and remote (`mergeSharedSnapshots`) — not blind replace
- **Apply** merged result to state (`applySharedSnapshot`)
- **Schedule push** after local changes (debounced; blocked until initial sync completes)

UI renders from in-memory `state` object in `app.js`; sync updates that object and triggers re-render.

Display mode changes do **not** trigger sync.

---

## 5. Mutations Through Finance Layer (Conceptual Rule)

User actions that change money or entities should flow through established modules:

- `financeGate.js` — gated write operations
- `financeEngine.js` — derived balances and aggregates
- `transactions.js` — transaction records, reconciliation helpers

UI handlers call these; card renderers do not mutate state directly except through existing handler patterns.

*Note: Full audit of every code path against this rule has not been completed — see open questions.*

---

## 6. UI Must Not Contain Business Logic

Allowed in UI modules:

- Formatting for display (`formatUiMoney`, `escapeHtml`)
- Sorting/grouping for presentation (e.g. owner groups on accounts)
- Wiring `data-action` to handlers

Not allowed in UI modules:

- Computing balances from scratch for persistence
- Deciding whether a transfer is valid beyond calling finance gate
- Writing to Supabase directly (except through `stateRemote` via `saveState` → `schedulePushSharedState`)

---

## 7. Display Layer Is Pure Rendering

`src/modules/displayMode.js` + module render functions:

- Read current `state` and render HTML strings
- Manage layout density and visibility (CSS + `data-display-mode`)
- Handle display-only events (toggle detail, set display mode)

Must not:

- Change Supabase schema
- Change snapshot IDs
- Alter merge/sync semantics

---

## 8. Module Consistency Requirement

Entity tabs share the same architectural pattern:

| Module | Render entry | Display root key |
|--------|--------------|------------------|
| Accounts | `renderAccounts` | `accounts` |
| Categories | `renderCategories` | `categories` |
| Savings | `renderSavings` | `savings` |
| Debts | `renderDebts` | `debts` |
| Obligations | `renderObligations` | `obligations` |

New entity modules must:

1. Use `renderDisplayItem` / `renderDisplaySummary`
2. Register a `DISPLAY_MODULE_KEYS` entry
3. Use isolated snapshot data only (same payload shape)
4. Keep display preferences in localStorage under a dedicated key

---

## 9. Application Bootstrap Order

From `app.js` (conceptual):

1. Load local state from localStorage
2. Initialize display mode system (global click delegate)
3. Render profile + active tab
4. Attach tab handlers
5. Pull remote snapshot into state; merge; re-render if data arrived
6. Subscribe to realtime snapshot changes

Failure in a single module import must not silently half-initialize — module graph must load completely.

---

## 10. PWA and Static Assets

- Service worker caches static assets (separate from Supabase truth)
- `manifest.webmanifest` for installability
- SW cache version bumps are deployment concerns, not data migrations

---

## 11. Branch and Backup Policy (Process)

- Production work on `main` with `SNAPSHOT_ID = 'shared'`
- Experiment work on `experiment-full-sync` with `SNAPSHOT_ID = 'shared-experiment'`
- Backup reference: branch `backup/experiment-full-ui-clean-2026-06-27`, tag `backup-experiment-ui-clean`

Do not merge experiment into main without explicit instruction and environment config review.

---

## OPEN QUESTIONS / UNCERTAIN AREAS

- **Full mutation audit:** Not every UI handler path has been verified to go exclusively through `financeGate` — rule stated as target architecture.
- **Conflict resolution edge cases:** `mergeSharedSnapshots` prefer-local behavior during concurrent edits — documented in code but not fully specified for users.
- **Stats / History tabs:** Use rendering patterns outside display mode system — whether they must migrate is undecided.
- **Auth / multi-household:** Current model assumes single shared snapshot per deployment; no household picker architecture yet.
- **Schema changes:** Rule is «no schema changes» for experiment work; future migrations would need their own architecture addendum.
- **Offline push queue:** Failed push retry semantics beyond console error — not fully defined.
