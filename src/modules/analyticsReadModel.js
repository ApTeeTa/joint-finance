import {
  calculateFreeBalance,
  calculateReservedBalance,
  calculateTotalBalance
} from './financeEngine.js';
import { computePaidUntilFromPayments } from './obligationPaidUntil.js';
import {
  TRANSACTION_STATUS,
  TRANSACTION_TYPES,
  getSavingAccumulated
} from './transactions.js';
import { getRecommendedMonthlyPayment } from './savings.js';
import { findIncomeCategory, resolveIncomeCategoryName } from './incomeCategories.js';

const EXPENSE_TOP_LIMIT = 10;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function isAnalyticsTransaction(tx) {
  if (!tx) return false;
  if (tx.status === TRANSACTION_STATUS.CANCELLED) return false;
  if (tx.service === true) return false;
  return true;
}

function getTransactionDate(tx) {
  return tx.date || tx.createdAt?.slice(0, 10) || null;
}

function findCategoryName(state, categoryId, fallbackName) {
  if (fallbackName) return fallbackName;
  const category = (state.categories ?? []).find((item) => item.id === categoryId);
  return category?.name ?? 'Без категории';
}

function sumSavingsAccumulated(state) {
  return (state.savings ?? []).reduce(
    (sum, saving) => sum + getSavingAccumulated(saving),
    0
  );
}

function sumObligationReserves(state) {
  return (state.obligations ?? []).reduce(
    (sum, obligation) => sum + (obligation.reserveAmount ?? 0),
    0
  );
}

function sumActiveDebtLiabilities(state) {
  return (state.debts ?? []).reduce((sum, debt) => {
    if (debt.type === 'we_owe' || debt.type === 'manual_debt_event') {
      return sum + (debt.remainingAmount ?? 0);
    }
    return sum;
  }, 0);
}

function sumActiveDebtReceivables(state) {
  return (state.debts ?? []).reduce((sum, debt) => {
    if (debt.type === 'owed_to_us') {
      return sum + (debt.remainingAmount ?? 0);
    }
    return sum;
  }, 0);
}

export function getFinancialSummary(state) {
  const totalBalance = calculateTotalBalance(state);
  const liabilitiesTotal = sumActiveDebtLiabilities(state);
  const receivablesTotal = sumActiveDebtReceivables(state);

  return {
    freeBalance: calculateFreeBalance(state),
    reservedBalance: calculateReservedBalance(state),
    savingsTotal: sumSavingsAccumulated(state),
    obligationsTotal: sumObligationReserves(state),
    totalBalance,
    liabilitiesTotal,
    receivablesTotal,
    netBalance: totalBalance + receivablesTotal - liabilitiesTotal
  };
}

export function getExpensesByCategory(state, limit = EXPENSE_TOP_LIMIT) {
  const totals = new Map();

  for (const tx of state.transactions ?? []) {
    if (!isAnalyticsTransaction(tx)) continue;
    if (tx.type !== TRANSACTION_TYPES.EXPENSE) continue;

    const categoryId = tx.categoryId ?? '__none__';
    const current = totals.get(categoryId) ?? {
      categoryId: tx.categoryId ?? null,
      categoryName: findCategoryName(state, tx.categoryId, tx.categoryName),
      amount: 0,
      count: 0
    };

    current.amount += Number(tx.amount) || 0;
    current.count += 1;
    if (!current.categoryName || current.categoryName === 'Без категории') {
      current.categoryName = findCategoryName(state, tx.categoryId, tx.categoryName);
    }
    totals.set(categoryId, current);
  }

  return [...totals.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export function getSavingsProgress(state) {
  return (state.savings ?? []).map((saving) => {
    const accumulated = getSavingAccumulated(saving);
    const targetAmount = saving.targetAmount ?? null;
    const hasTarget = targetAmount != null && targetAmount > 0;
    const progressPercent = hasTarget
      ? Math.min(100, Math.round((accumulated / targetAmount) * 100))
      : null;
    const recommendation = hasTarget ? getRecommendedMonthlyPayment(saving) : null;

    return {
      id: saving.id,
      name: saving.name ?? 'Копилка',
      accumulated,
      targetAmount,
      progressPercent,
      savingType: saving.savingType ?? 'recurring',
      recommendedMonthly: recommendation?.kind === 'active' ? recommendation.amount : null,
      recommendationStatus: recommendation?.kind ?? null
    };
  }).sort((a, b) => b.accumulated - a.accumulated);
}

function resolveObligationStatus(obligation) {
  const paidUntil = computePaidUntilFromPayments(obligation);
  const reserveAmount = obligation.reserveAmount ?? 0;
  const paymentsCount = (obligation.payments ?? []).length;

  if (paidUntil && paidUntil < todayIso()) {
    return {
      status: 'overdue',
      statusLabel: 'Просрочено',
      paidUntil
    };
  }

  if (reserveAmount === 0 && paymentsCount > 0 && paidUntil && paidUntil >= todayIso()) {
    return {
      status: 'completed',
      statusLabel: 'Оплачено',
      paidUntil
    };
  }

  return {
    status: 'active',
    statusLabel: 'Активно',
    paidUntil: paidUntil ?? obligation.paidUntil ?? null
  };
}

export function getObligationsOverview(state) {
  return (state.obligations ?? []).map((obligation) => {
    const resolved = resolveObligationStatus(obligation);
    const payments = Array.isArray(obligation.payments) ? obligation.payments : [];
    const paymentsTotal = payments.reduce(
      (sum, payment) => sum + (Number(payment.amount) || 0),
      0
    );

    return {
      id: obligation.id,
      name: obligation.name ?? 'Обязательство',
      status: resolved.status,
      statusLabel: resolved.statusLabel,
      storedStatus: obligation.status ?? null,
      reserveAmount: obligation.reserveAmount ?? 0,
      paidUntil: resolved.paidUntil,
      paymentsCount: payments.length,
      paymentsTotal
    };
  }).sort((a, b) => {
    const order = { overdue: 0, active: 1, completed: 2 };
    const rankA = order[a.status] ?? 3;
    const rankB = order[b.status] ?? 3;
    if (rankA !== rankB) return rankA - rankB;
    return String(a.paidUntil ?? '').localeCompare(String(b.paidUntil ?? ''));
  });
}

export function getAnalyticsTransactions(state) {
  return (state.transactions ?? []).filter(isAnalyticsTransaction);
}

export function getTransactionEffectiveDate(tx) {
  return getTransactionDate(tx);
}

const PERIOD_PRESETS = {
  month: 'month',
  prev_month: 'prev_month',
  quarter: 'quarter',
  year: 'year',
  all: 'all'
};

export { PERIOD_PRESETS };

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * @returns {{ from: string, to: string, label: string, previousFrom: string|null, previousTo: string|null }}
 */
export function resolveIncomePeriodRange(preset = 'month', now = new Date()) {
  const base = startOfDay(now);
  const year = base.getFullYear();
  const month = base.getMonth();

  if (preset === PERIOD_PRESETS.all) {
    return {
      from: '1970-01-01',
      to: formatIsoDate(endOfDay(now)),
      label: 'За всё время',
      previousFrom: null,
      previousTo: null
    };
  }

  if (preset === PERIOD_PRESETS.year) {
    const from = new Date(year, 0, 1);
    const to = endOfDay(now);
    const prevFrom = new Date(year - 1, 0, 1);
    const prevTo = new Date(year - 1, 11, 31);
    return {
      from: formatIsoDate(from),
      to: formatIsoDate(to),
      label: `${year} год`,
      previousFrom: formatIsoDate(prevFrom),
      previousTo: formatIsoDate(endOfDay(prevTo))
    };
  }

  if (preset === PERIOD_PRESETS.quarter) {
    const qStartMonth = Math.floor(month / 3) * 3;
    const from = new Date(year, qStartMonth, 1);
    const to = endOfDay(now);
    const prevFrom = new Date(year, qStartMonth - 3, 1);
    const prevTo = new Date(year, qStartMonth, 0);
    return {
      from: formatIsoDate(from),
      to: formatIsoDate(to),
      label: 'Текущий квартал',
      previousFrom: formatIsoDate(prevFrom),
      previousTo: formatIsoDate(endOfDay(prevTo))
    };
  }

  if (preset === PERIOD_PRESETS.prev_month) {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0);
    return {
      from: formatIsoDate(from),
      to: formatIsoDate(endOfDay(to)),
      label: 'Прошлый месяц',
      previousFrom: formatIsoDate(new Date(year, month - 2, 1)),
      previousTo: formatIsoDate(endOfDay(new Date(year, month - 1, 0)))
    };
  }

  const from = new Date(year, month, 1);
  const to = endOfDay(now);
  const prevFrom = new Date(year, month - 1, 1);
  const prevTo = new Date(year, month, 0);
  return {
    from: formatIsoDate(from),
    to: formatIsoDate(to),
    label: 'Текущий месяц',
    previousFrom: formatIsoDate(prevFrom),
    previousTo: formatIsoDate(endOfDay(prevTo))
  };
}

function isDateInRange(isoDate, from, to) {
  if (!isoDate) return false;
  return isoDate >= from && isoDate <= to;
}

export function getIncomeTransactionsInPeriod(state, from, to) {
  return (state.transactions ?? [])
    .filter((tx) => {
      if (!isAnalyticsTransaction(tx)) return false;
      if (tx.type !== TRANSACTION_TYPES.ACCOUNT_DEPOSIT) return false;
      const date = getTransactionDate(tx);
      return isDateInRange(date, from, to);
    })
    .sort((a, b) => {
      const da = getTransactionDate(a) ?? '';
      const db = getTransactionDate(b) ?? '';
      return db.localeCompare(da);
    });
}

function sumIncomeAmount(transactions) {
  return transactions.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
}

export function getIncomeSummary(state, preset = 'month') {
  const range = resolveIncomePeriodRange(preset);
  const items = getIncomeTransactionsInPeriod(state, range.from, range.to);
  const total = sumIncomeAmount(items);
  const count = items.length;

  let previousTotal = null;
  let deltaAmount = null;
  let deltaPercent = null;
  if (range.previousFrom && range.previousTo) {
    const prevItems = getIncomeTransactionsInPeriod(
      state,
      range.previousFrom,
      range.previousTo
    );
    previousTotal = sumIncomeAmount(prevItems);
    deltaAmount = total - previousTotal;
    if (previousTotal > 0) {
      deltaPercent = Math.round(((total - previousTotal) / previousTotal) * 100);
    } else if (total > 0) {
      deltaPercent = 100;
    } else {
      deltaPercent = 0;
    }
  }

  const byDate = new Map();
  for (const tx of items) {
    const date = getTransactionDate(tx) ?? '—';
    byDate.set(date, (byDate.get(date) ?? 0) + (Number(tx.amount) || 0));
  }
  const trend = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, amount]) => ({ date, amount }));

  return {
    preset,
    range,
    total,
    count,
    items,
    trend,
    previousTotal,
    deltaAmount,
    deltaPercent
  };
}

export function getIncomeByCategory(state, preset = 'month') {
  const range = resolveIncomePeriodRange(preset);
  const items = getIncomeTransactionsInPeriod(state, range.from, range.to);
  const totals = new Map();

  for (const tx of items) {
    const categoryId = tx.incomeCategoryId ?? '__none__';
    const current = totals.get(categoryId) ?? {
      categoryId: tx.incomeCategoryId ?? null,
      categoryName: resolveIncomeCategoryName(
        state,
        tx.incomeCategoryId,
        tx.incomeCategoryName
      ),
      amount: 0,
      count: 0
    };
    if (tx.incomeCategoryId) {
      const cat = findIncomeCategory(state, tx.incomeCategoryId);
      if (cat?.name) current.categoryName = cat.name;
    }
    current.amount += Number(tx.amount) || 0;
    current.count += 1;
    totals.set(categoryId, current);
  }

  const grandTotal = sumIncomeAmount(items);
  return [...totals.values()]
    .map((row) => ({
      ...row,
      sharePercent: grandTotal > 0 ? Math.round((row.amount / grandTotal) * 100) : 0
    }))
    .sort((a, b) => b.amount - a.amount);
}
