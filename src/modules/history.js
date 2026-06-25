import {
  getUserTransactions,
  canCancelTransaction,
  updateTransactionMeta,
  TYPE_LABELS,
  AUTHOR_LABELS,
  TRANSACTION_STATUS,
  todayIso
} from './transactions.js';
import { undoTransaction } from './financeGate.js';
import { openModal, closeModal, isWithinAppUi, findAppForm } from './modalLayer.js';
function formatMoney(amount, currency = 'RUB') {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'USD' ? 2 : 0
  }).format(amount ?? 0);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTransactionAmount(tx) {
  if (tx.type === 'account_transfer') {
    const src = formatMoney(tx.sourceAmount ?? tx.amount, tx.sourceCurrency ?? tx.currency ?? 'RUB');
    const dest = formatMoney(tx.destAmount ?? tx.amount, tx.destCurrency ?? tx.currency ?? 'RUB');
    return `${src} → ${dest}`;
  }

  if (tx.type === 'expense' && tx.accountCurrency === 'USD' && tx.accountDebitAmount != null) {
    return `${formatMoney(tx.amount, 'RUB')} (${formatMoney(tx.accountDebitAmount, 'USD')})`;
  }

  if (tx.type === 'account_updated') {
    const parts = [];
    if (tx.oldName !== tx.newName) {
      parts.push(`«${tx.oldName}» → «${tx.newName}»`);
    }
    if (tx.oldBalance !== tx.newBalance) {
      const currency = tx.newCurrency ?? tx.oldCurrency ?? 'RUB';
      parts.push(`${formatMoney(tx.oldBalance, currency)} → ${formatMoney(tx.newBalance, currency)}`);
    }
    if (tx.oldCurrency !== tx.newCurrency) {
      parts.push(`${tx.oldCurrency} → ${tx.newCurrency}`);
    }
    return parts.length ? parts.join('; ') : '—';
  }

  if (tx.type === 'account_deleted') {
    const owner = AUTHOR_LABELS[tx.accountOwner] ?? tx.accountOwner ?? '—';
    return `${tx.accountName ?? 'Счёт'} (${owner}) — ${formatMoney(tx.amount, tx.currency ?? 'RUB')}`;
  }

  if (tx.type === 'account_created') {
    const owner = AUTHOR_LABELS[tx.accountOwner] ?? tx.accountOwner ?? '—';
    return `${tx.accountName ?? 'Счёт'} (${owner}) — ${formatMoney(tx.amount, tx.currency ?? 'RUB')}`;
  }

  if (tx.type === 'category_deleted') {
    const reserved = tx.amount ?? 0;
    if (reserved > 0) {
      return `${tx.categoryName ?? 'Категория'} — ${formatMoney(reserved)} в резерве`;
    }
    return tx.categoryName ?? 'Категория';
  }

  return formatMoney(tx.amount, tx.currency ?? 'RUB');
}

function canManageTransaction(state, tx) {
  return canCancelTransaction(state, tx);
}

function canEditTransaction(tx) {
  return tx.status === TRANSACTION_STATUS.ACTIVE && !tx.service;
}
const SAVING_HISTORY_LABELS = {
  saving_deposit: 'Пополнение',
  saving_withdraw: 'Возврат',
  saving_spend: 'Потрачено'
};

function getTransactionTypeLabel(tx) {
  return SAVING_HISTORY_LABELS[tx.type] ?? TYPE_LABELS[tx.type] ?? tx.type;
}

function renderTransactionRow(state, tx) {
  const dateLabel = tx.date ? new Date(tx.date).toLocaleDateString('ru-RU') : '—';
  const typeLabel = getTransactionTypeLabel(tx);
  const authorLabel = AUTHOR_LABELS[tx.author] ?? tx.author;
  const isCancelled = tx.status === TRANSACTION_STATUS.CANCELLED;
  const statusLabel = isCancelled ? 'Отменена' : 'Активна';
  const statusClass = isCancelled ? 'text-slate-400 line-through' : 'text-slate-900';
  const comment = tx.comment ? escapeHtml(tx.comment) : '—';
  const amount = formatTransactionAmount(tx);

  return `
    <tr class="border-t border-slate-100 ${isCancelled ? 'bg-slate-50/80' : ''}" data-transaction-id="${tx.id}">
      <td class="py-3 px-2 text-sm ${statusClass} whitespace-nowrap">${dateLabel}</td>
      <td class="py-3 px-2 text-sm ${statusClass}">${typeLabel}</td>
      <td class="py-3 px-2 text-sm font-medium ${isCancelled ? 'text-slate-400 line-through' : 'text-slate-900'}">${amount}</td>
      <td class="py-3 px-2 text-sm ${statusClass}">${authorLabel}</td>
      <td class="py-3 px-2 text-sm ${isCancelled ? 'text-slate-400' : 'text-emerald-700'}">${statusLabel}</td>
      <td class="py-3 px-2 text-sm ${statusClass} max-w-[160px] truncate" title="${comment}">${comment}</td>
      <td class="py-3 px-2 text-right whitespace-nowrap">
        ${canEditTransaction(tx) ? `
          <button
            type="button"
            data-action="edit-transaction"
            data-transaction-id="${tx.id}"
            class="px-2 py-1 text-xs font-medium rounded text-slate-600 hover:bg-slate-100 mr-1"
          >Изменить</button>
        ` : ''}
        ${canManageTransaction(state, tx) ? `
          <button
            type="button"
            data-action="cancel-transaction"
            data-transaction-id="${tx.id}"
            class="px-2 py-1 text-xs font-medium rounded text-red-600 hover:bg-red-50"
          >Отменить</button>
        ` : ''}
      </td>    </tr>
  `;
}

function renderEditModal() {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="edit-transaction">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-4">Редактирование операции</h3>
        <p class="text-xs text-slate-400 mb-4">Можно изменить только комментарий и дату.</p>
        <form data-form="edit-transaction" class="space-y-4">
          <input type="hidden" name="transactionId" value="">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Комментарий</label>
            <input
              type="text"
              name="comment"
              maxlength="200"
              class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Дата</label>
            <input
              type="date"
              name="date"
              required
              class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
          </div>
          <div class="flex gap-2 pt-2">
            <button
              type="button"
              data-action="close-modal"
              data-modal="edit-transaction"
              class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
            >Отмена</button>
            <button
              type="submit"
              class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700"
            >Сохранить</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function renderHistory(state, container) {
  const transactions = getUserTransactions(state);

  const rows = transactions.length
    ? transactions.map((tx) => renderTransactionRow(state, tx)).join('')
    : `
      <tr>
        <td colspan="7" class="py-10 text-center text-slate-500 text-sm">Операций пока нет</td>
      </tr>
    `;

  container.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <h2 class="text-lg font-semibold text-slate-900 mb-4">История</h2>
      <div class="overflow-x-auto -mx-2 px-2">
        <table class="w-full min-w-[720px]">
          <thead>
            <tr class="text-left text-xs font-medium text-slate-400 uppercase tracking-wide">
              <th class="py-2 px-2">Дата</th>
              <th class="py-2 px-2">Тип</th>
              <th class="py-2 px-2">Сумма</th>
              <th class="py-2 px-2">Автор</th>
              <th class="py-2 px-2">Статус</th>
              <th class="py-2 px-2">Комментарий</th>
              <th class="py-2 px-2 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
    ${renderEditModal()}
  `;
}

function refresh(state, container, onUpdate) {
  renderHistory(state, container);
  if (typeof onUpdate === 'function') {
    onUpdate();
  }
}

export function initHistoryHandlers(state, container, onUpdate) {
  if (container.dataset.historyHandlersBound === 'true') return;
  container.dataset.historyHandlersBound = 'true';

  document.addEventListener('click', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    const target = event.target;

    if (target.closest('[data-action="close-modal"]')) {
      const btn = target.closest('[data-action="close-modal"]');
      closeModal(btn.dataset.modal);
      return;
    }

    if (target.closest('[data-action="cancel-transaction"]')) {
      const btn = target.closest('[data-action="cancel-transaction"]');
      if (!confirm('Отменить операцию? Деньги будут возвращены на место.')) return;

      const result = undoTransaction(state, btn.dataset.transactionId);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      refresh(state, container, onUpdate);
      return;
    }

    if (target.closest('[data-action="edit-transaction"]')) {
      const btn = target.closest('[data-action="edit-transaction"]');
      const tx = getUserTransactions(state).find((item) => item.id === btn.dataset.transactionId);
      const form = findAppForm('edit-transaction', container);
      if (tx && form) {
        form.transactionId.value = tx.id;
        form.comment.value = tx.comment ?? '';
        form.date.value = tx.date || todayIso();
      }
      openModal('edit-transaction');
    }
  });

  document.addEventListener('submit', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    event.preventDefault();

    const form = event.target.closest('[data-form="edit-transaction"]');
    if (!form) return;

    const result = updateTransactionMeta(state, form.transactionId.value, {
      comment: form.comment.value,
      date: form.date.value
    });

    if (!result.ok) {
      alert(result.error);
      return;
    }

    closeModal('edit-transaction');
    refresh(state, container, onUpdate);
  });
}
