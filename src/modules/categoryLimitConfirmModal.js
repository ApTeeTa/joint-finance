import { getModalRoot } from './modalLayer.js';
import { getModalOverlayTemplateClasses } from './uiRulesEngine.js';
import {
  CATEGORY_RESERVE_INSUFFICIENT_ERROR,
  assessCategoryMonthlyExpense
} from './categoryMonth.js';

const MODAL_NAME = 'category-limit-confirm';

function setModalVisible(modal, visible) {
  modal.classList.toggle('hidden', !visible);
  modal.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function syncBodyModalState() {
  const hasOpen = Boolean(document.querySelector('div[data-modal].fixed.inset-0:not(.hidden)'));
  document.body.classList.toggle('modal-open', hasOpen);
}

function ensureConfirmModal() {
  const root = getModalRoot();
  if (!root) return null;

  let modal = root.querySelector(`[data-modal="${MODAL_NAME}"]`);
  if (modal) return modal;

  modal = document.createElement('div');
  modal.className = `${getModalOverlayTemplateClasses()} !z-[110]`;
  modal.dataset.modal = MODAL_NAME;
  modal.setAttribute('role', 'presentation');
  modal.innerHTML = `
    <div class="jf-modal-panel bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm border border-slate-100"
         role="dialog" aria-labelledby="category-limit-confirm-title" aria-modal="true">
      <h2 id="category-limit-confirm-title" class="text-lg font-semibold text-slate-900 mb-6">
        Лимит категории превышен. Провести операцию?
      </h2>
      <div class="flex gap-3 justify-end">
        <button type="button" data-action="category-limit-confirm-no"
          class="px-4 py-2 rounded-xl text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200">
          Нет
        </button>
        <button type="button" data-action="category-limit-confirm-yes"
          class="px-4 py-2 rounded-xl text-sm font-medium text-white bg-slate-900 hover:bg-slate-800">
          Да
        </button>
      </div>
    </div>
  `;
  root.appendChild(modal);
  return modal;
}

/**
 * @returns {Promise<boolean>} true — пользователь подтвердил проведение
 */
export function confirmCategoryLimitExceeded() {
  return new Promise((resolve) => {
    const modal = ensureConfirmModal();
    if (!modal) {
      resolve(false);
      return;
    }

    const panel = modal.querySelector('.jf-modal-panel');
    const yesBtn = modal.querySelector('[data-action="category-limit-confirm-yes"]');
    const noBtn = modal.querySelector('[data-action="category-limit-confirm-no"]');

    const cleanup = (value) => {
      yesBtn?.removeEventListener('click', onYes);
      noBtn?.removeEventListener('click', onNo);
      modal.removeEventListener('click', onBackdrop);
      panel?.removeEventListener('click', stopPropagation);
      setModalVisible(modal, false);
      syncBodyModalState();
      resolve(value);
    };

    const onYes = (event) => {
      event.preventDefault();
      event.stopPropagation();
      cleanup(true);
    };
    const onNo = (event) => {
      event.preventDefault();
      event.stopPropagation();
      cleanup(false);
    };
    const stopPropagation = (event) => {
      event.stopPropagation();
    };
    const onBackdrop = (event) => {
      if (event.target === modal) {
        cleanup(false);
      }
    };

    yesBtn?.addEventListener('click', onYes);
    noBtn?.addEventListener('click', onNo);
    panel?.addEventListener('click', stopPropagation);
    modal.addEventListener('click', onBackdrop);

    setModalVisible(modal, true);
    syncBodyModalState();
    yesBtn?.focus();
  });
}

/**
 * Диалог до проведения расхода / переноса при превышении месячного лимита.
 * @returns {Promise<{ proceed: boolean, monthlyLimitAcknowledged: boolean }>}
 */
export async function resolveCategoryMonthlyLimitBeforeExpense(state, categoryId, rubAmount, expenseDate) {
  const assessment = assessCategoryMonthlyExpense(state, categoryId, rubAmount, expenseDate);
  if (!assessment.exceedsMonthlyLimit) {
    return { proceed: true, monthlyLimitAcknowledged: false };
  }

  const confirmed = await confirmCategoryLimitExceeded();
  if (!confirmed) {
    return { proceed: false, monthlyLimitAcknowledged: false };
  }

  if (!assessment.sufficientReserve) {
    alert(CATEGORY_RESERVE_INSUFFICIENT_ERROR);
    return { proceed: false, monthlyLimitAcknowledged: true };
  }

  return { proceed: true, monthlyLimitAcknowledged: true };
}