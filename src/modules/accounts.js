import {
  depositAccount,
  transferAccount,
  createAccount as recordAccountCreation,
  updateAccountRecord,
  deleteAccountRecord
} from './financeGate.js';
import {
  getAccountTransactions,
  renderAccountSelectOptions,
  TYPE_LABELS
} from './transactions.js';
import { calculateOwnerBalance } from './financeEngine.js';
import { openModal, closeModal, isWithinAppUi } from './modalLayer.js';
import { supabase } from '../lib/supabase.js';

const OWNER_LABELS = {
  husband: 'Муж',
  wife: 'Жена'
};
const OWNER_ICONS = {
  husband: '👨',
  wife: '👩'
};

const ICONS = {
  pencil: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4"><path d="m2.695 14.763-1.262 3.154a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.885L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.42a4 4 0 0 0-.885 1.343Z"/></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 0 0-.584.788 48.065 48.065 0 0 0 .522 7.403.75.75 0 0 0 .43.375A48.112 48.112 0 0 0 8 14.25c0 1.246.124 2.503.38 3.75a.75.75 0 0 0 .75.568h7.5a.75.75 0 0 0 .75-.568c.256-1.247.38-2.504.38-3.75a48.112 48.112 0 0 0-3.439-.908.75.75 0 0 0-.43-.375 48.65 48.65 0 0 0-2.365-.298V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM9.5 3.75V5h1V3.75a.25.25 0 0 0-.25-.25h-.5a.25.25 0 0 0-.25.25ZM4.5 6.75v8.5c0 .414.336.75.75.75h9.5a.75.75 0 0 0 .75-.75v-8.5h-11Z" clip-rule="evenodd"/></svg>`
};

const DEFAULT_EXCHANGE_RATE = 92;
const DEFAULT_HOUSEHOLD_ID = null;
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

function createId(prefix) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function getExchangeRate(state) {
  const rate = Number(state.exchangeRate);
  return Number.isFinite(rate) && rate >= 1 ? rate : DEFAULT_EXCHANGE_RATE;
}

function findAccount(state, accountId) {
  return (state.accounts ?? []).find((account) => account.id === accountId);
}

function validateAccountName(name) {
  if (!name || !String(name).trim()) {
    return 'Введите название счета';
  }
  return null;
}

function validateBalance(balance) {
  const value = Number(balance);
  if (!Number.isFinite(value) || value < 0) {
    return 'Баланс не может быть отрицательным';
  }
  return null;
}

function validateDepositAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return 'Сумма пополнения должна быть больше 0';
  }
  return null;
}

function validateTransferAmount(amount, sourceAccount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return 'Сумма перевода должна быть больше 0';
  }
  const balance = sourceAccount.balance ?? 0;
  if (value > balance) {
    return 'Недостаточно средств на счете. Перевод не может увести баланс в минус.';
  }
  return null;
}

function validateExchangeRate(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value) || value < 1) {
    return 'Курс USD не может быть меньше 1';
  }
  return null;
}

function validateCurrency(currency) {
  if (currency !== 'RUB' && currency !== 'USD') {
    return 'Выберите валюту: RUB или USD';
  }
  return null;
}

function createAccount(state, name, currency, initialBalance, comment) {
  const nameError = validateAccountName(name);
  if (nameError) {
    alert(nameError);
    return false;
  }

  const currencyError = validateCurrency(currency);
  if (currencyError) {
    alert(currencyError);
    return false;
  }

  const balanceError = validateBalance(initialBalance);
  if (balanceError) {
    alert(balanceError);
    return false;
  }

  if (!Array.isArray(state.accounts)) {
    state.accounts = [];
  }

  const balance = Number(initialBalance) || 0;
  const account = {
    id: createId('account'),
    name: String(name).trim(),
    currency,
    balance: 0,
    owner: state.profile,
    createdAt: new Date().toISOString()
  };

  state.accounts.push(account);

  if (balance > 0) {
    const result = depositAccount(
      state,
      account.id,
      balance,
      comment || 'Начальный баланс',
      todayIso(),
      state.profile
    );
    if (!result.ok) {
      state.accounts.pop();
      alert(result.error);
      return false;
    }
  }

  recordAccountCreation(state, account, balance, state.profile);

  return true;
}

async function persistAccountToSupabase(name, currency, initialBalance) {
  console.log('🔥 SUPABASE INSERT FUNCTION CALLED');
  console.log('🔥 SUPABASE CLIENT:', supabase);

  const balance = Number(initialBalance) || 0;
  const payload = {
    name: String(name).trim(),
    balance,
    currency,
    household_id: DEFAULT_HOUSEHOLD_ID
  };

  console.log('BEFORE_INSERT', JSON.stringify({ payload }));

  try {
    const response = await supabase.from('accounts').insert(payload).select();
    const { data, error, status, statusText } = response;

    console.log('SUPABASE_RESPONSE', JSON.stringify({
      data,
      error: error
        ? {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint
          }
        : null,
      status,
      statusText
    }));
    console.log('AFTER_INSERT', JSON.stringify({ ok: !error, rowCount: data?.length ?? 0 }));

    if (error) {
      console.error('Supabase accounts insert failed:', error);
      return { ok: false, error, status, statusText, data };
    }

    return { ok: true, data, status, statusText };
  } catch (error) {
    console.error('Supabase accounts insert threw:', error);
    console.log('AFTER_INSERT', JSON.stringify({ ok: false, thrown: String(error) }));
    return { ok: false, error };
  }
}

function updateAccount(state, accountId, name, balance) {
  const nameError = validateAccountName(name);
  if (nameError) {
    alert(nameError);
    return false;
  }

  const balanceError = validateBalance(balance);
  if (balanceError) {
    alert(balanceError);
    return false;
  }

  const account = findAccount(state, accountId);
  if (!account) {
    alert('Счет не найден');
    return false;
  }

  const changes = {
    oldName: account.name,
    newName: String(name).trim(),
    oldBalance: account.balance ?? 0,
    newBalance: Number(balance) || 0,
    oldCurrency: account.currency ?? 'RUB',
    newCurrency: account.currency ?? 'RUB'
  };

  const hasChanges = changes.oldName !== changes.newName
    || changes.oldBalance !== changes.newBalance
    || changes.oldCurrency !== changes.newCurrency;

  account.name = changes.newName;
  account.balance = changes.newBalance;

  if (hasChanges) {
    updateAccountRecord(state, accountId, changes, state.profile);
  }

  return true;
}

function deleteAccount(state, accountId) {
  if (!Array.isArray(state.accounts)) return false;

  const account = findAccount(state, accountId);
  if (!account) {
    alert('Счет не найден');
    return false;
  }

  deleteAccountRecord(state, account, state.profile);
  state.accounts = state.accounts.filter((item) => item.id !== accountId);
  return true;
}

function depositToAccount(state, accountId, amount, comment, date) {
  const amountError = validateDepositAmount(amount);
  if (amountError) {
    alert(amountError);
    return false;
  }

  const result = depositAccount(
    state,
    accountId,
    amount,
    comment,
    date,
    state.profile
  );

  if (!result.ok) {
    alert(result.error);
    return false;
  }

  return true;
}

function roundMoney(amount, currency = 'RUB') {
  const decimals = currency === 'USD' ? 2 : 2;
  const factor = 10 ** decimals;
  return Math.round(Number(amount) * factor) / factor;
}

function calculateTransferCreditAmount(sourceAmount, sourceCurrency, destCurrency, exchangeRate) {
  if (sourceCurrency === destCurrency) {
    return roundMoney(sourceAmount, destCurrency);
  }
  if (sourceCurrency === 'RUB' && destCurrency === 'USD') {
    return roundMoney(sourceAmount / exchangeRate, 'USD');
  }
  if (sourceCurrency === 'USD' && destCurrency === 'RUB') {
    return roundMoney(sourceAmount * exchangeRate, 'RUB');
  }
  return roundMoney(sourceAmount, destCurrency);
}

function calculateTransferDebitAmount(creditAmount, sourceCurrency, destCurrency, exchangeRate) {
  if (sourceCurrency === destCurrency) {
    return roundMoney(creditAmount, sourceCurrency);
  }
  if (sourceCurrency === 'RUB' && destCurrency === 'USD') {
    return roundMoney(creditAmount * exchangeRate, 'RUB');
  }
  if (sourceCurrency === 'USD' && destCurrency === 'RUB') {
    return roundMoney(creditAmount / exchangeRate, 'USD');
  }
  return roundMoney(creditAmount, sourceCurrency);
}

function resolveTransferAmounts(inputAmount, inputMode, sourceCurrency, destCurrency, exchangeRate) {
  const value = Number(inputAmount);
  if (inputMode === 'credit') {
    const creditAmount = roundMoney(value, destCurrency);
    const sourceAmount = calculateTransferDebitAmount(
      creditAmount,
      sourceCurrency,
      destCurrency,
      exchangeRate
    );
    return { sourceAmount, creditAmount };
  }

  const sourceAmount = roundMoney(value, sourceCurrency);
  const creditAmount = calculateTransferCreditAmount(
    sourceAmount,
    sourceCurrency,
    destCurrency,
    exchangeRate
  );
  return { sourceAmount, creditAmount };
}

function isCrossCurrencyTransfer(sourceAccount, destAccount) {
  if (!sourceAccount || !destAccount) return false;
  return (sourceAccount.currency ?? 'RUB') !== (destAccount.currency ?? 'RUB');
}

function transferBetweenAccounts(state, sourceAccountId, destAccountId, inputAmount, inputMode = 'debit') {
  if (sourceAccountId === destAccountId) {
    alert('Нельзя перевести на тот же счет');
    return false;
  }

  const sourceAccount = findAccount(state, sourceAccountId);
  const destAccount = findAccount(state, destAccountId);

  if (!sourceAccount || !destAccount) {
    alert('Счет не найден');
    return false;
  }

  const sourceCurrency = sourceAccount.currency ?? 'RUB';
  const destCurrency = destAccount.currency ?? 'RUB';
  const exchangeRate = getExchangeRate(state);
  const mode = isCrossCurrencyTransfer(sourceAccount, destAccount) ? inputMode : 'debit';
  const { sourceAmount, creditAmount } = resolveTransferAmounts(
    inputAmount,
    mode,
    sourceCurrency,
    destCurrency,
    exchangeRate
  );

  if (!Number.isFinite(sourceAmount) || sourceAmount <= 0) {
    alert('Сумма перевода должна быть больше 0');
    return false;
  }

  const amountError = validateTransferAmount(sourceAmount, sourceAccount);
  if (amountError) {
    alert(amountError);
    return false;
  }

  const date = todayIso();
  const destName = destAccount.name;
  const transferComment = sourceCurrency === destCurrency
    ? `Перевод на «${destName}»`
    : `Перевод на «${destName}» (${formatMoney(creditAmount, destCurrency)})`;

  const result = transferAccount(state, {
    sourceAccountId,
    destAccountId,
    sourceAmount,
    creditAmount,
    sourceCurrency,
    destCurrency,
    exchangeRate,
    comment: transferComment,
    date,
    author: state.profile
  });

  if (!result.ok) {
    alert(result.error);
    return false;
  }

  return true;
}

function renderOperations(state, accountId, currency) {
  const operations = getAccountTransactions(state, accountId, 3);
  if (!operations.length) {
    return '<p class="text-xs text-slate-400 mt-2">Операций пока нет</p>';
  }

  const items = operations.map((tx) => {
    const dateLabel = tx.date ? new Date(tx.date).toLocaleDateString('ru-RU') : '—';
    let comment = tx.comment ? escapeHtml(tx.comment) : 'Без комментария';
    let typeLabel = TYPE_LABELS[tx.type] ?? tx.type;

    let amountClass = 'text-emerald-600';
    let amountPrefix = '+';
    let displayAmount = tx.amount;
    let txCurrency = tx.currency ?? currency;

    if (tx.type === 'account_transfer') {
      if (tx.sourceAccountId === accountId) {
        amountClass = 'text-red-600';
        amountPrefix = '−';
        displayAmount = tx.sourceAmount ?? tx.amount;
        txCurrency = tx.sourceCurrency ?? currency;
      } else {
        displayAmount = tx.destAmount ?? tx.amount;
        txCurrency = tx.destCurrency ?? currency;
      }
    } else if (tx.type === 'expense') {
      amountClass = 'text-red-600';
      amountPrefix = '−';
      displayAmount = tx.accountDebitAmount ?? tx.amount;
      txCurrency = tx.accountCurrency ?? currency;
      if (tx.obligationId) {
        typeLabel = `Оплата: ${escapeHtml(tx.obligationName ?? 'обязательство')}`;
      }
    } else if (tx.type === 'saving_spend') {
      amountClass = 'text-red-600';
      amountPrefix = '−';
      displayAmount = tx.accountDebitAmount ?? tx.amount;
      txCurrency = tx.accountCurrency ?? currency;
      typeLabel = `Потрачено через копилку: ${escapeHtml(tx.savingName ?? 'копилка')}`;
      comment = tx.comment ? escapeHtml(tx.comment) : 'Списание со счёта';
    } else if (tx.type === 'debt_create_owed') {
      amountClass = 'text-red-600';
      amountPrefix = '−';
      displayAmount = tx.accountDebitAmount ?? tx.amount;
      txCurrency = tx.accountCurrency ?? currency;
      typeLabel = `Выдан долг: ${escapeHtml(tx.debtTitle ?? 'долг')}`;
    } else if (tx.type === 'debt_create_we_owe') {
      displayAmount = tx.accountDebitAmount ?? tx.amount;
      txCurrency = tx.accountCurrency ?? currency;
      typeLabel = `Получен долг: ${escapeHtml(tx.debtTitle ?? 'долг')}`;
    } else if (tx.type === 'debt_repay_owed') {
      displayAmount = tx.accountDebitAmount ?? tx.amount;
      txCurrency = tx.accountCurrency ?? currency;
      typeLabel = `Возврат долга: ${escapeHtml(tx.debtTitle ?? 'долг')}`;
    } else if (tx.type === 'debt_repay_we_owe') {
      amountClass = 'text-red-600';
      amountPrefix = '−';
      displayAmount = tx.accountDebitAmount ?? tx.amount;
      txCurrency = tx.accountCurrency ?? currency;
      typeLabel = `Погашение долга: ${escapeHtml(tx.debtTitle ?? 'долг')}`;
    } else if (tx.type === 'account_deposit') {
      txCurrency = tx.currency ?? currency;
    }

    return `
      <li class="text-xs text-slate-500 py-1 border-t border-slate-50 first:border-0">
        <span class="${amountClass} font-medium">${amountPrefix}${formatMoney(displayAmount, txCurrency)}</span>
        <span class="text-slate-400"> · ${dateLabel}</span>
        <span class="text-slate-400"> · ${typeLabel}</span>
        <span class="block text-slate-400 truncate">${comment}</span>
      </li>
    `;
  }).join('');

  return `<ul class="mt-2">${items}</ul>`;
}

function renderAccountCard(state, account) {
  const owner = account.owner ?? 'husband';
  const ownerLabel = OWNER_LABELS[owner] ?? owner;
  const ownerIcon = OWNER_ICONS[owner] ?? '👤';
  const currency = account.currency ?? 'RUB';

  return `
    <article class="border border-slate-200 rounded-xl p-4 bg-slate-50/50 relative" data-account-id="${account.id}">
      <button
        type="button"
        data-action="delete-account"
        data-account-id="${account.id}"
        title="Удалить"
        class="absolute top-3 right-3 p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
      >${ICONS.trash}</button>
      <div class="flex items-start justify-between gap-3 mb-3 pr-8">
        <div class="min-w-0">
          <div class="flex items-center gap-1.5">
            <h3 class="font-semibold text-slate-900 truncate">${escapeHtml(account.name)}</h3>
            <button
              type="button"
              data-action="open-edit"
              data-account-id="${account.id}"
              title="Редактировать"
              class="p-1 rounded text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors shrink-0"
            >${ICONS.pencil}</button>
          </div>
          <p class="text-sm text-slate-500 mt-0.5">${currency}</p>
        </div>
        <div class="text-right shrink-0">
          <p class="text-lg font-bold text-slate-900">${formatMoney(account.balance, currency)}</p>
          <p class="text-xs text-slate-500 mt-1 flex items-center justify-end gap-1">
            <span>${ownerIcon}</span>
            <span>${ownerLabel}</span>
          </p>
        </div>
      </div>
      <div class="flex gap-2 mb-2">
        <button
          type="button"
          data-action="open-topup"
          data-account-id="${account.id}"
          class="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >Пополнить</button>
        <button
          type="button"
          data-action="open-transfer"
          data-account-id="${account.id}"
          class="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
        >Перевести</button>
      </div>
      <div class="mt-2">
        <p class="text-xs font-medium text-slate-400 uppercase tracking-wide">История</p>
        ${renderOperations(state, account.id, currency)}
      </div>
    </article>
  `;
}

function renderAddAccountModal() {
  return `
    <div
      class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40"
      data-modal="add-account"
    >
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-4">Новый счет</h3>
        <form data-form="add-account" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Название счета</label>
            <input
              type="text"
              name="name"
              required
              maxlength="80"
              class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Например, Основной"
            >
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Валюта</label>
            <select
              name="currency"
              class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="RUB">RUB — рубли</option>
              <option value="USD">USD — доллары</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Начальный баланс</label>
            <input
              type="number"
              name="initialBalance"
              min="0"
              step="0.01"
              value="0"
              class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="0"
            >
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Комментарий</label>
            <input
              type="text"
              name="comment"
              maxlength="200"
              class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Необязательно"
            >
          </div>
          <p class="text-xs text-slate-400">Автор: определяется по активному профилю</p>
          <div class="flex gap-2 pt-2">
            <button
              type="button"
              data-action="close-modal"
              data-modal="add-account"
              class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
            >Отмена</button>
            <button
              type="submit"
              class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700"
            >Создать</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderEditAccountModal() {
  return `
    <div
      class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40"
      data-modal="edit-account"
    >
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-4">Редактирование счета</h3>
        <form data-form="edit-account" class="space-y-4">
          <input type="hidden" name="accountId" value="">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Название счета</label>
            <input
              type="text"
              name="name"
              required
              maxlength="80"
              class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Баланс</label>
            <input
              type="number"
              name="balance"
              required
              min="0"
              step="0.01"
              class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
          </div>
          <div class="flex gap-2 pt-2">
            <button
              type="button"
              data-action="close-modal"
              data-modal="edit-account"
              class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
            >Отмена</button>
            <button
              type="submit"
              class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700"
            >Сохранить</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderTransferAccountOptions(state, sourceAccountId) {
  return renderAccountSelectOptions(state, '', sourceAccountId);
}

function renderTransferModal() {
  return `
    <div
      class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40"
      data-modal="transfer"
    >
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-1">Перевод между счетами</h3>
        <p class="text-sm text-slate-500 mb-4" data-transfer-source-label>Со счета</p>
        <form data-form="transfer" class="space-y-4">
          <input type="hidden" name="sourceAccountId" value="">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Счет-получатель</label>
            <select
              name="destAccountId"
              required
              class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Выберите счет</option>
            </select>
          </div>
          <div class="hidden space-y-2" data-transfer-input-mode>
            <p class="text-sm font-medium text-slate-700">Способ ввода суммы</p>
            <label class="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="radio"
                name="inputMode"
                value="debit"
                checked
                class="text-primary-600 focus:ring-primary-500"
              >
              <span>Ввести сумму списания</span>
            </label>
            <label class="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="radio"
                name="inputMode"
                value="credit"
                class="text-primary-600 focus:ring-primary-500"
              >
              <span>Ввести сумму получения</span>
            </label>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1" data-transfer-amount-label>Сумма</label>
            <input
              type="number"
              name="amount"
              required
              min="0.01"
              step="0.01"
              inputmode="decimal"
              class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="0"
            >
            <p class="text-xs text-slate-400 mt-1 hidden" data-transfer-rate-hint></p>
            <p class="text-xs text-slate-600 mt-2 hidden" data-transfer-preview></p>
          </div>
          <div class="flex gap-2 pt-2">
            <button
              type="button"
              data-action="close-modal"
              data-modal="transfer"
              class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
            >Отмена</button>
            <button
              type="submit"
              class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700"
            >Перевести</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderTopUpModal() {
  return `
    <div
      class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40"
      data-modal="topup"
    >
      <div class="bg-white rounded-2xl border border-slate-200 shadow-lg w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-slate-900 mb-4">Пополнение счета</h3>
        <form data-form="topup" class="space-y-4">
          <input type="hidden" name="accountId" value="">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Сумма</label>
            <input
              type="number"
              name="amount"
              required
              min="0.01"
              step="0.01"
              class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="0"
            >
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Комментарий</label>
            <input
              type="text"
              name="comment"
              maxlength="200"
              class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Необязательно"
            >
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Дата</label>
            <input
              type="date"
              name="date"
              required
              value="${todayIso()}"
              class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
          </div>
          <div class="flex gap-2 pt-2">
            <button
              type="button"
              data-action="close-modal"
              data-modal="topup"
              class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
            >Отмена</button>
            <button
              type="submit"
              class="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700"
            >Сохранить</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderEmptyState() {
  return `
    <div class="text-center py-10">
      <p class="text-slate-500 mb-4">Счетов пока нет</p>
      <button
        type="button"
        data-action="open-add-modal"
        class="px-6 py-3 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
      >Создать первый счет</button>
    </div>
  `;
}

const OWNER_GROUP_ORDER = [
  { key: 'husband', label: OWNER_LABELS.husband },
  { key: 'wife', label: OWNER_LABELS.wife }
];

function groupAccountsByOwner(accounts) {
  const groups = { husband: [], wife: [] };
  (accounts ?? []).forEach((account) => {
    const ownerKey = account.owner === 'wife' ? 'wife' : 'husband';
    groups[ownerKey].push(account);
  });
  return groups;
}

function renderOwnerGroupSection(state, ownerKey, label, accounts) {
  if (!accounts.length) return '';

  const balanceRub = calculateOwnerBalance(state, ownerKey);
  const cards = accounts.map((account) => renderAccountCard(state, account)).join('');

  return `
    <details class="mb-4 border border-slate-200 rounded-xl bg-slate-50/40 group" open data-owner-group="${ownerKey}">
      <summary class="cursor-pointer px-4 py-3 select-none list-none">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="font-semibold text-slate-900">${label}</p>
            <p class="text-sm text-slate-600 mt-0.5">Баланс: ${formatMoney(balanceRub, 'RUB')}</p>
            <p class="text-xs text-slate-400 mt-1">Счета</p>
          </div>
          <span class="text-slate-400 text-sm shrink-0 group-open:rotate-180 transition-transform mt-1">▼</span>
        </div>
      </summary>
      <div class="px-4 pb-4 grid gap-4">${cards}</div>
    </details>
  `;
}

function renderAccountsList(state, accounts) {
  if (!accounts.length) return renderEmptyState();

  const groups = groupAccountsByOwner(accounts);
  const sections = OWNER_GROUP_ORDER
    .map(({ key, label }) => renderOwnerGroupSection(state, key, label, groups[key]))
    .filter(Boolean)
    .join('');

  return sections || renderEmptyState();
}

export function renderAccounts(state, container) {
  const accounts = state.accounts ?? [];
  const exchangeRate = getExchangeRate(state);

  if (state.exchangeRate === undefined || state.exchangeRate === null) {
    state.exchangeRate = DEFAULT_EXCHANGE_RATE;
  }

  const accountsList = renderAccountsList(state, accounts);

  container.innerHTML = `
    <div class="space-y-4">
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 class="text-lg font-semibold text-slate-900">Счета</h2>
          ${accounts.length ? `
            <button
              type="button"
              data-action="open-add-modal"
              class="px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors shrink-0"
            >Добавить счет</button>
          ` : ''}
        </div>

        <div class="flex items-center gap-3 mb-6 p-3 bg-slate-50 rounded-xl">
          <label for="exchange-rate-input" class="text-sm font-medium text-slate-700 shrink-0">Курс USD</label>
          <input
            id="exchange-rate-input"
            type="number"
            min="1"
            step="0.01"
            value="${exchangeRate}"
            data-action="exchange-rate"
            class="w-28 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
          <span class="text-xs text-slate-400">₽ за 1 $</span>
        </div>

        ${accountsList}

        <div class="mt-6 pt-4 border-t border-slate-100 text-center">
          <button
            type="button"
            data-action="reset-all-data"
            class="text-sm text-red-500 hover:text-red-700 transition-colors"
          >Сбросить все данные</button>
        </div>
      </div>
    </div>
    ${renderAddAccountModal()}
    ${renderEditAccountModal()}
    ${renderTopUpModal()}
    ${renderTransferModal()}
  `;
}

function getTransferInputMode(form) {
  const checked = form.querySelector('input[name="inputMode"]:checked');
  return checked?.value === 'credit' ? 'credit' : 'debit';
}

function populateTransferForm(state, container, sourceAccountId) {
  const form = container.querySelector('[data-form="transfer"]');
  if (!form) return;

  const sourceAccount = findAccount(state, sourceAccountId);
  if (!sourceAccount) return;

  const currency = sourceAccount.currency ?? 'RUB';

  form.sourceAccountId.value = sourceAccountId;
  form.amount.value = '';
  form.amount.removeAttribute('max');
  form.amount.step = '0.01';

  const debitRadio = form.querySelector('input[name="inputMode"][value="debit"]');
  if (debitRadio) debitRadio.checked = true;

  const destSelect = form.destAccountId;
  destSelect.innerHTML = `
    <option value="">Выберите счет</option>
    ${renderTransferAccountOptions(state, sourceAccountId)}
  `;

  const sourceLabel = container.querySelector('[data-transfer-source-label]');
  if (sourceLabel) {
    sourceLabel.textContent = `Со счета «${sourceAccount.name}» · ${formatMoney(sourceAccount.balance, currency)}`;
  }

  updateTransferFormUI(state, container, sourceAccountId);
}

function updateTransferFormUI(state, container, sourceAccountId) {
  const form = container.querySelector('[data-form="transfer"]');
  const rateHint = container.querySelector('[data-transfer-rate-hint]');
  const preview = container.querySelector('[data-transfer-preview]');
  const amountLabel = container.querySelector('[data-transfer-amount-label]');
  const modeBlock = container.querySelector('[data-transfer-input-mode]');

  if (!form) return;

  const sourceAccount = findAccount(state, sourceAccountId);
  const destAccount = findAccount(state, form.destAccountId.value);
  const sourceCurrency = sourceAccount?.currency ?? 'RUB';
  const destCurrency = destAccount?.currency ?? 'RUB';
  const crossCurrency = isCrossCurrencyTransfer(sourceAccount, destAccount);
  const inputMode = getTransferInputMode(form);

  if (modeBlock) {
    modeBlock.classList.toggle('hidden', !crossCurrency);
  }

  if (!crossCurrency) {
    const debitRadio = form.querySelector('input[name="inputMode"][value="debit"]');
    if (debitRadio) debitRadio.checked = true;
  }

  if (amountLabel) {
    if (!destAccount) {
      amountLabel.textContent = 'Сумма';
    } else if (crossCurrency && inputMode === 'credit') {
      amountLabel.textContent = `Сумма получения (${destCurrency})`;
    } else {
      amountLabel.textContent = `Сумма списания (${sourceCurrency})`;
    }
  }

  if (rateHint) {
    if (crossCurrency) {
      const exchangeRate = getExchangeRate(state);
      rateHint.classList.remove('hidden');
      rateHint.textContent = `Курс: ${exchangeRate} ₽ за 1 $.`;
    } else {
      rateHint.classList.add('hidden');
      rateHint.textContent = '';
    }
  }

  if (!preview) return;

  preview.classList.remove('text-red-600');

  const rawAmount = form.amount.value;
  const inputValue = Number(rawAmount);

  if (!destAccount || !sourceAccount || !Number.isFinite(inputValue) || inputValue <= 0) {
    preview.classList.add('hidden');
    preview.textContent = '';
    return;
  }

  const exchangeRate = getExchangeRate(state);
  const { sourceAmount, creditAmount } = resolveTransferAmounts(
    inputValue,
    crossCurrency ? inputMode : 'debit',
    sourceCurrency,
    destCurrency,
    exchangeRate
  );

  preview.classList.remove('hidden');
  preview.textContent = `Будет списано: ${formatMoney(sourceAmount, sourceCurrency)}, будет зачислено: ${formatMoney(creditAmount, destCurrency)}`;

  if (sourceAmount > (sourceAccount.balance ?? 0)) {
    preview.classList.add('text-red-600');
    preview.textContent += '. Недостаточно средств на счете.';
  }
}

function refresh(state, container, onUpdate) {
  renderAccounts(state, container);
  if (typeof onUpdate === 'function') {
    onUpdate();
  }
}

export function initAccountsHandlers(state, container, onUpdate, onReset) {
  if (container.dataset.accountsHandlersBound === 'true') return;
  container.dataset.accountsHandlersBound = 'true';

  document.addEventListener('click', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    const target = event.target;

    if (target.closest('[data-action="reset-all-data"]')) {
      if (typeof onReset === 'function') {
        onReset();
      }
      return;
    }

    if (target.closest('[data-action="open-add-modal"]')) {
      const form = container.querySelector('[data-form="add-account"]');
      if (form) form.reset();
      openModal('add-account');
      return;
    }

    if (target.closest('[data-action="close-modal"]')) {
      const btn = target.closest('[data-action="close-modal"]');
      closeModal(btn.dataset.modal);
      return;
    }

    if (target.closest('[data-action="open-topup"]')) {
      const btn = target.closest('[data-action="open-topup"]');
      const form = container.querySelector('[data-form="topup"]');
      if (form) {
        form.accountId.value = btn.dataset.accountId;
        form.amount.value = '';
        form.comment.value = '';
        form.date.value = todayIso();
      }
      openModal('topup');
      return;
    }

    if (target.closest('[data-action="open-transfer"]')) {
      const btn = target.closest('[data-action="open-transfer"]');
      populateTransferForm(state, container, btn.dataset.accountId);
      openModal('transfer');
      return;
    }

    if (target.closest('[data-action="open-edit"]')) {
      const btn = target.closest('[data-action="open-edit"]');
      const account = findAccount(state, btn.dataset.accountId);
      const form = container.querySelector('[data-form="edit-account"]');
      if (account && form) {
        form.accountId.value = account.id;
        form.name.value = account.name;
        form.balance.value = account.balance ?? 0;
      }
      openModal('edit-account');
      return;
    }

    if (target.closest('[data-action="delete-account"]')) {
      const btn = target.closest('[data-action="delete-account"]');
      if (confirm('Вы уверены?')) {
        if (deleteAccount(state, btn.dataset.accountId)) {
          refresh(state, container, onUpdate);
        }
      }
    }
  });

  document.addEventListener('input', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    const form = event.target.closest('[data-form="transfer"]');
    if (!form || event.target.name !== 'amount') return;
    updateTransferFormUI(state, container, form.sourceAccountId.value);
  });

  document.addEventListener('change', (event) => {
    if (!isWithinAppUi(event.target, container)) return;
    const input = event.target.closest('[data-action="exchange-rate"]');
    if (input) {
      const error = validateExchangeRate(input.value);
      if (error) {
        alert(error);
        input.value = getExchangeRate(state);
        return;
      }

      state.exchangeRate = Number(input.value);
      if (typeof onUpdate === 'function') {
        onUpdate();
      }
      return;
    }

    const transferForm = event.target.closest('[data-form="transfer"]');
    if (transferForm && (event.target.name === 'destAccountId' || event.target.name === 'inputMode')) {
      updateTransferFormUI(state, container, transferForm.sourceAccountId.value);
    }
  });

  document.addEventListener('submit', async (event) => {
    const submitRoot = event.target.closest?.('form') ?? event.target;
    if (!isWithinAppUi(submitRoot, container)) return;
    event.preventDefault();

    const addForm = submitRoot.matches?.('[data-form="add-account"]')
      ? submitRoot
      : submitRoot.closest?.('[data-form="add-account"]');
    if (addForm) {
      console.log('🔥 ADD ACCOUNT SUBMIT HANDLER');

      const name = addForm.name.value;
      const currency = addForm.currency.value;
      const initialBalance = addForm.initialBalance.value;
      const comment = addForm.comment.value;

      const supabaseResult = await persistAccountToSupabase(name, currency, initialBalance);
      if (!supabaseResult.ok) {
        console.error('🔥 SUPABASE INSERT FAILED — continuing with local fallback:', supabaseResult.error);
      }

      if (createAccount(state, name, currency, initialBalance, comment)) {
        closeModal('add-account');
        addForm.reset();
        refresh(state, container, onUpdate);
      }
      return;
    }

    const editForm = event.target.closest('[data-form="edit-account"]');
    if (editForm) {
      const accountId = editForm.accountId.value;
      const name = editForm.name.value;
      const balance = editForm.balance.value;
      if (updateAccount(state, accountId, name, balance)) {
        closeModal('edit-account');
        refresh(state, container, onUpdate);
      }
      return;
    }

    const topUpForm = event.target.closest('[data-form="topup"]');
    if (topUpForm) {
      const accountId = topUpForm.accountId.value;
      const amount = topUpForm.amount.value;
      const comment = topUpForm.comment.value;
      const date = topUpForm.date.value;
      if (depositToAccount(state, accountId, amount, comment, date)) {
        closeModal('topup');
        topUpForm.reset();
        refresh(state, container, onUpdate);
      }
      return;
    }

    const transferForm = event.target.closest('[data-form="transfer"]');
    if (transferForm) {
      const sourceAccountId = transferForm.sourceAccountId.value;
      const destAccountId = transferForm.destAccountId.value;
      const amount = transferForm.amount.value;
      const inputMode = getTransferInputMode(transferForm);

      if (!destAccountId) {
        alert('Выберите счет-получатель');
        return;
      }

      if (transferBetweenAccounts(state, sourceAccountId, destAccountId, amount, inputMode)) {
        closeModal('transfer');
        transferForm.reset();
        refresh(state, container, onUpdate);
      }
    }
  });
}
