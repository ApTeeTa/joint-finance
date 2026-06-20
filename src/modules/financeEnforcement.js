/**
 * A3.6 — Financial Enforcement Lock
 * When true, all financial mutations require financeGate entry context.
 */
export const FINANCE_ENFORCEMENT_MODE = true;

/**
 * Operations kept intentionally outside full user-action flow.
 * Each entry documents why it remains and the migration path.
 */
export const LEGACY_SAFE_OPERATIONS = {
  ensureObligationPaymentReserve:
    'Auto-reserve delta on explicit user payment (payObligation). Moved from UI in A3.5. ' +
    'LEGACY_SAFE until dedicated reserve step is enforced in UI.',
  reconcileLegacyTransactions:
    'Startup metadata repair only; does not mutate balances, reserves, or savings amounts.',
  recordSavingDelete_service:
    'Internal chained delete after explicit user spendSaving on single_use saving.'
};
