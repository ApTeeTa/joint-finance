import {
  TRANSACTION_STATUS,
  TRANSACTION_TYPES,
  isMiscCategory
} from './transactions.js';
import { getAppCalendarIsoDate, getAppYearMonth } from './appCalendar.js';

function findCategory(state, categoryId) {
  return (state.categories ?? []).find((category) => category.id === categoryId);
}

export function getYearMonthFromIso(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') return null;
  return isoDate.slice(0, 7);
}

/**
 * Текущий месяц для лимитов — календарь Asia/Dubai.
 * @param {string|Date} [reference] ISO-дата (YYYY-MM-DD) в Dubai или Date (инстант)
 */
export function getCurrentYearMonth(reference) {
  if (reference instanceof Date) {
    return getAppYearMonth(reference);
  }
  if (typeof reference === 'string' && reference.length >= 7) {
    return getYearMonthFromIso(reference);
  }
  return getAppYearMonth();
}

export function getTransactionYearMonth(tx) {
  return getYearMonthFromIso(tx?.date || tx?.createdAt?.slice(0, 10));
}

/**
 * Сумма активных расходов категории за календарный месяц (по дате операции).
 */
export function getCategorySpentInMonth(state, categoryId, yearMonth) {
  if (!categoryId || !yearMonth) return 0;
  let sum = 0;
  for (const tx of state.transactions ?? []) {
    if (tx.status !== TRANSACTION_STATUS.ACTIVE) continue;
    if (tx.type !== TRANSACTION_TYPES.EXPENSE) continue;
    if (tx.categoryId !== categoryId) continue;
    if (getTransactionYearMonth(tx) !== yearMonth) continue;
    const amount = Number(tx.amount);
    if (Number.isFinite(amount)) sum += amount;
  }
  return sum;
}

/**
 * Кэш category.spent — только текущий календарный месяц (для UI и gate).
 * Прошлые месяцы всегда считаются из транзакций по запросу.
 */
/**
 * @param {string} yearMonth — месяц, за который пересчитываем кэш
 * @param {string} [currentYm] — какой месяц считается «текущим» (по умолчанию Dubai сейчас)
 */
export function syncCategorySpentCacheForMonth(state, categoryId, yearMonth, currentYm = getCurrentYearMonth()) {
  const category = findCategory(state, categoryId);
  if (!category || isMiscCategory(category)) return;
  if (!yearMonth) return;
  if (yearMonth !== currentYm) return;
  category.spent = getCategorySpentInMonth(state, categoryId, currentYm);
}

export function syncCategorySpentCachesForMonth(state, yearMonth) {
  if (!yearMonth) return;
  for (const category of state.categories ?? []) {
    if (isMiscCategory(category)) continue;
    syncCategorySpentCacheForMonth(state, category.id, yearMonth, yearMonth);
  }
}

export function syncCategorySpentForTransactionMonths(state, tx, previousDate) {
  if (!tx || tx.type !== TRANSACTION_TYPES.EXPENSE) return;
  if (!tx.categoryId) return;
  const category = findCategory(state, tx.categoryId);
  if (!category || isMiscCategory(category)) return;

  const currentYm = getCurrentYearMonth();
  const months = new Set();
  const nextYm = getTransactionYearMonth(tx);
  if (nextYm) months.add(nextYm);
  if (previousDate) {
    const prevYm = getYearMonthFromIso(previousDate);
    if (prevYm) months.add(prevYm);
  }
  if (months.has(currentYm)) {
    syncCategorySpentCacheForMonth(state, tx.categoryId, currentYm);
  }
}

export function syncCategorySpentCacheAfterCategoryMove(state, fromCategoryId, toCategoryId, expenseDate) {
  const yearMonth = getYearMonthFromIso(expenseDate) ?? getCurrentYearMonth();
  const currentYm = getCurrentYearMonth();
  if (yearMonth !== currentYm) return;
  if (fromCategoryId) syncCategorySpentCacheForMonth(state, fromCategoryId, currentYm);
  if (toCategoryId) syncCategorySpentCacheForMonth(state, toCategoryId, currentYm);
}

/** Доступно к трате из резерва с учётом месячного лимита. */
export function getCategorySpendAvailability(category, reserved, spentInMonth) {
  const limit = category?.limit ?? 0;
  const reserve = Math.max(0, reserved ?? 0);
  if (limit <= 0) {
    return reserve;
  }
  const underLimit = Math.max(0, limit - spentInMonth);
  return Math.min(reserve, underLimit);
}