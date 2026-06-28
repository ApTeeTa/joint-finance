# Joint Finance — Project Principles

This document formalizes how the project is developed and must continue to be developed. It describes agreed behavior, not future product vision.

---

## Rule 0: No Local Fixes — Only System Rules

When something is wrong, do not patch a single screen in isolation.

Fix the **system rule** that allowed the problem:

- If duplication appears in one module, fix the shared display pattern (`displayMode.js`, shared CSS, shared helpers).
- If data appears in the wrong environment, fix the snapshot / sync rule — not a one-off branch hack.
- If formatting is inconsistent, fix `formatUi.js` usage — not a hardcoded string in one card.

Local fixes create drift. System rules keep modules aligned.

---

## Philosophy: Rule-Based Development

Joint Finance is a multi-module family finance app. Modules share:

- One Supabase snapshot model
- One sync layer
- One display mode system
- One UI icon and formatting layer

New work must **extend existing rules**, not introduce parallel patterns.

When adding a module or feature, ask:

1. Does it follow snapshot isolation?
2. Does it use the shared display item structure?
3. Does it keep UI as representation only?
4. Does it mutate data only through existing finance gates / actions?

If the answer is no, the work is not ready to merge.

---

## Principle: UI = Representation Only

The UI renders state. It does not own financial truth.

- Balances, limits, debts, obligations, and savings amounts come from application state hydrated from Supabase (with local cache).
- Display formatting (`formatUiMoney`, compact labels, card summaries) must never change stored values.
- Business calculations live in finance modules (`financeEngine.js`, `financeGate.js`, `transactions.js`, etc.), not in card renderers.

Cards show **one summary** and optional **expanded detail**. They do not re-derive business rules for display convenience.

---

## Principle: Supabase = Source of Truth

Shared household data is stored in Supabase table `household_snapshots`:

- Row `id = 'shared'` — production household data
- Row `id = 'shared-experiment'` — experiment environment data

The app reads and writes a JSON `payload` containing:

- `accounts`, `categories`, `transactions`, `obligations`, `savings`, `debts`, `exchangeRate`

Sync merges remote snapshots with local state; it does not replace architecture with ad-hoc per-device truth.

---

## Principle: Experiment Isolation Must Never Affect Production

On the experiment branch:

- `SNAPSHOT_ID` is `shared-experiment` (see `src/config/environment.js`)
- All remote read/write/subscribe operations target that row only
- Production row `shared` is never written by experiment code

Experiment may **read** production once to seed an empty experiment snapshot (bootstrap copy). That operation copies data into `shared-experiment` only.

Main branch must keep `SNAPSHOT_ID = 'shared'`.

Different devices may have different display preferences (localStorage), but **financial data environments must not cross-contaminate**.

---

## Principle: Stability Before Redesign

Display mode work established layout density (list / medium / large) without changing financial meaning.

Future UI changes must preserve:

- Single source of truth per card field
- Shared display item architecture
- Existing action wiring (`data-action` handlers, modals)

Visual polish is allowed. Silent behavior or data changes are not.

---

## OPEN QUESTIONS / UNCERTAIN AREAS

- Whether production (`main`) will use the same display mode system version as experiment at merge time — process decision, not yet codified in repo rules.
- Whether header-level totals (app bar balances) should eventually use `formatUiMoney` or always show full precision — currently mixed by design scope.
- Long-term policy for resetting vs. intentionally empty experiment snapshots after seeding.
