function getExchangeRate(state) {
  const rate = state.exchangeRate;
  return typeof rate === 'number' && rate > 0 ? rate : 1;
}

export function calculateTotalBalance(state) {
  const rate = getExchangeRate(state);

  return (state.accounts ?? []).reduce((sum, account) => {
    const balance = account.balance ?? 0;
    if (account.currency === 'USD') {
      return sum + balance * rate;
    }
    return sum + balance;
  }, 0);
}

export function calculateOwnerBalance(state, owner) {
  const rate = getExchangeRate(state);
  const ownerKey = owner === 'wife' ? 'wife' : 'husband';

  return (state.accounts ?? []).reduce((sum, account) => {
    if ((account.owner ?? 'husband') !== ownerKey) return sum;
    const balance = account.balance ?? 0;
    if (account.currency === 'USD') {
      return sum + balance * rate;
    }
    return sum + balance;
  }, 0);
}

export function calculateReservedBalance(state) {
  const categoriesTotal = (state.categories ?? []).reduce(
    (sum, category) => sum + (category.reserved ?? 0),
    0
  );

  const savingsTotal = (state.savings ?? []).reduce(
    (sum, saving) => sum + (saving.accumulated ?? saving.amount ?? 0),
    0
  );

  const debtsTotal = (state.debts ?? []).reduce((sum, debt) => {
    const isWeOwe = debt.direction === 'we_owe';
    const reserved = debt.reserved ?? 0;
    if (isWeOwe && reserved > 0) {
      return sum + reserved;
    }
    return sum;
  }, 0);

  const obligationsTotal = (state.obligations ?? []).reduce(
    (sum, obligation) => sum + (obligation.reserveAmount ?? 0),
    0
  );

  return categoriesTotal + savingsTotal + debtsTotal + obligationsTotal;
}

export function calculateFreeBalance(state) {
  return calculateTotalBalance(state) - calculateReservedBalance(state);
}

export function validateState(state) {
  const errors = [];

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
    if ((saving.accumulated ?? saving.amount ?? 0) < 0) {
      errors.push(`Копилка #${index + 1}: отрицательная сумма`);
    }
  });

  (state.debts ?? []).forEach((debt, index) => {
    if ((debt.reserved ?? 0) < 0) {
      errors.push(`Долг #${index + 1}: отрицательный резерв`);
    }
  });

  (state.obligations ?? []).forEach((obligation, index) => {
    if ((obligation.reserveAmount ?? 0) < 0) {
      errors.push(`Обязательство #${index + 1}: отрицательный резерв`);
    }
  });

  const totalBalance = calculateTotalBalance(state);
  const reservedBalance = calculateReservedBalance(state);

  if (reservedBalance > totalBalance) {
    errors.push('Зарезервированная сумма превышает общий баланс');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}
