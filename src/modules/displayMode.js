export const DISPLAY_MODES = {
  COMPACT: 'compact',
  MEDIUM: 'medium',
  LARGE: 'large'
};

export const DEFAULT_DISPLAY_MODE = DISPLAY_MODES.MEDIUM;

export const DISPLAY_MODULE_KEYS = {
  ACCOUNTS: 'accounts',
  CATEGORIES: 'categories',
  SAVINGS: 'savings',
  DEBTS: 'debts',
  OBLIGATIONS: 'obligations'
};

const MODULE_STORAGE_KEYS = {
  [DISPLAY_MODULE_KEYS.ACCOUNTS]: 'accountsDisplayMode',
  [DISPLAY_MODULE_KEYS.CATEGORIES]: 'categoriesDisplayMode',
  [DISPLAY_MODULE_KEYS.SAVINGS]: 'savingsDisplayMode',
  [DISPLAY_MODULE_KEYS.DEBTS]: 'debtsDisplayMode',
  [DISPLAY_MODULE_KEYS.OBLIGATIONS]: 'obligationsDisplayMode'
};

let displayModeSystemReady = false;

function isValidMode(mode) {
  return mode === DISPLAY_MODES.COMPACT
    || mode === DISPLAY_MODES.MEDIUM
    || mode === DISPLAY_MODES.LARGE;
}

export function getDisplayModeStorageKey(moduleKey) {
  return MODULE_STORAGE_KEYS[moduleKey] ?? `joint-finance-display-mode-${moduleKey}`;
}

export function getDisplayMode(moduleKey) {
  try {
    const stored = localStorage.getItem(getDisplayModeStorageKey(moduleKey));
    if (isValidMode(stored)) {
      return stored;
    }
  } catch {
    // ignore localStorage errors
  }
  return DEFAULT_DISPLAY_MODE;
}

export function setDisplayMode(moduleKey, mode) {
  if (!isValidMode(mode)) {
    return;
  }
  try {
    localStorage.setItem(getDisplayModeStorageKey(moduleKey), mode);
  } catch {
    // ignore localStorage errors
  }
}

export function renderDisplayModeToggle(moduleKey, currentMode = getDisplayMode(moduleKey)) {
  const modes = [
    { id: DISPLAY_MODES.COMPACT, label: '☰', title: 'Компактный список' },
    { id: DISPLAY_MODES.MEDIUM, label: '▦', title: 'Средние карточки' },
    { id: DISPLAY_MODES.LARGE, label: '▥', title: 'Крупные карточки' }
  ];

  return `
    <div
      class="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 display-mode-toggle"
      data-display-mode-toggle="${moduleKey}"
      role="group"
      aria-label="Режим отображения"
    >
      ${modes.map((mode) => {
        const active = currentMode === mode.id;
        return `
          <button
            type="button"
            data-action="set-display-mode"
            data-display-module="${moduleKey}"
            data-display-mode="${mode.id}"
            title="${mode.title}"
            aria-pressed="${active ? 'true' : 'false'}"
            class="px-2.5 py-1.5 text-sm rounded-md transition-all duration-150 ${active ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}"
          >${mode.label}</button>
        `;
      }).join('')}
    </div>
  `;
}

export function renderModuleToolbar(moduleKey, actionsHtml = '') {
  return `
    <div class="flex flex-wrap items-center gap-2 shrink-0">
      ${renderDisplayModeToggle(moduleKey)}
      ${actionsHtml}
    </div>
  `;
}

export function renderDisplayModeRoot(moduleKey, innerHtml) {
  const mode = getDisplayMode(moduleKey);
  return `
    <div data-display-mode-root="${moduleKey}" data-display-mode="${mode}" class="display-mode-root">
      ${innerHtml}
    </div>
  `;
}

export function renderDisplayModeList(innerHtml) {
  return `<div class="display-mode-list">${innerHtml}</div>`;
}

/** Layout layer: single summary source styled per display mode via CSS. */
export function renderDisplaySummary({ title, meta = '', value = '', statsHtml = '', badgesHtml = '' }) {
  return `
    <div class="display-item-summary">
      <div class="display-item-head min-w-0">
        ${badgesHtml ? `<div class="display-item-badges">${badgesHtml}</div>` : ''}
        <h3 class="display-item-title">${title}</h3>
        ${meta ? `<p class="display-item-meta">${meta}</p>` : ''}
      </div>
      ${statsHtml ? `<div class="display-item-stats">${statsHtml}</div>` : ''}
      ${value ? `<div class="display-item-value-wrap"><span class="display-item-value">${value}</span></div>` : ''}
    </div>
  `;
}

/**
 * Three-layer item shell:
 * - layout: summary inside .display-item-body
 * - actions: .display-item-actions (always visible)
 * - interaction: .display-item-detail (toggle on body click)
 */
export function renderDisplayItem({
  moduleKey,
  itemId,
  dataAttr,
  dataValue,
  summaryHtml,
  actionsHtml = '',
  detailHtml = '',
  itemClass = ''
}) {
  return `
    <article
      class="display-item ${itemClass}"
      ${dataAttr}="${escapeAttr(dataValue)}"
      data-display-item
      data-display-item-id="${escapeAttr(itemId)}"
    >
      <div class="display-item-shell">
        <div class="display-item-header">
        <button
          type="button"
          class="display-item-body"
          data-action="toggle-display-detail"
          data-display-module="${moduleKey}"
          data-display-item-id="${escapeAttr(itemId)}"
          aria-expanded="false"
        >
          ${summaryHtml}
        </button>
        ${actionsHtml ? `<div class="display-item-actions">${actionsHtml}</div>` : ''}
        </div>
      </div>
      ${detailHtml ? `
        <div
          class="display-item-detail"
          data-display-detail
          data-display-item-id="${escapeAttr(itemId)}"
          hidden
        >${detailHtml}</div>
      ` : ''}
    </article>
  `;
}

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function updateToggleState(container, moduleKey, mode) {
  container.querySelectorAll(`[data-display-mode-toggle="${moduleKey}"] [data-display-mode]`).forEach((button) => {
    const active = button.dataset.displayMode === mode;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.classList.toggle('bg-white', active);
    button.classList.toggle('text-primary-700', active);
    button.classList.toggle('shadow-sm', active);
    button.classList.toggle('text-slate-500', !active);
  });
}

function closeAllDisplayDetails(container) {
  if (!container) {
    return;
  }
  container.querySelectorAll('[data-display-detail]').forEach((detail) => {
    detail.hidden = true;
    detail.classList.remove('is-open');
  });
  container.querySelectorAll('[data-action="toggle-display-detail"]').forEach((button) => {
    button.setAttribute('aria-expanded', 'false');
  });
  container.querySelectorAll('.display-item-open').forEach((item) => {
    item.classList.remove('display-item-open');
  });
}

function toggleDisplayDetail(button) {
  const article = button.closest('.display-item');
  const detail = article?.querySelector('[data-display-detail]');
  if (!article || !detail) {
    return;
  }

  const willOpen = detail.hidden;
  const root = article.closest('[data-display-mode-root]');
  if (root) {
    root.querySelectorAll('[data-display-detail]').forEach((other) => {
      if (other !== detail) {
        other.hidden = true;
        other.classList.remove('is-open');
      }
    });
    root.querySelectorAll('[data-action="toggle-display-detail"]').forEach((otherBtn) => {
      if (otherBtn !== button) {
        otherBtn.setAttribute('aria-expanded', 'false');
      }
    });
    root.querySelectorAll('.display-item-open').forEach((item) => {
      if (item !== article) {
        item.classList.remove('display-item-open');
      }
    });
  }

  detail.hidden = !willOpen;
  detail.classList.toggle('is-open', willOpen);
  button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  article.classList.toggle('display-item-open', willOpen);
}

export function applyDisplayMode(container, moduleKey, mode) {
  if (!container || !isValidMode(mode)) {
    return;
  }

  setDisplayMode(moduleKey, mode);

  const root = container.querySelector(`[data-display-mode-root="${moduleKey}"]`);
  if (root) {
    root.dataset.displayMode = mode;
    closeAllDisplayDetails(root);
  }

  updateToggleState(container, moduleKey, mode);
}

export function initDisplayModeSystem() {
  if (displayModeSystemReady) {
    return;
  }
  displayModeSystemReady = true;

  document.addEventListener('click', (event) => {
    const modeButton = event.target.closest('[data-action="set-display-mode"]');
    if (modeButton) {
      const moduleKey = modeButton.dataset.displayModule;
      const mode = modeButton.dataset.displayMode;
      const container = document.getElementById('tab-content');
      if (!container || !moduleKey || !isValidMode(mode)) {
        return;
      }
      if (getDisplayMode(moduleKey) === mode) {
        return;
      }
      applyDisplayMode(container, moduleKey, mode);
      return;
    }

    const detailButton = event.target.closest('[data-action="toggle-display-detail"]');
    if (detailButton) {
      event.preventDefault();
      toggleDisplayDetail(detailButton);
    }
  });
}
