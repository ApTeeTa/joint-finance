export const TRANSACTION_TYPES = {
  ACCOUNT_DEPOSIT: 'account_deposit',
  ACCOUNT_TRANSFER: 'account_transfer',
  ACCOUNT_CREATED: 'account_created',
  ACCOUNT_UPDATED: 'account_updated',
  ACCOUNT_DELETED: 'account_deleted',
  RESERVE: 'reserve',
  CATEGORY_UNRESERVE: 'category_unreserve',
  EXPENSE: 'expense',
  CATEGORY_DELETED: 'category_deleted',
  SAVING_CREATE: 'saving_create',
  SAVING_DEPOSIT: 'saving_deposit',
  SAVING_WITHDRAW: 'saving_withdraw',
  SAVING_UPDATE: 'saving_update',
  SAVING_DELETE: 'saving_delete',
  SAVING_SPEND: 'saving_spend',
  DEBT_CREATE_OWED: 'debt_create_owed',
  DEBT_CREATE_WE_OWE: 'debt_create_we_owe',
  DEBT_REPAY_OWED: 'debt_repay_owed',
  DEBT_REPAY_WE_OWE: 'debt_repay_we_owe',
  DEBT_WRITE_OFF: 'debt_write_off',
  OBLIGATION_RESERVE: 'obligation_reserve',
  OBLIGATION_UNRESERVE: 'obligation_unreserve'
};

export const TRANSACTION_STATUS = {
  ACTIVE: 'active',
  CANCELLED: 'cancelled'
};

export const CANCELLABLE_TYPES = new Set([
  TRANSACTION_TYPES.ACCOUNT_DEPOSIT,
  TRANSACTION_TYPES.ACCOUNT_TRANSFER,
  TRANSACTION_TYPES.RESERVE,
  TRANSACTION_TYPES.CATEGORY_UNRESERVE,
  TRANSACTION_TYPES.EXPENSE,
  TRANSACTION_TYPES.CATEGORY_DELETED,
  TRANSACTION_TYPES.SAVING_DEPOSIT,
  TRANSACTION_TYPES.SAVING_WITHDRAW,
  TRANSACTION_TYPES.SAVING_SPEND,
  TRANSACTION_TYPES.DEBT_CREATE_OWED,
  TRANSACTION_TYPES.DEBT_CREATE_WE_OWE,
  TRANSACTION_TYPES.DEBT_REPAY_OWED,
  TRANSACTION_TYPES.DEBT_REPAY_WE_OWE,
  TRANSACTION_TYPES.DEBT_WRITE_OFF,
  TRANSACTION_TYPES.OBLIGATION_RESERVE,
  TRANSACTION_TYPES.OBLIGATION_UNRESERVE
]);

export const TYPE_LABELS = {
  account_deposit: 'Пополнение счёта',
  account_transfer: 'Перевод между счетами',
  account_created: 'Создание счёта',
  account_updated: 'Редактирование счёта',
  account_deleted: 'Удаление счёта',
  reserve: 'Резервирование',
  category_unreserve: 'Возврат резерва категории',
  expense: 'Расход',
  category_deleted: 'Удаление категории',
  saving_create: 'Создание копилки',
  saving_deposit: 'Пополнение копилки',
  saving_withdraw: 'Возврат из копилки',
  saving_update: 'Редактирование копилки',
  saving_delete: 'Удаление копилки',
  saving_spend: 'Трата из копилки',
  debt_create_owed: 'Выдан долг',
  debt_create_we_owe: 'Получен долг',
  debt_repay_owed: 'Возврат долга',
  debt_repay_we_owe: 'Погашение долга',
  debt_write_off: 'Списание долга',
  obligation_reserve: 'Резерв обязательства',
  obligation_unreserve: 'Возврат резерва обязательства'
};
export const AUTHOR_LABELS = {
  husband: 'Муж',
  wife: 'Жена'
};

export const MISC_CATEGORY_NAME = 'Прочее';

export const UNRESERVE_INSUFFICIENT_FREE_ERROR =
  'Недостаточно свободных денег для восстановления резерва';

export function isMiscCategory(category) {
  return category?.name === MISC_CATEGORY_NAME || category?.isSystem === true;
}

export function isServiceTransaction(tx) {
  return tx?.service === true;
}

import { calculateFreeBalance } from './financeEngine.js';
import {
  runFinanceGate,
  requireFinanceEntryPoint,
  blockIfGateRejected,
  withInternalFinanceContext
} from './financeGateHelpers.js';
import {
  enforceFinancialInvariants
} from './financeCoreInvariants.js';
import { LEGACY_SAFE_OPERATIONS } from './financeEnforcement.js';
import {
  computePaidUntilFromPayments,
  syncObligationStatusFromPayments
} from './obligationPaidUntil.js';

function guardFinanceEntry(operation) {
  const guard = requireFinanceEntryPoint(operation);
  if (!guard.allowed) {
    return { ok: false, error: guard.error };
  }
  return null;
}

function rejectGateDecision(gateDecision) {
  return blockIfGateRejected(gateDecision);
}

function createId(prefix) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createGroupId() {
  return createId('group');
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const DEFAULT_EXCHANGE_RATE = 92;

function formatMoney(amount, currency = 'RUB') {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'USD' ? 2 : 0
  }).format(amount ?? 0);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getExchangeRate(state) {
  const rate = Number(state.exchangeRate);
  return Number.isFinite(rate) && rate >= 1 ? rate : DEFAULT_EXCHANGE_RATE;
}

function roundMoney(amount, currency = 'RUB') {
  const decimals = currency === 'USD' ? 2 : 2;
  const factor = 10 ** decimals;
  return Math.round(Number(amount) * factor) / factor;
}

export function renderAccountSelectOptions(state, selectedId = '', excludeAccountId = null) {
  const accounts = (state.accounts ?? []).filter(
    (account) => account.id !== excludeAccountId
  );

  if (!accounts.length) {
    return '<option value="">Нет счетов</option>';
  }

  return accounts.map((account) => {
    const currency = account.currency ?? 'RUB';
    const owner = AUTHOR_LABELS[account.owner ?? 'husband'] ?? account.owner;
    const label = `${escapeHtml(account.name)} (${owner}) — ${formatMoney(account.balance, currency)}`;
    const selected = account.id === selectedId ? ' selected' : '';
    return `<option value="${account.id}"${selected}>${label}</option>`;
  }).join('');
}

export function ensureTransactions(state) {  if (!Array.isArray(state.transactions)) {
    state.transactions = [];
  }
}

function normalizeAuthor(author, state) {
  if (author === 'wife' || author === 'husband') return author;
  return state.profile === 'wife' ? 'wife' : 'husband';
}

function findAccount(state, accountId) {
  return (state.accounts ?? []).find((account) => account.id === accountId);
}

function findCategory(state, categoryId) {
  return (state.categories ?? []).find((category) => category.id === categoryId);
}

function findSaving(state, savingId) {
  return (state.savings ?? []).find((saving) => saving.id === savingId);
}

function findDebt(state, debtId) {
  return (state.debts ?? []).find((debt) => debt.id === debtId);
}

function findObligation(state, obligationId) {
  return (state.obligations ?? []).find((obligation) => obligation.id === obligationId);
}

function ensureDebts(state) {
  if (!Array.isArray(state.debts)) {
    state.debts = [];
  }
}

function rubToAccountAmount(rubAmount, account, state) {
  const accountCurrency = account.currency ?? 'RUB';
  const exchangeRate = getExchangeRate(state);
  return accountCurrency === 'USD'
    ? roundMoney(rubAmount / exchangeRate, 'USD')
    : roundMoney(rubAmount, 'RUB');
}

export function getSavingAccumulated(saving) {
  return saving?.accumulated ?? saving?.amount ?? 0;
}

function findTransaction(state, transactionId) {
  return (state.transactions ?? []).find((tx) => tx.id === transactionId);
}

function sortByNewest(transactions) {
  return [...transactions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getAllTransactions(state) {
  ensureTransactions(state);
  return sortByNewest(state.transactions);
}

export function getUserTransactions(state) {
  return getAllTransactions(state).filter((tx) => !isServiceTransaction(tx));
}

export function getAccountTransactions(state, accountId, limit = 3) {
  return getAllTransactions(state)
    .filter((tx) => {
      if (tx.status !== TRANSACTION_STATUS.ACTIVE) return false;
      if (tx.type === TRANSACTION_TYPES.ACCOUNT_DEPOSIT && tx.accountId === accountId) return true;
      if (tx.type === TRANSACTION_TYPES.ACCOUNT_TRANSFER) {
        return tx.sourceAccountId === accountId || tx.destAccountId === accountId;
      }
      if (tx.type === TRANSACTION_TYPES.EXPENSE && tx.accountId === accountId) return true;
      if (tx.type === TRANSACTION_TYPES.SAVING_SPEND && tx.accountId === accountId) return true;
      if (tx.type === TRANSACTION_TYPES.DEBT_CREATE_OWED && tx.accountId === accountId) return true;
      if (tx.type === TRANSACTION_TYPES.DEBT_CREATE_WE_OWE && tx.accountId === accountId) return true;
      if (tx.type === TRANSACTION_TYPES.DEBT_REPAY_OWED && tx.accountId === accountId) return true;
      if (tx.type === TRANSACTION_TYPES.DEBT_REPAY_WE_OWE && tx.accountId === accountId) return true;
      return false;
    })
    .slice(0, limit);
}

export function getCategoryTransactions(state, categoryId, limit = 3) {
  return getAllTransactions(state)
    .filter((tx) => {
      if (tx.status !== TRANSACTION_STATUS.ACTIVE) return false;
      if (tx.categoryId !== categoryId) return false;
      return tx.type === TRANSACTION_TYPES.RESERVE
        || tx.type === TRANSACTION_TYPES.CATEGORY_UNRESERVE
        || tx.type === TRANSACTION_TYPES.EXPENSE;
    })
    .slice(0, limit);
}

function addTransaction(state, data) {
  ensureTransactions(state);
  const record = {
    id: data.id || createId('tx'),
    groupId: data.groupId || createGroupId(),
    type: data.type,
    status: TRANSACTION_STATUS.ACTIVE,
    amount: Number(data.amount),
    date: data.date || todayIso(),
    createdAt: new Date().toISOString(),
    author: normalizeAuthor(data.author, state),
    comment: String(data.comment ?? '').trim(),
    accountId: data.accountId,
    sourceAccountId: data.sourceAccountId,
    destAccountId: data.destAccountId,
    categoryId: data.categoryId,
    currency: data.currency || 'RUB',
    sourceAmount: data.sourceAmount,
    sourceCurrency: data.sourceCurrency,
    destAmount: data.destAmount,
    destCurrency: data.destCurrency,
    exchangeRate: data.exchangeRate,
    accountDebitAmount: data.accountDebitAmount,
    accountCurrency: data.accountCurrency,
    accountName: data.accountName,
    accountOwner: data.accountOwner,
    oldName: data.oldName,
    newName: data.newName,
    oldBalance: data.oldBalance,
    newBalance: data.newBalance,
    oldCurrency: data.oldCurrency,
    newCurrency: data.newCurrency,
    savingId: data.savingId,
    savingName: data.savingName,
    targetAmount: data.targetAmount,
    deadlineType: data.deadlineType,
    deadlineDate: data.deadlineDate,
    oldTargetAmount: data.oldTargetAmount,
    newTargetAmount: data.newTargetAmount,
    oldDeadlineType: data.oldDeadlineType,
    newDeadlineType: data.newDeadlineType,
    oldDeadlineDate: data.oldDeadlineDate,
    newDeadlineDate: data.newDeadlineDate,
    savingType: data.savingType,
    savingSnapshot: data.savingSnapshot,
    debtId: data.debtId,
    debtTitle: data.debtTitle,
    debtType: data.debtType,
    debtPaidBefore: data.debtPaidBefore,
    debtRemainingBefore: data.debtRemainingBefore,
    debtStatusBefore: data.debtStatusBefore,
    debtSnapshot: data.debtSnapshot,
    categoryName: data.categoryName,
    categorySnapshot: data.categorySnapshot,
    service: data.service === true,
    linkedTransactionId: data.linkedTransactionId,
    linkedDeleteTransactionId: data.linkedDeleteTransactionId,
    obligationId: data.obligationId,
    obligationName: data.obligationName,
    obligationReserveBefore: data.obligationReserveBefore,
    obligationPaidUntilBefore: data.obligationPaidUntilBefore,
    obligationStatusBefore: data.obligationStatusBefore
  };
  state.transactions.unshift(record);
  return record;
}

export function recordAccountDeposit(state, accountId, amount, comment, date, author) {
  const blocked = guardFinanceEntry('depositAccount');
  if (blocked) return blocked;

  const account = findAccount(state, accountId);
  if (!account) return { ok: false, error: 'Счет не найден' };

  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: 'Сумма пополнения должна быть больше 0' };
  }

  account.balance = (account.balance ?? 0) + value;
  const currency = account.currency ?? 'RUB';

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.ACCOUNT_DEPOSIT,
    amount: value,
    accountId,
    currency,
    comment,
    date,
    author
  });

  enforceFinancialInvariants(state, { operation: 'recordAccountDeposit', accountId });

  return { ok: true, transaction: tx };
}

export function recordAccountTransfer(state, params) {
  const blocked = guardFinanceEntry('transferAccount');
  if (blocked) return blocked;

  const {
    sourceAccountId,
    destAccountId,
    sourceAmount,
    creditAmount,
    sourceCurrency,
    destCurrency,
    exchangeRate,
    comment,
    date,
    author
  } = params;

  const sourceAccount = findAccount(state, sourceAccountId);
  const destAccount = findAccount(state, destAccountId);

  if (!sourceAccount || !destAccount) {
    return { ok: false, error: 'Счет не найден' };
  }

  const sourceBalance = sourceAccount.balance ?? 0;
  const destBalance = destAccount.balance ?? 0;
  if (sourceAmount > sourceBalance) {
    return { ok: false, error: 'Недостаточно средств на счете списания.' };
  }

  sourceAccount.balance = sourceBalance - sourceAmount;
  destAccount.balance = destBalance + creditAmount;

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.ACCOUNT_TRANSFER,
    amount: sourceAmount,
    accountId: sourceAccountId,
    sourceAccountId,
    destAccountId,
    currency: sourceCurrency,
    sourceAmount,
    sourceCurrency,
    destAmount: creditAmount,
    destCurrency,
    exchangeRate,
    comment,
    date,
    author
  });

  try {
    enforceFinancialInvariants(state, { operation: 'recordAccountTransfer' });
  } catch (e) {
    sourceAccount.balance = sourceBalance;
    destAccount.balance = destBalance;
    state.transactions = (state.transactions ?? []).filter((item) => item.id !== tx.id);
    throw e;
  }

  return { ok: true, transaction: tx };
}

export function recordReserve(state, categoryId, amount, comment, date, author) {
  const blocked = guardFinanceEntry('reserveCategory');
  if (blocked) return blocked;

  const category = findCategory(state, categoryId);
  if (!category) return { ok: false, error: 'Категория не найдена' };

  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: 'Сумма резервирования должна быть больше 0' };
  }

  const freeBalance = calculateFreeBalance(state);
  if (value > freeBalance) {
    return { ok: false, error: 'Недостаточно свободных средств.' };
  }

  const previousReserved = category.reserved ?? 0;
  category.reserved = previousReserved + value;

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.RESERVE,
    amount: value,
    categoryId,
    currency: 'RUB',
    comment: comment || `Резерв: ${category.name}`,
    date,
    author
  });

  try {
    enforceFinancialInvariants(state, { operation: 'recordReserve', categoryId });
  } catch (e) {
    category.reserved = previousReserved;
    state.transactions = (state.transactions ?? []).filter((item) => item.id !== tx.id);
    throw e;
  }

  return { ok: true, transaction: tx };
}

export function recordCategoryUnreserve(state, categoryId, amount, comment, date, author) {
  const blocked = guardFinanceEntry('unreserveCategory');
  if (blocked) return blocked;

  const category = findCategory(state, categoryId);
  if (!category) return { ok: false, error: 'Категория не найдена' };

  if (isMiscCategory(category)) {
    return { ok: false, error: 'Для системной категории возврат резерва недоступен' };
  }

  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: 'Сумма возврата должна быть больше 0' };
  }

  const reserved = category.reserved ?? 0;
  const available = Math.max(0, reserved);

  if (value > available) {
    return { ok: false, error: `Доступно к возврату: ${formatMoney(available)}` };
  }

  category.reserved = reserved - value;

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.CATEGORY_UNRESERVE,
    amount: value,
    categoryId,
    categoryName: category.name,
    currency: 'RUB',
    comment: comment || `Возврат резерва: ${category.name}`,
    date,
    author
  });

  enforceFinancialInvariants(state, { operation: 'recordCategoryUnreserve', categoryId });

  return { ok: true, transaction: tx };
}

export function recordObligationReserve(state, obligationId, amount, comment, date, author) {
  const blocked = guardFinanceEntry('reserveObligation');
  if (blocked) return blocked;

  const obligation = findObligation(state, obligationId);
  if (!obligation) return { ok: false, error: 'Обязательство не найдено' };

  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: 'Сумма резервирования должна быть больше 0' };
  }

  const freeBalance = calculateFreeBalance(state);
  if (value > freeBalance) {
    return { ok: false, error: 'Недостаточно свободных средств.' };
  }

  const previousReserved = obligation.reserveAmount ?? 0;
  obligation.reserveAmount = previousReserved + value;

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.OBLIGATION_RESERVE,
    amount: value,
    obligationId: obligation.id,
    obligationName: obligation.name,
    currency: 'RUB',
    comment: comment || `Резерв: ${obligation.name}`,
    date,
    author
  });

  try {
    enforceFinancialInvariants(state, { operation: 'recordObligationReserve', obligationId });
  } catch (e) {
    obligation.reserveAmount = previousReserved;
    state.transactions = (state.transactions ?? []).filter((item) => item.id !== tx.id);
    throw e;
  }

  return { ok: true, transaction: tx };
}

export function recordObligationUnreserve(state, obligationId, amount, comment, date, author) {
  const blocked = guardFinanceEntry('unreserveObligation');
  if (blocked) return blocked;

  const obligation = findObligation(state, obligationId);
  if (!obligation) return { ok: false, error: 'Обязательство не найдено' };

  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: 'Сумма возврата должна быть больше 0' };
  }

  const reserveAmount = obligation.reserveAmount ?? 0;
  if (value > reserveAmount) {
    return { ok: false, error: `Доступно к возврату: ${formatMoney(reserveAmount)}` };
  }

  obligation.reserveAmount = reserveAmount - value;

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.OBLIGATION_UNRESERVE,
    amount: value,
    obligationId: obligation.id,
    obligationName: obligation.name,
    currency: 'RUB',
    comment: comment || `Возврат резерва: ${obligation.name}`,
    date,
    author
  });

  enforceFinancialInvariants(state, { operation: 'recordObligationUnreserve', obligationId });

  return { ok: true, transaction: tx };
}

export function recordExpense(state, categoryId, amount, accountId, comment, date, author) {
  const blocked = guardFinanceEntry('createExpense');
  if (blocked) return blocked;

  const category = findCategory(state, categoryId);
  if (!category) return { ok: false, error: 'Категория не найдена' };

  const account = findAccount(state, accountId);
  if (!account) return { ok: false, error: 'Выберите счет' };

  const rubAmount = Number(amount);
  if (!Number.isFinite(rubAmount) || rubAmount <= 0) {
    return { ok: false, error: 'Сумма расхода должна быть больше 0' };
  }

  const gateBlock = rejectGateDecision(
    runFinanceGate('createExpense', rubAmount, state, { categoryId, accountId })
  );
  if (gateBlock) return gateBlock;

  const reserved = category.reserved ?? 0;
  const accountCurrency = account.currency ?? 'RUB';
  const exchangeRate = getExchangeRate(state);
  const accountDebitAmount = accountCurrency === 'USD'
    ? roundMoney(rubAmount / exchangeRate, 'USD')
    : roundMoney(rubAmount, 'RUB');
  const accountBalance = account.balance ?? 0;

  if (rubAmount > reserved) {
    return { ok: false, error: 'Недостаточно средств в резерве категории. Сначала зарезервируйте деньги.' };
  }

  if (accountDebitAmount > accountBalance) {
    return { ok: false, error: 'Недостаточно средств на выбранном счете.' };
  }

  category.reserved = reserved - rubAmount;
  category.spent = (category.spent ?? 0) + rubAmount;
  account.balance = accountBalance - accountDebitAmount;

  const expenseComment = accountCurrency === 'USD'
    ? `${comment ? `${String(comment).trim()} · ` : ''}Списано ${formatMoney(accountDebitAmount, 'USD')} (${formatMoney(rubAmount, 'RUB')})`
    : comment;

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.EXPENSE,
    amount: rubAmount,
    categoryId,
    accountId,
    currency: 'RUB',
    accountDebitAmount,
    accountCurrency,
    exchangeRate: accountCurrency === 'USD' ? exchangeRate : undefined,
    comment: expenseComment,
    date,
    author
  });

  enforceFinancialInvariants(state, { operation: 'recordExpense', categoryId });

  return { ok: true, transaction: tx };
}

// LEGACY_SAFE: see LEGACY_SAFE_OPERATIONS.ensureObligationPaymentReserve
function ensureObligationPaymentReserve(state, obligation, rubAmount) {
  const current = obligation.reserveAmount ?? 0;
  if (rubAmount <= current) {
    return { ok: true };
  }

  const needed = rubAmount - current;
  const freeBalance = calculateFreeBalance(state);
  if (needed > freeBalance) {
    return { ok: false, error: 'Недостаточно свободных средств для оплаты обязательства.' };
  }

  obligation.reserveAmount = current + needed;

  try {
    enforceFinancialInvariants(state, {
      operation: 'ensureObligationPaymentReserve',
      obligationId: obligation.id
    });
  } catch (e) {
    obligation.reserveAmount = current;
    return { ok: false, error: e.message };
  }

  return { ok: true };
}

export function recordObligationPayment(state, obligationId, amount, accountId, paidUntil, comment, date, author) {
  const blocked = guardFinanceEntry('payObligation');
  if (blocked) return blocked;

  const obligation = findObligation(state, obligationId);
  if (!obligation) return { ok: false, error: 'Обязательство не найдено' };

  const account = findAccount(state, accountId);
  if (!account) return { ok: false, error: 'Выберите счет' };

  const rubAmount = Number(amount);
  if (!Number.isFinite(rubAmount) || rubAmount <= 0) {
    return { ok: false, error: 'Сумма оплаты должна быть больше 0' };
  }

  if (!paidUntil) {
    return { ok: false, error: 'Укажите дату «Оплачено до»' };
  }

  const gateBlock = rejectGateDecision(
    runFinanceGate('payObligation', rubAmount, state, { obligationId, accountId })
  );
  if (gateBlock) return gateBlock;

  const reserveAmount = obligation.reserveAmount ?? 0;
  if (rubAmount > reserveAmount) {
    return {
      ok: false,
      error: 'Недостаточно средств в резерве обязательства. Сначала зарезервируйте деньги.'
    };
  }

  const accountCurrency = account.currency ?? 'RUB';
  const exchangeRate = getExchangeRate(state);
  const accountDebitAmount = accountCurrency === 'USD'
    ? roundMoney(rubAmount / exchangeRate, 'USD')
    : roundMoney(rubAmount, 'RUB');
  const accountBalance = account.balance ?? 0;

  if (accountDebitAmount > accountBalance) {
    return { ok: false, error: 'Недостаточно средств на выбранном счете.' };
  }

  const obligationReserveBefore = reserveAmount;
  const obligationPaidUntilBefore = computePaidUntilFromPayments(obligation);
  const obligationStatusBefore = obligation.status
    ?? (obligationPaidUntilBefore >= todayIso() ? 'active' : 'overdue');

  obligation.reserveAmount = reserveAmount - rubAmount;
  account.balance = accountBalance - accountDebitAmount;

  const paymentComment = comment
    || `Оплата: ${obligation.name}${accountCurrency === 'USD' ? ` (${formatMoney(accountDebitAmount, 'USD')})` : ''}`;

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.EXPENSE,
    amount: rubAmount,
    accountId,
    obligationId: obligation.id,
    obligationName: obligation.name,
    obligationReserveBefore,
    obligationPaidUntilBefore,
    obligationStatusBefore,
    currency: 'RUB',
    accountDebitAmount,
    accountCurrency,
    exchangeRate: accountCurrency === 'USD' ? exchangeRate : undefined,
    comment: paymentComment,
    date,
    author
  });

  if (!Array.isArray(obligation.payments)) {
    obligation.payments = [];
  }

  obligation.payments.push({
    id: createId('payment'),
    paidAt: tx.date || date || todayIso(),
    paidUntil,
    amount: rubAmount,
    accountId,
    transactionId: tx.id
  });

  syncObligationStatusFromPayments(obligation, todayIso());

  enforceFinancialInvariants(state, {
    operation: 'recordObligationPayment',
    obligationId
  });

  return { ok: true, transaction: tx, obligation };
}

export function recordAccountCreated(state, account, initialBalance, author) {
  const blocked = guardFinanceEntry('createAccount');
  if (blocked) return blocked;

  const currency = account.currency ?? 'RUB';
  const owner = AUTHOR_LABELS[account.owner ?? 'husband'] ?? account.owner;
  const balance = Number(initialBalance) || 0;

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.ACCOUNT_CREATED,
    amount: balance,
    accountId: account.id,
    currency,
    accountName: account.name,
    accountOwner: account.owner,
    comment: `Создан счёт «${account.name}» (${owner}, ${currency})${balance > 0 ? `, начальный баланс ${formatMoney(balance, currency)}` : ''}`,
    author
  });

  enforceFinancialInvariants(state, { operation: 'recordAccountCreated', accountId: account.id });

  return { ok: true, transaction: tx };
}

export function recordAccountUpdated(state, accountId, changes, author) {
  const blocked = guardFinanceEntry('updateAccount');
  if (blocked) return blocked;

  const account = findAccount(state, accountId);
  if (!account) return { ok: false, error: 'Счет не найден' };

  const parts = [];
  if (changes.oldName !== changes.newName) {
    parts.push(`название: «${changes.oldName}» → «${changes.newName}»`);
  }
  if (changes.oldBalance !== changes.newBalance) {
    const currency = changes.newCurrency ?? changes.oldCurrency ?? 'RUB';
    parts.push(`баланс: ${formatMoney(changes.oldBalance, currency)} → ${formatMoney(changes.newBalance, currency)}`);
  }
  if (changes.oldCurrency !== changes.newCurrency) {
    parts.push(`валюта: ${changes.oldCurrency} → ${changes.newCurrency}`);
  }

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.ACCOUNT_UPDATED,
    amount: 0,
    accountId,
    currency: account.currency ?? 'RUB',
    accountName: account.name,
    oldName: changes.oldName,
    newName: changes.newName,
    oldBalance: changes.oldBalance,
    newBalance: changes.newBalance,
    oldCurrency: changes.oldCurrency,
    newCurrency: changes.newCurrency,
    comment: parts.length ? parts.join('; ') : `Изменён счёт «${account.name}»`,
    author
  });

  enforceFinancialInvariants(state, { operation: 'recordAccountUpdated', accountId });

  return { ok: true, transaction: tx };
}

export function recordAccountDeleted(state, account, author) {
  const blocked = guardFinanceEntry('deleteAccount');
  if (blocked) return blocked;

  const currency = account.currency ?? 'RUB';
  const owner = AUTHOR_LABELS[account.owner ?? 'husband'] ?? account.owner;
  const balance = account.balance ?? 0;

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.ACCOUNT_DELETED,
    amount: balance,
    accountId: account.id,
    currency,
    accountName: account.name,
    accountOwner: account.owner,
    comment: `Удалён счёт «${account.name}» (${owner}) — ${formatMoney(balance, currency)}`,
    author
  });

  enforceFinancialInvariants(state, { operation: 'recordAccountDeleted', accountId: account.id });

  return { ok: true, transaction: tx };
}

function ensureMiscCategory(state) {
  if (!Array.isArray(state.categories)) {
    state.categories = [];
  }

  let category = state.categories.find((item) => isMiscCategory(item));
  if (!category) {
    category = state.categories.find((item) => item.name === MISC_CATEGORY_NAME);
  }
  if (!category) {
    category = {
      id: createId('category'),
      name: MISC_CATEGORY_NAME,
      isSystem: true,
      limit: 0,
      reserved: 0,
      spent: 0,
      createdAt: new Date().toISOString()
    };
    state.categories.push(category);
  } else {
    category.name = MISC_CATEGORY_NAME;
    category.isSystem = true;
  }

  return category;
}

export { ensureMiscCategory };

export function recordCategoryDeleted(state, category, author) {
  const blocked = guardFinanceEntry('deleteCategory');
  if (blocked) return blocked;

  if (isMiscCategory(category)) {
    return { ok: false, error: 'Системную категорию нельзя удалить' };
  }

  const snapshot = {
    id: category.id,
    name: category.name,
    limit: category.limit ?? 0,
    reserved: category.reserved ?? 0,
    spent: category.spent ?? 0,
    createdAt: category.createdAt ?? new Date().toISOString()
  };

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.CATEGORY_DELETED,
    amount: snapshot.reserved,
    categoryId: category.id,
    categoryName: category.name,
    categorySnapshot: snapshot,
    currency: 'RUB',
    comment: `Удалена категория «${category.name}»`,
    author
  });

  enforceFinancialInvariants(state, { operation: 'recordCategoryDeleted', categoryId: category.id });

  return { ok: true, transaction: tx };
}

function cancelLinkedServiceDelete(state, spendTx) {
  if (spendTx.linkedDeleteTransactionId) {
    const deleteTx = findTransaction(state, spendTx.linkedDeleteTransactionId);
    if (deleteTx && deleteTx.status === TRANSACTION_STATUS.ACTIVE) {
      deleteTx.status = TRANSACTION_STATUS.CANCELLED;
      deleteTx.cancelledAt = new Date().toISOString();
      return;
    }
  }

  const legacyDelete = (state.transactions ?? []).find((item) =>
    item.type === TRANSACTION_TYPES.SAVING_DELETE
    && item.status === TRANSACTION_STATUS.ACTIVE
    && item.savingId === spendTx.savingId
    && (item.service === true || /после траты/i.test(item.comment ?? ''))
  );

  if (legacyDelete) {
    legacyDelete.status = TRANSACTION_STATUS.CANCELLED;
    legacyDelete.cancelledAt = new Date().toISOString();
  }
}

// LEGACY_SAFE: see LEGACY_SAFE_OPERATIONS.reconcileLegacyTransactions
export function reconcileLegacyTransactions(state) {
  ensureTransactions(state);
  ensureMiscCategory(state);

  (state.categories ?? []).forEach((category) => {
    if (category.name === MISC_CATEGORY_NAME) {
      category.isSystem = true;
    }
  });

  for (const tx of state.transactions ?? []) {
    if (tx.type !== TRANSACTION_TYPES.SAVING_SPEND || tx.savingType !== 'single_use') {
      continue;
    }

    const deleteTx = (state.transactions ?? []).find((item) =>
      item.type === TRANSACTION_TYPES.SAVING_DELETE
      && item.savingId === tx.savingId
      && item.status === TRANSACTION_STATUS.ACTIVE
      && (
        item.linkedTransactionId === tx.id
        || /после траты/i.test(item.comment ?? '')
      )
    );

    if (!deleteTx) continue;

    deleteTx.service = true;
    deleteTx.linkedTransactionId = tx.id;
    tx.linkedDeleteTransactionId = deleteTx.id;

    if (!tx.groupId || !deleteTx.groupId || tx.groupId !== deleteTx.groupId) {
      const groupId = tx.groupId || deleteTx.groupId || createGroupId();
      tx.groupId = groupId;
      deleteTx.groupId = groupId;
    }
  }
}

function validateSavingDeposit(state, saving, amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: 'Сумма пополнения должна быть больше 0' };
  }

  const accumulated = getSavingAccumulated(saving);
  const targetAmount = saving.targetAmount;

  if (targetAmount != null && targetAmount > 0 && accumulated >= targetAmount) {
    return { ok: false, error: 'Цель достигнута. Измените целевую сумму, чтобы пополнить копилку.' };
  }

  if (targetAmount != null && targetAmount > 0 && accumulated + value > targetAmount) {
    return { ok: false, error: `Нельзя превысить цель ${formatMoney(targetAmount, 'RUB')}. Осталось ${formatMoney(targetAmount - accumulated, 'RUB')}.` };
  }

  const freeBalance = calculateFreeBalance(state);
  if (value > freeBalance) {
    return { ok: false, error: 'Недостаточно свободных средств.' };
  }

  return { ok: true, value };
}

export function recordSavingCreate(state, saving, author) {
  const blocked = guardFinanceEntry('manageSaving');
  if (blocked) return blocked;

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.SAVING_CREATE,
    amount: 0,
    savingId: saving.id,
    savingName: saving.name,
    targetAmount: saving.targetAmount,
    deadlineType: saving.deadlineType,
    deadlineDate: saving.deadlineDate,
    currency: 'RUB',
    comment: `Создана копилка «${saving.name}»`,
    author
  });

  enforceFinancialInvariants(state, { operation: 'recordSavingCreate', savingId: saving.id });

  return { ok: true, transaction: tx };
}

export function recordSavingDeposit(state, savingId, amount, comment, date, author) {
  const blocked = guardFinanceEntry('updateSavings');
  if (blocked) return blocked;

  const saving = findSaving(state, savingId);
  if (!saving) return { ok: false, error: 'Копилка не найдена' };

  const validation = validateSavingDeposit(state, saving, amount);
  if (!validation.ok) return validation;

  const gateBlock = rejectGateDecision(
    runFinanceGate('updateSavings', validation.value, state, { action: 'deposit', savingId })
  );
  if (gateBlock) return gateBlock;

  saving.accumulated = getSavingAccumulated(saving) + validation.value;

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.SAVING_DEPOSIT,
    amount: validation.value,
    savingId,
    savingName: saving.name,
    currency: 'RUB',
    comment: comment || `Пополнение: ${saving.name}`,
    date,
    author
  });

  enforceFinancialInvariants(state, { operation: 'recordSavingDeposit', savingId });

  return { ok: true, transaction: tx };
}

export function recordSavingWithdraw(state, savingId, amount, comment, date, author) {
  const blocked = guardFinanceEntry('updateSavings');
  if (blocked) return blocked;

  const saving = findSaving(state, savingId);
  if (!saving) return { ok: false, error: 'Копилка не найдена' };

  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: 'Сумма возврата должна быть больше 0' };
  }

  const accumulated = getSavingAccumulated(saving);
  if (value > accumulated) {
    return { ok: false, error: 'Нельзя вернуть больше, чем накоплено' };
  }

  const gateBlock = rejectGateDecision(
    runFinanceGate('updateSavings', value, state, { action: 'withdraw', savingId })
  );
  if (gateBlock) return gateBlock;

  saving.accumulated = accumulated - value;

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.SAVING_WITHDRAW,
    amount: value,
    savingId,
    savingName: saving.name,
    currency: 'RUB',
    comment: comment || `Возврат: ${saving.name}`,
    date,
    author
  });

  enforceFinancialInvariants(state, { operation: 'recordSavingWithdraw', savingId });

  return { ok: true, transaction: tx };
}

export function recordSavingUpdate(state, savingId, changes, author) {
  const blocked = guardFinanceEntry('manageSaving');
  if (blocked) return blocked;

  const saving = findSaving(state, savingId);
  if (!saving) return { ok: false, error: 'Копилка не найдена' };

  const parts = [];
  if (changes.oldName !== changes.newName) {
    parts.push(`название: «${changes.oldName}» → «${changes.newName}»`);
  }
  if (changes.oldTargetAmount !== changes.newTargetAmount) {
    const fmt = (v) => (v == null || v === '' ? 'без цели' : formatMoney(Number(v), 'RUB'));
    parts.push(`цель: ${fmt(changes.oldTargetAmount)} → ${fmt(changes.newTargetAmount)}`);
  }
  if (changes.oldDeadlineType !== changes.newDeadlineType || changes.oldDeadlineDate !== changes.newDeadlineDate) {
    parts.push(`срок: ${changes.oldDeadlineLabel} → ${changes.newDeadlineLabel}`);
  }

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.SAVING_UPDATE,
    amount: 0,
    savingId,
    savingName: saving.name,
    oldName: changes.oldName,
    newName: changes.newName,
    oldTargetAmount: changes.oldTargetAmount,
    newTargetAmount: changes.newTargetAmount,
    oldDeadlineType: changes.oldDeadlineType,
    newDeadlineType: changes.newDeadlineType,
    oldDeadlineDate: changes.oldDeadlineDate,
    newDeadlineDate: changes.newDeadlineDate,
    currency: 'RUB',
    comment: parts.length ? parts.join('; ') : `Изменена копилка «${saving.name}»`,
    author
  });

  enforceFinancialInvariants(state, { operation: 'recordSavingUpdate', savingId });

  return { ok: true, transaction: tx };
}

// LEGACY_SAFE when options.service === true: see LEGACY_SAFE_OPERATIONS.recordSavingDelete_service
export function recordSavingDelete(state, saving, author, customComment, options = {}) {
  const blocked = guardFinanceEntry('manageSaving');
  if (blocked) return blocked;

  const accumulated = options.amount ?? getSavingAccumulated(saving);

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.SAVING_DELETE,
    amount: accumulated,
    savingId: saving.id,
    savingName: saving.name,
    savingType: saving.savingType,
    currency: 'RUB',
    comment: customComment || (accumulated > 0
      ? `Удалена копилка «${saving.name}», возвращено ${formatMoney(accumulated, 'RUB')}`
      : `Удалена копилка «${saving.name}»`),
    author,
    service: options.service === true,
    linkedTransactionId: options.linkedTransactionId,
    groupId: options.groupId
  });

  enforceFinancialInvariants(state, { operation: 'recordSavingDelete', savingId: saving.id });

  return { ok: true, transaction: tx };
}

export function recordSavingSpend(state, savingId, accountId, comment, date, author) {
  const blocked = guardFinanceEntry('spendSaving');
  if (blocked) return blocked;

  const saving = findSaving(state, savingId);
  if (!saving) return { ok: false, error: 'Копилка не найдена' };

  const rubAmount = getSavingAccumulated(saving);
  if (rubAmount <= 0) {
    return { ok: false, error: 'В копилке нет накоплений' };
  }

  const targetAmount = saving.targetAmount;
  if (targetAmount != null && targetAmount > 0 && rubAmount < targetAmount) {
    return { ok: false, error: 'Цель ещё не достигнута' };
  }

  const account = findAccount(state, accountId);
  if (!account) return { ok: false, error: 'Выберите счет' };

  const accountCurrency = account.currency ?? 'RUB';
  const exchangeRate = getExchangeRate(state);
  const accountDebitAmount = accountCurrency === 'USD'
    ? roundMoney(rubAmount / exchangeRate, 'USD')
    : roundMoney(rubAmount, 'RUB');
  const accountBalance = account.balance ?? 0;

  if (accountDebitAmount > accountBalance) {
    return { ok: false, error: 'Недостаточно средств на выбранном счете.' };
  }

  const gateBlock = rejectGateDecision(
    runFinanceGate('spendSaving', rubAmount, state, { savingId, accountId, action: 'spend' })
  );
  if (gateBlock) return gateBlock;

  const category = ensureMiscCategory(state);
  const savingType = saving.savingType ?? 'recurring';
  const savingSnapshot = {
    id: saving.id,
    name: saving.name,
    accumulated: rubAmount,
    targetAmount: saving.targetAmount ?? null,
    deadlineType: saving.deadlineType ?? 'none',
    deadlineDate: saving.deadlineDate ?? null,
    savingType,
    createdAt: saving.createdAt
  };

  saving.accumulated = 0;
  account.balance = accountBalance - accountDebitAmount;
  category.spent = (category.spent ?? 0) + rubAmount;

  const spendComment = comment
    || `Трата из копилки «${saving.name}»${accountCurrency === 'USD' ? ` (${formatMoney(accountDebitAmount, 'USD')})` : ''}`;

  const groupId = createGroupId();

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.SAVING_SPEND,
    amount: rubAmount,
    savingId,
    savingName: saving.name,
    savingType,
    savingSnapshot,
    accountId,
    categoryId: category.id,
    currency: 'RUB',
    accountDebitAmount,
    accountCurrency,
    exchangeRate: accountCurrency === 'USD' ? exchangeRate : undefined,
    comment: spendComment,
    date,
    author,
    groupId
  });

  if (savingType === 'single_use') {
    const deleteResult = withInternalFinanceContext(() =>
      recordSavingDelete(
        state,
        saving,
        author,
        `Удалена разовая копилка «${saving.name}» после траты`,
        { service: true, linkedTransactionId: tx.id, amount: rubAmount, groupId }
      )
    );
    tx.linkedDeleteTransactionId = deleteResult.transaction.id;
    state.savings = (state.savings ?? []).filter((item) => item.id !== savingId);
  }

  enforceFinancialInvariants(state, {
    operation: 'recordSavingSpend',
    savingId
  });

  return { ok: true, transaction: tx };
}

function reverseSavingDeposit(state, tx) {
  const saving = findSaving(state, tx.savingId);
  if (!saving) return { ok: false, error: 'Копилка не найдена' };

  const accumulated = getSavingAccumulated(saving);
  if (accumulated < tx.amount) {
    return { ok: false, error: 'Недостаточно накоплений для отмены' };
  }

  saving.accumulated = accumulated - tx.amount;
  return { ok: true };
}

function reverseSavingWithdraw(state, tx) {
  const saving = findSaving(state, tx.savingId);
  if (!saving) return { ok: false, error: 'Копилка не найдена' };

  saving.accumulated = getSavingAccumulated(saving) + tx.amount;
  return { ok: true };
}

function reverseSavingSpend(state, tx) {
  const account = findAccount(state, tx.accountId);
  const category = tx.categoryId ? findCategory(state, tx.categoryId) : null;

  if (!account) {
    return { ok: false, error: 'Счет не найден' };
  }

  const accountDebitAmount = tx.accountDebitAmount ?? tx.amount;
  account.balance = (account.balance ?? 0) + accountDebitAmount;

  if (category) {
    category.spent = Math.max(0, (category.spent ?? 0) - tx.amount);
  }

  let saving = findSaving(state, tx.savingId);

  if (tx.savingType === 'single_use' && tx.savingSnapshot) {
    if (!saving) {
      if (!Array.isArray(state.savings)) {
        state.savings = [];
      }
      saving = {
        ...tx.savingSnapshot,
        accumulated: tx.amount
      };
      state.savings.push(saving);
    } else {
      saving.accumulated = tx.amount;
    }
    cancelLinkedServiceDelete(state, tx);
    return { ok: true };
  }

  if (!saving) {
    return { ok: false, error: 'Копилка не найдена' };
  }

  saving.accumulated = tx.amount;
  return { ok: true };
}

export function recordDebtCreateOwedToUs(state, params) {
  const blocked = guardFinanceEntry('manageDebt');
  if (blocked) return blocked;

  const { title, amount, accountId, comment, date, author } = params;
  const rubAmount = Number(amount);

  if (!title || !String(title).trim()) {
    return { ok: false, error: 'Введите название долга' };
  }
  if (!Number.isFinite(rubAmount) || rubAmount <= 0) {
    return { ok: false, error: 'Сумма долга должна быть больше 0' };
  }

  const account = findAccount(state, accountId);
  if (!account) return { ok: false, error: 'Выберите счет' };

  const freeBalance = calculateFreeBalance(state);
  if (rubAmount > freeBalance) {
    return { ok: false, error: 'Недостаточно свободных денег' };
  }

  const accountDebitAmount = rubToAccountAmount(rubAmount, account, state);
  const accountBalance = account.balance ?? 0;
  if (accountDebitAmount > accountBalance) {
    return { ok: false, error: 'Недостаточно денег на счете' };
  }

  account.balance = accountBalance - accountDebitAmount;

  ensureDebts(state);
  const debt = {
    id: createId('debt'),
    type: 'owed_to_us',
    title: String(title).trim(),
    amount: rubAmount,
    paidAmount: 0,
    remainingAmount: rubAmount,
    comment: String(comment ?? '').trim(),
    accountId,
    status: 'active',
    createdAt: new Date().toISOString()
  };
  state.debts.push(debt);

  const accountCurrency = account.currency ?? 'RUB';
  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.DEBT_CREATE_OWED,
    amount: rubAmount,
    accountId,
    debtId: debt.id,
    debtTitle: debt.title,
    debtType: 'owed_to_us',
    currency: 'RUB',
    accountDebitAmount,
    accountCurrency,
    exchangeRate: accountCurrency === 'USD' ? getExchangeRate(state) : undefined,
    comment: comment || debt.title,
    date,
    author,
    debtSnapshot: { ...debt }
  });

  enforceFinancialInvariants(state, { operation: 'recordDebtCreateOwedToUs', debtId: debt.id });

  return { ok: true, transaction: tx, debt };
}

export function recordDebtCreateWeOwe(state, params) {
  const blocked = guardFinanceEntry('manageDebt');
  if (blocked) return blocked;

  const { title, amount, accountId, comment, date, author } = params;
  const rubAmount = Number(amount);

  if (!title || !String(title).trim()) {
    return { ok: false, error: 'Введите название долга' };
  }
  if (!Number.isFinite(rubAmount) || rubAmount <= 0) {
    return { ok: false, error: 'Сумма долга должна быть больше 0' };
  }

  const account = findAccount(state, accountId);
  if (!account) return { ok: false, error: 'Выберите счет' };

  const accountCreditAmount = rubToAccountAmount(rubAmount, account, state);
  account.balance = (account.balance ?? 0) + accountCreditAmount;

  ensureDebts(state);
  const debt = {
    id: createId('debt'),
    type: 'we_owe',
    title: String(title).trim(),
    amount: rubAmount,
    paidAmount: 0,
    remainingAmount: rubAmount,
    comment: String(comment ?? '').trim(),
    accountId,
    status: 'active',
    createdAt: new Date().toISOString()
  };
  state.debts.push(debt);

  const accountCurrency = account.currency ?? 'RUB';
  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.DEBT_CREATE_WE_OWE,
    amount: rubAmount,
    accountId,
    debtId: debt.id,
    debtTitle: debt.title,
    debtType: 'we_owe',
    currency: 'RUB',
    accountDebitAmount: accountCreditAmount,
    accountCurrency,
    exchangeRate: accountCurrency === 'USD' ? getExchangeRate(state) : undefined,
    comment: comment || debt.title,
    date,
    author,
    debtSnapshot: { ...debt }
  });

  enforceFinancialInvariants(state, { operation: 'recordDebtCreateWeOwe', debtId: debt.id });

  return { ok: true, transaction: tx, debt };
}

export function recordDebtRepayment(state, debtId, amount, accountId, comment, date, author) {
  const blocked = guardFinanceEntry('manageDebt');
  if (blocked) return blocked;

  const debt = findDebt(state, debtId);
  if (!debt) return { ok: false, error: 'Долг не найден' };
  if (debt.status === 'closed' || (debt.remainingAmount ?? 0) <= 0) {
    return { ok: false, error: 'Долг уже погашен' };
  }

  const rubAmount = Number(amount);
  if (!Number.isFinite(rubAmount) || rubAmount <= 0) {
    return { ok: false, error: 'Сумма платежа должна быть больше 0' };
  }

  const remaining = debt.remainingAmount ?? 0;
  if (rubAmount > remaining) {
    return { ok: false, error: `Сумма не может превышать остаток ${formatMoney(remaining, 'RUB')}` };
  }

  const account = findAccount(state, accountId);
  if (!account) return { ok: false, error: 'Выберите счет' };

  const accountAmount = rubToAccountAmount(rubAmount, account, state);
  const accountCurrency = account.currency ?? 'RUB';
  const debtPaidBefore = debt.paidAmount ?? 0;
  const debtRemainingBefore = remaining;
  const debtStatusBefore = debt.status ?? 'active';

  if (debt.type === 'owed_to_us') {
    account.balance = (account.balance ?? 0) + accountAmount;

    debt.paidAmount = debtPaidBefore + rubAmount;
    debt.remainingAmount = debtRemainingBefore - rubAmount;
    if (debt.remainingAmount <= 0) {
      debt.remainingAmount = 0;
      debt.status = 'closed';
    }

    const tx = addTransaction(state, {
      type: TRANSACTION_TYPES.DEBT_REPAY_OWED,
      amount: rubAmount,
      accountId,
      debtId: debt.id,
      debtTitle: debt.title,
      debtType: 'owed_to_us',
      currency: 'RUB',
      accountDebitAmount: accountAmount,
      accountCurrency,
      exchangeRate: accountCurrency === 'USD' ? getExchangeRate(state) : undefined,
      comment: comment || debt.title,
      date,
      author,
      debtPaidBefore,
      debtRemainingBefore,
      debtStatusBefore
    });

    enforceFinancialInvariants(state, { operation: 'recordDebtRepayment', debtId });

    return { ok: true, transaction: tx, debt };
  }

  if (debt.type === 'we_owe') {
    const freeBalance = calculateFreeBalance(state);
    if (rubAmount > freeBalance) {
      return { ok: false, error: 'Недостаточно свободных денег. Освободите деньги из категорий или копилок.' };
    }

    const accountBalance = account.balance ?? 0;
    if (accountAmount > accountBalance) {
      return { ok: false, error: 'Недостаточно денег на счете' };
    }

    account.balance = accountBalance - accountAmount;
    debt.paidAmount = debtPaidBefore + rubAmount;
    debt.remainingAmount = debtRemainingBefore - rubAmount;
    if (debt.remainingAmount <= 0) {
      debt.remainingAmount = 0;
      debt.status = 'closed';
    }

    const tx = addTransaction(state, {
      type: TRANSACTION_TYPES.DEBT_REPAY_WE_OWE,
      amount: rubAmount,
      accountId,
      debtId: debt.id,
      debtTitle: debt.title,
      debtType: 'we_owe',
      currency: 'RUB',
      accountDebitAmount: accountAmount,
      accountCurrency,
      exchangeRate: accountCurrency === 'USD' ? getExchangeRate(state) : undefined,
      comment: comment || debt.title,
      date,
      author,
      debtPaidBefore,
      debtRemainingBefore,
      debtStatusBefore
    });

    enforceFinancialInvariants(state, { operation: 'recordDebtRepayment', debtId });

    return { ok: true, transaction: tx, debt };
  }

  return { ok: false, error: 'Неизвестный тип долга' };
}

export function recordDebtWriteOff(state, debtId, comment, date, author) {
  const blocked = guardFinanceEntry('manageDebt');
  if (blocked) return blocked;

  const debt = findDebt(state, debtId);
  if (!debt) return { ok: false, error: 'Долг не найден' };
  if (debt.type !== 'owed_to_us') {
    return { ok: false, error: 'Списание доступно только для долгов «Нам должны»' };
  }
  if (debt.status === 'closed' || (debt.remainingAmount ?? 0) <= 0) {
    return { ok: false, error: 'Долг уже закрыт' };
  }

  const writtenOff = debt.remainingAmount ?? 0;
  const debtRemainingBefore = writtenOff;
  const debtStatusBefore = debt.status ?? 'active';
  const debtPaidBefore = debt.paidAmount ?? 0;

  debt.remainingAmount = 0;
  debt.status = 'closed';

  const tx = addTransaction(state, {
    type: TRANSACTION_TYPES.DEBT_WRITE_OFF,
    amount: writtenOff,
    debtId: debt.id,
    debtTitle: debt.title,
    debtType: 'owed_to_us',
    currency: 'RUB',
    comment: comment || `Списан долг: ${debt.title}`,
    date,
    author,
    debtPaidBefore,
    debtRemainingBefore,
    debtStatusBefore,
    accountId: debt.accountId
  });

  enforceFinancialInvariants(state, { operation: 'recordDebtWriteOff', debtId });

  return { ok: true, transaction: tx, debt };
}

function reverseDebtCreateOwed(state, tx) {
  const account = findAccount(state, tx.accountId);
  if (!account) return { ok: false, error: 'Счет не найден' };

  const accountAmount = tx.accountDebitAmount ?? tx.amount;
  account.balance = (account.balance ?? 0) + accountAmount;

  ensureDebts(state);
  state.debts = state.debts.filter((debt) => debt.id !== tx.debtId);
  return { ok: true };
}

function reverseDebtCreateWeOwe(state, tx) {
  const account = findAccount(state, tx.accountId);
  if (!account) return { ok: false, error: 'Счет не найден' };

  const accountAmount = tx.accountDebitAmount ?? tx.amount;
  const balance = account.balance ?? 0;
  if (balance < accountAmount) {
    return { ok: false, error: 'Недостаточно средств на счете для отмены' };
  }

  account.balance = balance - accountAmount;
  ensureDebts(state);
  state.debts = state.debts.filter((debt) => debt.id !== tx.debtId);
  return { ok: true };
}

function findOrRestoreDebt(state, tx) {
  let debt = findDebt(state, tx.debtId);
  if (!debt && tx.debtSnapshot) {
    ensureDebts(state);
    debt = { ...tx.debtSnapshot };
    state.debts.push(debt);
  }
  return debt;
}

function reverseDebtRepayOwed(state, tx) {
  const account = findAccount(state, tx.accountId);
  if (!account) return { ok: false, error: 'Счет не найден' };

  const accountAmount = tx.accountDebitAmount ?? tx.amount;
  const balance = account.balance ?? 0;
  if (balance < accountAmount) {
    return { ok: false, error: 'Недостаточно средств на счете для отмены' };
  }

  account.balance = balance - accountAmount;

  const debt = findOrRestoreDebt(state, tx);
  if (!debt) return { ok: false, error: 'Долг не найден' };

  debt.paidAmount = tx.debtPaidBefore ?? 0;
  debt.remainingAmount = tx.debtRemainingBefore ?? debt.remainingAmount;
  debt.status = tx.debtStatusBefore ?? 'active';
  return { ok: true };
}

function reverseDebtRepayWeOwe(state, tx) {
  const account = findAccount(state, tx.accountId);
  if (!account) return { ok: false, error: 'Счет не найден' };

  const accountAmount = tx.accountDebitAmount ?? tx.amount;
  account.balance = (account.balance ?? 0) + accountAmount;

  const debt = findOrRestoreDebt(state, tx);
  if (!debt) return { ok: false, error: 'Долг не найден' };

  debt.paidAmount = tx.debtPaidBefore ?? 0;
  debt.remainingAmount = tx.debtRemainingBefore ?? debt.remainingAmount;
  debt.status = tx.debtStatusBefore ?? 'active';
  return { ok: true };
}

function reverseDebtWriteOff(state, tx) {
  const debt = findOrRestoreDebt(state, tx);
  if (!debt) return { ok: false, error: 'Долг не найден' };

  debt.remainingAmount = tx.debtRemainingBefore ?? tx.amount;
  debt.status = tx.debtStatusBefore ?? 'active';
  return { ok: true };
}

function reverseAccountDeposit(state, tx) {  const account = findAccount(state, tx.accountId);
  if (!account) return { ok: false, error: 'Счет не найден' };

  const balance = account.balance ?? 0;
  if (balance < tx.amount) {
    return { ok: false, error: 'Недостаточно средств на счете для отмены пополнения' };
  }

  account.balance = balance - tx.amount;
  return { ok: true };
}

function reverseAccountTransfer(state, tx) {
  const sourceAccount = findAccount(state, tx.sourceAccountId);
  const destAccount = findAccount(state, tx.destAccountId);

  if (!sourceAccount || !destAccount) {
    return { ok: false, error: 'Счет не найден' };
  }

  const destBalance = destAccount.balance ?? 0;
  const destAmount = tx.destAmount ?? tx.amount;

  if (destBalance < destAmount) {
    return { ok: false, error: 'Недостаточно средств на счете-получателе для отмены перевода' };
  }

  sourceAccount.balance = (sourceAccount.balance ?? 0) + (tx.sourceAmount ?? tx.amount);
  destAccount.balance = destBalance - destAmount;
  return { ok: true };
}

function reverseReserve(state, tx) {
  const category = findCategory(state, tx.categoryId);
  if (!category) return { ok: false, error: 'Категория не найдена' };

  const reserved = category.reserved ?? 0;
  if (reserved < tx.amount) {
    return { ok: false, error: 'Недостаточно зарезервированных средств для отмены' };
  }

  category.reserved = reserved - tx.amount;
  return { ok: true };
}

function reverseCategoryUnreserve(state, tx) {
  const category = findCategory(state, tx.categoryId);
  if (!category) return { ok: false, error: 'Категория не найдена' };

  if (calculateFreeBalance(state) < tx.amount) {
    return { ok: false, error: UNRESERVE_INSUFFICIENT_FREE_ERROR };
  }

  category.reserved = (category.reserved ?? 0) + tx.amount;
  return { ok: true };
}

function removeObligationPaymentByTransactionId(obligation, transactionId) {
  if (!Array.isArray(obligation.payments) || !transactionId) {
    return;
  }

  obligation.payments = obligation.payments.filter(
    (payment) => payment.transactionId !== transactionId
  );
}

function assertObligationPaymentLifoCancel(obligation, tx) {
  const payments = Array.isArray(obligation.payments) ? obligation.payments : [];
  const index = payments.findIndex((payment) => payment.transactionId === tx.id);

  if (index !== payments.length - 1) {
    console.warn({
      type: 'LIFO_VIOLATION',
      obligationId: tx.obligationId,
      transactionId: tx.id,
      message: 'Only last payment can be reverted'
    });
    return { ok: false, error: 'Можно отменить только последнюю оплату обязательства' };
  }

  return { ok: true };
}

function reverseObligationReserve(state, tx) {
  const obligation = findObligation(state, tx.obligationId);
  if (!obligation) return { ok: false, error: 'Обязательство не найдено' };

  const reserved = obligation.reserveAmount ?? 0;
  if (reserved < tx.amount) {
    return { ok: false, error: 'Недостаточно зарезервированных средств для отмены' };
  }

  obligation.reserveAmount = reserved - tx.amount;
  return { ok: true };
}

function reverseObligationUnreserve(state, tx) {
  const obligation = findObligation(state, tx.obligationId);
  if (!obligation) return { ok: false, error: 'Обязательство не найдено' };

  if (calculateFreeBalance(state) < tx.amount) {
    return { ok: false, error: UNRESERVE_INSUFFICIENT_FREE_ERROR };
  }

  obligation.reserveAmount = (obligation.reserveAmount ?? 0) + tx.amount;
  return { ok: true };
}

function reverseExpense(state, tx) {
  if (tx.obligationId) {
    const obligation = findObligation(state, tx.obligationId);
    if (!obligation) {
      return { ok: false, error: 'Обязательство не найдено' };
    }

    const lifoCheck = assertObligationPaymentLifoCancel(obligation, tx);
    if (!lifoCheck.ok) {
      return lifoCheck;
    }
  }

  const account = findAccount(state, tx.accountId);
  if (!account) {
    return { ok: false, error: 'Счет не найден' };
  }

  const rubAmount = tx.amount;
  const accountDebitAmount = tx.accountDebitAmount ?? tx.amount;
  account.balance = (account.balance ?? 0) + accountDebitAmount;

  if (tx.obligationId) {
    const obligation = findObligation(state, tx.obligationId);
    if (!obligation) {
      return { ok: false, error: 'Обязательство не найдено' };
    }
    obligation.reserveAmount = tx.obligationReserveBefore != null
      ? tx.obligationReserveBefore
      : (obligation.reserveAmount ?? 0) + rubAmount;

    removeObligationPaymentByTransactionId(obligation, tx.id);
    syncObligationStatusFromPayments(obligation, todayIso());

    return { ok: true };
  }

  const category = findCategory(state, tx.categoryId);
  if (!category) {
    return { ok: false, error: 'Категория или счет не найдены' };
  }

  category.reserved = (category.reserved ?? 0) + rubAmount;
  category.spent = (category.spent ?? 0) - rubAmount;
  return { ok: true };
}

function reverseCategoryDeleted(state, tx) {
  if (!tx.categorySnapshot) {
    return { ok: false, error: 'Нет данных для восстановления категории' };
  }

  if (findCategory(state, tx.categoryId)) {
    return { ok: false, error: 'Категория уже существует' };
  }

  if (!Array.isArray(state.categories)) {
    state.categories = [];
  }

  state.categories.push({ ...tx.categorySnapshot });
  return { ok: true };
}

function canReverseAccountDeposit(state, tx) {
  const account = findAccount(state, tx.accountId);
  if (!account) return false;
  return (account.balance ?? 0) >= tx.amount;
}

function canReverseAccountTransfer(state, tx) {
  const sourceAccount = findAccount(state, tx.sourceAccountId);
  const destAccount = findAccount(state, tx.destAccountId);
  if (!sourceAccount || !destAccount) return false;
  const destAmount = tx.destAmount ?? tx.amount;
  return (destAccount.balance ?? 0) >= destAmount;
}

function canReverseReserve(state, tx) {
  const category = findCategory(state, tx.categoryId);
  if (!category) return false;
  return (category.reserved ?? 0) >= tx.amount;
}

function canReverseCategoryUnreserve(state, tx) {
  const category = findCategory(state, tx.categoryId);
  if (!category) return false;
  return calculateFreeBalance(state) >= tx.amount;
}

function canReverseObligationReserve(state, tx) {
  const obligation = findObligation(state, tx.obligationId);
  if (!obligation) return false;
  return (obligation.reserveAmount ?? 0) >= tx.amount;
}

function canReverseObligationUnreserve(state, tx) {
  const obligation = findObligation(state, tx.obligationId);
  if (!obligation) return false;
  return calculateFreeBalance(state) >= tx.amount;
}

function canReverseExpense(state, tx) {
  const account = findAccount(state, tx.accountId);
  if (!account) return false;

  if (tx.obligationId) {
    return !!findObligation(state, tx.obligationId);
  }

  if (!findCategory(state, tx.categoryId)) return false;
  return true;
}

function canReverseCategoryDeleted(state, tx) {
  if (!tx.categorySnapshot) return false;
  if (findCategory(state, tx.categoryId)) return false;
  return true;
}

function canReverseSavingDeposit(state, tx) {
  const saving = findSaving(state, tx.savingId);
  if (!saving) return false;
  return getSavingAccumulated(saving) >= tx.amount;
}

function canReverseSavingWithdraw(state, tx) {
  return !!findSaving(state, tx.savingId);
}

function canReverseSavingSpend(state, tx) {
  if (!findAccount(state, tx.accountId)) return false;
  if (tx.savingType === 'single_use' && tx.savingSnapshot) return true;
  return !!findSaving(state, tx.savingId);
}

function canReverseDebtCreateOwed(state, tx) {
  return !!findAccount(state, tx.accountId);
}

function canReverseDebtCreateWeOwe(state, tx) {
  const account = findAccount(state, tx.accountId);
  if (!account) return false;
  const accountAmount = tx.accountDebitAmount ?? tx.amount;
  return (account.balance ?? 0) >= accountAmount;
}

function canReverseDebtRepay(state, tx) {
  const account = findAccount(state, tx.accountId);
  if (!account) return false;
  const accountAmount = tx.accountDebitAmount ?? tx.amount;
  if ((account.balance ?? 0) < accountAmount) return false;
  return !!(findDebt(state, tx.debtId) || tx.debtSnapshot);
}

function canReverseDebtWriteOff(state, tx) {
  return !!(findDebt(state, tx.debtId) || tx.debtSnapshot);
}

export function canCancelTransaction(state, tx) {
  if (!tx || tx.status !== TRANSACTION_STATUS.ACTIVE) return false;
  if (!CANCELLABLE_TYPES.has(tx.type)) return false;
  if (isServiceTransaction(tx)) return false;

  switch (tx.type) {
    case TRANSACTION_TYPES.ACCOUNT_DEPOSIT:
      return canReverseAccountDeposit(state, tx);
    case TRANSACTION_TYPES.ACCOUNT_TRANSFER:
      return canReverseAccountTransfer(state, tx);
    case TRANSACTION_TYPES.RESERVE:
      return canReverseReserve(state, tx);
    case TRANSACTION_TYPES.CATEGORY_UNRESERVE:
      return canReverseCategoryUnreserve(state, tx);
    case TRANSACTION_TYPES.EXPENSE:
      return canReverseExpense(state, tx);
    case TRANSACTION_TYPES.CATEGORY_DELETED:
      return canReverseCategoryDeleted(state, tx);
    case TRANSACTION_TYPES.SAVING_DEPOSIT:
      return canReverseSavingDeposit(state, tx);
    case TRANSACTION_TYPES.SAVING_WITHDRAW:
      return canReverseSavingWithdraw(state, tx);
    case TRANSACTION_TYPES.SAVING_SPEND:
      return canReverseSavingSpend(state, tx);
    case TRANSACTION_TYPES.DEBT_CREATE_OWED:
      return canReverseDebtCreateOwed(state, tx);
    case TRANSACTION_TYPES.DEBT_CREATE_WE_OWE:
      return canReverseDebtCreateWeOwe(state, tx);
    case TRANSACTION_TYPES.DEBT_REPAY_OWED:
    case TRANSACTION_TYPES.DEBT_REPAY_WE_OWE:
      return canReverseDebtRepay(state, tx);
    case TRANSACTION_TYPES.DEBT_WRITE_OFF:
      return canReverseDebtWriteOff(state, tx);
    case TRANSACTION_TYPES.OBLIGATION_RESERVE:
      return canReverseObligationReserve(state, tx);
    case TRANSACTION_TYPES.OBLIGATION_UNRESERVE:
      return canReverseObligationUnreserve(state, tx);
    default:
      return false;
  }
}

export function cancelTransaction(state, transactionId) {
  const blocked = guardFinanceEntry('undoTransaction');
  if (blocked) return blocked;

  const tx = findTransaction(state, transactionId);
  if (!tx) return { ok: false, error: 'Транзакция не найдена' };

  const gateBlock = rejectGateDecision(
    runFinanceGate('undoTransaction', tx.amount ?? 0, state, {
      transactionId,
      transactionType: tx.type
    })
  );
  if (gateBlock) return gateBlock;

  if (tx.status === TRANSACTION_STATUS.CANCELLED) {
    return { ok: false, error: 'Операция уже отменена' };
  }

  let result;
  switch (tx.type) {
    case TRANSACTION_TYPES.ACCOUNT_DEPOSIT:
      result = reverseAccountDeposit(state, tx);
      break;
    case TRANSACTION_TYPES.ACCOUNT_TRANSFER:
      result = reverseAccountTransfer(state, tx);
      break;
    case TRANSACTION_TYPES.RESERVE:
      result = reverseReserve(state, tx);
      break;
    case TRANSACTION_TYPES.CATEGORY_UNRESERVE:
      result = reverseCategoryUnreserve(state, tx);
      break;
    case TRANSACTION_TYPES.EXPENSE:
      result = reverseExpense(state, tx);
      break;
    case TRANSACTION_TYPES.CATEGORY_DELETED:
      result = reverseCategoryDeleted(state, tx);
      break;
    case TRANSACTION_TYPES.SAVING_DEPOSIT:
      result = reverseSavingDeposit(state, tx);
      break;
    case TRANSACTION_TYPES.SAVING_WITHDRAW:
      result = reverseSavingWithdraw(state, tx);
      break;
    case TRANSACTION_TYPES.SAVING_SPEND:
      result = reverseSavingSpend(state, tx);
      break;
    case TRANSACTION_TYPES.DEBT_CREATE_OWED:
      result = reverseDebtCreateOwed(state, tx);
      break;
    case TRANSACTION_TYPES.DEBT_CREATE_WE_OWE:
      result = reverseDebtCreateWeOwe(state, tx);
      break;
    case TRANSACTION_TYPES.DEBT_REPAY_OWED:
      result = reverseDebtRepayOwed(state, tx);
      break;
    case TRANSACTION_TYPES.DEBT_REPAY_WE_OWE:
      result = reverseDebtRepayWeOwe(state, tx);
      break;
    case TRANSACTION_TYPES.DEBT_WRITE_OFF:
      result = reverseDebtWriteOff(state, tx);
      break;
    case TRANSACTION_TYPES.OBLIGATION_RESERVE:
      result = reverseObligationReserve(state, tx);
      break;
    case TRANSACTION_TYPES.OBLIGATION_UNRESERVE:
      result = reverseObligationUnreserve(state, tx);
      break;
    default:
      return { ok: false, error: 'Неизвестный тип операции' };
  }

  if (!result.ok) return result;

  tx.status = TRANSACTION_STATUS.CANCELLED;
  tx.cancelledAt = new Date().toISOString();

  enforceFinancialInvariants(state, { operation: 'cancelTransaction', transactionId });

  return { ok: true, transaction: tx };
}

export function updateTransactionMeta(state, transactionId, { comment, date }) {
  const tx = findTransaction(state, transactionId);
  if (!tx) return { ok: false, error: 'Транзакция не найдена' };

  if (comment !== undefined) {
    tx.comment = String(comment ?? '').trim();
  }
  if (date !== undefined && date) {
    tx.date = date;
  }

  return { ok: true, transaction: tx };
}
