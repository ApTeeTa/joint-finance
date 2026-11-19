import { UI } from './uiTheme.js';
import {
  getUserTransactions,
  canCancelTransaction,
  updateTransactionMeta,
  TYPE_LABELS,
  AUTHOR_LABELS,
  TRANSACTION_STATUS,
  TRANSACTION_TYPES,
  todayIso,
  renderAccountSelectOptions,
  isMiscCategory,
  findTransaction
} from './transactions.js';
import {
  undoTransaction,
  createUncategorizedExpense,
  reassignExpense
} from './financeGate.js';
import { openModal, closeModal, isWithinAppUi, findAppForm } from './modalLayer.js';
import { runGuardedModalSubmit } from './modalFormSubmit.js';
import { resolveCategoryMonthlyLimitBeforeExpense } from './categoryLimitConfirmModal.js';
import { notifyConfirm, notifyError, showJfError } from './jfNotifyModal.js';
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

function findAccountById(state, accountId) {
  if (!accountId) return null;
  return (state.accounts ?? []).find((account) => account.id === accountId);
}

function getTransactionAccountLine(state, tx) {
  if (tx.type === 'account_transfer') {
    const source = findAccountById(state, tx.sourceAccountId);
    const dest = findAccountById(state, tx.destAccountId);
    if (source && dest) {
      return `${source.name} → ${dest.name}`;
    }
    return 'Между счетами';
  }

  const account = findAccountById(state, tx.accountId ?? tx.sourceAccountId);
  return account?.name ?? '—';
}

function truncateHistoryPreview(text, maxLen = 28) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}

function getHistoryAmountToneClass(tx, isCancelled) {
  if (isCancelled) return 'text-slate-400';
  if (tx.type === TRANSACTION_TYPES.EXPENSE || tx.type === TRANSACTION_TYPES.SAVING_SPEND) {
    return 'text-red-600';
  }
  if (tx.type === TRANSACTION_TYPES.ACCOUNT_DEPOSIT
    || tx.type === TRANSACTION_TYPES.SAVING_DEPOSIT
    || tx.type === TRANSACTION_TYPES.CATEGORY_UNRESERVE) {
    return 'text-emerald-600';
  }
  return 'text-slate-900';
}

function getTransactionCategoryLine(state, tx) {
  if (tx.type === 'account_transfer') {
    return 'Между счетами';
  }
  const category = (state.categories ?? []).find((item) => item.id === tx.categoryId);
  if (category?.name) {
    return category.name;
  }
  if (tx.categoryName) {
    return tx.categoryName;
  }
  return '';
}

function renderTransactionActions(state, tx) {
  return `
    ${canEditTransaction(tx) ? `
      <button
        type="button"
        data-action="edit-transaction"
        data-transaction-id="${tx.id}"
        class="px-2 py-1 text-xs font-medium rounded text-slate-600 hover:bg-slate-100"
      >Изменить</button>
    ` : ''}
    ${tx.userCategoryPending && canEditTransaction(tx) ? `
      <button
        type="button"
        data-action="reassign-expense"
        data-transaction-id="${tx.id}"
        class="px-2 py-1 text-xs font-medium rounded text-amber-700 hover:bg-amber-50"
      >Категория</button>
    ` : ''}
    ${canManageTransaction(state, tx) ? `
      <button
        type="button"
        data-action="cancel-transaction"
        data-transaction-id="${tx.id}"
        class="px-2 py-1 text-xs font-medium rounded text-red-600 hover:bg-red-50"
      >Отменить</button>
    ` : ''}
  `.trim();
}
const SAVING_HISTORY_LABELS = {
  saving_deposit: 'Пополнение',
  saving_withdraw: 'Возврат',
  saving_spend: 'Потрачено'
};

function getTransactionTypeLabel(tx) {
  return SAVING_HISTORY_LABELS[tx.type] ?? TYPE_LABELS[tx.type] ?? tx.type;
}

const HISTORY_FILTERS = {
  ALL: 'all',
  ACTIVE: 'active',
  CANCELLED: 'cancelled',
  UNCATEGORIZED: 'uncategorized'
};

function getHistoryFilter(container) {
  const value = container?.dataset?.historyFilter;
  return Object.values(HISTORY_FILTERS).includes(value) ? value : HISTORY_FILTERS.ALL;
}

function filterHistoryTransactions(transactions, filter) {
  if (filter === HISTORY_FILTERS.ACTIVE) {
    return transactions.filter((tx) => tx.status === TRANSACTION_STATUS.ACTIVE);
  }
  if (filter === HISTORY_FILTERS.CANCELLED) {
    return transactions.filter((tx) => tx.status === TRANSACTION_STATUS.CANCELLED);
  }
  if (filter === HISTORY_FILTERS.UNCATEGORIZED) {
    return transactions.filter((tx) => tx.userCategoryPending === true);
  }
  return transactions;
}

function getHistoryCategoryFilter(container) {
  const value = container?.dataset?.historyCategoryFilter;
  return typeof value === 'string' ? value : '';
}

function getHistorySearchQuery(container) {
  const value = container?.dataset?.historySearch;
  return typeof value === 'string' ? value : '';
}

function findCategoryName(state, categoryId) {
  const category = (state.categories ?? []).find((item) => item.id === categoryId);
  return category?.name ?? '';
}

/** Только активные расходы выбранной категории (доходы и прочие типы исключаются). */
export function applyHistoryCategoryExpenseFilter(transactions, categoryId) {
  if (!categoryId) {
    return transactions;
  }
  return transactions.filter(
    (tx) => tx.type === TRANSACTION_TYPES.EXPENSE && tx.categoryId === categoryId
  );
}

export function applyHistorySearchFilter(transactions, state, searchQuery) {
  const query = String(searchQuery ?? '').trim().toLowerCase();
  if (!query) {
    return transactions;
  }
  return transactions.filter((tx) => {
    const categoryLine = getTransactionCategoryLine(state, tx);
    const typeLabel = getTransactionTypeLabel(tx);
    const haystack = [
      tx.comment,
      categoryLine,
      typeLabel,
      String(tx.amount ?? ''),
      tx.date,
      tx.accountId
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  });
}

export function applyHistoryViewFilters(state, transactions, options = {}) {
  const statusFilter = options.statusFilter ?? HISTORY_FILTERS.ALL;
  const categoryId = options.categoryId ?? '';
  const searchQuery = options.searchQuery ?? '';

  let list = filterHistoryTransactions(transactions, statusFilter);
  list = applyHistoryCategoryExpenseFilter(list, categoryId);
  list = applyHistorySearchFilter(list, state, searchQuery);
  return list;
}

function renderHistoryCategoryFilterOptions(state, selectedId) {
  const categories = (state.categories ?? []).filter((category) => Boolean(category?.id));
  const options = categories.map((category) => {
    const selected = category.id === selectedId ? 'selected' : '';
    return `<option value="${escapeHtml(category.id)}" ${selected}>${escapeHtml(category.name)}</option>`;
  });
  return `<option value="" ${selectedId ? '' : 'selected'}>Все категории</option>${options.join('')}`;
}

function renderHistoryEmptyMessage(state, options, hasRows) {
  if (hasRows) {
    return null;
  }
  const total = getUserTransactions(state).length;
  if (total === 0) {
    return 'Операций пока нет';
  }
  const { categoryId, searchQuery } = options;
  const search = String(searchQuery ?? '').trim();
  if (categoryId) {
    const name = findCategoryName(state, categoryId);
    if (name) {
      return `По категории «${name}» операций не найдено`;
    }
    return 'По выбранной категории операций не найдено';
  }
  if (search) {
    return 'По заданным фильтрам операций не найдено';
  }
  return 'Операций не найдено';
}

function renderCategoryOptions(state) {
  const options = (state.categories ?? [])
    .filter((category) => !isMiscCategory(category))
    .map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`)
    .join('');
  return `<option value="">Выберите категорию</option>${options}`;
}

function renderTransactionRow(state, tx) {
  const dateLabel = tx.date ? new Date(tx.date).toLocaleDateString('ru-RU') : '—';
  const typeLabel = getTransactionTypeLabel(tx);
  const authorLabel = AUTHOR_LABELS[tx.author] ?? tx.author;
  const isCancelled = tx.status === TRANSACTION_STATUS.CANCELLED;
  const pendingBadge = tx.userCategoryPending
    ? '<span class="ml-1 text-[10px] font-semibold uppercase text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">Без категории</span>'
    : '';
  const statusLabel = isCancelled ? 'Отменено' : 'Активна';
  const statusClass = isCancelled ? 'text-slate-400 line-through' : 'text-slate-900';
  const comment = `${tx.comment ? escapeHtml(tx.comment) : '—'}${pendingBadge}`;
  const amount = formatTransactionAmount(tx);
  const actions = renderTransactionActions(state, tx);

  return `
    <tr class="border-t border-slate-100 ${isCancelled ? 'bg-slate-50/80' : ''}" data-transaction-id="${tx.id}">
      <td class="py-3 px-2 text-sm ${statusClass} whitespace-nowrap">${dateLabel}</td>
      <td class="py-3 px-2 text-sm ${statusClass} break-words">${typeLabel}</td>
      <td class="py-3 px-2 text-sm font-medium ${isCancelled ? 'text-slate-400 line-through' : 'text-slate-900'} break-words">${amount}</td>
      <td class="py-3 px-2 text-sm ${statusClass} break-words">${authorLabel}</td>
      <td class="py-3 px-2 text-sm ${isCancelled ? 'text-slate-400' : 'text-emerald-700'}">${statusLabel}</td>
      <td class="py-3 px-2 text-sm ${statusClass} break-words align-top">${comment}</td>
      <td class="py-3 px-2 text-right align-top">
        <div class="flex flex-wrap justify-end gap-1">${actions}</div>
      </td>
    </tr>
  `;
}

function renderTransactionCard(state, tx) {
  const dateLabel = tx.date ? new Date(tx.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '—';
  const typeLabel = getTransactionTypeLabel(tx);
  const authorLabel = AUTHOR_LABELS[tx.author] ?? tx.author ?? '—';
  const isCancelled = tx.status === TRANSACTION_STATUS.CANCELLED;
  const statusLabel = isCancelled ? 'Отменено' : 'Активна';
  const amountTone = getHistoryAmountToneClass(tx, isCancelled);
  const amountClass = isCancelled ? `${amountTone} line-through` : amountTone;
  const amount = formatTransactionAmount(tx);
  const categoryLine = getTransactionCategoryLine(state, tx);
  const headline = escapeHtml(categoryLine || typeLabel);
  const accountLine = escapeHtml(getTransactionAccountLine(state, tx));
  const commentPreview = truncateHistoryPreview(tx.comment);
  const commentText = tx.comment ? escapeHtml(tx.comment) : '';
  const pendingBadge = tx.userCategoryPending
    ? '<span class="inline-block text-[10px] font-semibold uppercase text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">Без категории</span>'
    : '';
  const actions = renderTransactionActions(state, tx);

  return `
    <article
      class="rounded-lg border border-slate-200/90 bg-white shadow-sm ${isCancelled ? 'opacity-80' : ''}"
      data-transaction-id="${tx.id}"
      data-history-card
      data-history-expanded="false"
    >
      <button
        type="button"
        data-action="toggle-history-card"
        class="w-full text-left px-2.5 py-2 flex items-center gap-2 min-w-0 touch-manipulation"
        aria-expanded="false"
        data-history-card-summary
      >
        <span class="text-[11px] tabular-nums text-slate-500 shrink-0 w-[2.75rem]">${dateLabel}</span>
        <span class="text-xs text-slate-700 truncate min-w-0 flex-1">${headline}</span>
        <span class="text-sm font-semibold tabular-nums shrink-0 ${amountClass}">${amount}</span>
        ${commentPreview
          ? `<span class="text-[11px] text-slate-400 truncate max-w-[4.75rem] sm:max-w-[6.5rem] min-w-0">${escapeHtml(commentPreview)}</span>`
          : ''}
        <span class="shrink-0 text-slate-400" data-history-chevron aria-hidden="true">
          <svg class="w-4 h-4 transition-transform duration-150" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.293l3.71-4.06a.75.75 0 111.08 1.04l-4.24 4.65a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>
        </span>
      </button>
      <div
        data-history-card-details
        class="hidden border-t border-slate-100 px-2.5 pb-2.5 pt-2 space-y-2"
      >
        <p class="text-xs text-slate-500">Тип: <span class="text-slate-700">${escapeHtml(typeLabel)}</span></p>
        <p class="text-xs text-slate-500">Счёт: <span class="text-slate-700">${accountLine}</span></p>
        <p class="text-xs text-slate-500">Автор: <span class="text-slate-700">${escapeHtml(authorLabel)}</span> · ${escapeHtml(statusLabel)}</p>
        ${commentText
          ? `<p class="text-sm text-slate-700 break-words whitespace-normal" data-history-card-comment>${commentText}</p>`
          : '<p class="text-xs text-slate-400">Без комментария</p>'}
        ${pendingBadge}
        ${actions ? `<div class="flex flex-wrap gap-1.5 pt-1">${actions}</div>` : ''}
      </div>
    </article>
  `;
}

function renderEditModal() {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="edit-transaction">
      <div class="${UI.modalShell} ${UI.modalBody}">
        <h3 class="${UI.modalTitle} mb-4">Редактирование операции</h3>
        <p class="text-xs text-slate-400 mb-4">Можно изменить только комментарий и дату.</p>
        <form data-form="edit-transaction" class="space-y-4">
          <input type="hidden" name="transactionId" value="">
          <div>
            <label class="${UI.label}">Комментарий</label>
            <input
              type="text"
              name="comment"
              maxlength="200"
              class="${UI.field}"
            >
          </div>
          <div>
            <label class="${UI.label}">Дата</label>
            <input
              type="date"
              name="date"
              required
              class="${UI.field}"
            >
          </div>
          <div class="flex gap-2 pt-2">
            <button
              type="button"
              data-action="close-modal"
              data-modal="edit-transaction"
              class="${UI.btnCancelBlock}"
            >Отмена</button>
            <button
              type="submit"
              class="${UI.btnPrimaryBlock}"
            >Сохранить</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderReassignModal(state) {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="reassign-expense">
      <div class="${UI.modalShell} ${UI.modalBody}">
        <h3 class="${UI.modalTitle} mb-4">Назначить категорию</h3>
        <form data-form="reassign-expense" class="space-y-4">
          <input type="hidden" name="transactionId" value="">
          <div>
            <label class="${UI.label}">Категория</label>
            <select name="categoryId" required class="${UI.field}">${renderCategoryOptions(state)}</select>
          </div>
          <p class="text-xs text-slate-400">Сумма, дата и счёт не меняются. Для переноса в категории нужен достаточный резерв.</p>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="reassign-expense" class="${UI.btnCancelBlock}">Отмена</button>
            <button type="submit" class="${UI.btnPrimaryBlock}">Сохранить</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderUncategorizedExpenseModal(state) {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="uncategorized-expense">
      <div class="${UI.modalShell} ${UI.modalBody}">
        <h3 class="${UI.modalTitle} mb-4">Расход без категории</h3>
        <form data-form="uncategorized-expense" class="space-y-4">
          <div>
            <label class="${UI.label}">Сумма (RUB)</label>
            <input type="number" name="amount" required min="0.01" step="0.01" class="${UI.field}" placeholder="0">
          </div>
          <div>
            <label class="${UI.label}">Счёт</label>
            <select name="accountId" required class="${UI.field}">${renderAccountSelectOptions(state)}</select>
          </div>
          <div>
            <label class="${UI.label}">Комментарий</label>
            <input type="text" name="comment" maxlength="200" class="${UI.field}" placeholder="Необязательно">
          </div>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="uncategorized-expense" class="${UI.btnCancelBlock}">Отмена</button>
            <button type="submit" class="${UI.btnPrimaryBlock}">Сохранить</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function renderHistory(state, container) {
  const filter = getHistoryFilter(container);
  const categoryFilter = getHistoryCategoryFilter(container);
  const searchQuery = getHistorySearchQuery(container);
  const allTransactions = getUserTransactions(state);
  const transactions = applyHistoryViewFilters(state, allTransactions, {
    statusFilter: filter,
    categoryId: categoryFilter,
    searchQuery
  });

  const emptyLabel = renderHistoryEmptyMessage(state, { categoryId: categoryFilter, searchQuery }, transactions.length > 0);
  const emptyHistory = `<p class="py-10 text-center text-slate-500 text-sm">${escapeHtml(emptyLabel ?? 'Операций пока нет')}</p>`;

  const rows = transactions.length
    ? transactions.map((tx) => renderTransactionRow(state, tx)).join('')
    : `
      <tr>
        <td colspan="7" class="py-10 text-center text-slate-500 text-sm">${escapeHtml(emptyLabel ?? 'Операций пока нет')}</td>
      </tr>
    `;

  const cards = transactions.length
    ? transactions.map((tx) => renderTransactionCard(state, tx)).join('')
    : emptyHistory;

  container.innerHTML = `
    <div class="${UI.panel} ${UI.panelPadding}">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 class="${UI.panelTitle}">История</h2>
        <div class="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
          <label class="text-xs text-slate-500 shrink-0">Фильтр</label>
          <select data-history-filter-select class="${UI.field} text-sm py-1.5 min-w-0 w-[7.5rem] sm:w-[9rem] max-w-[45vw]">
            <option value="all" ${filter === 'all' ? 'selected' : ''}>Все</option>
            <option value="active" ${filter === 'active' ? 'selected' : ''}>Активные</option>
            <option value="cancelled" ${filter === 'cancelled' ? 'selected' : ''}>Отменённые</option>
            <option value="uncategorized" ${filter === 'uncategorized' ? 'selected' : ''}>Без категории</option>
          </select>
          <label class="text-xs text-slate-500 shrink-0">Категория</label>
          <select data-history-category-filter-select class="${UI.field} text-sm py-1.5 min-w-0 w-[8rem] sm:w-[10rem] max-w-[50vw]" title="${categoryFilter ? escapeHtml(findCategoryName(state, categoryFilter)) : 'Все категории'}">
            ${renderHistoryCategoryFilterOptions(state, categoryFilter)}
          </select>
          <label class="sr-only" for="history-search-input">Поиск</label>
          <input
            id="history-search-input"
            type="search"
            data-history-search-input
            value="${escapeHtml(searchQuery)}"
            placeholder="Поиск"
            class="${UI.field} text-sm py-1.5 min-w-0 w-[6.5rem] sm:w-[9rem] max-w-[40vw]"
            autocomplete="off"
          />
          <button type="button" data-action="open-uncategorized-expense" class="${UI.btnPrimary} text-sm shrink-0">Расход без категории</button>
        </div>
      </div>
      <div class="md:hidden min-w-0 space-y-1" data-history-cards-root>
        ${cards}
      </div>
      <div class="hidden md:block min-w-0 w-full -mx-2 px-2" data-history-table-root>
        <table class="w-full table-fixed history-table text-sm">
          <colgroup>
            <col style="width:11%">
            <col style="width:12%">
            <col style="width:17%">
            <col style="width:10%">
            <col style="width:10%">
            <col style="width:24%">
            <col style="width:16%">
          </colgroup>
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
    ${renderReassignModal(state)}
    ${renderUncategorizedExpenseModal(state)}
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

  document.addEventListener('click', async (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    const target = event.target;

    if (target.closest('[data-action="close-modal"]')) {
      const btn = target.closest('[data-action="close-modal"]');
      closeModal(btn.dataset.modal);
      return;
    }

    if (target.closest('[data-action="toggle-history-card"]')) {
      const toggle = target.closest('[data-action="toggle-history-card"]');
      const card = toggle?.closest('[data-history-card]');
      if (!card) return;
      const expanded = card.dataset.historyExpanded === 'true';
      const nextExpanded = !expanded;
      card.dataset.historyExpanded = nextExpanded ? 'true' : 'false';
      toggle.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
      const details = card.querySelector('[data-history-card-details]');
      details?.classList.toggle('hidden', !nextExpanded);
      const chevron = card.querySelector('[data-history-chevron] svg');
      chevron?.classList.toggle('rotate-180', nextExpanded);
      return;
    }

    if (target.closest('[data-action="cancel-transaction"]')) {
      const btn = target.closest('[data-action="cancel-transaction"]');
      if (!(await notifyConfirm('Отменить операцию? Деньги будут возвращены на место.'))) return;

      const result = undoTransaction(state, btn.dataset.transactionId);
      if (!result.ok) {
        notifyError(result.error);
        return;
      }
      refresh(state, container, onUpdate);
      return;
    }

    if (target.closest('[data-action="edit-transaction"]')) {
      const btn = target.closest('[data-action="edit-transaction"]');
      const tx = getUserTransactions(state).find((item) => item.id === btn.dataset.transactionId);
      if (!tx) return;
      openModal('edit-transaction', {
        pinnedFields: {
          transactionId: tx.id,
          comment: tx.comment ?? '',
          date: tx.date || todayIso()
        }
      });
      return;
    }

    if (target.closest('[data-action="reassign-expense"]')) {
      const btn = target.closest('[data-action="reassign-expense"]');
      openModal('reassign-expense', {
        pinnedFields: { transactionId: btn.dataset.transactionId, categoryId: '' }
      });
      return;
    }

    if (target.closest('[data-action="open-uncategorized-expense"]')) {
      openModal('uncategorized-expense', {
        pinnedFields: { amount: '', comment: '', accountId: '' }
      });
    }
  });

  container.addEventListener('change', (event) => {
    const statusSelect = event.target.closest('[data-history-filter-select]');
    if (statusSelect) {
      container.dataset.historyFilter = statusSelect.value;
      refresh(state, container, onUpdate);
      return;
    }
    const categorySelect = event.target.closest('[data-history-category-filter-select]');
    if (categorySelect) {
      container.dataset.historyCategoryFilter = categorySelect.value;
      refresh(state, container, onUpdate);
    }
  });

  let searchDebounceId;
  container.addEventListener('input', (event) => {
    const searchInput = event.target.closest('[data-history-search-input]');
    if (!searchInput) return;
    clearTimeout(searchDebounceId);
    searchDebounceId = setTimeout(() => {
      container.dataset.historySearch = searchInput.value;
      refresh(state, container, onUpdate);
    }, 200);
  });

  document.addEventListener('submit', async (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    event.preventDefault();

    const editForm = event.target.closest('[data-form="edit-transaction"]');
    if (editForm) {
      await runGuardedModalSubmit('edit-transaction', editForm, async () => {
        const result = updateTransactionMeta(state, editForm.transactionId.value, {
          comment: editForm.comment.value,
          date: editForm.date.value
        });
        if (!result.ok) {
          notifyError(result.error);
          return false;
        }
        refresh(state, container, onUpdate);
        return true;
      });
      return;
    }

    const reassignForm = event.target.closest('[data-form="reassign-expense"]');
    if (reassignForm) {
      const tx = findTransaction(state, reassignForm.transactionId.value);
      const targetCategoryId = reassignForm.categoryId.value;
      const expenseDate = tx?.date || todayIso();
      const limitStep = await resolveCategoryMonthlyLimitBeforeExpense(
        state,
        targetCategoryId,
        tx?.amount,
        expenseDate
      );
      if (!limitStep.proceed) {
        return;
      }
      await runGuardedModalSubmit('reassign-expense', reassignForm, async () => {
        const result = reassignExpense(
          state,
          reassignForm.transactionId.value,
          targetCategoryId,
          state.profile,
          { monthlyLimitAcknowledged: limitStep.monthlyLimitAcknowledged }
        );
        if (!result.ok) {
          await showJfError(result.error);
          return false;
        }
        refresh(state, container, onUpdate);
        return true;
      });
      return;
    }

    const uncategorizedForm = event.target.closest('[data-form="uncategorized-expense"]');
    if (uncategorizedForm) {
      await runGuardedModalSubmit('uncategorized-expense', uncategorizedForm, async () => {
        const result = createUncategorizedExpense(
          state,
          uncategorizedForm.amount.value,
          uncategorizedForm.accountId.value,
          uncategorizedForm.comment.value,
          todayIso(),
          state.profile
        );
        if (!result.ok) {
          notifyError(result.error);
          return false;
        }
        refresh(state, container, onUpdate);
        return true;
      });
    }
  });
}
