# Joint Finance — UI Rulebook

Rules for how information is shown. These reflect the current implemented display system.

---

## 1. No Duplicated Information

Each fact appears **once** at the summary level of a card.

**Do not show:**

- The same metric in meta, large value, and stats grid
- Currency code separately when the formatted amount already includes `₽` or `$`
- Owner name text when owner is already indicated by icon in the title (accounts)
- Repeated «Доступно» / «Лимит» / «Накоплено» labels in multiple places on the same card

**Do show:**

- Title (entity name)
- One optional meta line (context only)
- One primary value (the main number the user cares about)
- Stats grid (medium/large only) for **secondary** metrics not already shown as the primary value

---

## 2. Single Primary Value Per Card

| Module | Primary value | Meta (examples) |
|--------|---------------|-------------------|
| Accounts | Balance (`formatUiMoney`) | None required; owner via icon in title |
| Categories | Available amount | Limit + spent summary line |
| Savings | Accumulated amount | Progress % or goal status |
| Obligations | Target amount | `оплатить до …` (due phrase) |
| Debts | Remaining amount | Paid progress or category (manual debts) |

Expanded detail (`.display-item-detail`) holds actions and history — not a second copy of the primary value.

---

## 3. Money Formatting

### `formatUiMoney` — card summaries and compact display

- UI-only; never persists formatted strings
- Values ≥ 1 000 use compact suffix: `k`, `M` (e.g. `30k ₽`, `$7.5k`, `1.25M ₽`)
- Values &lt; 1 000 use full localized currency via `formatFullMoney`
- Currency symbol is **inside** the formatted amount — do not add separate `RUB` / `USD` lines

### `formatMoney` / `formatFullMoney` — precision contexts

Use full formatting in:

- Modals and forms
- Transaction history lines
- Detailed operation lists
- Anywhere exact amounts are required for user input or audit

---

## 4. Display Modes (Density, Not Meaning)

Three modes per module, toggled in section toolbar (☰ ▦ ▥):

| Mode | Icon | Purpose |
|------|------|---------|
| Compact | ☰ | List density; minimal row height |
| Medium | ▦ | Default on first launch; ~2 columns on mobile |
| Large | ▥ | Single column; more spacing |

**Rules:**

- Mode changes **layout only** — same data, same actions, same handlers
- Preference stored per module in localStorage (`accountsDisplayMode`, etc.)
- Default mode is **medium** (`DEFAULT_DISPLAY_MODE`)
- Switching is instant (CSS `data-display-mode` on root); no page reload
- Transition duration ~150–200ms

Display mode must not hide actions that exist in other modes (list-specific quick actions use `.display-list-action`; card actions use `.display-card-action`).

---

## 5. Adaptive Formatting by Space

- Compact list: truncate title/meta with ellipsis; value column capped width
- Medium cards: title clamp (2 lines); values ellipsis if overflow
- Large cards: more padding; same truncation rules to prevent boundary escape

Overflow must not break card borders on mobile.

---

## 6. Progressive Disclosure (Collapsed vs Expanded)

Every entity card uses the shared three-layer structure from `displayMode.js`:

1. **Layout** — `.display-item-summary` inside `.display-item-body`
2. **Actions** — `.display-item-actions` (always visible; position varies by mode)
3. **Interaction** — `.display-item-detail` (hidden until row/card body click)

**Rules:**

- Clicking the body toggles detail; action buttons do not trigger toggle (separate elements)
- Detail shows extra actions, history, progress bars — not duplicated summary fields
- Only one detail panel open per module root at a time (current behavior)

---

## 7. Icon Placement and Actions

### Unified icon system

- Use `renderUiIcon()` from `src/modules/uiIcons.js`
- Icons render inside `.ui-icon` (16×16); action buttons are 32×32 touch targets

### Placement by mode

- **Compact (☰):** actions inline on the right of the row; vertically centered with summary
- **Medium / Large:** actions absolute top-right of card header (`.display-item-header`)

### Action classes

| Class | When visible | Purpose |
|-------|--------------|---------|
| `.display-list-action` | Compact only | Primary quick actions (+ top up, ⇄ transfer, + deposit) |
| `.display-card-action` | Medium/Large | Edit, delete, menu icons |

### Primary «+» per entity (compact list)

- **Accounts:** `+` top up, `⇄` transfer
- **Savings:** `+` deposit (when goal not reached)
- **Categories / Obligations:** `+` / `−` reserve actions (not the same semantic «+», but primary inline actions)

### Secondary actions

- **Categories:** `⋮` menu → delete (and similar secondary items)
- **Accounts / Savings:** edit and delete as icon buttons in card modes

---

## 8. Consistent Card Structure Across Modules

All list modules (accounts, categories, savings, debts, obligations) must use:

```text
renderDisplayModeRoot(moduleKey, …)
  renderModuleToolbar(moduleKey, section actions)
  renderDisplayModeList(
    renderDisplayItem({ summaryHtml, actionsHtml, detailHtml })
  )
```

Inside `renderDisplayItem`:

- `renderDisplaySummary({ title, meta, value, statsHtml })` — single summary source
- No parallel compact + expanded DOM trees for the same fields
- Module-specific styling via `itemClass` only (e.g. overdue border on obligations)

---

## 9. Section Toolbar

Each module section includes:

- Display mode toggle (☰ ▦ ▥) on the right
- Module action button(s) next to toggle (e.g. «Добавить») when applicable

Toggle affects only that module’s `data-display-mode-root`.

---

## OPEN QUESTIONS / UNCERTAIN AREAS

- **Debts module:** no compact-list «+» quick action yet — only expand/detail; whether debts should get a list-mode primary action is undecided.
- **Stats tab:** not yet integrated into display mode system — rules above apply to the five main entity modules only.
- **Badges:** obligation status badges were removed; whether overdue should ever use a badge again vs. border/meta only is unset.
- **⋮ menu pattern:** fully standardized on categories; other modules use direct icon buttons instead of menus — intentional partial consistency.
