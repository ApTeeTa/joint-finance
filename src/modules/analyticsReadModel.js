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
