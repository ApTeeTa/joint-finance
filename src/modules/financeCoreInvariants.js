import {
  calculateFreeBalance,
  calculateTotalBalance,
  calculateReservedBalance
} from './financeEngine.js';

export class FinanceInvariantError extends Error {
  constructor(errors, context = {}) {
    super(errors[0] ?? 'Нарушен финансовый инвариант');
    this.name = 'FinanceInvariantError';
    this.errors = errors;
    this.context = context;
  }
}

export function checkFinancialInvariants(state) {
  const errors = [];

  const total = calculateTotalBalance(state);
  const reserved = calculateReservedBalance(state);
  const free = calculateFreeBalance(state);

  if (reserved > total) {
    errors.push('Зарезервированная сумма превышает общий баланс');
  }

  if (free < 0) {
    errors.push('Свободный баланс отрицательный');
  }

  if (reserved < 0) {
    errors.push('Суммарный резерв отрицательный');
  }

  (state.accounts ?? []).forEach((account, index) => {
    if ((account.balance ?? 0) < 0) {
      errors.push(`Счёт #${index + 1}: отрицательный баланс`);
    }
  });

  (state.categories ?? []).forEach((category, index) => {
    if ((category.reserved ?? 0) < 0) {
      errors.push(`Категория #${index + 1}: отрицательный резерв`);
    }
  });

  (state.savings ?? []).forEach((saving, index) => {
    const accumulated = saving.accumulated ?? saving.amount ?? 0;
    if (accumulated < 0) {
      errors.push(`Копилка #${index + 1}: отрицательное накопление`);
    }
  });

  (state.obligations ?? []).forEach((obligation, index) => {
    if ((obligation.reserveAmount ?? 0) < 0) {
      errors.push(`Обязательство #${index + 1}: отрицательный резерв`);
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, errors: [] };
}

export function enforceFinancialInvariants(state, context = {}) {
  const result = checkFinancialInvariants(state);
  if (!result.ok) {
    throw new FinanceInvariantError(result.errors, context);
  }
}

export function assertFinancialInvariants(state, context = {}) {
  const result = checkFinancialInvariants(state);
  if (!result.ok) {
    console.error('[FINANCE INVARIANT VIOLATION]', {
      ...context,
      errors: result.errors
    });
  }
  return result;
}

export function invariantFailureError(result) {
  return result.errors[0] ?? 'Нарушен финансовый инвариант';
}
