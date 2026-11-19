import { isExperiment } from '../config/environmentConfig.js';
import {
  logUiRuleFix,
  MODAL_OPEN_OVERLAY_SELECTOR,
  MODAL_OVERLAY_SELECTOR
} from './uiRulesEngine.js';
import {
  clearDraft,
  confirmDiscardDraft,
  restoreDraftIntoForm,
  applyFormFields
} from './modalDraftStore.js';
import { isModalSubmitting } from './modalFormSubmit.js';

const MODAL_ROOT_ID = 'modal-root';

export function getModalRoot() {
  return document.getElementById(MODAL_ROOT_ID);
}

export function isWithinAppUi(target, container) {
  if (!target || !container) return false;
  const root = getModalRoot();
  return container.contains(target) || Boolean(root?.contains(target));
}

const MODAL_SELECTOR = '[data-modal]';

function queryModals(scope = document) {
  return scope.querySelectorAll(MODAL_SELECTOR);
}

function setModalHidden(modal, hidden) {
  modal.classList.toggle('hidden', hidden);
  modal.setAttribute('aria-hidden', hidden ? 'true' : 'false');
}

/**
 * MODAL_LIFECYCLE_RULE: relocate modals from tab container → #modal-root once per tab render.
 * If container has no modals (already relocated), keep existing #modal-root modals intact.
 */
export function relocateModals(fromContainer, options = {}) {
  const root = getModalRoot();
  if (!root || !fromContainer) return;

  const incoming = fromContainer.querySelectorAll(MODAL_OVERLAY_SELECTOR);
  if (incoming.length === 0) {
    return;
  }

  const keepOpenNames = new Set(
    options.preserveOpenNames ?? getOpenModalNames()
  );
  const preserveOpen = options.preserveOpen === true && keepOpenNames.size > 0;

  const incomingNames = new Set(
    [...incoming].map((modal) => modal.dataset.modal).filter(Boolean)
  );

  queryModals(root).forEach((existing) => {
    const name = existing.dataset.modal;
    if (name && !incomingNames.has(name)) {
      existing.remove();
    }
  });

  incoming.forEach((modal) => {
    const name = modal.dataset.modal;
    if (name) {
      root.querySelectorAll(`${MODAL_SELECTOR}[data-modal="${name}"]`).forEach((existing) => {
        if (existing !== modal) {
          existing.remove();
        }
      });
    }
    const stayOpen = preserveOpen && name && keepOpenNames.has(name);
    setModalHidden(modal, !stayOpen);
    root.appendChild(modal);
  });

  if (preserveOpen) {
    syncBodyModalState();
  }
}

function findModal(modalName) {
  const selector = `${MODAL_OVERLAY_SELECTOR}[data-modal="${modalName}"]`;
  return getModalRoot()?.querySelector(selector) ?? document.querySelector(selector);
}

/** Query modal-root first, then tab container (after relocateModals). */
export function findInAppUi(selector, container) {
  return getModalRoot()?.querySelector(selector)
    ?? container?.querySelector(selector)
    ?? document.querySelector(selector);
}

export function queryAllInAppUi(selector, container) {
  const root = getModalRoot();
  if (root) {
    const inRoot = root.querySelectorAll(selector);
    if (inRoot.length) return inRoot;
  }
  if (container) {
    const inContainer = container.querySelectorAll(selector);
    if (inContainer.length) return inContainer;
  }
  return document.querySelectorAll(selector);
}

/** Forms live in #modal-root after relocateModals; fall back to tab container. */
export function findAppForm(formName, container) {
  return findInAppUi(`[data-form="${formName}"]`, container);
}

export function findAppModal(modalName, container) {
  return findInAppUi(`${MODAL_OVERLAY_SELECTOR}[data-modal="${modalName}"]`, container);
}

function syncBodyModalState() {
  const hasOpen = Boolean(document.querySelector(MODAL_OPEN_OVERLAY_SELECTOR));
  document.body.classList.toggle('modal-open', hasOpen);
  const root = getModalRoot();
  if (root) {
    root.setAttribute('aria-hidden', hasOpen ? 'false' : 'true');
  }
}

export function isAnyModalOpen() {
  return getOpenModalNames().length > 0;
}

/** Visible modals in DOM (modal-root or elsewhere). */
export function getOpenModalNames() {
  const names = [];
  document.querySelectorAll(MODAL_OPEN_OVERLAY_SELECTOR).forEach((modal) => {
    const name = modal.dataset?.modal;
    if (name) names.push(name);
  });
  return names;
}

export function filterRestorableSessionModalNames(rawNames) {
  if (!Array.isArray(rawNames)) {
    return [];
  }
  const unique = [];
  const seen = new Set();
  for (const name of rawNames) {
    if (typeof name !== 'string' || !name.length || seen.has(name)) {
      continue;
    }
    seen.add(name);
    if (!findModal(name)) {
      continue;
    }
    unique.push(name);
  }
  if (unique.length > 1) {
    return [unique[unique.length - 1]];
  }
  return unique;
}

const SESSION_OPEN_MODALS_KEY = 'jf-session-open-modals';

export function persistOpenModalsForSession() {
  const names = getOpenModalNames();
  try {
    if (names.length > 0) {
      sessionStorage.setItem(SESSION_OPEN_MODALS_KEY, JSON.stringify(names));
    } else {
      sessionStorage.removeItem(SESSION_OPEN_MODALS_KEY);
    }
  } catch {
    /* private mode */
  }
}

export function clearOpenModalsSession() {
  try {
    sessionStorage.removeItem(SESSION_OPEN_MODALS_KEY);
  } catch {
    /* noop */
  }
}

/**
 * After full tab re-render (e.g. cold resume), reopen modals the user had open.
 * Draft fields are restored via openModal → restoreDraftIntoForm.
 */
export function restoreOpenModalsFromSession() {
  let rawNames = [];
  try {
    const raw = sessionStorage.getItem(SESSION_OPEN_MODALS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        rawNames = parsed.filter((n) => typeof n === 'string' && n.length > 0);
      }
    }
  } catch {
    return;
  }
  const names = filterRestorableSessionModalNames(rawNames);
  try {
    if (names.length > 0) {
      sessionStorage.setItem(SESSION_OPEN_MODALS_KEY, JSON.stringify(names));
    } else if (rawNames.length > 0) {
      sessionStorage.removeItem(SESSION_OPEN_MODALS_KEY);
    }
  } catch {
    /* private mode */
  }
  if (!names.length) return;
  openModal(names[0]);
}

export function openModal(modalName, options = {}) {
  const modal = findModal(modalName);
  if (!modal) {
    if (isExperiment()) {
      console.error('[UI ACTION] modal not found — button action cannot run', { modalName });
      logUiRuleFix('modal_not_found', { modalName });
    }
    return false;
  }

  closeAllModals();

  const root = getModalRoot();
  if (root && modal.parentElement !== root) {
    root.appendChild(modal);
  }

  setModalHidden(modal, false);
  const form = modal.querySelector('form[data-form]');
  if (form && modalName) {
    restoreDraftIntoForm(form, modalName);
    if (options.pinnedFields) {
      applyFormFields(form, options.pinnedFields);
    }
  }
  syncBodyModalState();
  persistOpenModalsForSession();
  return true;
}

export function closeModal(modalName) {
  if (modalName && isModalSubmitting(modalName)) {
    return false;
  }
  const modal = findModal(modalName);
  if (modal) {
    setModalHidden(modal, true);
  }
  syncBodyModalState();
  persistOpenModalsForSession();
  if (modalName) {
    document.dispatchEvent(new CustomEvent('joint-finance:modal-closed', {
      detail: { modalName }
    }));
  }
}

/**
 * Backdrop / «Отмена» — confirm draft discard; blocked while submitting.
 */
export function requestCloseModal(modalName) {
  if (!modalName) return false;
  if (isModalSubmitting(modalName)) return false;
  if (!confirmDiscardDraft(modalName)) return false;
  clearDraft(modalName);
  closeModal(modalName);
  return true;
}

export function closeAllModals() {
  document.querySelectorAll(MODAL_OVERLAY_SELECTOR).forEach((modal) => {
    setModalHidden(modal, true);
  });
  syncBodyModalState();
  persistOpenModalsForSession();
}

let modalDismissHandlersBound = false;

/**
 * MODAL_DISMISS_RULE: click on dimmed backdrop closes the open modal.
 * Click on the white panel (direct child) does not close.
 */
export function initModalDismissHandlers() {
  if (modalDismissHandlersBound) {
    return;
  }
  modalDismissHandlersBound = true;

  if (isExperiment()) {
    logUiRuleFix('modal_backdrop_dismiss');
  }

  document.addEventListener('click', (event) => {
    const closeBtn = event.target.closest('[data-action="close-modal"]');
    if (closeBtn?.dataset?.modal) {
      event.preventDefault();
      event.stopPropagation();
      requestCloseModal(closeBtn.dataset.modal);
      return;
    }

    const modal = event.target.closest(MODAL_OVERLAY_SELECTOR);
    if (!modal || modal.classList.contains('hidden')) {
      return;
    }

    if (event.target !== modal) {
      return;
    }

    const modalName = modal.dataset.modal;
    if (modalName) {
      requestCloseModal(modalName);
    }
  }, true);
}
