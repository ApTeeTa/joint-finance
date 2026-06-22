import { calculateFreeBalance } from './financeEngine.js';
import { payObligation, undoTransaction, unreserveObligation } from './financeGate.js';
import {
  renderAccountSelectOptions,
  canCancelTransaction,
  todayIso
} from './transactions.js';
import {
  computePaidUntilFromPayments,
  diagnosePaidUntilSnapshotDrift,
  diagnosePaidUntilShadow,
  validatePaidUntilConsistency
} from './obligationPaidUntil.js';
import { openModal, closeModal, isWithinAppUi, relocateModals } from './modalLayer.js';

export {
  computePaidUntilFromPayments,
  diagnosePaidUntilSnapshotDrift,
  diagnosePaidUntilShadow,
  validatePaidUntilConsistency
} from './obligationPaidUntil.js';

const STATUS_CARD_CLASS = {
  current: 'border-emerald-300 bg-emerald-50/60',
  overdue: 'border-red-300 bg-red-50/60'
};

const STATUS_BADGE_CLASS = {
  current: 'text-emerald-700 bg-emerald-100',
  overdue: 'text-red-700 bg-red-100'
};

function formatMoney(amount) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0
  }).format(amount ?? 0);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createId(prefix) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseLocalDate(iso) {
  const [year, month, day] = String(iso).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatPaidUntilLabel(iso) {
  if (!iso) return '—';
  const date = parseLocalDate(iso);
  const day = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleDateString('ru-RU', { month: 'long' });
  return `до ${day} ${month}`;
}

function syncStoredStatus(obligation) {
  const paidUntil = computePaidUntilFromPayments(obligation);
  if (!paidUntil) {
    return;
  }

  obligation.status = paidUntil >= todayIso() ? 'active' : 'overdue';
}

function getUiStatus(obligation) {
  const paidUntil = computePaidUntilFromPayments(obligation);

  if (!paidUntil || paidUntil >= todayIso()) {
    return { ui: 'current', label: 'К оплате' };
  }

  return { ui: 'overdue', label: 'Просрочено' };
}

function findTransaction(state, transactionId) {
  return (state.transactions ?? []).find((tx) => tx.id === transactionId);
}

function getLastObligationPayment(obligation) {
  const payments = obligation.payments ?? [];
  return payments.length ? payments[payments.length - 1] : null;
}

function canCancelLastObligationPayment(state, obligation) {
  const lastPayment = getLastObligationPayment(obligation);
  if (!lastPayment?.transactionId) return false;
  const tx = findTransaction(state, lastPayment.transactionId);
  return !!(tx && canCancelTransaction(state, tx));
}

export function getOverdueDays(paidUntil) {
  if (!paidUntil) return 0;
  const today = parseLocalDate(todayIso());
  const until = parseLocalDate(paidUntil);
  return Math.round((today - until) / 86400000);
}

export function isObligationOverdue(obligation) {
  const paidUntil = computePaidUntilFromPayments(obligation);
  if (!paidUntil) return false;
  return paidUntil <= todayIso();
}

export function formatOverdueDaysLabel(overdueDays) {
  if (overdueDays <= 0) return 'Просрочено сегодня';
  const n = overdueDays;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `Просрочено ${n} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `Просрочено ${n} дня`;
  return `Просрочено ${n} дней`;
}

export function getOverdueObligations(state) {
  return (state.obligations ?? [])
    .filter(isObligationOverdue)
    .map((obligation) => ({
      id: obligation.id,
      name: obligation.name,
      overdueDays: getOverdueDays(computePaidUntilFromPayments(obligation))
    }))
    .sort((a, b) => a.overdueDays - b.overdueDays);
}

function findObligation(state, obligationId) {
  return (state.obligations ?? []).find((item) => item.id === obligationId);
}

function normalizeObligation(obligation) {
  const item = {
    ...obligation,
    reserveAmount: obligation.reserveAmount ?? 0,
    targetAmount: obligation.targetAmount ?? null,
    comment: obligation.comment ?? '',
    payments: Array.isArray(obligation.payments) ? obligation.payments : []
  };
  syncStoredStatus(item);
  return item;
}

function reserveFunds(state, obligationId, amount) {
  // LEGACY_SAFE: dead UI helper — не используется; резерв через payObligation / unreserveObligation
  const obligation = findObligation(state, obligationId);
  if (!obligation) {
    alert('Обязательство не найдено');
    return false;
  }

  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    alert('Сумма должна быть больше 0');
    return false;
  }

  const freeBalance = calculateFreeBalance(state);
  if (value > freeBalance) {
    alert('Недостаточно средств');
    return false;
  }

  obligation.reserveAmount = (obligation.reserveAmount ?? 0) + value;
  syncStoredStatus(obligation);
  return true;
}

function unreserveFunds(state, obligationId, amount) {
  const obligation = findObligation(state, obligationId);
  if (!obligation) {
    alert('Обязательство не найдено');
    return false;
  }

  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    alert('Сумма возврата должна быть больше 0');
    return false;
  }

  const result = unreserveObligation(
    state,
    obligationId,
    value,
    '',
    todayIso(),
    state.profile
  );

  if (!result.ok) {
    alert(result.error);
    return false;
  }

  return true;
}

function createObligation(state, data) {
  if (!data.name || !String(data.name).trim()) {
    alert('Введите название обязательства');
    return false;
  }
  if (!data.accountId) {
    alert('Выберите счёт');
    return false;
  }
  if (!data.paidUntil) {
    alert('Укажите срок оплаты');
    return false;
  }

  if (!Array.isArray(state.obligations)) {
    state.obligations = [];
  }

  const obligation = normalizeObligation({
    id: createId('obligation'),
    name: String(data.name).trim(),
    accountId: data.accountId,
    reserveAmount: 0,
    targetAmount: data.targetAmount != null && data.targetAmount !== ''
      ? Number(data.targetAmount)
      : null,
    paidUntil: data.paidUntil,
    comment: String(data.comment ?? '').trim(),
    status: 'active',
    createdAt: new Date().toISOString()
  });

  state.obligations.push(obligation);
  return true;
}

function updateObligation(state, obligationId, data) {
  const obligation = findObligation(state, obligationId);
  if (!obligation) {
    alert('Обязательство не найдено');
    return false;
  }

  if (!data.name || !String(data.name).trim()) {
    alert('Введите название обязательства');
    return false;
  }
  if (!data.accountId) {
    alert('Выберите счёт');
    return false;
  }
  if (!data.paidUntil) {
    alert('Укажите срок оплаты');
    return false;
  }

  obligation.name = String(data.name).trim();
  obligation.accountId = data.accountId;
  obligation.targetAmount = data.targetAmount != null && data.targetAmount !== ''
    ? Number(data.targetAmount)
    : null;
  obligation.paidUntil = data.paidUntil;
  obligation.comment = String(data.comment ?? '').trim();
  syncStoredStatus(obligation);
  return true;
}

function deleteObligation(state, obligationId) {
  const obligation = findObligation(state, obligationId);
  if (!obligation) {
    alert('Обязательство не найдено');
    return false;
  }

  state.obligations = (state.obligations ?? []).filter((item) => item.id !== obligationId);
  return true;
}

function renderObligationCard(state, obligation) {
  const item = normalizeObligation(obligation);
  const uiStatus = getUiStatus(item);
  const cardClass = STATUS_CARD_CLASS[uiStatus.ui] ?? STATUS_CARD_CLASS.current;
  const badgeClass = STATUS_BADGE_CLASS[uiStatus.ui] ?? STATUS_BADGE_CLASS.current;
  const paidUntilLabel = formatPaidUntilLabel(computePaidUntilFromPayments(item));
  const amountLabel = item.targetAmount != null && item.targetAmount > 0
    ? formatMoney(item.targetAmount)
    : '—';
  const showCancelPayment = canCancelLastObligationPayment(state, item);

  return `
    <article class="border rounded-xl p-4 ${cardClass}" data-obligation-id="${item.id}">
      <div class="flex items-start justify-between gap-3 mb-3">
        <div class="min-w-0">
          <h3 class="font-semibold text-slate-900 truncate">${escapeHtml(item.name)}</h3>
        </div>
        <span class="shrink-0 px-2 py-1 rounded-full text-xs font-medium ${badgeClass}">
          ${escapeHtml(uiStatus.label)}
        </span>
      </div>

      <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-4">
        <span class="text-slate-500">Сумма:</span>
        <span class="text-slate-900 font-medium text-right">${amountLabel}</span>
        <span class="text-slate-500">Срок:</span>
        <span class="text-slate-900 font-medium text-right">${paidUntilLabel}</span>
      </div>

      <div class="flex flex-wrap gap-2">
        <button type="button" data-action="open-pay-obligation" data-obligation-id="${item.id}" class="flex-1 min-w-[110px] px-3 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors">Оплатить</button>
        ${showCancelPayment ? `
          <button type="button" data-action="cancel-obligation-payment" data-obligation-id="${item.id}" class="flex-1 min-w-[110px] px-3 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors">Отменить оплату</button>
        ` : ''}
        <button type="button" data-action="open-edit-obligation" data-obligation-id="${item.id}" class="flex-1 min-w-[110px] px-3 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors">Редактировать</button>
        <button type="button" data-action="delete-obligation" data-obligation-id="${item.id}" class="flex-1 min-w-[110px] px-3 py-2 text-sm font-medium rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors">Удалить</button>
      </div>
    </article>
  `;
}

function renderFormModal(key, title, submitLabel, obligation = null) {
  const paidUntil = computePaidUntilFromPayments(obligation) ?? todayIso();
  const targetAmount = obligation?.targetAmount ?? '';

  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="${key}">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <h3 class="text-lg font-semibold text-slate-900 mb-4">${title}</h3>
        <form data-form="${key}" class="space-y-4">
          ${obligation ? `<input type="hidden" name="obligationId" value="${obligation.id}">` : ''}
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Название</label>
            <input type="text" name="name" required maxlength="80" value="${escapeHtml(obligation?.name ?? '')}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Например, Интернет">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Счёт по умолчанию</label>
            <select name="accountId" required class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 obligation-account-select">
              ${renderAccountSelectOptions({ accounts: [] }, obligation?.accountId ?? '')}
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Сумма (RUB)</label>
            <input type="number" name="targetAmount" min="0" step="1" value="${targetAmount}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Необязательно">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Срок оплаты</label>
            <input type="date" name="paidUntil" required value="${paidUntil}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Комментарий</label>
            <input type="text" name="comment" maxlength="200" value="${escapeHtml(obligation?.comment ?? '')}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Необязательно">
          </div>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="${key}" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700">${submitLabel}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderPayModal() {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="pay-obligation">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-1">Оплатить</h3>
        <p class="text-sm text-slate-500 mb-4" data-pay-obligation-title></p>
        <form data-form="pay-obligation" class="space-y-4">
          <input type="hidden" name="obligationId" value="">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Сумма (RUB)</label>
            <input type="number" name="amount" required min="1" step="1" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Счёт списания</label>
            <select name="accountId" required class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 obligation-account-select">
              ${renderAccountSelectOptions({ accounts: [] })}
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Оплатить до</label>
            <input type="date" name="paidUntil" required class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Комментарий</label>
            <input type="text" name="comment" maxlength="200" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Необязательно">
          </div>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="pay-obligation" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700">Оплатить</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function renderObligations(state, container) {
  const obligations = (state.obligations ?? []).map(normalizeObligation);

  const list = obligations.length
    ? `<div class="grid gap-4 sm:grid-cols-2">${obligations.map((item) => renderObligationCard(state, item)).join('')}</div>`
    : '<p class="text-sm text-slate-400">Обязательств пока нет</p>';

  container.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 class="text-lg font-semibold text-slate-900">Обязательства</h2>
        <button type="button" data-action="open-add-obligation" class="px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors shrink-0">Добавить</button>
      </div>
      ${list}
    </div>
    ${renderFormModal('add-obligation', 'Новое обязательство', 'Создать')}
    ${renderFormModal('edit-obligation', 'Редактирование', 'Сохранить')}
    ${renderPayModal()}
  `;

  refreshSelects(state, container);
}

function refreshSelects(state, container) {
  container.querySelectorAll('.obligation-account-select').forEach((select) => {
    const selected = select.value;
    select.innerHTML = renderAccountSelectOptions(state, selected);
  });
}

function readFormData(form) {
  const formData = new FormData(form);
  return {
    obligationId: formData.get('obligationId'),
    name: formData.get('name'),
    accountId: formData.get('accountId'),
    targetAmount: formData.get('targetAmount'),
    paidUntil: formData.get('paidUntil'),
    comment: formData.get('comment'),
    amount: formData.get('amount')
  };
}

export function initObligationsHandlers(state, container, onStateChange) {
  const refresh = () => {
    renderObligations(state, container);
    if (typeof onStateChange === 'function') {
      onStateChange();
    }
  };

  if (container.dataset.obligationsHandlersBound === 'true') {
    return;
  }
  container.dataset.obligationsHandlersBound = 'true';

  document.addEventListener('click', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    const closeBtn = event.target.closest('[data-action="close-modal"]');
    if (closeBtn) {
      closeModal(closeBtn.dataset.modal);
      return;
    }

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'open-add-obligation') {
      const form = container.querySelector('[data-form="add-obligation"]');
      if (form) form.reset();
      openModal('add-obligation');
      refreshSelects(state, container);
      return;
    }

    if (action === 'open-edit-obligation') {
      const obligationId = event.target.closest('[data-action]').dataset.obligationId;
      const obligation = findObligation(state, obligationId);
      if (!obligation) {
        alert('Обязательство не найдено');
        return;
      }

      const modal = container.querySelector('[data-modal="edit-obligation"]');
      modal.outerHTML = renderFormModal('edit-obligation', 'Редактирование', 'Сохранить', obligation);
      relocateModals(container);
      openModal('edit-obligation');
      refreshSelects(state, container);
      return;
    }

    if (action === 'open-pay-obligation') {
      const obligationId = event.target.closest('[data-action]').dataset.obligationId;
      const obligation = normalizeObligation(findObligation(state, obligationId) ?? {});
      if (!obligation.id) {
        alert('Обязательство не найдено');
        return;
      }

      const form = container.querySelector('[data-form="pay-obligation"]');
      form.obligationId.value = obligation.id;
      form.amount.value = obligation.targetAmount != null && obligation.targetAmount > 0
        ? String(obligation.targetAmount)
        : '';
      form.accountId.value = obligation.accountId;
      form.paidUntil.value = computePaidUntilFromPayments(obligation) || todayIso();
      form.comment.value = '';
      container.querySelector('[data-pay-obligation-title]').textContent = obligation.name;

      openModal('pay-obligation');
      refreshSelects(state, container);
      return;
    }

    if (action === 'cancel-obligation-payment') {
      const obligationId = event.target.closest('[data-action]').dataset.obligationId;
      const obligation = findObligation(state, obligationId);
      if (!obligation) {
        alert('Обязательство не найдено');
        return;
      }

      const lastPayment = getLastObligationPayment(obligation);
      if (!lastPayment?.transactionId) {
        return;
      }

      if (!confirm('Отменить последнюю оплату?')) {
        return;
      }

      const result = undoTransaction(state, lastPayment.transactionId);
      if (!result.ok) {
        alert(result.error);
        return;
      }

      refresh();
      return;
    }

    if (action === 'delete-obligation') {
      const obligationId = event.target.closest('[data-action]').dataset.obligationId;
      if (!confirm('Удалить обязательство?')) {
        return;
      }
      if (deleteObligation(state, obligationId)) {
        refresh();
      }
    }
  });

  document.addEventListener('submit', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    const form = event.target.closest('[data-form]');
    if (!form) return;
    event.preventDefault();

    const formKey = form.dataset.form;
    const data = readFormData(form);

    if (formKey === 'add-obligation') {
      if (createObligation(state, data)) {
        closeModal('add-obligation');
        refresh();
      }
      return;
    }

    if (formKey === 'edit-obligation') {
      if (updateObligation(state, data.obligationId, data)) {
        closeModal('edit-obligation');
        refresh();
      }
      return;
    }

    if (formKey === 'pay-obligation') {
      const result = payObligation(
        state,
        data.obligationId,
        data.amount,
        data.accountId,
        data.paidUntil,
        data.comment,
        todayIso(),
        state.profile
      );

      if (!result.ok) {
        alert(result.error);
        return;
      }

      closeModal('pay-obligation');
      refresh();
    }
  });
}
