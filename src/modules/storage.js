import {
  getFinancialStorageKey,
  allowsLegacyStorageKeyMigration
} from '../config/environmentConfig.js';

const STORAGE_KEY = getFinancialStorageKey();
const LEGACY_PRODUCTION_STORAGE_KEY = 'joint-finance-state-v2';

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

export function getEmptySharedSnapshot() {
  return pickSharedFields(getDefaultState());
}

/** RULE 3: hard replace local shared fields — no merge when remote is empty. */
export function hardReplaceStateFromRemoteSnapshot(state, snapshot) {
  applySharedSnapshot(state, snapshot ?? getEmptySharedSnapshot());
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

function getRecordTimestamp(record) {
  if (!record || typeof record !== 'object') {
    return 0;
  }

  const raw = record.updatedAt || record.createdAt || record.date;
  const parsed = Date.parse(raw ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickRecordOnConflict(localRecord, remoteRecord, preferLocalOnConflict) {
  if (!remoteRecord) {
    return localRecord;
  }
  if (!localRecord) {
    return remoteRecord;
  }
  if (preferLocalOnConflict) {
    return localRecord;
  }

  return getRecordTimestamp(localRecord) >= getRecordTimestamp(remoteRecord)
    ? localRecord
    : remoteRecord;
}

function mergeEntityArrays(localItems, remoteItems, preferLocalOnConflict) {
  const byId = new Map();
  const remoteIds = new Set();

  (remoteItems ?? []).forEach((item) => {
    if (item?.id) {
      byId.set(item.id, item);
      remoteIds.add(item.id);
    }
  });

  (localItems ?? []).forEach((localItem) => {
    if (!localItem?.id) {
      return;
    }

    if (!remoteIds.has(localItem.id) && !preferLocalOnConflict) {
      return;
    }

    byId.set(
      localItem.id,
      pickRecordOnConflict(localItem, byId.get(localItem.id), preferLocalOnConflict)
    );
  });

  return Array.from(byId.values());
}

function mergeObligationRecords(localItems, remoteItems, preferLocalOnConflict) {
  const localById = new Map((localItems ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  const remoteById = new Map((remoteItems ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  const ids = new Set([...localById.keys(), ...remoteById.keys()]);

  return Array.from(ids).map((id) => {
    const localItem = localById.get(id);
    const remoteItem = remoteById.get(id);
    const winner = pickRecordOnConflict(localItem, remoteItem, preferLocalOnConflict);
    const other = winner === localItem ? remoteItem : localItem;

    return normalizeObligationRecord({
      ...(other ?? {}),
      ...winner,
      payments: mergeEntityArrays(
        localItem?.payments,
        remoteItem?.payments,
        preferLocalOnConflict
      )
    });
  });
}

function mergeTransactions(localItems, remoteItems, preferLocalOnConflict) {
  const merged = mergeEntityArrays(localItems, remoteItems, preferLocalOnConflict);

  return merged.sort((left, right) => {
    const leftTs = getRecordTimestamp(left);
    const rightTs = getRecordTimestamp(right);
    if (rightTs !== leftTs) {
      return rightTs - leftTs;
    }
    return String(right.id ?? '').localeCompare(String(left.id ?? ''));
  });
}

export function mergeSharedSnapshots(localSnapshot, remoteSnapshot, options = {}) {
  const preferLocalOnConflict = options.preferLocalOnConflict === true;
  const local = mergeWithDefaults(localSnapshot);
  const remote = mergeWithDefaults(remoteSnapshot);

  return {
    accounts: mergeEntityArrays(local.accounts, remote.accounts, preferLocalOnConflict),
    categories: mergeEntityArrays(local.categories, remote.categories, preferLocalOnConflict),
    transactions: mergeTransactions(local.transactions, remote.transactions, preferLocalOnConflict),
    obligations: mergeObligationRecords(local.obligations, remote.obligations, preferLocalOnConflict),
    savings: mergeEntityArrays(local.savings, remote.savings, preferLocalOnConflict),
    debts: mergeEntityArrays(local.debts, remote.debts, preferLocalOnConflict),
    exchangeRate: preferLocalOnConflict
      ? local.exchangeRate
      : (remote.exchangeRate ?? local.exchangeRate)
  };
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

function hasPersistedData(loaded) {
  if (!loaded || typeof loaded !== 'object') {
    return false;
  }

  return ['accounts', 'categories', 'transactions', 'obligations', 'savings', 'debts'].some(
    (key) => Array.isArray(loaded[key]) && loaded[key].length > 0
  );
}

export function loadState() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);

    if (!raw && allowsLegacyStorageKeyMigration()) {
      const legacyRaw = localStorage.getItem(LEGACY_PRODUCTION_STORAGE_KEY);
      if (legacyRaw) {
        try {
          const legacy = JSON.parse(legacyRaw);
          if (hasPersistedData(legacy)) {
            raw = legacyRaw;
            localStorage.setItem(STORAGE_KEY, legacyRaw);
          }
        } catch {
          // ignore invalid legacy cache
        }
      }
    }

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
