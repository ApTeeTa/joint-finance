import {
  updateSavings,
  spendSaving,
  createSaving as recordSavingCreation,
  updateSavingRecord,
  deleteSavingRecord
} from './financeGate.js';
import {
  renderAccountSelectOptions,
  getSavingAccumulated,
  todayIso
} from './transactions.js';
import { openModal, closeModal, isWithinAppUi, findAppForm, findInAppUi } from './modalLayer.js';
import {
  DISPLAY_MODULE_KEYS,
  renderDisplayItem,
  renderDisplaySummary,
  renderDisplayModeList,
  renderDisplayModeRoot,
  renderModuleToolbar
} from './displayMode.js';
import { formatUiMoney } from './formatUi.js';
import { renderUiIcon } from './uiIcons.js';

const DEADLINE_LABELS = {
  none: 'Без срока',
  months_3: '3 месяца',
  months_6: '6 месяцев',
  months_12: '12 месяцев',
  months_24: '24 месяца',
  years_1: '12 месяцев',
  date: 'Конкретная дата'
};

const SAVING_TYPE_LABELS = {
  recurring: 'Возобновляемая',
  single_use: 'Разовая'
};

const TARGET_MONTHS_BY_DEADLINE = {
  months_3: 3,
  months_6: 6,
  months_12: 12,
  years_1: 12,
  months_24: 24
};

const ICONS = {
  pencil: renderUiIcon('pencil'),
  trash: renderUiIcon('trash')
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

function addMonthsIso(isoDate, months) {
  const date = parseLocalDate(isoDate);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function resolveDeadlineDate(deadlineType, specificDate, fromDate = todayIso()) {
  if (deadlineType === 'none' || !deadlineType) {
    return null;
  }
  if (deadlineType === 'months_3') {
    return addMonthsIso(fromDate, 3);
  }
  if (deadlineType === 'months_6') {
    return addMonthsIso(fromDate, 6);
  }
  if (deadlineType === 'months_12' || deadlineType === 'years_1') {
    return addMonthsIso(fromDate, 12);
  }
  if (deadlineType === 'months_24') {
    return addMonthsIso(fromDate, 24);
  }
  if (deadlineType === 'date') {
    return specificDate || null;
  }
  return null;
}

function formatDeadlineLabel(saving) {
  if (!saving.deadlineType || saving.deadlineType === 'none' || !saving.deadlineDate) {
    return DEADLINE_LABELS.none;
  }
  if (saving.deadlineType === 'date') {
    return new Date(saving.deadlineDate).toLocaleDateString('ru-RU');
  }
  return `${DEADLINE_LABELS[saving.deadlineType] ?? saving.deadlineType} (до ${new Date(saving.deadlineDate).toLocaleDateString('ru-RU')})`;
}

export function countFullMonthsBetween(fromDate, toDate) {
  if (!toDate || toDate <= fromDate) {
    return 1;
  }

  let months = (toDate.getFullYear() - fromDate.getFullYear()) * 12
    + (toDate.getMonth() - fromDate.getMonth());

  if (toDate.getDate() < fromDate.getDate()) {
    months -= 1;
  }

  return Math.max(1, months);
}

function getTargetMonths(saving) {
  const fixedMonths = TARGET_MONTHS_BY_DEADLINE[saving.deadlineType];
  if (fixedMonths) {
    return fixedMonths;
  }

  if (saving.deadlineType === 'date' && saving.deadlineDate) {
    const startDate = saving.createdAt?.slice(0, 10) ?? todayIso();
    if (saving.deadlineDate < startDate) {
      return 0;
    }
    return countFullMonthsBetween(
      parseLocalDate(startDate),
      parseLocalDate(saving.deadlineDate)
    );
  }

  return null;
}

export function getRecommendedMonthlyPayment(saving) {
  const targetAmount = saving.targetAmount;
  if (targetAmount == null || targetAmount <= 0) {
    return null;
  }

  const targetMonths = getTargetMonths(saving);
  if (targetMonths == null || targetMonths <= 0) {
    return null;
  }

  const accumulated = getSavingAccumulated(saving);
  const remaining = targetAmount - accumulated;
  if (remaining <= 0) {
    return { kind: 'completed', amount: 0, targetMonths };
  }

  if (saving.deadlineDate && saving.deadlineType !== 'none' && saving.deadlineDate < todayIso()) {
    return { kind: 'overdue', amount: null, targetMonths };
  }

  return {
    kind: 'active',
    amount: remaining / targetMonths,
    targetMonths,
    remaining
  };
}

function renderRecommendedMonthlyPaymentRow(saving) {
  const recommendation = getRecommendedMonthlyPayment(saving);
  if (!recommendation) {
    return '';
  }

  if (recommendation.kind === 'completed') {
    return `
      <span class="text-slate-500">Рекомендуемый платёж:</span>
      <span class="text-emerald-700 font-medium text-right">${formatMoney(0)}</span>
    `;
  }

  if (recommendation.kind === 'overdue') {
    return `
      <span class="text-slate-500">Рекомендуемый платёж:</span>
      <span class="text-red-600 font-medium text-right">Цель просрочена</span>
    `;
  }

  return `
    <span class="text-slate-500">Рекомендуемый платёж:</span>
    <span class="text-primary-700 font-medium text-right">${formatMoney(recommendation.amount)} / мес</span>
  `;
}

function isGoalReached(saving) {
  const targetAmount = saving.targetAmount;
  if (targetAmount == null || targetAmount <= 0) return false;
  return getSavingAccumulated(saving) >= targetAmount;
}

function normalizeSaving(saving) {
  if (saving.accumulated == null && saving.amount != null) {
    saving.accumulated = saving.amount;
  }
  if (saving.accumulated == null) {
    saving.accumulated = 0;
  }
  if (!saving.deadlineType) {
    saving.deadlineType = 'none';
  }
  if (!saving.savingType) {
    saving.savingType = 'recurring';
  }
  return saving;
}

function findSaving(state, savingId) {
  const saving = (state.savings ?? []).find((item) => item.id === savingId);
  return saving ? normalizeSaving(saving) : null;
}

function parseOptionalTarget(value) {
  if (value === '' || value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function parseDeadlineFromForm(form, fromDate = todayIso()) {
  const deadlineType = form.deadlineType.value;
  const specificDate = form.deadlineDate?.value || null;
  const deadlineDate = resolveDeadlineDate(deadlineType, specificDate, fromDate);

  if (deadlineType === 'date' && !specificDate) {
    return { ok: false, error: 'Укажите дату срока' };
  }

  return { ok: true, deadlineType, deadlineDate };
}

function createSaving(state, name, targetAmount, deadlineType, deadlineDate, savingType) {
  if (!name || !String(name).trim()) {
    alert('Введите название копилки');
    return false;
  }

  if (!Array.isArray(state.savings)) {
    state.savings = [];
  }

  const saving = normalizeSaving({
    id: createId('saving'),
    name: String(name).trim(),
    accumulated: 0,
    targetAmount: targetAmount ?? null,
    deadlineType: deadlineType || 'none',
    deadlineDate: deadlineDate ?? null,
    savingType: savingType === 'single_use' ? 'single_use' : 'recurring',
    createdAt: new Date().toISOString()
  });

  state.savings.push(saving);
  recordSavingCreation(state, saving, state.profile);
  return true;
}

function updateSaving(state, savingId, name, targetAmount, deadlineType, deadlineDate, savingType) {
  const saving = findSaving(state, savingId);
  if (!saving) {
    alert('Копилка не найдена');
    return false;
  }

  if (!name || !String(name).trim()) {
    alert('Введите название копилки');
    return false;
  }

  const accumulated = getSavingAccumulated(saving);
  if (targetAmount != null && targetAmount > 0 && accumulated > targetAmount) {
    alert('Целевая сумма не может быть меньше уже накопленного');
    return false;
  }

  const changes = {
    oldName: saving.name,
    newName: String(name).trim(),
    oldTargetAmount: saving.targetAmount ?? null,
    newTargetAmount: targetAmount ?? null,
    oldDeadlineType: saving.deadlineType ?? 'none',
    newDeadlineType: deadlineType || 'none',
    oldDeadlineDate: saving.deadlineDate ?? null,
    newDeadlineDate: deadlineDate ?? null,
    oldDeadlineLabel: formatDeadlineLabel(saving),
    newDeadlineLabel: formatDeadlineLabel({
      deadlineType: deadlineType || 'none',
      deadlineDate: deadlineDate ?? null
    })
  };

  saving.name = changes.newName;
  saving.targetAmount = changes.newTargetAmount;
  saving.deadlineType = changes.newDeadlineType;
  saving.deadlineDate = changes.newDeadlineDate;
  saving.savingType = savingType === 'single_use' ? 'single_use' : 'recurring';

  const hasChanges = changes.oldName !== changes.newName
    || changes.oldTargetAmount !== changes.newTargetAmount
    || changes.oldDeadlineType !== changes.newDeadlineType
    || changes.oldDeadlineDate !== changes.newDeadlineDate;

  if (hasChanges) {
    updateSavingRecord(state, savingId, changes, state.profile);
  }

  return true;
}

function deleteSaving(state, savingId) {
  const saving = findSaving(state, savingId);
  if (!saving) {
    alert('Копилка не найдена');
    return false;
  }

  deleteSavingRecord(state, saving, state.profile);
  state.savings = (state.savings ?? []).filter((item) => item.id !== savingId);
  return true;
}

function renderSavingTypeFields(prefix, saving = null) {
  const savingType = saving?.savingType ?? 'recurring';

  return `
    <div>
      <label class="block text-sm font-medium text-slate-700 mb-1">Тип копилки</label>
      <select name="savingType" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
        <option value="recurring"${savingType === 'recurring' ? ' selected' : ''}>Возобновляемая</option>
        <option value="single_use"${savingType === 'single_use' ? ' selected' : ''}>Разовая</option>
      </select>
      <p class="text-xs text-slate-400 mt-1">Разовая копилка закрывается после «Потратить».</p>
    </div>
  `;
}

function renderDeadlineFields(prefix, saving = null) {
  const deadlineType = saving?.deadlineType ?? 'none';
  const deadlineDate = saving?.deadlineDate ?? todayIso();

  return `
    <div>
      <label class="block text-sm font-medium text-slate-700 mb-1">Срок</label>
      <select name="deadlineType" data-deadline-type="${prefix}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
        <option value="none"${deadlineType === 'none' ? ' selected' : ''}>Без срока</option>
        <option value="months_3"${deadlineType === 'months_3' ? ' selected' : ''}>3 месяца</option>
        <option value="months_6"${deadlineType === 'months_6' ? ' selected' : ''}>6 месяцев</option>
        <option value="months_12"${deadlineType === 'months_12' || deadlineType === 'years_1' ? ' selected' : ''}>12 месяцев</option>
        <option value="months_24"${deadlineType === 'months_24' ? ' selected' : ''}>24 месяца</option>
        <option value="date"${deadlineType === 'date' ? ' selected' : ''}>Конкретная дата</option>
      </select>
    </div>
    <div class="${deadlineType === 'date' ? '' : 'hidden'}" data-deadline-date-wrap="${prefix}">
      <label class="block text-sm font-medium text-slate-700 mb-1">Дата</label>
      <input type="date" name="deadlineDate" value="${deadlineDate}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
    </div>
  `;
}

function getSavingProgress(item) {
  const accumulated = getSavingAccumulated(item);
  const targetAmount = item.targetAmount;

  if (targetAmount == null || targetAmount <= 0) {
    return { accumulated, targetAmount: null, percent: null };
  }

  return {
    accumulated,
    targetAmount,
    percent: Math.min(100, Math.round((accumulated / targetAmount) * 100))
  };
}

function renderSavingCard(state, saving) {
  const item = normalizeSaving(saving);
  const { accumulated, targetAmount, percent } = getSavingProgress(item);
  const goalReached = isGoalReached(item);
  const progressBar = percent != null
    ? `
      <div class="mt-2">
        <div class="h-2 rounded-full bg-slate-200 overflow-hidden">
          <div class="h-full rounded-full bg-primary-500 transition-all" style="width: ${percent}%"></div>
        </div>
      </div>
    `
    : '';

  const summaryHtml = renderDisplaySummary({
    title: escapeHtml(item.name),
    meta: percent != null ? `Прогресс ${percent}%` : (goalReached ? 'Цель достигнута' : ''),
    value: formatUiMoney(accumulated),
    statsHtml: `
      ${targetAmount != null && targetAmount > 0 ? `
        <span class="text-slate-500">Цель:</span>
        <span class="text-slate-900 font-medium text-right">${formatUiMoney(targetAmount)}</span>
      ` : ''}
      ${percent != null ? `
        <span class="text-slate-500">Прогресс:</span>
        <span class="text-primary-700 font-medium text-right">${percent}%</span>
      ` : ''}
      ${renderRecommendedMonthlyPaymentRow(item)}
    `
  });

  const actionsHtml = `
    ${!goalReached ? `
      <button type="button" data-action="open-deposit-saving" data-saving-id="${item.id}" title="Пополнить" class="display-list-action p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-100 transition-colors text-base leading-none font-semibold">+</button>
    ` : ''}
    <button type="button" data-action="open-edit-saving" data-saving-id="${item.id}" title="Редактировать" class="display-card-action p-1.5 rounded-lg text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors">${ICONS.pencil}</button>
    <button type="button" data-action="delete-saving" data-saving-id="${item.id}" title="Удалить" class="display-card-action p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors">${ICONS.trash}</button>
  `;

  const detailHtml = `
    ${progressBar}
    <div class="display-item-detail-actions mt-3">
      ${!goalReached ? `
        <button type="button" data-action="open-deposit-saving" data-saving-id="${item.id}" class="px-3 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors">Пополнить</button>
      ` : ''}
      ${accumulated > 0 ? `
        <button type="button" data-action="open-withdraw-saving" data-saving-id="${item.id}" class="px-3 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors">Вернуть</button>
      ` : ''}
      ${goalReached && accumulated > 0 ? `
        <button type="button" data-action="open-spend-saving" data-saving-id="${item.id}" class="px-3 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">Потратить</button>
      ` : ''}
    </div>
  `;

  return renderDisplayItem({
    moduleKey: DISPLAY_MODULE_KEYS.SAVINGS,
    itemId: item.id,
    dataAttr: 'data-saving-id',
    dataValue: item.id,
    summaryHtml,
    actionsHtml,
    detailHtml,
    itemClass: 'bg-slate-50/50'
  });
}

function renderAddSavingModal() {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="add-saving">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-4">Новая копилка</h3>
        <form data-form="add-saving" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Название</label>
            <input type="text" name="name" required maxlength="80" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Например, Отпуск">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Цель (RUB)</label>
            <input type="number" name="targetAmount" min="0" step="1" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Необязательно">
          </div>
          ${renderSavingTypeFields('add')}
          ${renderDeadlineFields('add')}
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="add-saving" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700">Создать</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderEditSavingModal() {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="edit-saving">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-4">Редактирование копилки</h3>
        <form data-form="edit-saving" class="space-y-4">
          <input type="hidden" name="savingId" value="">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Название</label>
            <input type="text" name="name" required maxlength="80" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Цель (RUB)</label>
            <input type="number" name="targetAmount" min="0" step="1" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
          </div>
          ${renderSavingTypeFields('edit')}
          ${renderDeadlineFields('edit')}
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="edit-saving" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700">Сохранить</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderDepositModal() {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="deposit-saving">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-4">Пополнить копилку</h3>
        <form data-form="deposit-saving" class="space-y-4">
          <input type="hidden" name="savingId" value="">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Сумма (RUB)</label>
            <input type="number" name="amount" required min="0.01" step="0.01" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="0">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Комментарий</label>
            <input type="text" name="comment" maxlength="200" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Необязательно">
          </div>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="deposit-saving" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700">Пополнить</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderWithdrawModal() {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="withdraw-saving">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-4">Вернуть из копилки</h3>
        <form data-form="withdraw-saving" class="space-y-4">
          <input type="hidden" name="savingId" value="">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Сумма (RUB)</label>
            <input type="number" name="amount" required min="0.01" step="0.01" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="0">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Комментарий</label>
            <input type="text" name="comment" maxlength="200" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Необязательно">
          </div>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="withdraw-saving" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700">Вернуть</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderSpendModal(state) {
  return `
    <div class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" data-modal="spend-saving">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-4">Потратить копилку</h3>
        <form data-form="spend-saving" class="space-y-4">
          <input type="hidden" name="savingId" value="">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Счет</label>
            <select name="accountId" required class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
              ${renderAccountSelectOptions(state)}
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Комментарий</label>
            <input type="text" name="comment" maxlength="200" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="Необязательно">
          </div>
          <div class="flex gap-2 pt-2">
            <button type="button" data-action="close-modal" data-modal="spend-saving" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">Отмена</button>
            <button type="submit" class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">Потратить</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderEmptyState() {
  return `
    <div class="text-center py-10">
      <p class="text-slate-500 mb-4">Копилок пока нет</p>
      <button type="button" data-action="open-add-saving" class="px-6 py-3 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors">Создать первую копилку</button>
    </div>
  `;
}

export function renderSavings(state, container) {
  const savings = (state.savings ?? []).map(normalizeSaving);

  const list = savings.length
    ? renderDisplayModeList(savings.map((item) => renderSavingCard(state, item)).join(''))
    : renderEmptyState();

  container.innerHTML = `
    <div class="space-y-4">
      ${renderDisplayModeRoot(DISPLAY_MODULE_KEYS.SAVINGS, `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 class="text-lg font-semibold text-slate-900">Копилки</h2>
          ${renderModuleToolbar(DISPLAY_MODULE_KEYS.SAVINGS, savings.length ? `<button type="button" data-action="open-add-saving" class="px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors shrink-0">Добавить копилку</button>` : '')}
        </div>
        ${list}
      </div>
      `)}
    </div>
    ${renderAddSavingModal()}
    ${renderEditSavingModal()}
    ${renderDepositModal()}
    ${renderWithdrawModal()}
    ${renderSpendModal(state)}
  `;
}

function toggleDeadlineDateField(container, prefix, deadlineType) {
  const wrap = findInAppUi(`[data-deadline-date-wrap="${prefix}"]`, container);
  if (wrap) {
    wrap.classList.toggle('hidden', deadlineType !== 'date');
  }
}

function fillEditSavingForm(state, container, savingId) {
  const saving = findSaving(state, savingId);
  const form = findAppForm('edit-saving', container);
  if (!saving || !form) return;

  form.savingId.value = saving.id;
  form.name.value = saving.name;
  form.targetAmount.value = saving.targetAmount ?? '';
  form.savingType.value = saving.savingType ?? 'recurring';
  form.deadlineType.value = saving.deadlineType === 'years_1' ? 'months_12' : (saving.deadlineType ?? 'none');
  if (form.deadlineDate) {
    form.deadlineDate.value = saving.deadlineDate ?? todayIso();
  }
  toggleDeadlineDateField(container, 'edit', form.deadlineType.value);
}

function refresh(state, container, onUpdate) {
  renderSavings(state, container);
  if (typeof onUpdate === 'function') {
    onUpdate();
  }
}

export function initSavingsHandlers(state, container, onUpdate) {
  if (container.dataset.savingsHandlersBound === 'true') return;
  container.dataset.savingsHandlersBound = 'true';

  document.addEventListener('change', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    const select = event.target.closest('[data-deadline-type]');
    if (!select) return;
    toggleDeadlineDateField(container, select.dataset.deadlineType, select.value);
  });

  document.addEventListener('click', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    const target = event.target;

    if (target.closest('[data-action="open-add-saving"]')) {
      const form = findAppForm('add-saving', container);
      if (form) form.reset();
      toggleDeadlineDateField(container, 'add', 'none');
      openModal('add-saving');
      return;
    }

    if (target.closest('[data-action="close-modal"]')) {
      const btn = target.closest('[data-action="close-modal"]');
      closeModal(btn.dataset.modal);
      return;
    }

    if (target.closest('[data-action="open-edit-saving"]')) {
      const btn = target.closest('[data-action="open-edit-saving"]');
      fillEditSavingForm(state, container, btn.dataset.savingId);
      openModal('edit-saving');
      return;
    }

    if (target.closest('[data-action="open-deposit-saving"]')) {
      const btn = target.closest('[data-action="open-deposit-saving"]');
      const form = findAppForm('deposit-saving', container);
      if (form) {
        form.savingId.value = btn.dataset.savingId;
        form.amount.value = '';
        form.comment.value = '';
      }
      openModal('deposit-saving');
      return;
    }

    if (target.closest('[data-action="open-withdraw-saving"]')) {
      const btn = target.closest('[data-action="open-withdraw-saving"]');
      const form = findAppForm('withdraw-saving', container);
      if (form) {
        form.savingId.value = btn.dataset.savingId;
        form.amount.value = '';
        form.comment.value = '';
      }
      openModal('withdraw-saving');
      return;
    }

    if (target.closest('[data-action="open-spend-saving"]')) {
      const btn = target.closest('[data-action="open-spend-saving"]');
      const form = findAppForm('spend-saving', container);
      if (form) {
        form.savingId.value = btn.dataset.savingId;
        form.comment.value = '';
        if (form.accountId.options.length) {
          form.accountId.selectedIndex = 0;
        }
      }
      openModal('spend-saving');
      return;
    }

    if (target.closest('[data-action="delete-saving"]')) {
      const btn = target.closest('[data-action="delete-saving"]');
      const saving = findSaving(state, btn.dataset.savingId);
      const accumulated = saving ? getSavingAccumulated(saving) : 0;
      const message = accumulated > 0
        ? `Удалить копилку? ${formatMoney(accumulated)} вернутся в общий баланс.`
        : 'Удалить копилку?';
      if (confirm(message) && deleteSaving(state, btn.dataset.savingId)) {
        refresh(state, container, onUpdate);
      }
    }
  });

  document.addEventListener('submit', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    event.preventDefault();

    const addForm = event.target.closest('[data-form="add-saving"]');
    if (addForm) {
      const deadline = parseDeadlineFromForm(addForm);
      if (!deadline.ok) {
        alert(deadline.error);
        return;
      }
      const targetAmount = parseOptionalTarget(addForm.targetAmount.value);
      if (createSaving(
        state,
        addForm.name.value,
        targetAmount,
        deadline.deadlineType,
        deadline.deadlineDate,
        addForm.savingType.value
      )) {
        closeModal('add-saving');
        addForm.reset();
        refresh(state, container, onUpdate);
      }
      return;
    }

    const editForm = event.target.closest('[data-form="edit-saving"]');
    if (editForm) {
      const deadline = parseDeadlineFromForm(editForm);
      if (!deadline.ok) {
        alert(deadline.error);
        return;
      }
      const targetAmount = parseOptionalTarget(editForm.targetAmount.value);
      if (updateSaving(
        state,
        editForm.savingId.value,
        editForm.name.value,
        targetAmount,
        deadline.deadlineType,
        deadline.deadlineDate,
        editForm.savingType.value
      )) {
        closeModal('edit-saving');
        refresh(state, container, onUpdate);
      }
      return;
    }

    const depositForm = event.target.closest('[data-form="deposit-saving"]');
    if (depositForm) {
      const rubAmount = Number(depositForm.amount.value);
      const result = updateSavings(state, {
        action: 'deposit',
        savingId: depositForm.savingId.value,
        amount: depositForm.amount.value,
        comment: depositForm.comment.value,
        date: todayIso(),
        author: state.profile
      });
      if (!result.ok) {
        alert(result.error);
        return;
      }
      closeModal('deposit-saving');
      refresh(state, container, onUpdate);
      return;
    }

    const withdrawForm = event.target.closest('[data-form="withdraw-saving"]');
    if (withdrawForm) {
      const result = updateSavings(state, {
        action: 'withdraw',
        savingId: withdrawForm.savingId.value,
        amount: withdrawForm.amount.value,
        comment: withdrawForm.comment.value,
        date: todayIso(),
        author: state.profile
      });
      if (!result.ok) {
        alert(result.error);
        return;
      }
      closeModal('withdraw-saving');
      refresh(state, container, onUpdate);
      return;
    }

    const spendForm = event.target.closest('[data-form="spend-saving"]');
    if (spendForm) {
      const saving = findSaving(state, spendForm.savingId.value);
      const result = spendSaving(
        state,
        spendForm.savingId.value,
        spendForm.accountId.value,
        spendForm.comment.value,
        todayIso(),
        state.profile
      );
      if (!result.ok) {
        alert(result.error);
        return;
      }
      closeModal('spend-saving');
      refresh(state, container, onUpdate);
    }
  });
}
