import { FINANCE_ENTRY_POINTS } from './financeEntryRegistry.js';
import { withGateContext, assertCalledFromAllowedEntryPoint } from './financeGateHelpers.js';
import { FinanceInvariantError } from './financeCoreInvariants.js';
import {
  recordExpense,
  recordReserve,
  recordCategoryUnreserve,
  recordCategoryDeleted,
  recordObligationUnreserve,
  recordObligationReserve,
  recordObligationPayment,
  recordAccountDeposit,
  recordAccountTransfer,
  recordAccountCreated,
  recordAccountUpdated,
  recordAccountDeleted,
  recordSavingCreate,
  recordSavingDeposit,
  recordSavingWithdraw,
  recordSavingUpdate,
  recordSavingDelete,
  recordSavingSpend,
  recordDebtCreateOwedToUs,
  recordDebtCreateWeOwe,
  recordManualDebtEvent,
  recordManualDebtUpdate,
  recordManualDebtDelete,
  recordDebtRepayment,
  recordDebtWriteOff,
  cancelTransaction
} from './transactions.js';

export { assertCalledFromAllowedEntryPoint };

function runProtected(entryPoint, fn) {
  return withGateContext(entryPoint, () => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof FinanceInvariantError) {
        return { ok: false, error: e.message };
      }
      throw e;
    }
  });
}

export function createExpense(state, categoryId, amount, accountId, comment, date, author) {
  return runProtected(FINANCE_ENTRY_POINTS.EXPENSE, () =>
    recordExpense(state, categoryId, amount, accountId, comment, date, author)
  );
}

export function reserveCategory(state, categoryId, amount, comment, date, author) {
  return runProtected(FINANCE_ENTRY_POINTS.RESERVE, () =>
    recordReserve(state, categoryId, amount, comment, date, author)
  );
}

export function unreserveCategory(state, categoryId, amount, comment, date, author) {
  return runProtected(FINANCE_ENTRY_POINTS.UNRESERVE, () =>
    recordCategoryUnreserve(state, categoryId, amount, comment, date, author)
  );
}

export function deleteCategory(state, category, author) {
  return runProtected(FINANCE_ENTRY_POINTS.CATEGORY_DELETE, () =>
    recordCategoryDeleted(state, category, author)
  );
}

export function updateSavings(state, { action, savingId, amount, comment, date, author }) {
  return runProtected(FINANCE_ENTRY_POINTS.SAVINGS, () => {
    if (action === 'deposit') {
      return recordSavingDeposit(state, savingId, amount, comment, date, author);
    }

    if (action === 'withdraw') {
      return recordSavingWithdraw(state, savingId, amount, comment, date, author);
    }

    return { ok: false, error: 'Неизвестное действие копилки' };
  });
}

export function spendSaving(state, savingId, accountId, comment, date, author) {
  return runProtected(FINANCE_ENTRY_POINTS.SPEND_SAVING, () =>
    recordSavingSpend(state, savingId, accountId, comment, date, author)
  );
}

export function createSaving(state, saving, author) {
  return runProtected(FINANCE_ENTRY_POINTS.SAVING_ADMIN, () =>
    recordSavingCreate(state, saving, author)
  );
}

export function updateSavingRecord(state, savingId, changes, author) {
  return runProtected(FINANCE_ENTRY_POINTS.SAVING_ADMIN, () =>
    recordSavingUpdate(state, savingId, changes, author)
  );
}

export function deleteSavingRecord(state, saving, author, customComment, options) {
  return runProtected(FINANCE_ENTRY_POINTS.SAVING_ADMIN, () =>
    recordSavingDelete(state, saving, author, customComment, options)
  );
}

export function payObligation(state, obligationId, amount, accountId, paidUntil, comment, date, author) {
  return runProtected(FINANCE_ENTRY_POINTS.OBLIGATION, () =>
    recordObligationPayment(
      state,
      obligationId,
      amount,
      accountId,
      paidUntil,
      comment,
      date,
      author
    )
  );
}

export function unreserveObligation(state, obligationId, amount, comment, date, author) {
  return runProtected(FINANCE_ENTRY_POINTS.OBLIGATION_UNRESERVE, () =>
    recordObligationUnreserve(state, obligationId, amount, comment, date, author)
  );
}

export function reserveObligation(state, obligationId, amount, comment, date, author) {
  return runProtected(FINANCE_ENTRY_POINTS.OBLIGATION_RESERVE, () =>
    recordObligationReserve(state, obligationId, amount, comment, date, author)
  );
}

export function depositAccount(state, accountId, amount, comment, date, author) {
  return runProtected(FINANCE_ENTRY_POINTS.ACCOUNT, () =>
    recordAccountDeposit(state, accountId, amount, comment, date, author)
  );
}

export function transferAccount(state, params) {
  return runProtected(FINANCE_ENTRY_POINTS.ACCOUNT, () =>
    recordAccountTransfer(state, params)
  );
}

export function createAccount(state, account, initialBalance, author) {
  return runProtected(FINANCE_ENTRY_POINTS.ACCOUNT, () =>
    recordAccountCreated(state, account, initialBalance, author)
  );
}

export function updateAccountRecord(state, accountId, changes, author) {
  return runProtected(FINANCE_ENTRY_POINTS.ACCOUNT, () =>
    recordAccountUpdated(state, accountId, changes, author)
  );
}

export function deleteAccountRecord(state, account, author) {
  return runProtected(FINANCE_ENTRY_POINTS.ACCOUNT, () =>
    recordAccountDeleted(state, account, author)
  );
}

export function createDebtOwedToUs(state, params) {
  return runProtected(FINANCE_ENTRY_POINTS.DEBT, () =>
    recordDebtCreateOwedToUs(state, params)
  );
}

export function createDebtWeOwe(state, params) {
  return runProtected(FINANCE_ENTRY_POINTS.DEBT, () =>
    recordDebtCreateWeOwe(state, params)
  );
}

export function createManualDebtEvent(state, params) {
  return runProtected(FINANCE_ENTRY_POINTS.DEBT, () =>
    recordManualDebtEvent(state, params)
  );
}

export function updateManualDebtEvent(state, debtId, params) {
  return runProtected(FINANCE_ENTRY_POINTS.DEBT, () =>
    recordManualDebtUpdate(state, debtId, params)
  );
}

export function deleteManualDebtEvent(state, debtId) {
  return runProtected(FINANCE_ENTRY_POINTS.DEBT, () =>
    recordManualDebtDelete(state, debtId)
  );
}

export function repayDebt(state, debtId, amount, accountId, comment, date, author) {
  return runProtected(FINANCE_ENTRY_POINTS.DEBT, () =>
    recordDebtRepayment(state, debtId, amount, accountId, comment, date, author)
  );
}

export function writeOffDebt(state, debtId, comment, date, author) {
  return runProtected(FINANCE_ENTRY_POINTS.DEBT, () =>
    recordDebtWriteOff(state, debtId, comment, date, author)
  );
}

export function undoTransaction(state, transactionId) {
  return runProtected(FINANCE_ENTRY_POINTS.UNDO, () =>
    cancelTransaction(state, transactionId)
  );
}
