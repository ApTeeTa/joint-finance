const STORAGE_KEY = 'joint-finance-state-v2';

const VALID_TABS = ['accounts', 'categories', 'history', 'obligations', 'savings', 'debts', 'stats'];

function getDefaultState() {
  return {
    profile: 'husband',
    accounts: [],
    categories: [],
    transactions: [],
    obligations: [],
    savings: [],
    debts: [],
    exchangeRate: 92,
    activeTab: 'accounts'
  };
}

function pickSharedFields(state) {
  return {
    accounts: Array.isArray(state.accounts) ? state.accounts : [],
    categories: Array.isArray(state.categories) ? state.categories : [],
    transactions: Array.isArray(state.transactions) ? state.transactions : [],
    obligations: Array.isArray(state.obligations) ? state.obligations : [],
    savings: Array.isArray(state.savings) ? state.savings : [],
    debts: Array.isArray(state.debts) ? state.debts : [],
    exchangeRate: typeof state.exchangeRate === 'number' ? state.exchangeRate : 92
  };
}

function pickPersistedFields(state) {
  return {
    profile: state.profile === 'wife' ? 'wife' : 'husband',
    ...pickSharedFields(state),
    activeTab: VALID_TABS.includes(state.activeTab) ? state.activeTab : 'accounts'
  };
}

export function exportSharedSnapshot(state) {
  return pickSharedFields(state);
}

export function applySharedSnapshot(state, snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return;
  }

  const merged = mergeWithDefaults({
    ...snapshot,
    profile: state.profile,
    activeTab: state.activeTab
  });

  state.accounts = merged.accounts;
  state.categories = merged.categories;
  state.transactions = merged.transactions;
  state.obligations = merged.obligations;
  state.savings = merged.savings;
  state.debts = merged.debts;
  state.exchangeRate = merged.exchangeRate;
}

function normalizeObligationRecord(obligation) {
  if (!obligation || typeof obligation !== 'object') {
    return obligation;
  }

  return {
    ...obligation,
    payments: Array.isArray(obligation.payments) ? obligation.payments : []
  };
}

function normalizeObligations(obligations) {
  return (obligations ?? []).map(normalizeObligationRecord);
}

function mergeWithDefaults(loaded) {
  const defaults = getDefaultState();
  if (!loaded || typeof loaded !== 'object') {
    return defaults;
  }

  return {
    profile: loaded.profile === 'wife' ? 'wife' : defaults.profile,
    accounts: Array.isArray(loaded.accounts) ? loaded.accounts : defaults.accounts,
    categories: Array.isArray(loaded.categories) ? loaded.categories : defaults.categories,
    transactions: Array.isArray(loaded.transactions) ? loaded.transactions : defaults.transactions,
    obligations: normalizeObligations(
      Array.isArray(loaded.obligations) ? loaded.obligations : defaults.obligations
    ),
    savings: Array.isArray(loaded.savings) ? loaded.savings : defaults.savings,
    debts: Array.isArray(loaded.debts) ? loaded.debts : defaults.debts,
    exchangeRate:
      typeof loaded.exchangeRate === 'number' && loaded.exchangeRate >= 1
        ? loaded.exchangeRate
        : defaults.exchangeRate,
    activeTab: loaded.activeTab === 'regulars'
      ? 'obligations'
      : (VALID_TABS.includes(loaded.activeTab) ? loaded.activeTab : defaults.activeTab)
  };
}

export function saveState(state, options = {}) {
  try {
    const payload = pickPersistedFields(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    if (!options.skipRemote) {
      import('../lib/stateRemote.js').then((remote) => {
        remote.schedulePushSharedState(state);
      });
    }
    return true;
  } catch {
    return false;
  }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getDefaultState();
    }
    return mergeWithDefaults(JSON.parse(raw));
  } catch {
    return getDefaultState();
  }
}

export function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
