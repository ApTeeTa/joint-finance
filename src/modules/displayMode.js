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

export function renderCompactLine({ title, meta = '', value = '' }) {
  return `
    <div class="display-compact-only flex items-center justify-between gap-2 py-2.5 px-3 rounded-lg border border-slate-200 bg-white min-h-[44px]">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-slate-900 truncate">${title}</p>
        ${meta ? `<p class="text-xs text-slate-500 truncate">${meta}</p>` : ''}
      </div>
      ${value ? `<span class="text-sm font-semibold text-slate-900 shrink-0 whitespace-nowrap">${value}</span>` : ''}
    </div>
  `;
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

export function applyDisplayMode(container, moduleKey, mode) {
  if (!container || !isValidMode(mode)) {
    return;
  }

  setDisplayMode(moduleKey, mode);

  const root = container.querySelector(`[data-display-mode-root="${moduleKey}"]`);
  if (root) {
    root.dataset.displayMode = mode;
  }

  updateToggleState(container, moduleKey, mode);
}

export function initDisplayModeSystem() {
  if (displayModeSystemReady) {
    return;
  }
  displayModeSystemReady = true;

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="set-display-mode"]');
    if (!button) {
      return;
    }

    const moduleKey = button.dataset.displayModule;
    const mode = button.dataset.displayMode;
    const container = document.getElementById('tab-content');
    if (!container || !moduleKey || !isValidMode(mode)) {
      return;
    }

    if (getDisplayMode(moduleKey) === mode) {
      return;
    }

    applyDisplayMode(container, moduleKey, mode);
  });
}
