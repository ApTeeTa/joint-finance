import { calculateFreeBalance } from './financeEngine.js';
import { payObligation, unreserveObligation, reserveObligation } from './financeGate.js';
import {
  renderAccountSelectOptions,
  todayIso
} from './transactions.js';
import {
  computePaidUntilFromPayments,
  diagnosePaidUntilSnapshotDrift,
  diagnosePaidUntilShadow,
  validatePaidUntilConsistency
} from './obligationPaidUntil.js';
import { openModal, closeModal, isWithinAppUi, relocateModals, findAppForm, findInAppUi, findAppModal, queryAllInAppUi } from './modalLayer.js';
import {
  DISPLAY_MODULE_KEYS,
  renderCompactLine,
  renderDisplayModeList,
  renderDisplayModeRoot,
  renderModuleToolbar
} from './displayMode.js';

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

const ICONS = {
  pencil: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4"><path d="m2.695 14.763-1.262 3.154a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.885L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.42a4 4 0 0 0-.885 1.343Z"/></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 0 0-.584.788 48.065 48.065 0 0 0 .522 7.403.75.75 0 0 0 .43.375A48.112 48.112 0 0 0 8 14.25c0 1.246.124 2.503.38 3.75a.75.75 0 0 0 .75.568h7.5a.75.75 0 0 0 .75-.568c.256-1.247.38-2.504.38-3.75a48.112 48.112 0 0 0-3.439-.908.75.75 0 0 0-.43-.375 48.65 48.65 0 0 0-2.365-.298V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM9.5 3.75V5h1V3.75a.25.25 0 0 0-.25-.25h-.5a.25.25 0 0 0-.25.25ZM4.5 6.75v8.5c0 .414.336.75.75.75h9.5a.75.75 0 0 0 .75-.75v-8.5h-11Z" clip-rule="evenodd"/></svg>`
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
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    alert('Сумма должна быть больше 0');
    return false;
  }

  const obligation = findObligation(state, obligationId);
  if (!obligation) {
    alert('Обязательство не найдено');
    return false;
  }

  const freeBalance = calculateFreeBalance(state);
  if (value > freeBalance) {
    alert('Недостаточно средств');
    return false;
  }

  const result = reserveObligation(
    state,
    obligationId,
    value,
    `Резерв: ${obligation.name}`,
    todayIso(),
    state.profile
  );

  if (!result.ok) {
    alert(result.error);
    return false;
  }

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
  if (!data.paidUntil) {
    alert('Укажите срок оплаты');
    return false;
  }

  obligation.name = String(data.name).trim();
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
  const reservedAmount = item.reserveAmount ?? 0;

  return `
    <article class="display-item border rounded-xl p-4 ${cardClass}" data-obligation-id="${item.id}">
      ${renderCompactLine({
        title: escapeHtml(item.name),
        meta: `${uiStatus.label} · до ${paidUntilLabel}`,
        value: amountLabel
      })}
      <div class="display-expanded-only">
      <div class="flex items-start justify-between gap-3 mb-3">
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          <h3 class="font-semibold text-slate-900 truncate">${escapeHtml(item.name)}</h3>
          <button type="button" data-action="open-edit-obligation" data-obligation-id="${item.id}" title="Редактировать" class="p-1 rounded text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors shrink-0">${ICONS.pencil}</button>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <span class="px-2 py-1 rounded-full text-xs font-medium ${badgeClass}">
            ${escapeHtml(uiStatus.label)}
          </span>
          <button type="button" data-action="delete-obligation" data-obligation-id="${item.id}" title="Удалить" class="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">${ICONS.trash}</button>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-4">
        <span class="text-slate-500">Сумма:</span>
        <span class="text-slate-900 font-medium text-right">${amountLabel}</span>
        <span class="text-slate-500">Срок:</span>
        <span class="text-slate-900 font-medium text-right">${paidUntilLabel}</span>
        <span class="text-slate-500">Зарезервировано:</span>
        <span class="text-slate-900 font-medium text-right flex items-center justify-end gap-1">
          ${formatMoney(reservedAmount)}
          <button type="button" data-action="open-reserve-obligation" data-obligation-id="${item.id}" title="Зарезервировать" class="p-0.5 rounded text-emerald-600 hover:bg-emerald-100 transition-colors text-base leading-none">+</button>
          <button type="button" data-action="open-unreserve-obligation" data-obligation-id="${item.id}" title="Снять резерв" class="p-0.5 rounded text-slate-500 hover:bg-slate-200 transition-colors text-base leading-none">−</button>
        </span>
      </div>

      <div class="flex flex-wrap gap-2">
        <button type="button" data-action="open-pay-obligation" data-obligation-id="${item.id}" class="flex-1 min-w-[110px] px-3 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors">Оплатить</button>
      </div>
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

function renderReserveObligationModal(freeBalance) {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="reserve-obligation">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-4">Зарезервировать</h3>
        <p class="text-sm text-emerald-700 mb-4">Можно зарезервировать: <strong>${formatMoney(freeBalance)}</strong></p>
        <form data-form="reserve-obligation" class="space-y-4">
          <input type="hidden" name="obligationId" value="">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Сумма</label>
            <input type="number" name="amount" required min="1" step="1" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="0">
          </div>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="reserve-obligation" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700">Зарезервировать</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderUnreserveObligationModal() {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="unreserve-obligation">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-4">Снять резерв</h3>
        <form data-form="unreserve-obligation" class="space-y-4">
          <input type="hidden" name="obligationId" value="">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Сумма</label>
            <input type="number" name="amount" required min="1" step="1" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="0">
          </div>
          <p class="text-xs text-slate-400" data-unreserve-obligation-hint></p>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="unreserve-obligation" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700">Снять резерв</button>
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
  const freeBalance = calculateFreeBalance(state);

  const list = obligations.length
    ? renderDisplayModeList(obligations.map((item) => renderObligationCard(state, item)).join(''))
    : '<p class="text-sm text-slate-400">Обязательств пока нет</p>';

  container.innerHTML = `
    ${renderDisplayModeRoot(DISPLAY_MODULE_KEYS.OBLIGATIONS, `
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 class="text-lg font-semibold text-slate-900">Обязательства</h2>
        ${renderModuleToolbar(DISPLAY_MODULE_KEYS.OBLIGATIONS, `<button type="button" data-action="open-add-obligation" class="px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors shrink-0">Добавить</button>`)}
      </div>
      ${list}
    </div>
    `)}
    ${renderFormModal('add-obligation', 'Новое обязательство', 'Создать')}
    ${renderFormModal('edit-obligation', 'Редактирование', 'Сохранить')}
    ${renderPayModal()}
    ${renderReserveObligationModal(freeBalance)}
    ${renderUnreserveObligationModal()}
  `;

  refreshSelects(state, container);
  relocateModals(container);
}

function refreshSelects(state, container) {
  queryAllInAppUi('.obligation-account-select', container).forEach((select) => {
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
      const form = findAppForm('add-obligation', container);
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

      const modal = findAppModal('edit-obligation', container);
      if (!modal) return;
      modal.outerHTML = renderFormModal('edit-obligation', 'Редактирование', 'Сохранить', obligation);
      relocateModals(container);
      openModal('edit-obligation');
      return;
    }

    if (action === 'open-pay-obligation') {
      const obligationId = event.target.closest('[data-action]').dataset.obligationId;
      const obligation = normalizeObligation(findObligation(state, obligationId) ?? {});
      if (!obligation.id) {
        alert('Обязательство не найдено');
        return;
      }

      const form = findAppForm('pay-obligation', container);
      if (!form) return;
      form.obligationId.value = obligation.id;
      form.amount.value = obligation.targetAmount != null && obligation.targetAmount > 0
        ? String(obligation.targetAmount)
        : '';
      form.accountId.value = '';
      form.paidUntil.value = computePaidUntilFromPayments(obligation) || todayIso();
      form.comment.value = '';
      const titleEl = findInAppUi('[data-pay-obligation-title]', container);
      if (titleEl) titleEl.textContent = obligation.name;

      openModal('pay-obligation');
      refreshSelects(state, container);
      return;
    }

    if (action === 'open-reserve-obligation') {
      const obligationId = event.target.closest('[data-action]').dataset.obligationId;
      const form = findAppForm('reserve-obligation', container);
      if (form) {
        form.obligationId.value = obligationId;
        form.amount.value = '';
      }
      openModal('reserve-obligation');
      return;
    }

    if (action === 'open-unreserve-obligation') {
      const obligationId = event.target.closest('[data-action]').dataset.obligationId;
      const obligation = findObligation(state, obligationId);
      const form = findAppForm('unreserve-obligation', container);
      if (form && obligation) {
        form.obligationId.value = obligationId;
        form.amount.value = '';
        const hint = findInAppUi('[data-unreserve-obligation-hint]', container);
        if (hint) {
          hint.textContent = `Доступно к снятию: ${formatMoney(obligation.reserveAmount ?? 0)}`;
        }
      }
      openModal('unreserve-obligation');
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
      return;
    }

    if (formKey === 'reserve-obligation') {
      if (reserveFunds(state, data.obligationId, data.amount)) {
        closeModal('reserve-obligation');
        refresh();
      }
      return;
    }

    if (formKey === 'unreserve-obligation') {
      if (unreserveFunds(state, data.obligationId, data.amount)) {
        closeModal('unreserve-obligation');
        refresh();
      }
    }
  });
}
