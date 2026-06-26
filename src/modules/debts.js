import {
  createDebtOwedToUs,
  createDebtWeOwe,
  createManualDebtEvent,
  repayDebt,
  writeOffDebt
} from './financeGate.js';
import {
  renderAccountSelectOptions,
  todayIso
} from './transactions.js';
import {
  getOverdueObligations,
  formatOverdueDaysLabel
} from './obligations.js';
import { openModal, closeModal, isWithinAppUi, findAppForm, findInAppUi, queryAllInAppUi } from './modalLayer.js';

const TYPE_LABELS = {
  owed_to_us: 'Нам должны',
  we_owe: 'Мы должны',
  manual_debt_event: 'Учётные обязательства'
};

const MANUAL_DEBT_CATEGORY_LABELS = {
  emergency: 'Экстренные расходы',
  rent: 'Аренда / задержка',
  fees: 'Комиссии / штрафы',
  other: 'Другое'
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

function normalizeDebt(debt) {
  const amount = debt.amount ?? 0;
  const paidAmount = debt.paidAmount ?? 0;
  const remainingAmount = debt.remainingAmount ?? Math.max(0, amount - paidAmount);
  return {
    ...debt,
    type: debt.type === 'manual_debt_event'
      ? 'manual_debt_event'
      : (debt.type === 'we_owe' ? 'we_owe' : 'owed_to_us'),
    amount,
    paidAmount,
    remainingAmount,
    status: debt.status ?? (remainingAmount > 0 ? 'active' : 'closed')
  };
}

function getActiveDebts(state, type) {
  return (state.debts ?? [])
    .map(normalizeDebt)
    .filter((debt) => debt.type === type && debt.status !== 'closed' && debt.remainingAmount > 0);
}

function renderDebtCard(debt) {
  const item = normalizeDebt(debt);
  const isOwedToUs = item.type === 'owed_to_us';
  const isManual = item.type === 'manual_debt_event';
  const categoryLabel = isManual
    ? MANUAL_DEBT_CATEGORY_LABELS[item.category] ?? MANUAL_DEBT_CATEGORY_LABELS.other
    : '';

  return `
    <article class="border border-slate-200 rounded-xl p-4 bg-slate-50/50" data-debt-id="${item.id}">
      <div class="flex items-start justify-between gap-3 mb-3">
        <div class="min-w-0">
          <h3 class="font-semibold text-slate-900 truncate">${escapeHtml(item.title)}</h3>
          ${isManual && categoryLabel ? `<p class="text-xs text-amber-700 mt-0.5">${escapeHtml(categoryLabel)}</p>` : ''}
          ${item.comment ? `<p class="text-sm text-slate-500 mt-0.5">${escapeHtml(item.comment)}</p>` : ''}
          ${isManual && item.eventDate ? `<p class="text-xs text-slate-400 mt-0.5">${new Date(item.eventDate).toLocaleDateString('ru-RU')}</p>` : ''}
        </div>
        <div class="text-right shrink-0">
          <p class="text-lg font-bold text-slate-900">${formatMoney(item.remainingAmount)}</p>
          <p class="text-xs text-slate-400 mt-0.5">из ${formatMoney(item.amount)}</p>
        </div>
      </div>

      <div class="text-sm text-slate-600 mb-4">
        <p><span class="text-slate-400">Погашено:</span> ${formatMoney(item.paidAmount)}</p>
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          data-action="open-repay-debt"
          data-debt-id="${item.id}"
          class="flex-1 min-w-[120px] px-3 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >Погасить</button>
        ${isOwedToUs ? `
          <button
            type="button"
            data-action="open-write-off-debt"
            data-debt-id="${item.id}"
            class="flex-1 min-w-[120px] px-3 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
          >Списать долг</button>
        ` : ''}
      </div>
    </article>
  `;
}

function renderDebtSection(title, type, debts, options = {}) {
  const cards = debts.length
    ? `<div class="grid gap-3 sm:grid-cols-2">${debts.map(renderDebtCard).join('')}</div>`
    : '<p class="text-sm text-slate-400">Активных долгов нет</p>';

  const addAction = options.addAction
    ?? (type === 'owed_to_us' ? 'open-add-debt-owed' : 'open-add-debt-we-owe');
  const addLabel = options.addLabel
    ?? (type === 'owed_to_us' ? 'Выдать в долг' : 'Взять в долг');

  return `
    <section class="mb-8">
      <div class="flex items-center justify-between gap-3 mb-4">
        <h3 class="text-base font-semibold text-slate-900">${title}</h3>
        <button
          type="button"
          data-action="${addAction}"
          class="px-3 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors shrink-0"
        >${addLabel}</button>
      </div>
      ${cards}
    </section>
  `;
}

function renderCreateDebtModal(type) {
  const isOwed = type === 'owed_to_us';
  const modalKey = isOwed ? 'add-debt-owed' : 'add-debt-we-owe';
  const title = isOwed ? 'Нам должны' : 'Мы должны';
  const submitLabel = isOwed ? 'Выдать в долг' : 'Взять в долг';

  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="${modalKey}">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-4">${title}</h3>
        <form data-form="${modalKey}" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Название</label>
            <input type="text" name="title" required maxlength="80" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Например, Родители">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Сумма (RUB)</label>
            <input type="number" name="amount" required min="1" step="1" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="50000">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Счёт</label>
            <select name="accountId" required class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
              ${renderAccountSelectOptions({ accounts: [] })}
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Комментарий</label>
            <input type="text" name="comment" maxlength="200" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Необязательно">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Дата</label>
            <input type="date" name="date" value="${todayIso()}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
          </div>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="${modalKey}" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700">${submitLabel}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderCreateManualDebtModal() {
  const categoryOptions = Object.entries(MANUAL_DEBT_CATEGORY_LABELS).map(
    ([value, label]) => `<option value="${value}">${label}</option>`
  ).join('');

  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="add-manual-debt">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-1">Учётное обязательство</h3>
        <p class="text-sm text-slate-500 mb-4">Без движения денег по счетам — только учёт долга.</p>
        <form data-form="add-manual-debt" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Описание</label>
            <input type="text" name="description" required maxlength="120" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Например, Штраф банка">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Сумма (RUB)</label>
            <input type="number" name="amount" required min="1" step="1" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="15000">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Категория</label>
            <select name="category" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
              ${categoryOptions}
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Комментарий</label>
            <input type="text" name="comment" maxlength="200" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Необязательно">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Дата</label>
            <input type="date" name="date" value="${todayIso()}" required class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
          </div>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="add-manual-debt" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700">Добавить</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderRepayDebtModal() {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="repay-debt">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-1">Погасить долг</h3>
        <p class="text-sm text-slate-500 mb-4" data-repay-debt-title></p>
        <form data-form="repay-debt" class="space-y-4">
          <input type="hidden" name="debtId" value="">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Сумма (RUB)</label>
            <input type="number" name="amount" required min="1" step="1" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
            <p class="text-xs text-slate-400 mt-1" data-repay-debt-remaining></p>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Счёт</label>
            <select name="accountId" required class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
              ${renderAccountSelectOptions({ accounts: [] })}
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Комментарий</label>
            <input type="text" name="comment" maxlength="200" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Необязательно">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Дата</label>
            <input type="date" name="date" value="${todayIso()}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
          </div>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="repay-debt" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700">Погасить</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderWriteOffDebtModal() {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="write-off-debt">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-1">Списать долг</h3>
        <p class="text-sm text-slate-500 mb-4" data-write-off-debt-title></p>
        <p class="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4">Деньги на счёт не вернутся. Остаток долга будет списан.</p>
        <form data-form="write-off-debt" class="space-y-4">
          <input type="hidden" name="debtId" value="">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Комментарий</label>
            <input type="text" name="comment" maxlength="200" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Необязательно">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Дата</label>
            <input type="date" name="date" value="${todayIso()}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
          </div>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="write-off-debt" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700">Списать</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderOverdueObligationsSection(state) {
  const overdue = getOverdueObligations(state);
  if (!overdue.length) return '';

  const items = overdue.map((item) => `
    <li>
      <button
        type="button"
        data-action="open-obligation-tab"
        data-obligation-id="${item.id}"
        class="w-full text-left px-3 py-2.5 rounded-lg border border-red-200 bg-white hover:bg-red-50 transition-colors"
      >
        <span class="font-medium text-slate-900">⚠ ${escapeHtml(item.name)}</span>
        <span class="block text-sm text-red-700 mt-0.5">${formatOverdueDaysLabel(item.overdueDays)}</span>
      </button>
    </li>
  `).join('');

  return `
    <details class="mb-8 border border-red-200 rounded-xl bg-red-50/40 group" open data-overdue-obligations>
      <summary class="cursor-pointer px-4 py-3 font-semibold text-slate-900 select-none list-none flex items-center justify-between gap-2">
        <span>Регулярные обязательства (${overdue.length})</span>
        <span class="text-slate-400 text-sm font-normal group-open:rotate-180 transition-transform">▼</span>
      </summary>
      <ul class="px-4 pb-4 space-y-2">${items}</ul>
    </details>
  `;
}

export function renderDebts(state, container) {
  const owedToUs = getActiveDebts(state, 'owed_to_us');
  const weOwe = getActiveDebts(state, 'we_owe');
  const manualDebts = getActiveDebts(state, 'manual_debt_event');

  container.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <h2 class="text-lg font-semibold text-slate-900 mb-6">Долги</h2>
      ${renderOverdueObligationsSection(state)}
      ${renderDebtSection(TYPE_LABELS.manual_debt_event, 'manual_debt_event', manualDebts, {
        addAction: 'open-add-manual-debt',
        addLabel: 'Добавить обязательство'
      })}
      ${renderDebtSection(TYPE_LABELS.owed_to_us, 'owed_to_us', owedToUs)}
      ${renderDebtSection(TYPE_LABELS.we_owe, 'we_owe', weOwe)}
    </div>
    ${renderCreateManualDebtModal()}
    ${renderCreateDebtModal('owed_to_us')}
    ${renderCreateDebtModal('we_owe')}
    ${renderRepayDebtModal()}
    ${renderWriteOffDebtModal()}
  `;

  queryAllInAppUi('select[name="accountId"]', container).forEach((select) => {
    select.innerHTML = renderAccountSelectOptions(state);
  });
}

function findDebt(state, debtId) {
  return (state.debts ?? []).map(normalizeDebt).find((debt) => debt.id === debtId);
}

function refreshAccountSelects(state, container) {
  queryAllInAppUi('select[name="accountId"]', container).forEach((select) => {
    const selected = select.value;
    select.innerHTML = renderAccountSelectOptions(state, selected);
  });
}

export function initDebtsHandlers(state, container, onStateChange, onNavigateTab) {
  const refresh = () => {
    renderDebts(state, container);
    refreshAccountSelects(state, container);
    if (typeof onStateChange === 'function') {
      onStateChange();
    }
  };

  if (container.dataset.debtsHandlersBound === 'true') {
    return;
  }
  container.dataset.debtsHandlersBound = 'true';

  document.addEventListener('click', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    const closeBtn = event.target.closest('[data-action="close-modal"]');
    if (closeBtn) {
      closeModal(closeBtn.dataset.modal);
      return;
    }

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'open-add-debt-owed') {
      openModal('add-debt-owed');
      refreshAccountSelects(state, container);
      return;
    }

    if (action === 'open-obligation-tab') {
      if (typeof onNavigateTab === 'function') {
        onNavigateTab('obligations');
      }
      return;
    }

    if (action === 'open-add-debt-we-owe') {
      openModal('add-debt-we-owe');
      refreshAccountSelects(state, container);
      return;
    }

    if (action === 'open-add-manual-debt') {
      openModal('add-manual-debt');
      return;
    }

    if (action === 'open-repay-debt') {
      const debtId = event.target.closest('[data-action]').dataset.debtId;
      const debt = findDebt(state, debtId);
      if (!debt) {
        alert('Долг не найден');
        return;
      }

      const form = findAppForm('repay-debt', container);
      if (!form) return;
      form.querySelector('[name="debtId"]').value = debt.id;
      form.querySelector('[name="amount"]').value = '';
      form.querySelector('[name="amount"]').max = debt.remainingAmount;
      form.querySelector('[name="comment"]').value = '';
      form.querySelector('[name="date"]').value = todayIso();

      const titleEl = findInAppUi('[data-repay-debt-title]', container);
      const remainingEl = findInAppUi('[data-repay-debt-remaining]', container);
      if (titleEl) {
        titleEl.textContent = `${debt.title} · остаток ${formatMoney(debt.remainingAmount)}`;
      }
      if (remainingEl) {
        remainingEl.textContent = `Максимум: ${formatMoney(debt.remainingAmount)}`;
      }

      openModal('repay-debt');
      refreshAccountSelects(state, container);
      return;
    }

    if (action === 'open-write-off-debt') {
      const debtId = event.target.closest('[data-action]').dataset.debtId;
      const debt = findDebt(state, debtId);
      if (!debt) {
        alert('Долг не найден');
        return;
      }

      const form = findAppForm('write-off-debt', container);
      if (!form) return;
      form.querySelector('[name="debtId"]').value = debt.id;
      form.querySelector('[name="comment"]').value = '';
      form.querySelector('[name="date"]').value = todayIso();
      const titleEl = findInAppUi('[data-write-off-debt-title]', container);
      if (titleEl) {
        titleEl.textContent = `${debt.title} · остаток ${formatMoney(debt.remainingAmount)}`;
      }

      openModal('write-off-debt');
    }
  });

  document.addEventListener('submit', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    const form = event.target.closest('[data-form]');
    if (!form) return;
    event.preventDefault();

    const formKey = form.dataset.form;
    const formData = new FormData(form);

    if (formKey === 'add-debt-owed') {
      const result = createDebtOwedToUs(state, {
        title: formData.get('title'),
        amount: formData.get('amount'),
        accountId: formData.get('accountId'),
        comment: formData.get('comment'),
        date: formData.get('date'),
        author: state.profile
      });

      if (!result.ok) {
        alert(result.error);
        return;
      }

      closeModal('add-debt-owed');
      form.reset();
      refresh();
      return;
    }

    if (formKey === 'add-debt-we-owe') {
      const result = createDebtWeOwe(state, {
        title: formData.get('title'),
        amount: formData.get('amount'),
        accountId: formData.get('accountId'),
        comment: formData.get('comment'),
        date: formData.get('date'),
        author: state.profile
      });

      if (!result.ok) {
        alert(result.error);
        return;
      }

      closeModal('add-debt-we-owe');
      form.reset();
      refresh();
      return;
    }

    if (formKey === 'add-manual-debt') {
      const result = createManualDebtEvent(state, {
        description: formData.get('description'),
        amount: formData.get('amount'),
        category: formData.get('category'),
        comment: formData.get('comment'),
        date: formData.get('date')
      });

      if (!result.ok) {
        alert(result.error);
        return;
      }

      closeModal('add-manual-debt');
      form.reset();
      refresh();
      return;
    }

    if (formKey === 'repay-debt') {
      const result = repayDebt(
        state,
        formData.get('debtId'),
        formData.get('amount'),
        formData.get('accountId'),
        formData.get('comment'),
        formData.get('date'),
        state.profile
      );

      if (!result.ok) {
        alert(result.error);
        return;
      }

      closeModal('repay-debt');
      refresh();
      return;
    }

    if (formKey === 'write-off-debt') {
      if (!confirm('Списать остаток долга? Деньги на счёт не вернутся.')) {
        return;
      }

      const result = writeOffDebt(
        state,
        formData.get('debtId'),
        formData.get('comment'),
        formData.get('date'),
        state.profile
      );

      if (!result.ok) {
        alert(result.error);
        return;
      }

      closeModal('write-off-debt');
      refresh();
    }
  });
}
