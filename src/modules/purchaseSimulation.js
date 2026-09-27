import { calculateFreeBalance } from './financeEngine.js';
import { isMiscCategory, getSavingAccumulated } from './transactions.js';

export const RESERVE_SOURCE_TYPES = Object.freeze({
  CATEGORY: 'category',
  SAVING: 'saving',
  OBLIGATION: 'obligation',
  DEBT: 'debt'
});

function parsePurchaseAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: 'Enter an amount greater than zero.' };
  }
  return { ok: true, value };
}

function debtDisplayName(debt) {
  return debt.title || debt.description || debt.name || 'Debt';
}

/**
 * Lists every reserve pool with a positive balance, using the same fields as financeEngine.
 */
export function listReserveSources(state) {
  const sources = [];

  for (const category of state.categories ?? []) {
    if (isMiscCategory(category)) continue;
    const amount = category.reserved ?? 0;
    if (amount <= 0) continue;
    sources.push({
      type: RESERVE_SOURCE_TYPES.CATEGORY,
      id: category.id,
      name: category.name,
      amount,
      kindLabel: 'Category budget'
    });
  }

  for (const saving of state.savings ?? []) {
    const amount = getSavingAccumulated(saving);
    if (amount <= 0) continue;
    sources.push({
      type: RESERVE_SOURCE_TYPES.SAVING,
      id: saving.id,
      name: saving.name,
      amount,
      targetAmount: saving.targetAmount ?? null,
      deadlineType: saving.deadlineType ?? null,
      deadlineDate: saving.deadlineDate ?? null,
      kindLabel: 'Savings goal'
    });
  }

  for (const obligation of state.obligations ?? []) {
    const amount = obligation.reserveAmount ?? 0;
    if (amount <= 0) continue;
    sources.push({
      type: RESERVE_SOURCE_TYPES.OBLIGATION,
      id: obligation.id,
      name: obligation.name,
      amount,
      paidUntil: obligation.paidUntil ?? null,
      kindLabel: 'Obligation'
    });
  }

  for (const debt of state.debts ?? []) {
    const isWeOwe = debt.direction === 'we_owe';
    const amount = debt.reserved ?? 0;
    if (!isWeOwe || amount <= 0) continue;
    sources.push({
      type: RESERVE_SOURCE_TYPES.DEBT,
      id: debt.id,
      name: debtDisplayName(debt),
      amount,
      kindLabel: 'Debt reserve'
    });
  }

  return sources.sort((a, b) => b.amount - a.amount);
}

/**
 * Hypothetical impact if `drawAmount` is taken entirely from one reserve source.
 * Read-only — does not mutate state.
 */
export function projectReserveImpact(source, drawAmount) {
  const withdrawal = Math.min(drawAmount, source.amount);
  const remaining = source.amount - withdrawal;

  const impact = {
    sourceId: source.id,
    sourceType: source.type,
    name: source.name,
    kindLabel: source.kindLabel,
    currentAmount: source.amount,
    withdrawal,
    remaining,
    canCoverFully: source.amount >= drawAmount
  };

  if (source.type === RESERVE_SOURCE_TYPES.SAVING) {
    impact.targetAmount = source.targetAmount;
    impact.deadlineType = source.deadlineType;
    impact.deadlineDate = source.deadlineDate;
  }

  if (source.type === RESERVE_SOURCE_TYPES.OBLIGATION) {
    impact.paidUntil = source.paidUntil;
  }

  return impact;
}

/**
 * Simulates a purchase against current Free balance and existing reserves.
 * Uses calculateFreeBalance from financeEngine — no duplicate balance math.
 */
export function simulatePurchase(state, { name = '', amount }) {
  const parsed = parsePurchaseAmount(amount);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const purchaseAmount = parsed.value;
  const freeBefore = calculateFreeBalance(state);
  const fitsInFree = purchaseAmount <= freeBefore;
  const shortfall = fitsInFree ? 0 : purchaseAmount - freeBefore;
  const freeAfter = fitsInFree ? freeBefore - purchaseAmount : 0;

  const result = {
    ok: true,
    name: String(name ?? '').trim(),
    purchaseAmount,
    freeBefore,
    freeAfter,
    fitsInFree,
    shortfall,
    impacts: []
  };

  if (!fitsInFree && shortfall > 0) {
    result.impacts = listReserveSources(state).map((source) => projectReserveImpact(source, shortfall));
  }

  return result;
}
