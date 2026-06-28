# Joint Finance — Rule Enforcement Plan

**Date:** 2026-06-21  
**Source documents:** `/docs/00_PROJECT_PRINCIPLES.md`, `10_UI_RULEBOOK.md`, `20_UX_PRINCIPLES.md`, `30_ARCHITECTURE_RULES.md`  
**Source audit:** `/docs/RULE_AUDIT_REPORT.md` (branch `experiment-full-sync`, HEAD `7bb38b3`)  
**Purpose:** Prioritized execution plan to bring the codebase into full rulebook compliance.  
**Constraint:** This document defines direction and order only — no code, UI, or logic changes.

---

## 1. EXECUTIVE SUMMARY

### Overall system state vs rulebook

Joint Finance is **substantially aligned** with its own rule system at the foundation layer. Snapshot isolation, sync merge semantics, display mode infrastructure, and the accounts module collectively demonstrate that the rulebook describes real architecture — not aspirational documentation.

Compliance is **uneven by layer**:

| Layer | Maturity | Assessment |
|-------|----------|------------|
| **Architecture (ARCH)** | High with one critical exception | Snapshot model, experiment isolation, and finance gate pattern are implemented and coherent. One legacy write path undermines single-source-of-truth. |
| **UI (UI rules)** | Medium | Shared display system exists and four of five entity modules use it well. Debts module lags; categories/obligations opt out of action-class contract. |
| **UX (UX rules)** | Medium-low | Interaction patterns are consistent where accounts/savings set the template. Categories, obligations, and debts diverge on compact-mode action exposure and primary-action affordances. |

**Rough compliance estimate (entity modules only):**

- Architecture boundary: ~90% (minus parallel Supabase path and un-audited mutation paths)
- UI card/summary rules: ~75% (debts and savings duplication; debts formatting)
- UX interaction consistency: ~70% (action visibility and cross-module semantics)

### Main categories of inconsistency

1. **Legacy persistence remnant** — A pre-snapshot Supabase insert path survives in account creation, violating ARCH-1 and ARCH-6.
2. **Opt-out from shared UI contracts** — CSS-enforced action visibility (`.display-list-action` / `.display-card-action`) works only when modules adopt the classes; two modules do not.
3. **Module-local drift** — Debts was not brought through the same UI cleanup pass as accounts/categories/savings/obligations (formatting, deduplication, icons).
4. **Convention without enforcement** — Rules are documented but not structurally guarded (no shared action builder, no summary validator, no import boundary for Supabase).
5. **Undecided rulebook scope** — Stats, History, header totals, debts list «+», and badge policy in analytics views remain open questions; partial compliance is intentional but blocks “full” compliance until rules are extended or scope is narrowed.

### Architectural maturity assessment

**UI layer:** Mature infrastructure (`displayMode.js`, `formatUi.js`, `uiIcons.js`, shared CSS). Immature adoption — enforcement depends on each module manually following patterns. Accounts is the reference; debts is the outlier.

**UX layer:** Core gestures (body tap → detail, mode toggle, modal actions) are centralized. Secondary patterns (delete via trash vs ⋮ menu, compact primary actions, cross-tab alerts) vary by module without a codified variance policy.

**ARCH layer:** Mature for snapshot read/write/subscribe. Finance gate is present with runtime enforcement flag but incomplete audit coverage and documented legacy exceptions. Data-layer boundary is breached in one known path.

---

## 2. CRITICAL FIXES (P0)

These items break core architecture rules or create system-level data integrity risk. They must be resolved before UI/UX normalization is considered complete.

---

### P0-1 — Remove legacy Supabase write path from UI

| Field | Detail |
|-------|--------|
| **Rule IDs** | ARCH-6, ARCH-1, P-SB |
| **Affected** | `src/modules/accounts.js` — `persistAccountToSupabase()`, add-account submit handler |
| **System-level risk** | Parallel truth: account rows may exist in legacy `accounts` table while household state lives in `household_snapshots.payload`. Remote ID from legacy insert can attach to local state (`remoteId`) without guaranteed consistency with snapshot merge. Experiment/production isolation could be bypassed if legacy table is shared. Violates “Supabase = source of truth” at the schema level. |
| **Required direction** | Eliminate direct `supabase.from('accounts').insert()` from UI modules. Account creation must flow exclusively: user action → finance gate → in-memory state → `saveState` → `schedulePushSharedState` → snapshot upsert. Deprecate or document retirement of legacy `accounts` table usage. Remove debug logging tied to legacy path. Resolve whether `remoteId` from legacy table is still needed for any entity identity scheme. |

---

### P0-2 — Establish single remote write boundary

| Field | Detail |
|-------|--------|
| **Rule IDs** | ARCH-6, ARCH-4, P-UI |
| **Affected** | `src/lib/stateRemote.js`, `src/modules/storage.js`, any module importing `supabase` directly |
| **System-level risk** | Without a hard boundary, future features can reintroduce ad-hoc Supabase calls. Only `stateRemote.js` should perform remote financial persistence. |
| **Required direction** | Audit all imports of `supabase.js` outside `stateRemote.js`. Define architectural rule: UI and entity modules must not import Supabase client. Consolidate any remaining legitimate remote access into sync layer. Add process check (code review or lint rule) before merge. |

---

### P0-3 — Resolve legacy schema vs snapshot model policy

| Field | Detail |
|-------|--------|
| **Rule IDs** | ARCH-1, ARCH-11 (process) |
| **Affected** | Legacy `accounts` table, `DEFAULT_HOUSEHOLD_ID` in accounts flow |
| **System-level risk** | Ambiguous ownership of account identity and persistence creates migration dead ends and dual-write scenarios. |
| **Required direction** | Document explicit deprecation decision: snapshot payload is the only persisted financial document. Define whether legacy table reads/writes must be removed entirely or bridged during a bounded migration window — then encode that in architecture rules (new addendum). |

---

### P0-4 — Finance gate path audit (blocking for ARCH-5 closure)

| Field | Detail |
|-------|--------|
| **Rule IDs** | ARCH-5, P0 |
| **Affected** | All modules with state mutation handlers; `financeEnforcement.js`, `financeGateHelpers.js`, `LEGACY_SAFE_OPERATIONS` |
| **System-level risk** | Undocumented mutation paths can change balances without gate context, undermining enforcement lock and making UI-only fixes unsafe. |
| **Required direction** | Complete inventory of every handler that mutates `state.accounts`, balances, reserves, savings, debts, obligations, or transactions. Classify each as gate-backed or legacy exception. For each exception in `LEGACY_SAFE_OPERATIONS`, assign retirement criteria and owner. No new exceptions without architecture doc update. |

---

## 3. UI CONSOLIDATION PLAN (P1)

Goal: All five entity modules render cards through the same contracts — summary deduplication, `formatUiMoney` on summaries, action class split, unified icons — using accounts as the reference implementation.

---

### UI-G1 — Card summary deduplication

| Field | Detail |
|-------|--------|
| **Violated rules** | UI-1, UI-2, UX-2, UX-7 |
| **Impacted modules** | **Debts** (primary), **Savings** (secondary) |
| **Issues** | Debts: remaining in `value` + stats «Остаток»; paid in `meta` + stats «Погашено». Savings: progress % in `meta` + stats «Прогресс». |
| **Unified direction** | For each module, define one primary value and optional meta per UI-2 table. Stats grid may only show metrics **not** already in primary or meta. Debts: primary = remaining; meta = paid progress or category (manual); stats = original amount and one of paid/remaining breakdown — never repeat primary. Savings: keep progress in meta **or** stats, not both; stats should emphasize goal and recommended monthly (secondary). Apply Rule 0: adjust module render logic to match accounts/categories pattern, not one-off CSS hiding. |

---

### UI-G2 — Money formatting on card summaries

| Field | Detail |
|-------|--------|
| **Violated rules** | UI-3, P-UI |
| **Impacted modules** | **Debts** (cards); **Savings** (recommended monthly row in stats — mixed precision) |
| **Issues** | Debts uses local `formatMoney` for all card fields; only entity tab not using `formatUiMoney`. Savings stats row uses full `formatMoney` inside a card that otherwise uses `formatUiMoney`. |
| **Unified direction** | Card summaries (`value`, `meta`, `statsHtml` labels) use `formatUiMoney`. Modals, forms, history lines, transaction lists use `formatFullMoney` / precision formatters. Consolidate eight module-local `formatMoney` copies toward shared `formatFullMoney` from `formatUi.js` (P0 spirit). Resolve savings recommended-monthly row under same card-summary rule. |

---

### UI-G3 — Action CSS class contract (compact vs card modes)

| Field | Detail |
|-------|--------|
| **Violated rules** | UI-7, UI-4, UX-4 |
| **Impacted modules** | **Categories**, **Obligations** (violations); **Debts** (no actions in header at all) |
| **Issues** | Categories/obligations: buttons lack `.display-list-action` and `.display-card-action`; compact mode shows edit/delete/menu alongside primary actions. Debts: no `actionsHtml`; detail-only actions. |
| **Unified direction** | Every action button in entity cards must declare visibility class: primary compact actions → `.display-list-action`; secondary/destructive/edit → `.display-card-action`. Categories: reserve/unreserve as list-primary; edit and ⋮ menu as card-only. Obligations: +/− reserve as list-primary; edit/delete as card-only. Align with accounts/savings markup pattern. Consider shared helper (e.g. action button builder in display layer) so modules cannot omit classes — enforcement by API, not convention. |

---

### UI-G4 — Unified icon system on entity actions

| Field | Detail |
|-------|--------|
| **Violated rules** | UI-7 |
| **Impacted modules** | **Debts** (no `renderUiIcon`); partial elsewhere |
| **Issues** | Debts detail uses text buttons only; no header icon row. |
| **Unified direction** | Import and use `renderUiIcon()` for all icon-based entity actions across modules. Text buttons remain valid in detail panels for primary operations (popolnить, погасить) — rulebook allows detail actions as buttons. Header action row should match accounts/savings icon sizing (`.ui-icon`, 32×32 targets). |

---

### UI-G5 — Debts module full UI normalization pass

| Field | Detail |
|-------|--------|
| **Violated rules** | UI-1, UI-2, UI-3, UI-7, UI-8 (concentrated) |
| **Impacted modules** | **Debts** |
| **Issues** | Highest violation density in audit matrix: formatting, duplication, no action classes, no icons, no compact list actions. |
| **Unified direction** | Treat debts as a single consolidation workstream after P0 architecture fixes: apply same card summary rules as accounts; restructure `renderDebtCard` summary fields; adopt action class split once UX policy on debts compact «+» is decided (see UX-G2). Do not patch individual fields in isolation (P0). |

---

### UI-G6 — Header and app-bar formatting policy

| Field | Detail |
|-------|--------|
| **Violated rules** | UI-3 (open question), P-Stability |
| **Impacted modules** | `src/app.js` — `updateCounters()` |
| **Issues** | Header uses full-precision local `formatMoney`; cards use compact format. |
| **Unified direction** | **Decision required** before enforcement: either extend UI-3 explicitly to header totals (`formatUiMoney`) or codify header as precision context (like modals). Once decided, update rulebook open question and align `app.js` accordingly. Until decided, classify as P2 optional — not blocking entity module compliance. |

---

### UI-G7 — Stats / History outside display mode system

| Field | Detail |
|-------|--------|
| **Violated rules** | UI-4, UI-8 (scoped out) |
| **Impacted modules** | `stats.js`, `history.js` |
| **Issues** | No density toggle; custom layouts. |
| **Unified direction** | **Decision required:** either (a) extend UI-4/UI-8 scope to include these tabs with migration plan, or (b) explicitly exempt them in rulebook as analytics/audit views with their own subsection. Not P1 unless product scope expands. Place in Step 4 optional improvements if exempt; otherwise separate workstream after entity modules align. |

---

## 4. UX ALIGNMENT PLAN (P1)

Goal: Same gesture, same placement, same semantic weight for equivalent actions across all entity tabs.

---

### UX-G1 — Compact-mode action visibility (muscle memory)

| Field | Detail |
|-------|--------|
| **Violated rules** | UX-4, UX-5, UX-6, UI-7 |
| **Impacted modules** | Categories, Obligations (primary); Debts (no list actions) |
| **Issue** | List mode should show primary financial actions on the right; edit/delete/menu hidden. Categories/obligations show full icon row in compact mode. |
| **Unified direction** | After UI-G3 class adoption, verify compact rows match accounts: title left, value before actions, 1–2 primary actions right. Destructive actions never leftmost or largest in list row. User testing criterion: switching tabs at ☰ density should not change action count or placement logic. |

---

### UX-G2 — Primary «+» semantics and debts list actions

| Field | Detail |
|-------|--------|
| **Violated rules** | UX-5, UI-7 (open question) |
| **Impacted modules** | Debts; Categories/Obligations (+/− reserve semantics) |
| **Issue** | Accounts: + top up, ⇄ transfer. Savings: + deposit. Categories/Obligations: +/− reserve (not generic «+»). Debts: no compact action — must expand for «Погасить». |
| **Unified direction** | **Rulebook decision required** before implementation: define debts compact primary action (e.g. quick «Погасить» or none). Codify per-module primary action matrix in UX doc. Until decided, debts remains documented exception; do not invent ad-hoc button without rule update. Categories/obligations: document that +/− are reserve primitives, not deposit «+» — consistent labeling in titles/tooltips. |

---

### UX-G3 — Secondary action pattern: ⋮ menu vs trash icon

| Field | Detail |
|-------|--------|
| **Violated rules** | UX-6, UI-7 (open question) |
| **Impacted modules** | Categories (⋮ menu delete); Accounts, Savings, Obligations (trash icon) |
| **Issue** | Destructive action access differs by module without explicit allowed-variance rule. |
| **Unified direction** | **Policy decision:** either standardize on one pattern (menu for all secondary/destructive, or trash in card mode for all) or amend rulebook with module-specific exceptions (categories keep menu due to more secondary items). Enforcement: once policy is written, align obligations/accounts/savings/categories to match — no silent divergence. |

---

### UX-G4 — Progressive disclosure content

| Field | Detail |
|-------|--------|
| **Violated rules** | UX-1, UX-7, UI-6 |
| **Impacted modules** | Debts (summary duplicates detail-adjacent info); all modules (detail content audit) |
| **Issue** | Detail panels must reveal actions/history/progress, not repeat summary numbers. Debts stats overlap violates expand = more, not duplicate. |
| **Unified direction** | After UI-G1 deduplication, audit each module’s `detailHtml`: confirm no repeated primary value, «накоплено», or balance in detail. Detail holds operation buttons, history lists, progress bars, warnings — aligned with accounts reference. |

---

### UX-G5 — Obligation status communication across surfaces

| Field | Detail |
|-------|--------|
| **Violated rules** | UX-10 |
| **Impacted modules** | Obligations entity cards (compliant); Stats tab `renderObligationsOverview()` (badges) |
| **Issue** | Entity cards use border/meta (`просрочено ·`); Stats uses `renderStatusBadge()`. |
| **Unified direction** | Extend UX-10 scope explicitly: either badges allowed in analytics tables only, or stats must use same meta/border vocabulary as entity cards. Update rulebook; then align stats renderer to chosen policy. |

---

### UX-G6 — Cross-tab and embedded alert flows

| Field | Detail |
|-------|--------|
| **Violated rules** | None codified (system gap) |
| **Impacted modules** | Debts — `renderOverdueObligationsSection()` navigates to obligations tab |
| **Issue** | Alert surface uses `<details>` list, not display item architecture; cross-tab jump behavior undefined in UX rules. |
| **Unified direction** | Add UX rule for cross-tab navigation and alert blocks (or exempt debts overdue block as intentional). Ensures future alert UIs follow one pattern. P1 if product treats debts tab alerts as core flow; otherwise P2 rulebook addendum. |

---

### UX-G7 — Display mode interaction edge cases

| Field | Detail |
|-------|--------|
| **Violated rules** | UX-9 (open question) |
| **Impacted modules** | All display-mode modules |
| **Issue** | Detail closes on mode change within module; behavior on tab switch undecided. |
| **Unified direction** | Document and implement consistent policy: tab switch closes detail or preserves — pick one, add to UX-9, verify `displayMode.js` and tab render respect it. Low priority relative to action visibility fixes. |

---

## 5. ARCHITECTURE ALIGNMENT PLAN (P0/P1)

---

### ARCH-G1 — Snapshot-only persistence (P0)

| Priority | P0 |
|----------|-----|
| **Rules** | ARCH-1, ARCH-3, ARCH-4, ARCH-6 |
| **Scope** | Remove legacy write path (P0-1); verify all pushes target `household_snapshots` via `SNAPSHOT_ID` |
| **Direction** | Single pipeline: mutate state → saveState → merge → push. Experiment never writes `shared`. Confirm account creation does not depend on legacy table IDs for sync correctness. |

---

### ARCH-G2 — localStorage vs Supabase boundary (P1)

| Priority | P1 |
|----------|-----|
| **Rules** | ARCH-2, UX-8 |
| **Scope** | Financial cache keys vs display preference keys |
| **Direction** | Document and verify: only `*DisplayMode` keys and UI prefs in localStorage without sync; all financial entities from snapshot payload. Guard against future modules writing prefs to snapshot. Optional: naming convention lint for localStorage keys. |

---

### ARCH-G3 — Finance gate as mandatory mutation layer (P0 audit / P1 closure)

| Priority | P0 audit, P1 enforcement |
|----------|-----|
| **Rules** | ARCH-5, ARCH-6, P0 |
| **Scope** | All user-initiated mutations; `LEGACY_SAFE_OPERATIONS` retirement |
| **Direction** | Complete mutation inventory (P0-4). Ensure UI handlers never mutate financial fields without calling gate exports. Retire exceptions with dates. Keep `FINANCE_ENFORCEMENT_MODE` true in experiment; consider dev-only bypass if needed, not production silence. |

---

### ARCH-G4 — Display layer purity (P1)

| Priority | P1 |
|----------|-----|
| **Rules** | ARCH-7, P-UI |
| **Scope** | `displayMode.js`, module render functions |
| **Direction** | Confirm display layer never calls Supabase, never changes snapshot IDs, never alters merge semantics. Card renderers read state and format only; business calculations stay in `financeEngine.js` / gate. Debts UI normalization must not embed balance math for persistence. |

---

### ARCH-G5 — Module consistency requirement (P1)

| Priority | P1 |
|----------|-----|
| **Rules** | ARCH-8, UI-8 |
| **Scope** | Five entity modules |
| **Direction** | Each module must register `DISPLAY_MODULE_KEYS`, use `renderDisplayItem` / `renderDisplaySummary`, dedicated localStorage display key. Debts sub-sections (three types + overdue block) need rulebook clarification for multi-section layout vs ARCH-8 single-toolbar assumption — document before restructuring debts page layout. |

---

### ARCH-G6 — Analytics read model separation (P2)

| Priority | P2 |
|----------|-----|
| **Rules** | System gap — candidate new ARCH rule |
| **Scope** | `analyticsReadModel.js`, `stats.js` |
| **Direction** | Codify: Stats tab reads derived aggregates via read model; must not mutate state or bypass gate for writes. Stats rendering policy tied to UX-G5 for obligation status.display. |

---

### ARCH-G7 — Merge conflict and offline behavior (P2)

| Priority | P2 |
|----------|-----|
| **Rules** | ARCH open questions |
| **Scope** | `mergeSharedSnapshots`, failed push retry |
| **Direction** | Document user-visible merge behavior and offline push semantics in architecture rules. Not blocking UI compliance but required for production maturity before main merge. |

---

## 6. IMPLEMENTATION ORDER (IMPORTANT)

Strict execution sequence. Do not reorder P0 ahead of UI work if data integrity is at risk — architecture first.

---

### Step 1 — Critical architecture fixes (P0)

**Objective:** Single source of truth; no parallel remote writes.

| Order | Work item | Plan ref | Exit criterion |
|-------|-----------|----------|----------------|
| 1.1 | Remove `persistAccountToSupabase` and legacy insert from account creation flow | P0-1, ARCH-G1 | No UI module imports Supabase for writes; account create uses gate + snapshot push only |
| 1.2 | Supabase import audit — restrict to `stateRemote.js` | P0-2 | Documented allowlist; zero direct table writes from modules |
| 1.3 | Legacy `accounts` table deprecation policy written | P0-3 | Architecture addendum states snapshot-only persistence |
| 1.4 | Finance mutation path inventory | P0-4, ARCH-G3 | Spreadsheet or doc listing every mutation handler + gate status + exception retirement |

**Gate:** Step 2 must not start until 1.1 and 1.2 are complete.

---

### Step 2 — UI normalization layer (P1)

**Objective:** All entity cards follow same summary, formatting, and action markup contracts.

| Order | Work item | Plan ref | Exit criterion |
|-------|-----------|----------|----------------|
| 2.1 | Consolidate money formatters — modules import `formatFullMoney` / `formatUiMoney` from shared module | UI-G2, P0 spirit | No duplicate local `formatMoney` in entity modules (except transitional re-exports) |
| 2.2 | Debts card summary restructure — dedupe + `formatUiMoney` | UI-G1, UI-G2, UI-G5 | Debts passes UI-1/UI-2/UI-3 audit |
| 2.3 | Savings progress deduplication | UI-G1 | Progress appears once per card |
| 2.4 | Categories action class adoption | UI-G3, UX-G1 | Compact mode hides edit/menu; reserve/unreserve visible in list |
| 2.5 | Obligations action class adoption | UI-G3, UX-G1 | Same as categories pattern |
| 2.6 | Debts icons + action header (after UX-G2 decision on list primary action) | UI-G4, UI-G5, UX-G2 | Debts uses `renderUiIcon`; action row follows class contract |
| 2.7 | Optional: shared action-button builder in display layer | Missing enforcement | New modules cannot omit action classes |

**Gate:** Re-run rule audit sections 2–3 for entity modules; target zero hard violations in accounts–obligations–savings–categories–debts.

---

### Step 3 — UX consistency layer (P1)

**Objective:** Align interaction semantics and cross-surface policies.

| Order | Work item | Plan ref | Exit criterion |
|-------|-----------|----------|----------------|
| 3.1 | Rulebook update: primary action matrix (+ / ⇄ / reserve / debts) | UX-G2 | Written per-module primary action table |
| 3.2 | Rulebook update: delete pattern (⋮ vs trash) | UX-G3 | Explicit standard or documented exceptions |
| 3.3 | Rulebook update: obligation status in Stats vs cards | UX-G5 | UX-10 scope clarified |
| 3.4 | Align Stats obligations renderer to UX-10 policy | UX-G5 | No policy conflict between tabs |
| 3.5 | Progressive disclosure audit on all `detailHtml` | UX-G4 | No repeated primary metrics in detail |
| 3.6 | Cross-tab alert / debts overdue block rule | UX-G6 | Documented in UX or architecture rules |
| 3.7 | Display mode + tab switch behavior | UX-G7 | Documented and consistent |

**Gate:** UX open questions reduced; interaction matrix in rulebook matches implementation.

---

### Step 4 — Optional improvements (P2)

**Objective:** Maturity, enforcement tooling, and scope extensions — not required for core entity compliance.

| Order | Work item | Plan ref |
|-------|-----------|----------|
| 4.1 | Header totals formatting decision + alignment | UI-G6 |
| 4.2 | Stats/History display mode scope decision | UI-G7 |
| 4.3 | Analytics read model architecture rule | ARCH-G6 |
| 4.4 | Merge conflict / offline push UX | ARCH-G7 |
| 4.5 | Profile, exchange rate, misc category, modal layer rules | Audit §5 system gaps |
| 4.6 | Accessibility and keyboard conventions | Audit §5 |
| 4.7 | CI/review checks: no supabase in modules, action class presence | Missing enforcement |
| 4.8 | Finance gate exception retirement | ARCH-G3 |

---

### Dependency diagram (summary)

```text
Step 1 (P0 ARCH)
    ↓
Step 2 (P1 UI) ──requires──► UX-G2 decision for debts list actions (can parallel rulebook write)
    ↓
Step 3 (P1 UX) ──requires──► Step 2 complete + rulebook decisions 3.1–3.3
    ↓
Step 4 (P2 optional)
```

---

## 7. SYSTEM DESIGN INSIGHT

### Why these violations exist

1. **Incremental migration** — The app moved from legacy Supabase tables and per-module rendering to snapshot architecture and shared display modes. Accounts received the most recent cleanup; debts and the legacy account insert were not fully migrated.

2. **CSS contract without API enforcement** — Display mode action visibility relies on developers adding the correct CSS classes. Categories and obligations were integrated into `renderDisplayItem` before the action-class split was finalized, so they render actions but opt out of the contract unintentionally.

3. **Rulebook ahead of edge-case decisions** — Debts compact actions, Stats badge policy, header formatting, and History/Stats display modes are flagged as open questions. Implementation drift fills the vacuum (debts skipped normalization; stats kept badges).

4. **Module autonomy before system rules** — Each module historically owned its own `formatMoney`, card HTML, and action row. Shared helpers (`formatUi.js`, `uiIcons.js`, `displayMode.js`) arrived later; adoption is partial without mandatory shared builders.

5. **Architecture enforcement is runtime, not structural** — Finance gate blocking exists, but Supabase boundary and UI summary rules have no compile-time or review-time guards — violations are discovered by audit, not prevented at authoring time.

### Architectural gap that caused them

The system has **strong horizontal layers** (sync, display modes, gate) but **weak vertical contracts** between layers:

- UI modules are allowed to reach into persistence (Supabase) instead of being constrained to state + gate + saveState.
- Display modules are allowed to emit arbitrary HTML for actions instead of going through a display action API that encodes UI-7.
- No “compliance checklist” is embedded in the module template for new entity tabs.

The gap is **missing enforcement boundaries** between:

| From | To | Should be |
|------|-----|-----------|
| UI handlers | Remote DB | Forbidden except via stateRemote |
| Card renderers | Summary fields | Constrained API with dedup rules |
| Action buttons | CSS visibility | Generated with required classes |
| Analytics views | UX status policy | Shared status vocabulary helper |

### Design pattern to prevent future drift

**“Reference module + enforced facades”**

1. **Reference implementation** — `accounts.js` is the canonical entity module. New modules copy structure, not invent layout. Rulebook should state this explicitly.

2. **Facade-only persistence** — UI code may only call: `financeGate.*`, `saveState`, and read `state`. Supabase client is internal to `stateRemote.js`. Enforce via lint/import rules.

3. **Display facades** — `renderDisplaySummary({ title, meta, value, stats })` and a future `renderDisplayActions({ list: [], card: [] })` that inject classes automatically. Modules supply data, not markup strings, for actions — or markup must pass validation.

4. **Rulebook decisions before module work** — Open questions (debts «+», delete pattern, stats badges) become blocking decisions recorded in docs before implementation continues on that module.

5. **Audit as gate** — Re-run `RULE_AUDIT_REPORT` checklist before merge to main; zero P0 violations, zero hard UI violations in entity modules.

This pattern aligns with **Rule 0**: fix the system rule that allowed the problem, not the symptom on one screen.

---

## Appendix — Violation → Plan mapping

| Audit violation | Priority | Plan item |
|-----------------|----------|-----------|
| ARCH-6 / ARCH-1 legacy Supabase insert | P0 | P0-1, Step 1.1 |
| UI-1 debts remaining/paid duplication | P1 | UI-G1, Step 2.2 |
| UI-3 debts formatUiMoney | P1 | UI-G2, Step 2.2 |
| UI-7/UX-4 categories action classes | P1 | UI-G3, Step 2.4 |
| UI-7/UX-4 obligations action classes | P1 | UI-G3, Step 2.5 |
| UI-1 savings progress duplication | P1 | UI-G1, Step 2.3 |
| ARCH-5 gate audit incomplete | P0/P1 | P0-4, ARCH-G3, Step 1.4 |
| P0 parallel formatMoney | P1 | UI-G2, Step 2.1 |
| UX-10 stats badges | P1 | UX-G5, Step 3.3–3.4 |
| UI-7 debts no list actions | P1 (decision) | UX-G2, Step 2.6 |
| Header formatMoney | P2 | UI-G6, Step 4.1 |
| Stats/History display modes | P2 | UI-G7, Step 4.2 |

---

*Generated from RULE_AUDIT_REPORT — no application code was modified.*
