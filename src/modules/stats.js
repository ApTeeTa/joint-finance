import {
  getFinancialSummary,
  getExpensesByCategory,
  getSavingsProgress,
  getObligationsOverview
} from './analyticsReadModel.js';

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
    <section class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <h2 class="text-lg font-semibold text-slate-900 mb-4">Финансовая сводка</h2>
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
      <section class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <h2 class="text-lg font-semibold text-slate-900 mb-2">Расходы по категориям</h2>
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
    <section class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <h2 class="text-lg font-semibold text-slate-900 mb-4">Расходы по категориям</h2>
      <ul class="space-y-4">${rows}</ul>
    </section>
  `;
}

function renderSavingsProgress(items) {
  if (!items.length) {
    return `
      <section class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <h2 class="text-lg font-semibold text-slate-900 mb-2">Прогресс копилок</h2>
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
    <section class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <h2 class="text-lg font-semibold text-slate-900 mb-4">Прогресс копилок</h2>
      <ul class="space-y-3">${rows}</ul>
    </section>
  `;
}

function renderObligationsOverview(items) {
  if (!items.length) {
    return `
      <section class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <h2 class="text-lg font-semibold text-slate-900 mb-2">Обязательства</h2>
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
    <section class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <h2 class="text-lg font-semibold text-slate-900 mb-4">Обязательства</h2>
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

export function renderStats(state, container) {
  const summary = getFinancialSummary(state);
  const expenses = getExpensesByCategory(state);
  const savings = getSavingsProgress(state);
  const obligations = getObligationsOverview(state);

  container.innerHTML = `
    <div class="space-y-6">
      ${renderFinancialSummary(summary)}
      <div class="grid gap-6 lg:grid-cols-2">
        ${renderExpensesByCategory(expenses)}
        ${renderSavingsProgress(savings)}
      </div>
      ${renderObligationsOverview(obligations)}
    </div>
  `;
}

export function initStatsHandlers(_state, _container, _onStateChange) {
  // Read-only tab — обработчики не требуются.
}
