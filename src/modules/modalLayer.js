const MODAL_ROOT_ID = 'modal-root';

export function getModalRoot() {
  return document.getElementById(MODAL_ROOT_ID);
}

export function isWithinAppUi(target, container) {
  if (!target || !container) return false;
  const root = getModalRoot();
  return container.contains(target) || Boolean(root?.contains(target));
}

export function relocateModals(fromContainer) {
  const root = getModalRoot();
  if (!root || !fromContainer) return;

  fromContainer.querySelectorAll('[data-modal]').forEach((modal) => {
    root.appendChild(modal);
  });
}

function findModal(modalName) {
  const selector = `[data-modal="${modalName}"]`;
  return getModalRoot()?.querySelector(selector) ?? document.querySelector(selector);
}

function syncBodyModalState() {
  const hasOpen = Boolean(getModalRoot()?.querySelector('[data-modal]:not(.hidden)'));
  document.body.classList.toggle('modal-open', hasOpen);
}

export function openModal(modalName) {
  const modal = findModal(modalName);
  if (!modal) return;

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
  getModalRoot()?.querySelectorAll('[data-modal]').forEach((modal) => {
    modal.classList.add('hidden');
  });
  syncBodyModalState();
}
