# Joint Finance — ACTION CONTRACT Implementation Roadmap

**Date:** 2026-06-21  
**Status:** Migration planning only — no code changes  
**Target architecture:** `UI → ACTION CONTRACTS → financeGate → State → stateRemote → Snapshot`  
**Inputs:** `FINANCE_ACTION_CONTRACTS.md`, `FINANCE_GATE_EXPANSION_DESIGN.md`, `ARCHITECTURE_ENFORCEMENT_IMPLEMENTATION_PLAN.md`, `EXECUTION_SAFETY_REPORT.md`, `ARCHITECTURE_LOCKDOWN_DESIGN.md`

**Branch context:** Active experiment work on `experiment-full-sync`; production isolation via `SNAPSHOT_ID = shared-experiment`. Do not merge to `main` until Phase 5 checklist passes.

---

## 1. EXECUTION STRATEGY OVERVIEW

### Why a full rewrite is dangerous

Joint Finance is a **working PWA** with:

- Live snapshot sync (`household_snapshots`), merge semantics, and realtime subscribe
- Five entity modules on a shared display-mode system
- Partial but functional finance gate for money-moving operations
- One legacy remote write path (L-1) that already fails open to snapshot-only behavior

A **big-bang rewrite** (replace all modules, gate, and UI in one release) would:

| Risk | Consequence |
|------|-------------|
| Undiscovered coupling | Account create, obligation delete, category misc bootstrap — subtle ordering dependencies |
| Sync regression | Merge/prefer-local behavior untested under new mutation order |
| Dual-environment bleed | Experiment vs `shared` isolation broken during rushed Supabase changes |
| Unrecoverable user data | Snapshot payload corruption without rollback checkpoints |
| False completion | UI appears fine while gate bypass paths silently remain |

The audit and execution safety reports confirm **~90% architecture alignment**. The gap is **discipline and coverage**, not a missing engine. Rewriting discards proven sync and debt-module patterns.

---

### Why incremental migration is required

Incremental migration:

1. **Preserves snapshot truth** — Each phase leaves `saveState → stateRemote → household_snapshots` working.
2. **Bounds blast radius** — One domain (e.g. categories) per PR, revertible independently.
3. **Matches partial safety** — L-1–L-5 removable independently of L-6–L-10; gate expansion independent of UI switch.
4. **Enables verification** — Manual test matrix per phase before next phase starts.
5. **Respects experiment isolation** — All risky work stays on experiment branch until Phase 5 gate.

**Principle:** Add new path → switch UI → remove old path → enforce. Never remove before replacement exists.

---

### Concept: dual system phase

During Phases 1–3, a **dual system** temporarily coexists:

```text
LEGACY PATH (being retired):
  UI → direct state mutation → optional partial gate → saveState → snapshot

CONTRACT PATH (being introduced):
  UI → ActionIntent → financeGate.dispatch → saveState → snapshot
```

Both paths converge on **one persistence pipeline** (`saveState` → `stateRemote`). There is **not** two Supabase write models in the target dual phase — only one snapshot upsert. The duality is **mutation entry**, not **remote truth**.

**Dual system rules:**

| Rule | Detail |
|------|--------|
| **Single remote arbiter** | `stateRemote` + snapshot payload always wins; no second table writes in contract path |
| **No mixed handler** | A given UI handler uses legacy OR contract, never both in one commit |
| **Module-scoped** | e.g. debts stays contract-only (already); categories may be legacy while accounts migrated |
| **Time-bounded** | Dual system ends at Phase 4; no permanent parallel mutation APIs |
| **Documented per module** | Track status: `legacy` \| `dual` \| `contract` |

Optional **early acceleration** (documented exception): L-1 legacy Supabase insert can move to Phase 2/3 end because it is **remote-only** legacy, not gate-related — see Phase 4 note. Execution safety report classifies L-1 as safe to remove without gate extensions.

---

## 2. PHASED MIGRATION PLAN

### Phase dependency graph

```text
PHASE 0 ──> PHASE 1 ──> PHASE 2 ──> PHASE 3 ──> PHASE 4 ──> PHASE 5
 freeze      contracts    gate         UI           legacy       lock
             foundation   complete     migration    removal
```

**Gate rule:** Phase N+1 starts only when Phase N exit checklist is signed off on experiment preview.

---

### PHASE 0 — SAFETY FREEZE

**Objective:** Stabilize baseline; stop scope creep; create recovery points.

| Activity | Deliverable |
|----------|-------------|
| Freeze behavioral changes unrelated to migration | Team agreement; no new features on entity modules during active phase work |
| Tag rollback checkpoint | Git tag e.g. `pre-action-contract-migration` on current HEAD |
| Confirm backup branch/tag usable | `backup-experiment-ui-clean` / `backup/experiment-full-ui-clean-2026-06-27` |
| Snapshot stability smoke test | Add account, category, obligation, saving, debt; verify payload; two-tab sync on experiment URL |
| Document module mutation inventory | List all L-1–L-10 sites (from audit) — baseline grep output archived |
| Document action contract registry (doc-only) | `FINANCE_ACTION_CONTRACTS.md` accepted as spec baseline |

**Exit criteria:**

- [ ] Tag pushed to origin
- [ ] Manual smoke test script recorded (steps + expected results)
- [ ] No open P0 bugs in sync layer
- [ ] Team agrees migration happens on `experiment-full-sync` only

**Duration guidance:** 1 session — no code required if tag + test only.

---

### PHASE 1 — ACTION CONTRACT FOUNDATION

**Objective:** Introduce action contract **structure** without removing legacy paths. Map existing working gate flows to formal action types.

| Activity | Detail |
|----------|--------|
| Define action type registry (conceptual module) | Single source listing all `ActionType` strings matching `FINANCE_ACTION_CONTRACTS.md` |
| Wrap **existing** gate exports as contract dispatches | Debts, deposit, transfer, expense, reserve, pay, undo — already 1:1; document mapping only or thin `dispatch(type, payload)` facade |
| Standardize result envelope | Ensure all existing gate exports return `{ ok, error?, … }` consistently (design review; fix only if gaps found in implementation phase) |
| Extend `FINANCE_ENTRY_POINTS` design doc | Map every existing export → action type + entry point |
| Add contract tests plan | Manual matrix: each existing gate action → expected snapshot delta |
| **NO removal** | L-1–L-10 untouched; UI still uses legacy where present |

**Deliverables (implementation phase):**

- `actionRegistry` or equivalent catalog (type → handler → entry point)
- `dispatch(state, ActionIntent)` facade over `financeGate` for **already-complete** actions
- Developer doc: how to add a new action type per contract template

**Exit criteria:**

- [ ] All **existing** financial gate exports mapped to action types (DEBT_*, ACCOUNT_DEPOSIT, etc.)
- [ ] Contract dispatch API designed for UI consumption
- [ ] Zero legacy path removal in this phase
- [ ] Debts module documented as reference `contract` module

**Dual system status after Phase 1:** Legacy dominates CRUD; contract dispatch available for already-gated ops (optional adoption).

---

### PHASE 2 — GATE COMPLETION

**Objective:** Implement missing gate orchestrators so **every action in `FINANCE_ACTION_CONTRACTS.md` Section 3** has a handler. Still no mandatory UI switch.

| Workstream | Action types | Maps to |
|------------|--------------|---------|
| **Settings** | `RATE_UPDATE` | L-10 |
| **Accounts lifecycle** | `ACCOUNT_CREATE`, `ACCOUNT_UPDATE`, `ACCOUNT_DELETE` | L-9 |
| **Categories lifecycle** | `CATEGORY_CREATE`, `CATEGORY_UPDATE`, `CATEGORY_DELETE` (full orchestrator) | L-6 |
| **Savings lifecycle** | `SAVING_CREATE`, `SAVING_UPDATE`, `SAVING_DELETE` (full orchestrator) | L-8 |
| **Obligations lifecycle** | `OBLIGATION_CREATE`, `OBLIGATION_UPDATE`, `OBLIGATION_DELETE` | L-7 |

**Per-action implementation order (lowest coupling first):**

```text
1. RATE_UPDATE
2. ACCOUNT_CREATE → ACCOUNT_UPDATE → ACCOUNT_DELETE
3. OBLIGATION_CREATE → OBLIGATION_UPDATE → OBLIGATION_DELETE
4. CATEGORY_CREATE → CATEGORY_UPDATE → CATEGORY_DELETE
5. SAVING_CREATE → SAVING_UPDATE → SAVING_DELETE
```

**Technical requirements (from contracts):**

- Validation phases V0–V3 before mutation
- Entity lifecycle owned inside gate (IDs generated in gate)
- Journal rows per contract; new tx types where specified (`obligation_deleted`, `exchange_rate_updated`, etc.)
- `enforceFinancialInvariants` after every success path
- Record-only exports (`createAccount` tx-only) demoted to internal — not UI-facing

**Optional acceleration at Phase 2 end:**

- Remove **L-1–L-5** (legacy Supabase `accounts` insert) once `ACCOUNT_CREATE` contract handler exists and is tested via **direct gate invocation** (even before UI switch). Rationale: eliminates only parallel **remote** write; does not require UI migration. Document as Phase 2.5 if executed early.

**Exit criteria:**

- [ ] All Section 3 action types have gate handlers
- [ ] All handlers registered in entry point registry
- [ ] Manual gate-only tests pass for each new action (call dispatch without UI)
- [ ] `FINANCE_ENFORCEMENT_MODE` remains true
- [ ] Legacy UI paths still work (dual system) OR early L-1 removal completed with account create tested via gate

**Dual system status after Phase 2:** Gate can perform full lifecycle; UI may still call legacy — **two mutation entries, one snapshot out**.

---

### PHASE 3 — UI → ACTION MIGRATION

**Objective:** Replace direct state mutations in UI with `dispatch(ActionIntent)`. Render layer read-only for shared fields.

| Module order | Rationale |
|--------------|-----------|
| 1. **Accounts** | Reference module; includes RATE_UPDATE input |
| 2. **Obligations** | Delete audit gap fixed in Phase 2 |
| 3. **Categories** | High traffic; menu delete pattern |
| 4. **Savings** | Partial gate familiarity |
| 5. **History** (optional) | `TRANSACTION_UNDO` already gated; meta edit optional |

**Debts:** Already compliant — verify mapping to contract dispatch; no structural change expected.

**Per-module migration steps:**

1. Replace handler body: validate form → build payload → `dispatch` → on `ok` refresh/`onStateChange`
2. Delete local `createX` / `updateX` / `state.*.push` / `filter` functions
3. Grep module for forbidden patterns (see Phase 5)
4. Run module manual test matrix
5. Update module status: `legacy` → `contract`

**UI mapping enforcement (from contracts Section 5):**

- `+` → financial primary action, not CREATE
- ✎ → `*_UPDATE`
- trash / ⋮ delete → `*_DELETE`
- toolbar «Добавить» → `*_CREATE`

**Render layer rules:**

- No gate calls in render
- No state mutation in render
- Buttons: `data-action` + entity IDs only

**Exit criteria:**

- [ ] Zero direct shared-field mutation in migrated module handlers
- [ ] All user commits map 1:1 to action types
- [ ] Experiment preview full regression pass
- [ ] Module status table: all entity modules `contract`

**Dual system status after Phase 3:** Legacy mutation code removed from UI; gate-only entry for user actions.

---

### PHASE 4 — LEGACY REMOVAL (L-1 → L-10)

**Objective:** Remove all legacy paths; no fallback dependencies; single mutation engine.

| ID | Removal | Prerequisite |
|----|---------|--------------|
| **L-1** | `persistAccountToSupabase` | Phase 3 accounts migration OR Phase 2.5 early removal |
| **L-2** | `remoteId` option | With L-1 |
| **L-3** | async legacy await in submit | With L-1 |
| **L-4** | debug logging | With L-1 |
| **L-5** | `DEFAULT_HOUSEHOLD_ID` | With L-1 |
| **L-6** | UI category CRUD remnants | Phase 3 categories complete |
| **L-7** | UI obligation CRUD remnants | Phase 3 obligations complete |
| **L-8** | UI saving CRUD remnants | Phase 3 savings complete |
| **L-9** | UI account orchestration remnants | Phase 3 accounts complete |
| **L-10** | inline `state.exchangeRate =` | Phase 3 accounts complete |

**Additional cleanup:**

- Remove `supabase` import from `accounts.js`
- Review `app.js` supabase side-effect import (L-13)
- Demote internal record-only functions to non-exported
- Retire or schedule `LEGACY_SAFE_OPERATIONS` entries

**Verification:**

- Grep: no `supabase.from` outside `stateRemote.js`
- Grep: no `state.{accounts|categories|…|exchangeRate}` mutation in `src/modules/`
- Add account end-to-end: gate → snapshot only, no legacy network call

**Exit criteria:**

- [ ] L-1–L-10 fully removed
- [ ] EXECUTION_SAFETY_REPORT ARCH-6 violation closed
- [ ] No fallback to legacy insert documented or coded

**Dual system status after Phase 4:** **Ended** — contract path only.

---

### PHASE 5 — ENFORCEMENT LOCK

**Objective:** Make regression **impossible to merge** without explicit override.

| Mechanism | Type | When enabled |
|-----------|------|--------------|
| CI grep: `supabase.from` only in `stateRemote.js` | Static | Phase 5 start |
| CI grep: no `supabase` import in `src/modules/` | Static | Phase 5 start |
| CI grep: forbidden `state.*` mutation patterns in UI modules | Static | After Phase 4 |
| PR template architecture checklist | Process | Phase 5 start |
| Entry point registry diff review | Process | Ongoing |
| Optional dev runtime: gate context assert | Runtime | Optional |
| Re-run RULE_AUDIT_REPORT | Verification | Before main merge |
| Update `30_ARCHITECTURE_RULES.md` → LOCKED reference | Docs | Phase 5 end |
| Declare lock date + commit SHA | Docs | Phase 5 end |

**Exit criteria:** See Section 6 checklist — all items satisfied.

---

## 3. DUAL SYSTEM STRATEGY (IMPORTANT)

### Safe coexistence model

```text
                    ┌─────────────────────────────────┐
                    │         saveState(state)        │
                    │              ↓                  │
                    │     stateRemote → snapshot      │
                    │      (single remote truth)      │
                    └─────────────────────────────────┘
                                    ↑
              ┌─────────────────────┴─────────────────────┐
              │                                           │
    LEGACY mutation entry                    CONTRACT mutation entry
    (Phase 1–3 per module)                   (Phase 1–5 expanding)
              │                                           │
    UI direct state.*                         UI → dispatch(ActionIntent)
    optional partial gate                     financeGate full orchestrator
```

**Key invariant during dual phase:** Both paths must produce **valid snapshot payloads** that pass `exportSharedSnapshot` + merge. The gate path is stricter; legacy path must not be removed until contract path reproduces same observable behavior.

---

### Temporary synchronization (not dual remote write)

| Concern | Strategy |
|---------|----------|
| **Same entity edited two ways** | **Forbidden** — one module in one mode at a time; no handler calls both paths |
| **Account create: legacy Supabase + snapshot** | L-1 creates parallel remote row; **not synchronized** with snapshot — reason to prioritize L-1 removal (Phase 2.5 or 4) |
| **Local state after action** | Whichever path runs last before `saveState` wins locally; then push |
| **Remote conflict** | `mergeSharedSnapshots` + prefer-local rules — **stateRemote is arbiter** on pull |
| **Two devices** | Realtime subscribe → merge → re-render; no client-side dual write to Supabase |

**stateRemote as arbiter:**

- Inbound: remote snapshot merged into local state — not overwritten blindly
- Outbound: full payload upsert — no partial field PATCH
- On conflict: merge rules in `storage.js` — document test cases before Phase 3

**Conflict resolution testing (required before Phase 3):**

1. Device A: contract action → push
2. Device B: offline legacy action (if any module not migrated) → push
3. Verify merge outcome documented — if unacceptable, complete module migration before multi-device test

---

### Module status tracking (recommended)

Maintain a table in PR descriptions until Phase 4 complete:

| Module | Phase 0 | Phase 2 | Phase 3 | Phase 4 |
|--------|---------|---------|---------|---------|
| debts | contract | contract | contract | contract |
| accounts | legacy | dual (gate ready) | contract | contract |
| obligations | legacy | dual | contract | contract |
| categories | legacy | dual | contract | contract |
| savings | legacy | dual | contract | contract |
| history | partial | partial | partial | partial |

---

## 4. RISK CONTROL MATRIX

### High-risk modules (extra care, ordered migration)

| Module | Risk | Mitigation |
|--------|------|------------|
| **accounts.js** | L-1 legacy Supabase; L-9 split create; exchange rate; transfer/deposit coupling | Migrate after Phase 2 gate complete; consider early L-1 removal; extensive manual tests |
| **obligations.js** | Delete had no audit tx; pay/reserve chains | Phase 2 delete contract with reserve release; test pay → delete edge cases |
| **categories.js** | Misc category system rules; delete releases reserve | Test misc immutability; delete with reserved > 0 |
| **savings.js** | single_use spend → chained delete (LEGACY_SAFE) | Do not refactor chain until contract delete stable |
| **stateRemote.js** | Single remote I/O | **Must-not-change behavior** during Phases 1–3 except bugfixes |
| **storage.js** | Merge semantics | No merge rule changes during migration without dedicated phase |

---

### Safe-to-change modules (early candidates)

| Module | Reason |
|--------|--------|
| **debts.js** | Already full gate; map to contract dispatch only |
| **displayMode.js** | Not in mutation scope |
| **formatUi.js / uiIcons.js** | Read-only helpers |
| **stats.js / analyticsReadModel.js** | Read-only |
| **financeGate.js / transactions.js** | Primary implementation venue for Phases 1–2 — change with tests |

---

### Must-not-touch until Phase 3 (behavior freeze)

| Area | Reason |
|------|--------|
| **Merge / sync semantics** (`mergeSharedSnapshots`, pull logic) | Until action mutations stable — avoids blaming sync for gate bugs |
| **Experiment seed bootstrap** | Isolation-critical |
| **`SNAPSHOT_ID` / environment.js** | No environment switch during migration |
| **Display mode CSS/HTML structure** | Unrelated; scope creep risk |
| **main branch / production `shared`** | No merge until Phase 5 |
| **Supabase schema** | Out of scope; snapshot payload shape frozen |

**Allowed before Phase 3:** Phase 0 tag; Phase 1–2 gate additions; direct gate testing; optional L-1 removal after ACCOUNT_CREATE gate tested.

---

## 5. ROLLBACK STRATEGY

### Checkpoints per phase

| Phase | Checkpoint artifact | Rollback action |
|-------|---------------------|-----------------|
| **0** | Tag `pre-action-contract-migration` | Reset branch to tag |
| **1** | PR merge commit(s) for contract facade | Revert Phase 1 PR(s) — no user-visible change if UI untouched |
| **2** | Per-domain gate PRs | Revert failing domain PR; other domains unaffected |
| **3** | Per-module UI PRs | Revert module PR → module returns to legacy handlers |
| **4** | Legacy removal PR | Revert restores L-1–L-10 — **avoid** reverting to L-1 as "fix"; fix forward |
| **5** | CI config PR | Disable new checks temporarily; fix forward |

**Always available:** `backup-experiment-ui-clean` tag / branch at `7bb38b3` (pre-migration UI baseline).

---

### Restoring snapshot consistency after rollback

| Scenario | Action |
|----------|--------|
| Bad gate action corrupted local state | Reload from localStorage; if needed pull remote snapshot (stateRemote arbiter) |
| Bad push affected remote experiment snapshot | Restore payload from Supabase dashboard backup OR re-seed from `shared` if experiment disposable |
| Rollback mid-Phase 3 (mixed modules) | Accept mixed legacy/contract modules — both write valid snapshots if handlers correct; document module table |
| Rollback after L-1 removal | Do **not** re-add legacy insert; fix account create in gate path |

**Data corruption prevention:**

- Never force-push experiment snapshot without backup
- Test destructive actions on disposable experiment data first
- `resetAllData` + clear remote only on test environments

---

### Revert without data corruption rules

1. **Revert code, not data** — prefer git revert over manual state edits
2. **Pull after revert deploy** — let merge reconcile local with remote
3. **Never revert by writing legacy `accounts` table** — not part of snapshot model
4. **If invariants fail after deploy** — stop Phase progression; hotfix gate validation, do not bypass with UI mutation

---

## 6. FINAL TARGET STATE CONFIRMATION

System migration is **complete** when all conditions below are true.

### Architecture

- [ ] **A-1** Flow is `UI → ACTION CONTRACTS → financeGate → State → stateRemote → Snapshot`
- [ ] **A-2** All user mutations of shared snapshot fields use `dispatch(ActionIntent)`
- [ ] **A-3** financeGate is the **only** mutation engine for shared fields
- [ ] **A-4** stateRemote is the **only** Supabase client usage for financial data
- [ ] **A-5** No legacy writes (L-1–L-10 eliminated)
- [ ] **A-6** Dual system phase ended — no UI direct `state.*` mutation

### Action contracts

- [ ] **C-1** Every action in `FINANCE_ACTION_CONTRACTS.md` Section 3 implemented and registered
- [ ] **C-2** Every UI user commit maps 1:1 to exactly one action type
- [ ] **C-3** All actions satisfy atomic execution rule (validation → mutate → journal → invariants)
- [ ] **C-4** System invariants INV-1–INV-19 hold after manual full regression

### Snapshot determinism

- [ ] **S-1** `exportSharedSnapshot(state)` matches observable UI state after any action sequence
- [ ] **S-2** Two-device sync test passes on experiment snapshot
- [ ] **S-3** No parallel remote persistence paths
- [ ] **S-4** Experiment isolation verified — only `shared-experiment` written on experiment branch

### Enforcement

- [ ] **E-1** CI static guards active (Supabase boundary, mutation patterns)
- [ ] **E-2** PR checklist required for architecture-touching changes
- [ ] **E-3** RULE_AUDIT_REPORT re-run — zero P0 violations
- [ ] **E-4** EXECUTION_SAFETY gate completeness → COMPLETE
- [ ] **E-5** Architecture docs updated to LOCKED status with date + SHA

### Declaration template

```text
ACTION CONTRACT MIGRATION: COMPLETE
Date:
Commit:
Branch: experiment-full-sync (ready for main merge review)
Model: UI → ACTION CONTRACTS → financeGate → State → stateRemote → Snapshot
Dual system: OFF
Legacy L-1–L-10: REMOVED
```

---

## Appendix A — Phase timeline (suggested, not mandatory)

| Phase | Suggested focus | Parallel work |
|-------|-----------------|---------------|
| 0 | 1 day | Tag + smoke test |
| 1 | 2–3 days | Registry + dispatch facade for existing actions |
| 2 | 1–2 weeks | Gate orchestrators per domain |
| 3 | 1–2 weeks | UI module-by-module |
| 4 | 2–3 days | Legacy deletion + grep verification |
| 5 | 2–3 days | CI + audit + lock declaration |

Total: **~3–5 weeks** careful experiment-branch work before main merge consideration.

---

## Appendix B — Document chain

| Document | Role in roadmap |
|----------|-----------------|
| `FINANCE_ACTION_CONTRACTS.md` | What each action must do — Phase 1–2 spec |
| `FINANCE_GATE_EXPANSION_DESIGN.md` | Gate extensions — Phase 2 scope |
| `EXECUTION_SAFETY_REPORT.md` | L-1 early removal option; go/no-go |
| `ARCHITECTURE_ENFORCEMENT_IMPLEMENTATION_PLAN.md` | Overlapping phase detail — use this roadmap as master sequence |
| `RULE_AUDIT_REPORT.md` | Phase 5 verification baseline |
| **This document** | Master implementation sequence |

---

## Appendix C — PR sizing guide

| PR type | Max scope | Example |
|---------|-----------|---------|
| Gate addition | 1–3 action types | `RATE_UPDATE` + tests |
| UI migration | 1 module | `categories.js` → contract only |
| Legacy removal | L-1–L-5 OR one L-6–L-10 domain | Remove Supabase insert |
| Enforcement | CI rules only | Grep guards |

Avoid PRs that combine Phase 2 gate work + Phase 3 UI switch + Phase 4 removal.

---

*Implementation roadmap — no application code was modified.*
