# Joint Finance — UX Principles

Interaction and cognitive design rules derived from current behavior. Not a redesign brief.

---

## 1. Progressive Disclosure

Users see a **summary first**, details on demand.

- Summary answers: «What is this?» and «What is the key number?»
- Detail answers: «What can I do?» and «What happened recently?»

Expanding a card must **reveal** information or actions, not repeat the summary in different words.

Collapsing returns to the same summary state without data loss.

---

## 2. Minimal Cognitive Load

Each card row or tile should require at most:

- One glance at title + primary value
- Optional one-line meta for context

Avoid:

- Multiple labels for the same metric
- Status badge + meta + stats all saying similar things
- Long unbroken number strings on mobile when compact format suffices

Prefer one clear hierarchy:

**Title → meta (optional) → primary value → (expand for more)**

---

## 3. Consistent Interaction Patterns

The same gesture means the same thing everywhere:

| Interaction | Behavior |
|-------------|----------|
| Tap card body (not action icon) | Toggle detail panel |
| Tap `+` / `⇄` in list mode | Open existing modal/action for that entity |
| Tap edit / delete icons | Same modals as before display mode refactor |
| Tap ☰ ▦ ▥ | Change density for current module only |

Users should not relearn patterns per tab.

---

## 4. Muscle Memory — Actions in Fixed Places

**Compact list mode:**

- Primary actions on the **right** of the row
- Amount on the **right** of the text block (before actions)
- Title on the **left**

**Medium / large card mode:**

- Action icons **top-right** of the card
- Primary value below title/meta, left-aligned in card body

Changing display mode must not move actions to unrelated areas (e.g. bottom of card for edit/delete).

---

## 5. Fast Access to Primary Actions

Financial tasks users do often must stay one tap away in list mode:

- Top up account
- Transfer between accounts
- Deposit to savings goal

These use existing `data-action` handlers and modals — display layer only exposes them via `.display-list-action`.

Secondary or destructive actions (delete, menu items) remain icon or menu access, not competing with primary «+» placement.

---

## 6. Secondary Actions in Menu or Icon Row

Low-frequency or destructive actions:

- Delete category → `⋮` menu (categories)
- Delete account / saving → trash icon in card modes
- Edit → pencil icon

Do not put destructive actions as the largest or leftmost control.

---

## 7. Expand = More, Not Duplicate

When detail opens, user expects:

- Operation buttons (popolnить, перевести, оплатить, etc.)
- History / progress / warnings not shown in summary

User does **not** expect to see the same balance or «накоплено» again in smaller text.

---

## 8. Display Mode as Personal Preference

Density preference is per device, per module — not shared in Supabase.

Family members may prefer different layouts on different phones; that must not affect shared financial data.

First visit defaults to **medium cards** for familiarity; user can switch and preference persists locally.

---

## 9. Feedback and Safety

- Modals confirm destructive operations (existing confirm dialogs — not changed by display system)
- Display mode switch is immediate visual feedback (toggle pressed state + layout CSS)
- No full page reload for layout changes — preserves tab and scroll context

---

## 10. Language and Clarity (Obligations Example)

Due dates use plain phrasing:

- **Good:** `оплатить до 10 июля`
- **Avoid:** duplicated prepositions (`до до`), redundant status labels that repeat the date

Overdue state: communicated via card border/color and meta prefix `просрочено ·`, not a separate unclear badge.

---

## OPEN QUESTIONS / UNCERTAIN AREAS

- Whether detail panels should auto-close when switching tabs or display modes — current behavior closes detail on mode change within a module only.
- Keyboard / accessibility conventions for expand/collapse — not fully specified yet.
- Uniformity of Russian copy across all modules (some labels predate UI rulebook).
- Whether list mode should show edit/delete or only primary actions — currently list hides `.display-card-action`.
