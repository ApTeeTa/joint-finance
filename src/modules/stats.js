import { UI } from './uiTheme.js';
import {
  getFinancialSummary,
  getExpensesByCategory,
  getSavingsProgress,
  getObligationsOverview,
  getIncomeSummary,
  getIncomeByCategory,
  PERIOD_PRESETS
} from './analyticsReadModel.js';
import { addIncomeCategory, renameIncomeCategory, ensureDefaultIncomeCategories } from './incomeCategories.js';
import { isWithinAppUi } from './modalLayer.js';

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

function formatPaidUntil(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return iso;
  }
}

function renderSummaryCard(label, value, tone = 'slate') {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    blue: 'bg-blue-50 text-blue-700',
    violet: 'bg-violet-50 text-violet-700',
    slate: 'bg-slate-50 text-slate-900'
  };
  const labelTones = {
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    blue: 'text-blue-600',
    violet: 'text-violet-600',
    slate: 'text-slate-500'
  };

  return `
    <div class="rounded-xl p-4 ${tones[tone] ?? tones.slate}">
      <p class="text-xs mb-1 ${labelTones[tone] ?? labelTones.slate}">${escapeHtml(label)}</p>
      <p class="text-lg font-semibold">${formatMoney(value)}</p>
    </div>
  `;
}

function renderStatusBadge(status, label) {
  const classes = {
    overdue: 'bg-red-100 text-red-700',
    active: 'bg-emerald-100 text-emerald-700',
    completed: 'bg-slate-100 text-slate-600'
  };

  return `<span class="inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${classes[status] ?? classes.active}">${escapeHtml(label)}</span>`;
}

function renderFinancialSummary(summary) {
  return `
    <section class="${UI.panel} p-5">
      <h2 class="${UI.panelTitle} mb-4">Финансовая сводка</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        ${renderSummaryCard('Свободные деньги', summary.freeBalance, 'emerald')}
        ${renderSummaryCard('Зарезервировано', summary.reservedBalance, 'amber')}
        ${renderSummaryCard('Копилки', summary.savingsTotal, 'violet')}
        ${renderSummaryCard('Обязательства', summary.obligationsTotal, 'blue')}
        ${renderSummaryCard('Баланс счетов', summary.totalBalance, 'slate')}
        ${renderSummaryCard('Долги (мы должны)', summary.liabilitiesTotal, 'amber')}
        ${renderSummaryCard('Чистая позиция', summary.netBalance, 'emerald')}
      </div>
    </section>
  `;
}

function renderExpensesByCategory(items) {
  if (!items.length) {
    return `
      <section class="${UI.panel} p-5">
        <h2 class="${UI.panelTitle} mb-2">Расходы по категориям</h2>
        <p class="text-sm text-slate-500">Нет активных расходов в журнале операций.</p>
      </section>
    `;
  }

  const maxAmount = items[0]?.amount ?? 1;
  const rows = items.map((item) => {
    const width = maxAmount > 0 ? Math.max(4, Math.round((item.amount / maxAmount) * 100)) : 0;
    return `
      <li class="space-y-1">
        <div class="flex items-center justify-between gap-3 text-sm">
          <span class="font-medium text-slate-800 truncate">${escapeHtml(item.categoryName)}</span>
          <span class="text-slate-600 whitespace-nowrap">${formatMoney(item.amount)}</span>
        </div>
        <div class="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div class="h-full rounded-full bg-primary-500" style="width: ${width}%"></div>
        </div>
        <p class="text-xs text-slate-400">${item.count} операций</p>
      </li>
    `;
  }).join('');

  return `
    <section class="${UI.panel} p-5">
      <h2 class="${UI.panelTitle} mb-4">Расходы по категориям</h2>
      <ul class="space-y-4">${rows}</ul>
    </section>
  `;
}

function renderSavingsProgress(items) {
  if (!items.length) {
    return `
      <section class="${UI.panel} p-5">
        <h2 class="${UI.panelTitle} mb-2">Прогресс копилок</h2>
        <p class="text-sm text-slate-500">Копилок пока нет.</p>
      </section>
    `;
  }

  const rows = items.map((item) => {
    const progress = item.progressPercent ?? 0;
    const targetLabel = item.targetAmount != null && item.targetAmount > 0
      ? formatMoney(item.targetAmount)
      : 'без цели';
    const progressLabel = item.progressPercent != null ? `${item.progressPercent}%` : '—';
    let recommendationLabel = '';
    if (item.recommendationStatus === 'overdue') {
      recommendationLabel = 'Цель просрочена';
    } else if (item.recommendationStatus === 'completed') {
      recommendationLabel = formatMoney(0);
    } else if (item.recommendedMonthly != null) {
      recommendationLabel = `${formatMoney(item.recommendedMonthly)} / мес`;
    }

    return `
      <li class="rounded-xl border border-slate-100 p-4">
        <div class="flex items-start justify-between gap-3 mb-2">
          <div>
            <p class="font-medium text-slate-900">${escapeHtml(item.name)}</p>
            <p class="text-sm text-slate-500">${formatMoney(item.accumulated)} из ${targetLabel}</p>
            ${recommendationLabel ? `<p class="text-xs text-slate-500 mt-1">Рекомендуемый платёж: <span class="font-medium text-primary-700">${recommendationLabel}</span></p>` : ''}
          </div>
          <span class="text-sm font-semibold text-primary-700">${progressLabel}</span>
        </div>
        <div class="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div class="h-full rounded-full bg-accent-500" style="width: ${Math.min(100, progress)}%"></div>
        </div>
      </li>
    `;
  }).join('');

  return `
    <section class="${UI.panel} p-5">
      <h2 class="${UI.panelTitle} mb-4">Прогресс копилок</h2>
      <ul class="space-y-3">${rows}</ul>
    </section>
  `;
}

function renderObligationsOverview(items) {
  if (!items.length) {
    return `
      <section class="${UI.panel} p-5">
        <h2 class="${UI.panelTitle} mb-2">Обязательства</h2>
        <p class="text-sm text-slate-500">Обязательств пока нет.</p>
      </section>
    `;
  }

  const rows = items.map((item) => `
    <tr class="border-t border-slate-100">
      <td class="py-3 pr-3 text-sm font-medium text-slate-900">${escapeHtml(item.name)}</td>
      <td class="py-3 pr-3">${renderStatusBadge(item.status, item.statusLabel)}</td>
      <td class="py-3 pr-3 text-sm text-slate-700 whitespace-nowrap">${formatMoney(item.reserveAmount)}</td>
      <td class="py-3 pr-3 text-sm text-slate-600 whitespace-nowrap">${formatPaidUntil(item.paidUntil)}</td>
      <td class="py-3 text-sm text-slate-500 whitespace-nowrap">${item.paymentsCount} / ${formatMoney(item.paymentsTotal)}</td>
    </tr>
  `).join('');

  return `
    <section class="${UI.panel} p-5">
      <h2 class="${UI.panelTitle} mb-4">Обязательства</h2>
      <div class="overflow-x-auto -mx-2 px-2">
        <table class="w-full min-w-[640px]">
          <thead>
            <tr class="text-left text-xs uppercase tracking-wide text-slate-500">
              <th class="pb-2 pr-3 font-medium">Название</th>
              <th class="pb-2 pr-3 font-medium">Статус</th>
              <th class="pb-2 pr-3 font-medium">Резерв</th>
              <th class="pb-2 pr-3 font-medium">Оплачено до</th>
              <th class="pb-2 font-medium">Платежи</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderIncomePeriodSelect(activePreset) {
  const options = [
    { id: PERIOD_PRESETS.month, label: 'Текущий месяц' },
    { id: PERIOD_PRESETS.prev_month, label: 'Прошлый месяц' },
    { id: PERIOD_PRESETS.quarter, label: 'Квартал' },
    { id: PERIOD_PRESETS.year, label: 'Год' },
    { id: PERIOD_PRESETS.all, label: 'Всё время' }
  ];
  return options.map((opt) => {
    const selected = opt.id === activePreset ? ' selected' : '';
    return `<option value="${opt.id}"${selected}>${escapeHtml(opt.label)}</option>`;
  }).join('');
}

function renderIncomeSection(state, preset) {
  ensureDefaultIncomeCategories(state);
  const income = getIncomeSummary(state, preset);
  const byCategory = getIncomeByCategory(state, preset);

  const compareLine = income.previousTotal != null
    ? `<p class="text-xs text-slate-500 mt-1">Пред. период: ${formatMoney(income.previousTotal)} · ${income.deltaAmount >= 0 ? '+' : ''}${formatMoney(income.deltaAmount)}${income.deltaPercent != null ? ` (${income.deltaPercent}%)` : ''}</p>`
  : '';

  const trendRows = income.trend.length
    ? income.trend.map((row) => `
      <div class="flex justify-between text-sm py-1 border-b border-slate-50 last:border-0">
        <span class="text-slate-600">${escapeHtml(row.date)}</span>
        <span class="font-medium text-emerald-700">${formatMoney(row.amount)}</span>
      </div>
    `).join('')
    : '<p class="text-sm text-slate-500">Нет поступлений за выбранный период.</p>';

  const listRows = income.items.length
    ? income.items.slice(0, 20).map((tx) => `
      <li class="flex justify-between gap-3 text-sm py-2 border-b border-slate-50">
        <div class="min-w-0">
          <p class="font-medium text-slate-800 truncate">${escapeHtml(tx.comment || 'Пополнение счёта')}</p>
          <p class="text-xs text-slate-500">${escapeHtml(tx.date ?? '')} · ${escapeHtml(tx.incomeCategoryName || 'Без категории')}</p>
        </div>
        <span class="text-emerald-700 font-semibold whitespace-nowrap">${formatMoney(tx.amount)}</span>
      </li>
    `).join('')
    : '';

  const categoryRows = byCategory.length
    ? byCategory.map((item) => {
      const maxAmount = byCategory[0]?.amount ?? 1;
      const width = maxAmount > 0 ? Math.max(4, Math.round((item.amount / maxAmount) * 100)) : 0;
      return `
        <li class="space-y-1">
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="font-medium text-slate-800 truncate">${escapeHtml(item.categoryName)}</span>
            <span class="text-slate-600 whitespace-nowrap">${formatMoney(item.amount)} · ${item.sharePercent}%</span>
          </div>
          <div class="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div class="h-full rounded-full bg-emerald-500" style="width: ${width}%"></div>
          </div>
          <p class="text-xs text-slate-400">${item.count} поступлений</p>
        </li>
      `;
    }).join('')
    : '<p class="text-sm text-slate-500">Нет данных по категориям дохода.</p>';

  const categoryManage = (state.incomeCategories ?? []).map((cat) => `
    <li class="flex items-center justify-between gap-2 text-sm py-1">
      <span class="text-slate-800">${escapeHtml(cat.name)}</span>
      <button type="button" class="text-primary-600 text-xs font-medium" data-action="rename-income-category" data-category-id="${escapeHtml(cat.id)}">Переименовать</button>
    </li>
  `).join('');

  return `
    <section class="${UI.panel} p-5" data-income-section>
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 class="${UI.panelTitle}">Доходы</h2>
        <select data-action="income-period" class="text-sm rounded-lg border border-slate-200 px-3 py-2 bg-white">
          ${renderIncomePeriodSelect(preset)}
        </select>
      </div>
      <p class="text-xs text-slate-500 mb-3">${escapeHtml(income.range.label)} · ${escapeHtml(income.range.from)} — ${escapeHtml(income.range.to)}</p>
      <div class="grid grid-cols-2 gap-3 mb-4">
        ${renderSummaryCard('Сумма доходов', income.total, 'emerald')}
        <div class="rounded-xl p-4 bg-blue-50 text-blue-700">
          <p class="text-xs mb-1 text-blue-600">Поступлений</p>
          <p class="text-lg font-semibold">${income.count}</p>
        </div>
      </div>
      ${compareLine}
      <div class="grid gap-6 lg:grid-cols-2 mt-6">
        <div>
          <h3 class="text-sm font-semibold text-slate-800 mb-2">Динамика по датам</h3>
          ${trendRows}
        </div>
        <div>
          <h3 class="text-sm font-semibold text-slate-800 mb-2">По категориям</h3>
          <ul class="space-y-3">${categoryRows}</ul>
        </div>
      </div>
      ${listRows ? `<ul class="mt-6 divide-y divide-slate-100">${listRows}</ul>` : ''}
      <div class="mt-6 pt-4 border-t border-slate-100">
        <h3 class="text-sm font-semibold text-slate-800 mb-2">Категории доходов</h3>
        <ul class="space-y-1 mb-3">${categoryManage}</ul>
        <form data-form="add-income-category" class="flex gap-2">
          <input type="text" name="name" maxlength="80" required placeholder="Новая категория" class="flex-1 text-sm rounded-lg border border-slate-200 px-3 py-2">
          <button type="submit" class="${UI.btnPrimaryBlock} whitespace-nowrap">Добавить</button>
        </form>
      </div>
    </section>
  `;
}

export function renderStats(state, container, options = {}) {
  const incomePreset = options.incomePreset ?? state._statsIncomePreset ?? PERIOD_PRESETS.month;
  state._statsIncomePreset = incomePreset;

  const summary = getFinancialSummary(state);
  const expenses = getExpensesByCategory(state);
  const savings = getSavingsProgress(state);
  const obligations = getObligationsOverview(state);

  container.innerHTML = `
    <div class="space-y-6">
      ${renderFinancialSummary(summary)}
      ${renderIncomeSection(state, incomePreset)}
      <div class="grid gap-6 lg:grid-cols-2">
        ${renderExpensesByCategory(expenses)}
        ${renderSavingsProgress(savings)}
      </div>
      ${renderObligationsOverview(obligations)}
    </div>
  `;
}

export function initStatsHandlers(state, container, onStateChange) {
  if (container.dataset.statsHandlersBound) return;
  container.dataset.statsHandlersBound = '1';

  document.addEventListener('change', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    const select = event.target.closest('[data-action="income-period"]');
    if (!select) return;
    state._statsIncomePreset = select.value || PERIOD_PRESETS.month;
    renderStats(state, container, { incomePreset: state._statsIncomePreset });
  });

  document.addEventListener('click', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    const btn = event.target.closest('[data-action="rename-income-category"]');
    if (!btn) return;
    const categoryId = btn.dataset.categoryId;
    const current = (state.incomeCategories ?? []).find((c) => c.id === categoryId);
    const name = prompt('Новое название категории дохода', current?.name ?? '');
    if (!name) return;
    const result = renameIncomeCategory(state, categoryId, name);
    if (!result.ok) {
      alert(result.error);
      return;
    }
    onStateChange();
    renderStats(state, container, { incomePreset: state._statsIncomePreset });
  });

  document.addEventListener('submit', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    const form = event.target.closest('[data-form="add-income-category"]');
    if (!form) return;
    event.preventDefault();
    const result = addIncomeCategory(state, form.name.value);
    if (!result.ok) {
      alert(result.error);
      return;
    }
    form.reset();
    onStateChange();
    renderStats(state, container, { incomePreset: state._statsIncomePreset });
  });
}
