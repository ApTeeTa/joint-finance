# Joint Finance — Rule Compliance Audit Report

**Date:** 2026-06-21  
**Branch audited:** `experiment-full-sync` (HEAD `7bb38b3`)  
**Scope:** `/docs/` rule system vs. `src/`, `index.html`, `sw.js`  
**Method:** Read-only comparison; no code changes.

**Rule ID convention used in this report:**

| Prefix | Source document | Meaning |
|--------|-----------------|--------|
| P0, P-UI, P-SB, … | `00_PROJECT_PRINCIPLES.md` | Project principles |
| UI-1 … UI-9 | `10_UI_RULEBOOK.md` §1–§9 | UI rules |
| UX-1 … UX-10 | `20_UX_PRINCIPLES.md` §1–§10 | UX rules |
| ARCH-1 … ARCH-11 | `30_ARCHITECTURE_RULES.md` §1–§11 | Architecture rules |

---

## 1. COMPLIANT AREAS

### Snapshot and sync architecture (P-SB, ARCH-1, ARCH-2, ARCH-3, ARCH-4)

- `src/config/environment.js` sets `SNAPSHOT_ID = 'shared-experiment'` and `SEED_SNAPSHOT_ID = 'shared'` on the experiment branch.
- `src/lib/stateRemote.js` uses `SNAPSHOT_ID` for pull, push, upsert, and realtime filter (`id=eq.{SNAPSHOT_ID}`). Experiment bootstrap copies from `shared` → `shared-experiment` only when experiment has no accounts.
- `src/modules/storage.js` scopes localStorage to `joint-finance-state-v2-shared-experiment` on experiment; legacy key migration is one-time bootstrap only.
- Shared fields export/merge/apply flow (`exportSharedSnapshot`, `mergeSharedSnapshots`, `applySharedSnapshot`, `schedulePushSharedState`) matches ARCH-4.
- Display mode changes do not trigger sync (localStorage only).

### Display mode system (UI-4, UI-6, UI-8, UI-9, UX-8, UX-9)

- Central implementation in `src/modules/displayMode.js`: three modes, per-module localStorage keys, `DEFAULT_DISPLAY_MODE = medium`, global click delegate, one open detail panel per module root.
- All five entity modules register in `DISPLAY_MODULE_KEYS` and use `renderDisplayModeRoot` + `renderDisplayModeList` + `renderDisplayItem`.
- Section toolbars include ☰ ▦ ▥ toggle via `renderModuleToolbar` (accounts, categories, savings, debts, obligations).
- CSS in `index.html` implements compact list / medium grid / large single-column layouts, action visibility split (`.display-list-action` / `.display-card-action`), ~150–180ms transitions, mobile overflow constraints.
- `initDisplayModeSystem()` is called early in `src/app.js` bootstrap (ARCH-9).

### Shared card structure (UI-6, UI-8, P-Stability)

- Single DOM tree per entity via `renderDisplaySummary` + optional `actionsHtml` + `detailHtml` — no parallel compact/expanded field trees.
- Three-layer model: `.display-item-body` (layout), `.display-item-actions` (actions), `.display-item-detail` (interaction).
- Body click toggles detail; action buttons are separate elements inside `.display-item-header`.

### Accounts module — reference implementation (UI-1, UI-2, UI-3, UI-7, UX-4, UX-5)

- Primary value only in summary (`formatUiMoney` balance); owner shown as icon in title, not duplicated as text.
- `.display-list-action` (+ / ⇄) and `.display-card-action` (edit / delete) with `renderUiIcon()`.
- Modals and history lines use local `formatMoney` (full precision) — correct per UI-3.
- Mutations route through `financeGate.js` (`depositAccount`, `transferAccount`, `createAccount`, `updateAccountRecord`, `deleteAccountRecord`).

### Categories module — summary deduplication (UI-1, UI-2, UI-3)

- Primary value = available amount; meta = limit + spent context; no stats grid duplicating those fields.
- `formatUiMoney` on card summaries; `formatMoney` in modals and expense history.
- Reserve/unreserve/edit/menu use `renderUiIcon()`; delete hidden in `⋮` menu (UX-6).

### Savings module (UI-2, UI-3, UI-7, UX-5)

- Primary value = accumulated (`formatUiMoney`); meta = progress % or goal status.
- Compact list `+` deposit via `.display-list-action`; card edit/delete via `.display-card-action` and icons.
- Stats grid shows goal (secondary), not duplicate of primary accumulated amount.

### Obligations module — due phrasing and overdue styling (UI-2, UX-10)

- Meta uses `оплатить до …` / `просрочено · …` via `formatObligationDueMeta()` — no «до до» duplication.
- Overdue communicated via `STATUS_CARD_CLASS` border/color, not a status badge in the card summary.
- Status badges removed from entity cards (aligned with UI rulebook open note).

### UI formatting layer (UI-3, P-UI)

- `src/modules/formatUi.js` — `formatUiMoney` is UI-only, uses k/M suffixes ≥ 1000, currency symbol embedded.
- `src/modules/uiIcons.js` — unified `.ui-icon` wrapper (16×16 SVG inside 32×32 touch targets where used).

### Finance gate usage (ARCH-5 — target pattern)

- Entity modules import gated operations from `financeGate.js` (categories, savings, obligations, debts, history undo).
- `FINANCE_ENFORCEMENT_MODE = true` in `financeEnforcement.js`; gate helpers enforce entry context when enabled.

### Bootstrap and PWA shell (ARCH-9, ARCH-10)

- `app.js` order: load local state → init display modes → render profile/tab → attach handlers → subscribe → pull remote.
- `sw.js` and `manifest.webmanifest` present for static asset caching (separate from Supabase truth).

---

## 2. PARTIAL COMPLIANCE

### UI-3 / UI-2 — Debts card money formatting and primary value

| | |
|---|---|
| **Rule** | UI-3: card summaries use `formatUiMoney`; UI-2: remaining amount is primary value |
| **Where** | `src/modules/debts.js` — `renderDebtCard()` |
| **Inconsistent** | Uses local `formatMoney()` for `value`, `meta`, and `statsHtml` instead of `formatUiMoney`. Primary value shows full-precision strings on cards. |

### UI-1 — Debts stats grid duplicates summary fields

| | |
|---|---|
| **Rule** | UI-1: each fact once at summary level; stats for secondary metrics only |
| **Where** | `src/modules/debts.js` — `renderDebtCard()` |
| **Inconsistent** | `value` = remaining; `meta` includes «Погашено …»; `statsHtml` repeats «Остаток», «Из суммы», «Погашено» — overlapping with primary and meta. |

### UI-1 — Savings progress shown twice

| | |
|---|---|
| **Rule** | UI-1: no repeated labels for the same metric |
| **Where** | `src/modules/savings.js` — `renderSavingCard()` |
| **Inconsistent** | `meta` = `Прогресс N%`; `statsHtml` includes «Прогресс: N%» again in medium/large modes. |

### UI-7 / UX-4 — Categories and obligations action class split

| | |
|---|---|
| **Rule** | UI-7: `.display-list-action` (compact) vs `.display-card-action` (medium/large); UX-4: list mode hides card actions |
| **Where** | `src/modules/categories.js` — `renderCategoryCard()`; `src/modules/obligations.js` — `renderObligationCard()` |
| **Inconsistent** | Action buttons lack both CSS classes. In compact mode, edit/delete (and category menu) remain visible because only `.display-card-action` is hidden by CSS — opposite of accounts/savings behavior. Reserve/unreserve are not marked as list-primary actions. |

### UI-7 — Debts compact primary actions (acknowledged open question)

| | |
|---|---|
| **Rule** | UI-7 / UX-5: compact list primary «+» where applicable |
| **Where** | `src/modules/debts.js` — `renderDebtCard()` has no `actionsHtml` |
| **Inconsistent** | No inline list actions; user must expand detail for «Погасить». Rulebook open question explicitly flags this — implementation lags stated UX goal but is documented as undecided. |

### UI-7 — Debts icons not unified

| | |
|---|---|
| **Rule** | UI-7: use `renderUiIcon()` |
| **Where** | `src/modules/debts.js` |
| **Inconsistent** | Module does not import `uiIcons.js`; no header action icons at all (detail uses text buttons only). |

### UI-4 / UI-8 — Stats and History tabs outside display mode system

| | |
|---|---|
| **Rule** | UI-4, UI-8: five entity modules use shared display architecture |
| **Where** | `src/modules/stats.js`, `src/modules/history.js` |
| **Inconsistent** | Custom section/table/list markup; no `renderDisplayModeRoot`, no density toggle. Explicitly scoped out in rulebook open questions — partial by documented intent, not by accident. |

### UI-3 — Header totals use full precision

| | |
|---|---|
| **Rule** | UI-3 / P-Stability open question: header may use `formatUiMoney` or full precision |
| **Where** | `src/app.js` — `updateCounters()` |
| **Inconsistent** | App bar uses local `formatMoney()` (full amounts). Cards use compact format — intentional mixed scope per docs, not fully resolved. |

### ARCH-5 — Finance gate enforcement incomplete

| | |
|---|---|
| **Rule** | ARCH-5: mutations through finance layer |
| **Where** | `financeEnforcement.js`, `financeGateHelpers.js`, various handlers |
| **Inconsistent** | `FINANCE_ENFORCEMENT_MODE = true` but `LEGACY_SAFE_OPERATIONS` documents exceptions (`ensureObligationPaymentReserve`, `reconcileLegacyTransactions`, etc.). Architecture doc admits full path audit not done. |

### UX-10 — Status badges in Stats tab only

| | |
|---|---|
| **Rule** | UX-10: overdue via border/meta, avoid redundant badges on obligation cards |
| **Where** | `src/modules/stats.js` — `renderObligationsOverview()` |
| **Inconsistent** | Stats table uses `renderStatusBadge()` for obligation status. Entity cards comply; analytics view does not follow the same badge policy. |

### P0 — Parallel `formatMoney` helpers per module

| | |
|---|---|
| **Rule** | P0: fix shared helpers, not one-off strings |
| **Where** | `accounts.js`, `categories.js`, `debts.js`, `obligations.js`, `savings.js`, `history.js`, `stats.js`, `app.js` |
| **Inconsistent** | Each file defines its own `formatMoney()` with similar `Intl.NumberFormat` logic instead of importing `formatFullMoney` from `formatUi.js`. Behavior is mostly aligned but violates DRY spirit of Rule 0. |

---

## 3. VIOLATIONS

### ARCH-6 / ARCH-1 — Direct Supabase write from UI module

| | |
|---|---|
| **Rule ID** | ARCH-6 (UI must not write Supabase except via `stateRemote` / `saveState`); ARCH-1 (single source of truth) |
| **File(s)** | `src/modules/accounts.js` — `persistAccountToSupabase()`, called from add-account submit handler (~L1204) |
| **Mismatch** | Inserts into legacy `accounts` table via `supabase.from('accounts').insert()`, bypassing `household_snapshots` payload model. |
| **Why it violates** | Creates a parallel persistence path alongside snapshot sync. Financial truth should live only in `household_snapshots.payload`; this path can desync local state from remote schema intent and breaks ARCH-6’s boundary. |

### UI-1 / UI-2 — Debts primary value duplicated in stats

| | |
|---|---|
| **Rule ID** | UI-1, UI-2 |
| **File(s)** | `src/modules/debts.js` — `renderDebtCard()` L85–96 |
| **Mismatch** | Primary `value` shows remaining amount; `statsHtml` first row is «Остаток:» with the same remaining amount. |
| **Why it violates** | Same metric appears as primary value and again in stats grid — explicit UI-1 prohibition. |

### UI-1 — Debts paid amount in meta and stats

| | |
|---|---|
| **Rule ID** | UI-1 |
| **File(s)** | `src/modules/debts.js` — `renderDebtCard()` L87–95 |
| **Mismatch** | Non-manual debts: meta = `Погашено ${formatMoney(paidAmount)}`; stats includes «Погашено:» with same amount. |
| **Why it violates** | Duplicate fact at summary level (meta + stats). |

### UI-3 — Debts card summaries skip `formatUiMoney`

| | |
|---|---|
| **Rule ID** | UI-3 |
| **File(s)** | `src/modules/debts.js` — `renderDebtCard()` |
| **Mismatch** | Card `value`, `meta`, and `statsHtml` use local `formatMoney()` instead of `formatUiMoney()`. |
| **Why it violates** | Rulebook table (UI-2) specifies debts primary value via compact UI formatting; module is the only entity tab not using `formatUiMoney` on cards. |

### UI-7 / UX-4 — Categories compact mode exposes all actions

| | |
|---|---|
| **Rule ID** | UI-7, UX-4 |
| **File(s)** | `src/modules/categories.js` — `renderCategoryCard()` actionsHtml L427–468; `index.html` CSS L194–213 |
| **Mismatch** | Reserve, unreserve, edit, and ⋮ menu buttons have no `.display-list-action` or `.display-card-action` classes. CSS hides only `.display-card-action` in compact mode. |
| **Why it violates** | Compact list should show primary inline actions only; edit/delete/menu should be hidden until card mode. Current markup shows up to four controls in list rows — breaks muscle-memory and visibility rules. |

### UI-7 / UX-4 — Obligations compact mode exposes all actions

| | |
|---|---|
| **Rule ID** | UI-7, UX-4 |
| **File(s)** | `src/modules/obligations.js` — `renderObligationCard()` actionsHtml L312–317 |
| **Mismatch** | +, −, edit, delete buttons lack action class split; all visible in compact mode. |
| **Why it violates** | Same as categories — destructive/edit controls should not compete with primary placement in list density. Rulebook assigns reserve actions as primary inline for obligations/categories but does not exempt them from mode-based visibility. |

### UI-1 — Savings progress duplicated in meta and stats

| | |
|---|---|
| **Rule ID** | UI-1 |
| **File(s)** | `src/modules/savings.js` — `renderSavingCard()` L414–424 |
| **Mismatch** | Progress percentage in both `meta` and `statsHtml`. |
| **Why it violates** | Same metric twice on one card in medium/large modes. |

---

## 4. MISSING RULE ENFORCEMENT

Rules that exist in `/docs/` but have **no automated or structural enforcement** in code (convention-only):

| Rule | Stated requirement | Enforcement gap |
|------|-------------------|-----------------|
| **P0** | Fix system rules, not local patches | No lint/check preventing duplicate `formatMoney`, ad-hoc Supabase calls, or module-specific card DOM |
| **UI-1** | No duplicated summary facts | No validation on `renderDisplaySummary` inputs; duplicates possible in any module |
| **UI-3** | `formatUiMoney` on card summaries | Not enforced — debts module omits import entirely |
| **UI-7** | Action CSS class contract | No helper requiring `.display-list-action` / `.display-card-action`; categories/obligations skip classes |
| **ARCH-5** | All mutations via finance gate | Runtime guard exists (`FINANCE_ENFORCEMENT_MODE`) but documented legacy exceptions; no CI audit |
| **ARCH-6** | No direct Supabase from UI | `accounts.js` direct insert not blocked; only convention |
| **UX-10** | Badge policy for obligations | Entity cards follow; stats tab badges unconstrained by any shared helper |
| **UI-9** | Toolbar layout | Structure repeated manually per module — no shared section header component enforcing layout |

Rules **partially reflected in UI only** (CSS/delegates exist but modules can opt out):

- **UI-7 action visibility** — CSS works only when modules use the correct classes (accounts, savings yes; categories, obligations no).
- **UI-6 single open detail** — enforced in `displayMode.js` delegate; modules outside system (History, Stats) unaffected.
- **UX-8 display preference isolation** — localStorage keys exist; nothing prevents a future module from syncing preferences to Supabase.

Rules in docs marked as **open / undecided** — intentionally not enforced:

- Debts compact «+» action (UI-7 open question)
- Stats/History migration to display modes (UI-4, ARCH-11)
- Header `formatUiMoney` vs full precision (P-Stability open question)
- Obligation badge policy in non-entity views (UI rulebook open question)

---

## 5. SYSTEM GAPS (CANDIDATES FOR NEW RULES)

Behavior in code **without** matching rules in `/docs/`:

| Area | Code behavior | Gap |
|------|---------------|-----|
| **Profile / owner context** | `state.profile` (husband/wife), owner grouping on accounts, owner icons | No principle for profile switching, per-owner accounts, or icon semantics |
| **Exchange rate editor** | Inline USD rate input in accounts section (`renderAccounts`) | No rule for where global settings live vs. entity cards; mutates shared state |
| **Accounts owner grouping** | `OWNER_GROUP_ORDER` sections inside one display root | No rule for nested grouping within a module list |
| **Misc category** | `renderMiscCategoryCard()` — system category, spent-only primary | No exception rule for system entities vs. user categories |
| **Debts overdue obligations block** | `renderOverdueObligationsSection()` in debts tab — `<details>` list, not `renderDisplayItem` | No rule for cross-tab alert surfaces or embedded non-entity lists |
| **Debts sub-sections** | Three debt types + manual events, each with own «Добавить» in subsection header | No rule for multi-section modules vs. single toolbar (UI-9 assumes one section toolbar) |
| **Manual debt events** | Separate debt type with category labels and event date | Entity model rules in architecture docs don’t describe debt type taxonomy |
| **Modal layer** | `modalLayer.js` — shared open/close, `data-modal` pattern | No UI/UX rule for modal structure, confirm flows, or stacking |
| **Analytics read model** | `analyticsReadModel.js` feeds Stats tab | No architecture rule separating read models from entity renderers |
| **Transaction history / undo** | History tab, `undoTransaction` via gate | No UX rules for audit trail, undo eligibility, or edit meta |
| **Finance enforcement exceptions** | `LEGACY_SAFE_OPERATIONS` registry | Process rule needed for when exceptions are allowed and retirement criteria |
| **Legacy Supabase `accounts` table** | `persistAccountToSupabase` + `DEFAULT_HOUSEHOLD_ID` | No migration/deprecation rule for pre-snapshot schema remnants |
| **Console debug logging** | `🔥 SUPABASE INSERT` logs in accounts add flow | No dev/prod logging rule |
| **Tab navigation from debts** | `data-action="open-obligation-tab"` jumps to obligations | No cross-tab navigation UX rule |
| **Duplicate local formatters** | Eight module-local `formatMoney` copies | P0 implies consolidation; no explicit «use formatFullMoney» rule in UI rulebook |
| **Service worker cache busting** | `sw.js` version constant | ARCH-10 mentions deployment only — no link to release process |
| **Accessibility** | `aria-expanded` on detail toggle; incomplete keyboard spec | UX open question only — no a11y rule section |
| **Conflict merge UX** | `mergeSharedSnapshots` prefer-local | ARCH open question — user-visible behavior undefined |

**UI inconsistency without a rule:**

- Stats obligation **badges** vs. entity card **border/meta** for same concept (overdue/active).
- Categories use **⋮ menu** for delete; accounts/savings/obligations use **trash icon** — partially noted in UI-7 open question but not codified as allowed variance per module.
- Savings stats row uses **`formatMoney`** for recommended monthly (`renderRecommendedMonthlyPaymentRow`) while card uses **`formatUiMoney`** — mixed precision within same module card.

---

## Summary Matrix

| Module / area | Display mode | formatUiMoney cards | Action class split | No summary dup | financeGate mutations | Snapshot-only remote |
|---------------|-------------|---------------------|--------------------|----------------|----------------------|----------------------|
| Accounts | ✅ | ✅ | ✅ | ✅ | ✅ (except Supabase insert) | ⚠️ parallel `accounts` insert |
| Categories | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| Savings | ✅ | ✅ | ✅ | ⚠️ progress dup | ✅ | ✅ |
| Obligations | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| Debts | ✅ | ❌ | ❌ (no list actions) | ❌ | ✅ | ✅ |
| History | N/A | N/A | N/A | N/A | ✅ undo | ✅ |
| Stats | N/A | N/A | N/A | N/A | read-only | ✅ |
| App header | N/A | ❌ (full fmt) | N/A | N/A | N/A | ✅ |

---

## Audit Notes

- This report maps **documented rules → observed code** only. It does not recommend fixes (per task constraint).
- Several gaps are already acknowledged in rulebook **OPEN QUESTIONS** sections; those appear under partial compliance or missing enforcement rather than as undocumented surprises.
- Highest-severity architectural mismatch: **`persistAccountToSupabase`** (ARCH-6 / ARCH-1).
- Highest-severity UI mismatch concentration: **`debts.js`** (formatting, duplication, action/icon patterns).
- Reference module for UI rule alignment: **`accounts.js`** (post `7bb38b3` cleanup).

---

*Generated by rule compliance audit — no application code was modified.*
