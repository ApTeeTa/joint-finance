const MODAL_ROOT_ID = 'modal-root';

export function getModalRoot() {
  return document.getElementById(MODAL_ROOT_ID);
}

export function isWithinAppUi(target, container) {
  if (!target || !container) return false;
  const root = getModalRoot();
  return container.contains(target) || Boolean(root?.contains(target));
}

const MODAL_OVERLAY_SELECTOR = 'div[data-modal].fixed.inset-0';

export function relocateModals(fromContainer) {
  const root = getModalRoot();
  if (!root || !fromContainer) return;

  fromContainer.querySelectorAll(MODAL_OVERLAY_SELECTOR).forEach((modal) => {
    const name = modal.dataset.modal;
    if (name) {
      root.querySelectorAll(`${MODAL_OVERLAY_SELECTOR}[data-modal="${name}"]`).forEach((existing) => {
        if (existing !== modal) existing.remove();
      });
    }
    root.appendChild(modal);
  });
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
  const hasOpen = Boolean(getModalRoot()?.querySelector(`${MODAL_OVERLAY_SELECTOR}:not(.hidden)`));
  document.body.classList.toggle('modal-open', hasOpen);
}

export function openModal(modalName) {
  const modal = findModal(modalName);
  if (!modal) return;

  closeAllModals();

  const root = getModalRoot();
  if (root && modal.parentElement !== root) {
    root.appendChild(modal);
  }

  modal.classList.remove('hidden');
  syncBodyModalState();
}

export function closeModal(modalName) {
  const modal = findModal(modalName);
  if (modal) modal.classList.add('hidden');
  syncBodyModalState();
}

export function closeAllModals() {
  getModalRoot()?.querySelectorAll(MODAL_OVERLAY_SELECTOR).forEach((modal) => {
    modal.classList.add('hidden');
  });
  syncBodyModalState();
}
