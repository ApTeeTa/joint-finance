import { calculateFreeBalance } from './financeEngine.js';
import {
  createExpense,
  reserveCategory,
  unreserveCategory,
  deleteCategory as recordCategoryDeletion
} from './financeGate.js';
import { todayIso, getCategoryTransactions, renderAccountSelectOptions, TYPE_LABELS, isMiscCategory, MISC_CATEGORY_NAME } from './transactions.js';
import { openModal, closeModal, isWithinAppUi, findAppForm } from './modalLayer.js';
import {
  DISPLAY_MODULE_KEYS,
  renderDisplayItem,
  renderDisplaySummaryParts,
  renderExpandedDetailView,
  renderDisplayModeList,
  renderDisplayModeRoot,
  renderModuleToolbar,
  getModuleDisplayContext
} from './displayMode.js';
import { formatDisplayMoney } from './formatUi.js';
import {
  ENTITY_TYPES,
  getDisplayRules,
  buildReserveEntityDisplay
} from './uiRulesEngine.js';
import { renderEntityHeaderActions, renderEntityExpandedActions, closeAllOverflowMenus } from './uiActionRenderer.js';

const OWNER_LABELS = {
  husband: 'Муж',
  wife: 'Жена'
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
  const cardClass = overLimit
    ? 'border-amber-400 bg-amber-50'
    : '';

  const displayContext = getModuleDisplayContext(DISPLAY_MODULE_KEYS.CATEGORIES, {
    entityType: ENTITY_TYPES.CATEGORY
  });
  const displayRules = getDisplayRules(displayContext);

  const reserveDisplay = buildReserveEntityDisplay({
    limit,
    reserve: category.reserved ?? 0,
    spent,
    primaryNumeric: available,
    formatMoney: formatDisplayMoney,
    rules: displayRules
  });

  const summaryParts = renderDisplaySummaryParts({
    title: escapeHtml(category.name),
    meta: reserveDisplay.meta,
    value: reserveDisplay.value,
    statsHtml: reserveDisplay.statsHtml,
    reserveLineHtml: reserveDisplay.reserveLineHtml,
    limitLineHtml: reserveDisplay.limitLineHtml,
    listMetrics: reserveDisplay.listMetrics
  });

  const actionsHtml = renderEntityHeaderActions({
    moduleKey: DISPLAY_MODULE_KEYS.CATEGORIES,
    entityType: ENTITY_TYPES.CATEGORY,
    entityId: category.id,
    viewMode: displayContext.viewMode,
    displayRules
  });

  const expandedActionsHtml = renderEntityExpandedActions({
    entityType: ENTITY_TYPES.CATEGORY,
    entityId: category.id,
    viewMode: displayContext.viewMode,
    entityContext: {}
  });

  const expandedInfoHtml = `
    <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <div><span class="text-slate-500">Потрачено</span><div class="font-medium text-slate-900">${formatDisplayMoney(spent, 'RUB', displayRules)}</div></div>
      <div><span class="text-slate-500">Резерв</span><div class="font-medium text-slate-900">${formatDisplayMoney(category.reserved ?? 0, 'RUB', displayRules)}</div></div>
      <div><span class="text-slate-500">Лимит</span><div class="font-medium text-slate-900">${formatDisplayMoney(limit, 'RUB', displayRules)}</div></div>
      <div><span class="text-slate-500">Доступно</span><div class="font-medium text-slate-900">${formatDisplayMoney(available, 'RUB', displayRules)}</div></div>
    </div>
    ${overLimit ? `
      <div class="mt-3 p-2.5 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 text-sm">
        ⚠ Вы превысили лимит категории на ${formatMoney(overflow)}. Рекомендуется увеличить лимит.
      </div>
    ` : ''}
  `;

  const detailHtml = renderExpandedDetailView({
    title: escapeHtml(category.name),
    meta: reserveDisplay.meta,
    infoHtml: expandedInfoHtml,
    actionsHtml: expandedActionsHtml,
    contentHtml: `
      <div>
        <p class="text-xs font-medium text-slate-400 uppercase tracking-wide">Последние операции</p>
        ${renderExpenses(state, category)}
      </div>
    `
  });

  return renderDisplayItem({
    moduleKey: DISPLAY_MODULE_KEYS.CATEGORIES,
    itemId: category.id,
    dataAttr: 'data-category-id',
    dataValue: category.id,
    summaryTitleHtml: summaryParts.titleHtml,
    summaryMetricsHtml: summaryParts.metricsHtml,
    actionsHtml,
    detailHtml,
    itemClass: cardClass || 'bg-slate-50/50'
  });
}

function renderMiscCategoryCard(state, category) {
  const spent = category.spent ?? 0;

  const displayContext = getModuleDisplayContext(DISPLAY_MODULE_KEYS.CATEGORIES, {
    entityType: ENTITY_TYPES.CATEGORY
  });
  const displayRules = getDisplayRules(displayContext);

  const summaryParts = renderDisplaySummaryParts({
    title: escapeHtml(category.name),
    meta: 'Системная категория',
    value: formatDisplayMoney(spent, 'RUB', displayRules)
  });

  const detailHtml = renderExpandedDetailView({
    title: escapeHtml(category.name),
    meta: 'Системная категория',
    actionsHtml: renderEntityExpandedActions({
      entityType: ENTITY_TYPES.CATEGORY,
      entityId: category.id,
      viewMode: displayContext.viewMode
    }),
    contentHtml: `
      <div>
        <p class="text-xs font-medium text-slate-400 uppercase tracking-wide">Последние операции</p>
        ${renderExpenses(state, category)}
      </div>
    `
  });

  return renderDisplayItem({
    moduleKey: DISPLAY_MODULE_KEYS.CATEGORIES,
    itemId: category.id,
    dataAttr: 'data-category-id',
    dataValue: category.id,
    summaryTitleHtml: summaryParts.titleHtml,
    summaryMetricsHtml: summaryParts.metricsHtml,
    detailHtml,
    itemClass: 'bg-slate-50/50'
  });
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
      <button type="button" data-action="open-add-category-modal" class="px-6 py-3 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors">Создать первую категорию</button>
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
    ? renderDisplayModeList(categories.map((c) => renderCategoryCard(state, c)).join(''))
    : renderEmptyState();

  container.innerHTML = `
    <div class="space-y-4">
      ${renderDisplayModeRoot(DISPLAY_MODULE_KEYS.CATEGORIES, `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 class="text-lg font-semibold text-slate-900">Категории</h2>
          ${renderModuleToolbar(DISPLAY_MODULE_KEYS.CATEGORIES, categories.length ? `<button type="button" data-action="open-add-category-modal" class="px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors shrink-0">Добавить категорию</button>` : '')}
        </div>
        ${categoriesList}
      </div>
      `)}
    </div>
    ${renderAddCategoryModal()}
    ${renderEditCategoryModal()}
    ${renderReserveModal(freeBalance)}
    ${renderUnreserveModal()}
    ${renderExpenseModal(state)}
  `;
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

  document.addEventListener('click', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    const target = event.target;

    if (target.closest('[data-action="open-add-category-modal"]')) {
      const form = findAppForm('add-category', container);
      if (form) form.reset();
      openModal('add-category');
      return;
    }

    if (target.closest('[data-action="close-modal"]')) {
      const btn = target.closest('[data-action="close-modal"]');
      closeModal(btn.dataset.modal);
      return;
    }

    if (target.closest('[data-action="open-reserve"]')) {
      const btn = target.closest('[data-action="open-reserve"]');
      const form = findAppForm('reserve', container);
      if (form) {
        form.categoryId.value = btn.dataset.categoryId;
        form.amount.value = '';
      }
      openModal('reserve');
      return;
    }

    if (target.closest('[data-action="open-unreserve"]')) {
      const btn = target.closest('[data-action="open-unreserve"]');
      const category = findCategory(state, btn.dataset.categoryId);
      const form = findAppForm('unreserve', container);
      const hint = container.querySelector('[data-unreserve-hint]');
      if (form && category) {
        form.categoryId.value = category.id;
        form.amount.value = '';
        const available = Math.max(0, category.reserved ?? 0);
        if (hint) {
          hint.textContent = `Можно вернуть: ${formatMoney(available)}`;
        }
      }
      openModal('unreserve');
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
      const form = findAppForm('expense', container);
      if (form) {
        form.categoryId.value = btn.dataset.categoryId;
        form.amount.value = '';
        form.comment.value = '';
        if (form.accountId.options.length) {
          form.accountId.selectedIndex = 0;
        }
      }
      openModal('expense');
      return;
    }

    if (target.closest('[data-action="open-edit"]')) {
      const btn = target.closest('[data-action="open-edit"]');
      const category = findCategory(state, btn.dataset.categoryId);
      if (category && isMiscCategory(category)) {
        return;
      }
      const form = findAppForm('edit-category', container);
      if (category && form) {
        form.categoryId.value = category.id;
        form.name.value = category.name;
        form.limit.value = category.limit ?? 0;
      }
      openModal('edit-category');
      return;
    }

    if (target.closest('[data-action="delete-category"]')) {
      const btn = target.closest('[data-action="delete-category"]');
      closeAllOverflowMenus();
      if (confirm('Вы уверены? Средства из категории вернутся в общий баланс.')) {
        if (deleteCategory(state, btn.dataset.categoryId)) {
          refresh(state, container, onUpdate);
        }
      }
      return;
    }
  });

  document.addEventListener('submit', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    event.preventDefault();

    const addForm = event.target.closest('[data-form="add-category"]');
    if (addForm) {
      if (createCategory(state, addForm.name.value, addForm.limit.value)) {
        closeModal('add-category');
        addForm.reset();
        refresh(state, container, onUpdate);
      }
      return;
    }

    const editForm = event.target.closest('[data-form="edit-category"]');
    if (editForm) {
      if (updateCategory(state, editForm.categoryId.value, editForm.name.value, editForm.limit.value)) {
        closeModal('edit-category');
        refresh(state, container, onUpdate);
      }
      return;
    }

    const reserveForm = event.target.closest('[data-form="reserve"]');
    if (reserveForm) {
      if (reserveFunds(state, reserveForm.categoryId.value, reserveForm.amount.value)) {
        closeModal('reserve');
        reserveForm.reset();
        refresh(state, container, onUpdate);
      }
      return;
    }

    const unreserveForm = event.target.closest('[data-form="unreserve"]');
    if (unreserveForm) {
      if (unreserveFunds(state, unreserveForm.categoryId.value, unreserveForm.amount.value)) {
        closeModal('unreserve');
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
        closeModal('expense');
        expenseForm.reset();
        refresh(state, container, onUpdate);
        const category = findCategory(state, categoryId);
        if (category && !isMiscCategory(category)) showLimitWarning(category);
      }
    }
  });
}
