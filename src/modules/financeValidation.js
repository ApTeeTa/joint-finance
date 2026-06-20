import {
  calculateFreeBalance,
  calculateReservedBalance
} from './financeEngine.js';

export function validateAvailableFunds(amount, state) {
  const normalizedAmount = Number(amount);
  const free = calculateFreeBalance(state);
  const blocked = calculateReservedBalance(state);

  if (!Number.isFinite(normalizedAmount) || normalizedAmount < 0) {
    return {
      ok: false,
      free,
      blocked,
      reason: 'Сумма должна быть неотрицательным числом'
    };
  }

  if (normalizedAmount > free) {
    return {
      ok: false,
      free,
      blocked,
      reason: 'Недостаточно свободных средств'
    };
  }

  return {
    ok: true,
    free,
    blocked,
    reason: null
  };
}
