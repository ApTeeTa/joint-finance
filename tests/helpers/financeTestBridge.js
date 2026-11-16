import { payObligation, updateObligationRecord, undoTransaction } from '../../src/modules/financeGate.js';

export function cancelTransaction(state, transactionId) {
  return undoTransaction(state, transactionId);
}

/** Obligation payment in tests — via finance gate (enforcement-safe). */
export function recordObligationPayment(
  state,
  obligationId,
  amount,
  accountId,
  paidUntil,
  comment,
  date,
  author
) {
  const result = payObligation(
    state,
    obligationId,
    amount,
    accountId,
    paidUntil,
    comment,
    date,
    author
  );
  if (!result?.ok) {
    return result ?? { ok: false, error: 'payObligation failed' };
  }
  return result;
}

export function recordObligationUpdated(state, obligationId, data, author) {
  return updateObligationRecord(state, obligationId, data, author);
}