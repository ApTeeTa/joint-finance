import { calculateFreeBalance } from './financeEngine.js';
import {
  createExpense,
  reserveCategory,
  unreserveCategory,
  deleteCategory as recordCategoryDeletion
} from './financeGate.js';
import { todayIso, getCategoryTransactions, renderAccountSelectOptions, TYPE_LABELS, isMiscCategory, MISC_CATEGORY_NAME } from './transactions.js';

const OWNER_LABELS = {
  husband: 'Муж',
  wife: 'Жена'
};

const ICONS = {
  pencil: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4"><path d="m2.695 14.763-1.262 3.154a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.885L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.42a4 4 0 0 0-.885 1.343Z"/></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 0 0-.584.788 48.065 48.065 0 0 0 .522 7.403.75.75 0 0 0 .43.375A48.112 48.112 0 0 0 8 14.25c0 1.246.124 2.503.38 3.75a.75.75 0 0 0 .75.568h7.5a.75.75 0 0 0 .75-.568c.256-1.247.38-2.504.38-3.75a48.112 48.112 0 0 0-3.439-.908.75.75 0 0 0-.43-.375 48.65 48.65 0 0 0-2.365-.298V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM9.5 3.75V5h1V3.75a.25.25 0 0 0-.25-.25h-.5a.25.25 0 0 0-.25.25ZM4.5 6.75v8.5c0 .414.336.75.75.75h9.5a.75.75 0 0 0 .75-.75v-8.5h-11Z" clip-rule="evenodd"/></svg>`,
  reserve: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11.25a.75.75 0 0 0-1.5 0v2.5h-2.5a.75.75 0 0 0 0 1.5h2.5v2.5a.75.75 0 0 0 1.5 0v-2.5h2.5a.75.75 0 0 0 0-1.5h-2.5v-2.5Z" clip-rule="evenodd"/></svg>`,
  unreserve: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM7 9.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z" clip-rule="evenodd"/></svg>`,
  dots: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5"><path d="M10 3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM10 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM11.5 15.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0Z"/></svg>`
};

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

function createId(prefix) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function findCategory(state, categoryId) {
  return (state.categories ?? []).find((category) => category.id === categoryId);
}

function findAccount(state, accountId) {
  return (state.accounts ?? []).find((account) => account.id === accountId);
}

function getFreeBalance(state) {
  return calculateFreeBalance(state);
}

function getCategoryAvailableDisplay(category) {
  const limit = category.limit ?? 0;
  const spent = category.spent ?? 0;
  return limit - spent;
}

function getTransactionTypeLabel(tx) {
  const userLabels = {
    expense: 'Расход',
    reserve: 'Пополнение',
    category_unreserve: 'Возврат',
    category_deleted: 'Удаление категории'
  };

  return userLabels[tx.type] ?? TYPE_LABELS[tx.type] ?? tx.type;
}

function getLimitOverflow(category) {
  const limit = category.limit ?? 0;
  const spent = category.spent ?? 0;
  return Math.max(0, spent - limit);
}

function isOverLimit(category) {
  return getLimitOverflow(category) > 0;
}

function showLimitWarning(category) {
  const overflow = getLimitOverflow(category);
  if (overflow > 0) {
    alert(
      `⚠ Вы превысили лимит категории на ${formatMoney(overflow)}. Рекомендуется увеличить лимит.`
    );
  }
}

function renderAccountOptions(state, selectedId = '') {
  return renderAccountSelectOptions(state, selectedId);
}

function validateCategoryName(name) {
  if (!name || !String(name).trim()) {
    return 'Введите название категории';
  }
  return null;
}

function validateLimit(limit) {
  const value = Number(limit);
  if (!Number.isFinite(value) || value < 0) {
    return 'Лимит не может быть отрицательным';
  }
  return null;
}

function validatePositiveAmount(amount, label = 'Сумма') {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return `${label} должна быть больше 0`;
  }
  return null;
}

function createCategory(state, name, limit) {
  const nameError = validateCategoryName(name);
  if (nameError) {
    alert(nameError);
    return false;
  }

  const limitError = validateLimit(limit);
  if (limitError) {
    alert(limitError);
    return false;
  }

  if (String(name).trim() === MISC_CATEGORY_NAME) {
    alert('Название «Прочее» зарезервировано для системной категории');
    return false;
  }

  if (!Array.isArray(state.categories)) {
    state.categories = [];
  }

  state.categories.push({
    id: createId('category'),
    name: String(name).trim(),
    limit: Number(limit) || 0,
    reserved: 0,
    spent: 0,
    createdAt: new Date().toISOString()
  });

  return true;
}

function updateCategory(state, categoryId, name, limit) {
  const nameError = validateCategoryName(name);
  if (nameError) {
    alert(nameError);
    return false;
  }

  const limitError = validateLimit(limit);
  if (limitError) {
    alert(limitError);
    return false;
  }

  const category = findCategory(state, categoryId);
  if (!category) {
    alert('Категория не найдена');
    return false;
  }

  if (isMiscCategory(category)) {
    alert('Системную категорию нельзя редактировать');
    return false;
  }

  category.name = String(name).trim();
  category.limit = Number(limit) || 0;
  return true;
}

function deleteCategory(state, categoryId) {
  const category = findCategory(state, categoryId);
  if (!category) {
    alert('Категория не найдена');
    return false;
  }

  if (isMiscCategory(category)) {
    alert('Системную категорию «Прочее» нельзя удалить');
    return false;
  }

  const result = recordCategoryDeletion(state, category, state.profile);
  if (!result.ok) {
    alert(result.error);
    return false;
  }

  state.categories = (state.categories ?? []).filter((item) => item.id !== categoryId);
  return true;
}

function reserveFunds(state, categoryId, amount) {
  const amountError = validatePositiveAmount(amount, 'Сумма');
  if (amountError) {
    alert(amountError);
    return false;
  }

  const category = findCategory(state, categoryId);
  if (!category) {
    alert('Категория не найдена');
    return false;
  }

  if (isMiscCategory(category)) {
    alert('Для системной категории пополнение недоступно');
    return false;
  }

  const value = Number(amount);
  const freeBalance = getFreeBalance(state);

  if (value > freeBalance) {
    alert('Недостаточно средств для пополнения категории.');
    return false;
  }

  const result = reserveCategory(
    state,
    categoryId,
    value,
    `Пополнение: ${category.name}`,
    todayIso(),
    state.profile
  );

  if (!result.ok) {
    alert(result.error);
    return false;
  }

  return true;
}

function unreserveFunds(state, categoryId, amount) {
  const amountError = validatePositiveAmount(amount, 'Сумма возврата');
  if (amountError) {
    alert(amountError);
    return false;
  }

  const category = findCategory(state, categoryId);
  if (!category) {
    alert('Категория не найдена');
    return false;
  }

  if (isMiscCategory(category)) {
    alert('Для системной категории возврат недоступен');
    return false;
  }

  const result = unreserveCategory(
    state,
    categoryId,
    Number(amount),
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

function fillToLimit(state, categoryId) {
  const category = findCategory(state, categoryId);
  if (!category || isMiscCategory(category)) {
    return false;
  }

  const limit = category.limit ?? 0;
  const reserved = category.reserved ?? 0;

  if (reserved >= limit) {
    return true;
  }

  const needed = limit - reserved;
  const freeBalance = getFreeBalance(state);
  const amount = Math.min(needed, Math.max(0, freeBalance));

  if (amount <= 0) {
    return true;
  }

  const result = reserveCategory(
    state,
    categoryId,
    amount,
    `Пополнение до лимита: ${category.name}`,
    todayIso(),
    state.profile
  );

  if (!result.ok) {
    alert(result.error);
    return false;
  }

  return true;
}

function addExpense(state, categoryId, amount, accountId, comment) {
  const amountError = validatePositiveAmount(amount, 'Сумма расхода');
  if (amountError) {
    alert(amountError);
    return false;
  }

  if (!accountId) {
    alert('Выберите счет');
    return false;
  }

  const result = createExpense(
    state,
    categoryId,
    amount,
    accountId,
    comment,
    todayIso(),
    state.profile
  );

  if (!result.ok) {
    alert(result.error);
    return false;
  }

  return true;
}

function getAccountLabel(state, accountId) {
  const account = findAccount(state, accountId);
  if (!account) return '—';
  const currency = account.currency ?? 'RUB';
  const owner = OWNER_LABELS[account.owner ?? 'husband'] ?? account.owner;
  return `${account.name} (${owner}) — ${formatMoney(account.balance, currency)}`;
}

function renderExpenses(state, category) {
  const transactions = getCategoryTransactions(state, category.id, 3);
  if (!transactions.length) {
    return '<p class="text-xs text-slate-400 mt-2">Операций пока нет</p>';
  }

  const items = transactions.map((tx) => {
    const author = OWNER_LABELS[tx.author] ?? tx.author;
    const comment = tx.comment ? escapeHtml(tx.comment) : 'Без комментария';
    const dateLabel = tx.date ? new Date(tx.date).toLocaleDateString('ru-RU') : '—';
    const typeLabel = getTransactionTypeLabel(tx);
    const isExpense = tx.type === 'expense';
    const isUnreserve = tx.type === 'category_unreserve';
    const amountClass = isExpense ? 'text-red-600' : (isUnreserve ? 'text-slate-600' : 'text-amber-700');
    const amountPrefix = (isExpense || isUnreserve) ? '−' : '+';
    const accountLabel = isExpense
      ? `<span class="block text-slate-400 truncate">${escapeHtml(getAccountLabel(state, tx.accountId))}</span>`
      : '';

    return `
      <li class="text-xs text-slate-500 py-1.5 border-t border-slate-50 first:border-0">
        <span class="${amountClass} font-medium">${amountPrefix}${formatMoney(tx.amount)}</span>
        <span class="text-slate-400"> · ${dateLabel} · ${author}</span>
        <span class="text-slate-400"> · ${typeLabel}</span>
        <span class="block text-slate-400 truncate">${comment}</span>
        ${accountLabel}
      </li>
    `;
  }).join('');

  return `<ul class="mt-2">${items}</ul>`;
}

function renderCategoryCard(state, category) {
  if (isMiscCategory(category)) {
    return renderMiscCategoryCard(state, category);
  }

  const limit = category.limit ?? 0;
  const spent = category.spent ?? 0;
  const available = getCategoryAvailableDisplay(category);
  const overflow = getLimitOverflow(category);
  const overLimit = isOverLimit(category);
  const canFillToLimit = (category.reserved ?? 0) < limit;
  const availableClass = available < 0 ? 'text-red-600' : 'text-emerald-700';
  const cardClass = overLimit
    ? 'border-amber-400 bg-amber-50'
    : 'border-slate-200 bg-slate-50/50';

  return `
    <article class="border rounded-xl p-4 relative ${cardClass}" data-category-id="${category.id}">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          <h3 class="font-semibold text-slate-900 truncate">${escapeHtml(category.name)}</h3>
          <button
            type="button"
            data-action="open-edit"
            data-category-id="${category.id}"
            title="Редактировать"
            class="p-1 rounded text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors shrink-0"
          >${ICONS.pencil}</button>
        </div>
        <div class="relative shrink-0">
          <button
            type="button"
            data-action="toggle-menu"
            data-category-id="${category.id}"
            title="Меню"
            class="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200 transition-colors"
          >${ICONS.dots}</button>
          <div
            data-menu="${category.id}"
            class="hidden absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-10 min-w-[140px]"
          >
            <button
              type="button"
              data-action="delete-category"
              data-category-id="${category.id}"
              class="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            >${ICONS.trash}<span>Удалить</span></button>
          </div>
        </div>
      </div>

      ${overLimit ? `
        <div class="mb-3 p-2.5 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 text-sm">
          ⚠ Вы превысили лимит категории на ${formatMoney(overflow)}. Рекомендуется увеличить лимит.
        </div>
      ` : ''}

      <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-4">
        <span class="text-slate-500">Лимит:</span>
        <span class="text-slate-900 font-medium text-right">${formatMoney(limit)}</span>
        <span class="text-slate-500">Потрачено:</span>
        <span class="${overLimit ? 'text-red-600' : 'text-slate-900'} font-medium text-right">${formatMoney(spent)}</span>
        <span class="text-slate-500">Доступно:</span>
        <span class="${availableClass} font-medium text-right flex items-center justify-end gap-0.5">
          ${formatMoney(available)}
          <button
            type="button"
            data-action="open-reserve"
            data-category-id="${category.id}"
            title="Пополнить"
            class="p-0.5 rounded text-emerald-600 hover:bg-emerald-100 transition-colors"
          >${ICONS.reserve}</button>
          <button
            type="button"
            data-action="open-unreserve"
            data-category-id="${category.id}"
            title="Вернуть"
            class="p-0.5 rounded text-slate-500 hover:bg-slate-200 transition-colors"
          >${ICONS.unreserve}</button>
        </span>
      </div>

      ${canFillToLimit ? `
        <button
          type="button"
          data-action="fill-to-limit"
          data-category-id="${category.id}"
          class="w-full px-3 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors mb-2"
        >Пополнить до лимита</button>
      ` : ''}

      <button
        type="button"
        data-action="open-expense"
        data-category-id="${category.id}"
        class="w-full px-3 py-2 text-sm font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors mb-2"
      >Добавить расход</button>

      <div>
        <p class="text-xs font-medium text-slate-400 uppercase tracking-wide">Последние операции</p>
        ${renderExpenses(state, category)}
      </div>
    </article>
  `;
}

function renderMiscCategoryCard(state, category) {
  const spent = category.spent ?? 0;

  return `
    <article class="border border-slate-200 rounded-xl p-4 relative bg-slate-50/50" data-category-id="${category.id}">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="min-w-0 flex-1">
          <h3 class="font-semibold text-slate-900 truncate">${escapeHtml(category.name)}</h3>
          <p class="text-xs text-slate-400 mt-0.5">Системная категория</p>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-4">
        <span class="text-slate-500">Потрачено:</span>
        <span class="text-slate-900 font-medium text-right">${formatMoney(spent)}</span>
      </div>

      <button
        type="button"
        data-action="open-expense"
        data-category-id="${category.id}"
        class="w-full px-3 py-2 text-sm font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors mb-2"
      >Добавить расход</button>

      <div>
        <p class="text-xs font-medium text-slate-400 uppercase tracking-wide">Последние операции</p>
        ${renderExpenses(state, category)}
      </div>
    </article>
  `;
}

function renderAddCategoryModal() {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="add-category">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-4">Новая категория</h3>
        <form data-form="add-category" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Название категории</label>
            <input type="text" name="name" required maxlength="80" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Например, Продукты">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Лимит</label>
            <input type="number" name="limit" min="0" step="1" value="0" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
          </div>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="add-category" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700">Создать</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderEditCategoryModal() {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="edit-category">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-4">Редактирование категории</h3>
        <form data-form="edit-category" class="space-y-4">
          <input type="hidden" name="categoryId" value="">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Название категории</label>
            <input type="text" name="name" required maxlength="80" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Лимит</label>
            <input type="number" name="limit" min="0" step="1" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
          </div>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="edit-category" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700">Сохранить</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderReserveModal(freeBalance) {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="reserve">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-4">Пополнить категорию</h3>
        <p class="text-sm text-emerald-700 mb-4">Можно добавить: <strong>${formatMoney(freeBalance)}</strong></p>
        <form data-form="reserve" class="space-y-4">
          <input type="hidden" name="categoryId" value="">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Сумма</label>
            <input type="number" name="amount" required min="0.01" step="0.01" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="0">
          </div>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="reserve" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700">Пополнить</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderUnreserveModal() {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="unreserve">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-4">Вернуть из категории</h3>
        <form data-form="unreserve" class="space-y-4">
          <input type="hidden" name="categoryId" value="">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Сумма</label>
            <input type="number" name="amount" required min="0.01" step="0.01" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="0">
          </div>
          <p class="text-xs text-slate-400" data-unreserve-hint></p>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="unreserve" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-600 text-white hover:bg-slate-700">Вернуть</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderExpenseModal(state) {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="expense">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-4">Добавить расход</h3>
        <form data-form="expense" class="space-y-4">
          <input type="hidden" name="categoryId" value="">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Сумма (RUB)</label>
            <input type="number" name="amount" required min="0.01" step="0.01" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="0">
            <p class="text-xs text-slate-400 mt-1">Сумма расхода всегда в рублях. С USD-счета спишется эквивалент по курсу.</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Счет</label>
            <select name="accountId" required class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
              ${renderAccountOptions(state)}
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Комментарий</label>
            <input type="text" name="comment" maxlength="200" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Необязательно">
          </div>
          <p class="text-xs text-slate-400">Автор: ${OWNER_LABELS[state.profile] ?? 'Муж'}</p>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="expense" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600">Сохранить</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderEmptyState() {
  return `
    <div class="text-center py-10">
      <p class="text-slate-500 mb-4">Категорий пока нет</p>
      <button type="button" data-action="open-add-modal" class="px-6 py-3 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors">Создать первую категорию</button>
    </div>
  `;
}

export function renderCategories(state, container) {
  const categories = [...(state.categories ?? [])].sort((a, b) => {
    if (isMiscCategory(a)) return 1;
    if (isMiscCategory(b)) return -1;
    return 0;
  });
  const freeBalance = getFreeBalance(state);

  const categoriesList = categories.length
    ? `<div class="grid gap-4">${categories.map((c) => renderCategoryCard(state, c)).join('')}</div>`
    : renderEmptyState();

  container.innerHTML = `
    <div class="space-y-4">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 class="text-lg font-semibold text-slate-900">Категории</h2>
          ${categories.length ? `<button type="button" data-action="open-add-modal" class="px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors shrink-0">Добавить категорию</button>` : ''}
        </div>
        ${categoriesList}
      </div>
    </div>
    ${renderAddCategoryModal()}
    ${renderEditCategoryModal()}
    ${renderReserveModal(freeBalance)}
    ${renderUnreserveModal()}
    ${renderExpenseModal(state)}
  `;
}

function openModal(container, modalName) {
  const modal = container.querySelector(`[data-modal="${modalName}"]`);
  if (modal) modal.classList.remove('hidden');
}

function closeModal(container, modalName) {
  const modal = container.querySelector(`[data-modal="${modalName}"]`);
  if (modal) modal.classList.add('hidden');
}

function closeAllMenus(container) {
  container.querySelectorAll('[data-menu]').forEach((menu) => {
    menu.classList.add('hidden');
  });
}

function refresh(state, container, onUpdate) {
  renderCategories(state, container);
  if (typeof onUpdate === 'function') {
    onUpdate();
  }
}

export function initCategoriesHandlers(state, container, onUpdate) {
  if (container.dataset.categoriesHandlersBound === 'true') return;
  container.dataset.categoriesHandlersBound = 'true';

  container.addEventListener('click', (event) => {
    const target = event.target;

    if (!target.closest('[data-action="toggle-menu"]') && !target.closest('[data-menu]')) {
      closeAllMenus(container);
    }

    if (target.closest('[data-action="open-add-modal"]')) {
      const form = container.querySelector('[data-form="add-category"]');
      if (form) form.reset();
      openModal(container, 'add-category');
      return;
    }

    if (target.closest('[data-action="close-modal"]')) {
      const btn = target.closest('[data-action="close-modal"]');
      closeModal(container, btn.dataset.modal);
      return;
    }

    if (target.closest('[data-action="toggle-menu"]')) {
      const btn = target.closest('[data-action="toggle-menu"]');
      const menu = container.querySelector(`[data-menu="${btn.dataset.categoryId}"]`);
      if (menu) {
        const isHidden = menu.classList.contains('hidden');
        closeAllMenus(container);
        if (isHidden) menu.classList.remove('hidden');
      }
      return;
    }

    if (target.closest('[data-action="open-reserve"]')) {
      const btn = target.closest('[data-action="open-reserve"]');
      const form = container.querySelector('[data-form="reserve"]');
      if (form) {
        form.categoryId.value = btn.dataset.categoryId;
        form.amount.value = '';
      }
      openModal(container, 'reserve');
      return;
    }

    if (target.closest('[data-action="open-unreserve"]')) {
      const btn = target.closest('[data-action="open-unreserve"]');
      const category = findCategory(state, btn.dataset.categoryId);
      const form = container.querySelector('[data-form="unreserve"]');
      const hint = container.querySelector('[data-unreserve-hint]');
      if (form && category) {
        form.categoryId.value = category.id;
        form.amount.value = '';
        const available = Math.max(0, category.reserved ?? 0);
        if (hint) {
          hint.textContent = `Можно вернуть: ${formatMoney(available)}`;
        }
      }
      openModal(container, 'unreserve');
      return;
    }

    if (target.closest('[data-action="fill-to-limit"]')) {
      const btn = target.closest('[data-action="fill-to-limit"]');
      if (fillToLimit(state, btn.dataset.categoryId)) {
        refresh(state, container, onUpdate);
      }
      return;
    }

    if (target.closest('[data-action="open-expense"]')) {
      const btn = target.closest('[data-action="open-expense"]');
      const form = container.querySelector('[data-form="expense"]');
      if (form) {
        form.categoryId.value = btn.dataset.categoryId;
        form.amount.value = '';
        form.comment.value = '';
        if (form.accountId.options.length) {
          form.accountId.selectedIndex = 0;
        }
      }
      openModal(container, 'expense');
      return;
    }

    if (target.closest('[data-action="open-edit"]')) {
      const btn = target.closest('[data-action="open-edit"]');
      const category = findCategory(state, btn.dataset.categoryId);
      if (category && isMiscCategory(category)) {
        return;
      }
      const form = container.querySelector('[data-form="edit-category"]');
      if (category && form) {
        form.categoryId.value = category.id;
        form.name.value = category.name;
        form.limit.value = category.limit ?? 0;
      }
      openModal(container, 'edit-category');
      return;
    }

    if (target.closest('[data-action="delete-category"]')) {
      const btn = target.closest('[data-action="delete-category"]');
      closeAllMenus(container);
      if (confirm('Вы уверены? Средства из категории вернутся в общий баланс.')) {
        if (deleteCategory(state, btn.dataset.categoryId)) {
          refresh(state, container, onUpdate);
        }
      }
    }
  });

  container.addEventListener('submit', (event) => {
    event.preventDefault();

    const addForm = event.target.closest('[data-form="add-category"]');
    if (addForm) {
      if (createCategory(state, addForm.name.value, addForm.limit.value)) {
        closeModal(container, 'add-category');
        addForm.reset();
        refresh(state, container, onUpdate);
      }
      return;
    }

    const editForm = event.target.closest('[data-form="edit-category"]');
    if (editForm) {
      if (updateCategory(state, editForm.categoryId.value, editForm.name.value, editForm.limit.value)) {
        closeModal(container, 'edit-category');
        refresh(state, container, onUpdate);
      }
      return;
    }

    const reserveForm = event.target.closest('[data-form="reserve"]');
    if (reserveForm) {
      if (reserveFunds(state, reserveForm.categoryId.value, reserveForm.amount.value)) {
        closeModal(container, 'reserve');
        reserveForm.reset();
        refresh(state, container, onUpdate);
      }
      return;
    }

    const unreserveForm = event.target.closest('[data-form="unreserve"]');
    if (unreserveForm) {
      if (unreserveFunds(state, unreserveForm.categoryId.value, unreserveForm.amount.value)) {
        closeModal(container, 'unreserve');
        unreserveForm.reset();
        refresh(state, container, onUpdate);
      }
      return;
    }

    const expenseForm = event.target.closest('[data-form="expense"]');
    if (expenseForm) {
      const categoryId = expenseForm.categoryId.value;
      if (addExpense(
        state,
        categoryId,
        expenseForm.amount.value,
        expenseForm.accountId.value,
        expenseForm.comment.value
      )) {
        closeModal(container, 'expense');
        expenseForm.reset();
        refresh(state, container, onUpdate);
        const category = findCategory(state, categoryId);
        if (category && !isMiscCategory(category)) showLimitWarning(category);
      }
    }
  });
}
