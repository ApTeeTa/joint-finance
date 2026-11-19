import { getModalRoot } from './modalLayer.js';
import { getModalOverlayTemplateClasses } from './uiRulesEngine.js';

const MODAL_NAME = 'jf-notify';
const ACTION_PREFIX = 'jf-notify-action-';

const BTN_BASE = 'px-4 py-2 rounded-xl text-sm font-medium';
const BTN_PRIMARY = `${BTN_BASE} text-white bg-slate-900 hover:bg-slate-800`;
const BTN_SECONDARY = `${BTN_BASE} text-slate-700 bg-slate-100 hover:bg-slate-200`;

let dialogQueue = Promise.resolve();

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function syncBodyModalState() {
  const hasOpen = Boolean(document.querySelector('div[data-modal].fixed.inset-0:not(.hidden)'));
  document.body.classList.toggle('modal-open', hasOpen);
}

function setModalVisible(modal, visible) {
  modal.classList.toggle('hidden', !visible);
  modal.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function ensureNotifyShell() {
  const root = getModalRoot();
  if (!root) return null;

  let modal = root.querySelector(`[data-modal="${MODAL_NAME}"]`);
  if (modal) return modal;

  modal = document.createElement('div');
  modal.className = `${getModalOverlayTemplateClasses()} !z-[120]`;
  modal.dataset.modal = MODAL_NAME;
  modal.setAttribute('role', 'presentation');
  modal.innerHTML = '<div class="jf-modal-panel bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm border border-slate-100" role="dialog" aria-modal="true"></div>';
  root.appendChild(modal);
  return modal;
}

function enqueue(task) {
  const run = dialogQueue.then(task, task);
  dialogQueue = run.then(() => {}, () => {});
  return run;
}

/**
 * @param {{ title: string, detail?: string, actions: { id: string, label: string, primary?: boolean }[], dismissActionId: string, fallback?: unknown }} config
 */
function presentDialog(config) {
  return enqueue(() => new Promise((resolve) => {
    const modal = ensureNotifyShell();
    if (!modal) {
      resolve(config.fallback);
      return;
    }

    const panel = modal.querySelector('.jf-modal-panel');
    const detailHtml = config.detail
      ? `<p class="text-sm text-slate-600 mb-6">${escapeHtml(config.detail)}</p>`
      : '';
    const titleMargin = config.detail ? 'mb-2' : 'mb-6';

    const buttonsHtml = config.actions.map((action) => {
      const cls = action.primary ? BTN_PRIMARY : BTN_SECONDARY;
      return `<button type="button" data-action="${ACTION_PREFIX}${action.id}" class="${cls}">${escapeHtml(action.label)}</button>`;
    }).join('');

    panel.innerHTML = `
      <h2 class="text-lg font-semibold text-slate-900 ${titleMargin}">${escapeHtml(config.title)}</h2>
      ${detailHtml}
      <div class="flex gap-3 justify-end flex-wrap">${buttonsHtml}</div>
    `;
    panel.setAttribute('aria-labelledby', 'jf-notify-title');
    const titleEl = panel.querySelector('h2');
    if (titleEl) titleEl.id = 'jf-notify-title';

    const cleanup = (actionId) => {
      config.actions.forEach((action) => {
        const btn = modal.querySelector(`[data-action="${ACTION_PREFIX}${action.id}"]`);
        btn?.removeEventListener('click', actionHandlers.get(action.id));
      });
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeyDown);
      panel?.removeEventListener('click', stopPropagation);
      setModalVisible(modal, false);
      syncBodyModalState();
      resolve(actionId);
    };

    const actionHandlers = new Map();
    config.actions.forEach((action) => {
      const handler = (event) => {
        event.preventDefault();
        event.stopPropagation();
        cleanup(action.id);
      };
      actionHandlers.set(action.id, handler);
      modal.querySelector(`[data-action="${ACTION_PREFIX}${action.id}"]`)?.addEventListener('click', handler);
    });

    const stopPropagation = (event) => {
      event.stopPropagation();
    };
    const onBackdrop = (event) => {
      if (event.target === modal) {
        cleanup(config.dismissActionId);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup(config.dismissActionId);
      }
    };

    panel?.addEventListener('click', stopPropagation);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeyDown);

    setModalVisible(modal, true);
    syncBodyModalState();

    const focusBtn = modal.querySelector(`[data-action="${ACTION_PREFIX}${config.actions[config.actions.length - 1]?.id}"]`)
      ?? modal.querySelector('button');
    focusBtn?.focus();
  }));
}

/** Ошибка или информация: заголовок + «Понятно». */
export function showJfError(message, options = {}) {
  const title = options.title ?? String(message ?? '');
  const detail = options.detail ?? (options.title ? String(message ?? '') : undefined);
  return presentDialog({
    title,
    detail: detail || undefined,
    actions: [{ id: 'ok', label: options.okLabel ?? 'Понятно', primary: true }],
    dismissActionId: 'ok',
    fallback: 'ok'
  });
}

/** Подтверждение: «Да» / «Нет», backdrop и Escape = отмена. */
export function showJfConfirm(title, options = {}) {
  return presentDialog({
    title: String(title ?? ''),
    detail: options.detail ? String(options.detail) : undefined,
    actions: [
      { id: 'no', label: options.cancelLabel ?? 'Нет', primary: false },
      { id: 'yes', label: options.confirmLabel ?? 'Да', primary: true }
    ],
    dismissActionId: 'no',
    fallback: 'no'
  }).then((actionId) => actionId === 'yes');
}

/** Синхронные вызовы: показать ошибку (очередь модалок, без native alert). */
export function notifyError(message, options) {
  void showJfError(message, options);
}

/** Подтверждение — только через await. */
export function notifyConfirm(title, options) {
  return showJfConfirm(title, options);
}