import './lib/supabase.js';

import {
  calculateTotalBalance,
  calculateReservedBalance,
  calculateFreeBalance
} from './modules/financeEngine.js';
import { renderAccounts, initAccountsHandlers } from './modules/accounts.js';
import { renderCategories, initCategoriesHandlers } from './modules/categories.js';
import { renderHistory, initHistoryHandlers } from './modules/history.js';
import { renderSavings, initSavingsHandlers } from './modules/savings.js';
import { renderDebts, initDebtsHandlers } from './modules/debts.js';
import { renderObligations, initObligationsHandlers } from './modules/obligations.js';
import { renderStats, initStatsHandlers } from './modules/stats.js';
import { reconcileLegacyTransactions } from './modules/transactions.js';
import { saveState, loadState, clearState, hardResetStateFromRemoteSnapshot } from './modules/storage.js';
import { relocateModals, closeAllModals } from './modules/modalLayer.js';
import { initDisplayModeSystem } from './modules/displayMode.js';
import { validateEnvironmentIsolation } from './config/environmentConfig.js';
import {
  fetchRemoteSharedSnapshot,
  subscribeSharedState,
  clearRemoteSharedState,
  markInitialSyncDone,
  getLastRemoteSnapshot
} from './lib/stateRemote.js';
import {
  validateNoStaleEntities,
  applyStatePatch,
  hasSharedStateData
} from './lib/stateAuthority.js';
import {
  flushOfflineQueue,
  initOfflineSyncQueue,
  loadOfflineQueue,
  clearOfflineQueue
} from './lib/offlineActionsQueue.js';

console.log('APP ENTRY LOADED');

const TAB_LABELS = {
  accounts: 'Счета',
  categories: 'Категории',
  history: 'История',
  obligations: 'Обязательства',
  savings: 'Копилки',
  debts: 'Долги',
  stats: 'Статистика'
};

const TAB_MESSAGES = {
  accounts: 'Вкладка Счета работает',
  categories: 'Вкладка Категории работает',
  history: 'Вкладка История работает',
  obligations: 'Вкладка Обязательства работает',
  savings: 'Вкладка Копилки работает',
  debts: 'Вкладка Долги работает',
  stats: 'Вкладка Статистика работает'
};

const PROFILE_LABELS = {
  husband: 'Муж',
  wife: 'Жена'
};

const state = {
  profile: 'husband',
  accounts: [],
  categories: [],
  transactions: [],
  obligations: [],
  savings: [],
  debts: [],
  exchangeRate: 92,
  totalBalance: 0,
  freeBalance: 0,
  reservedBalance: 0,
  activeTab: 'accounts'
};

let tabContent;
let totalBalanceEl;
let freeBalanceEl;
let reservedBalanceEl;

function formatMoney(amount) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0
  }).format(amount);
}

function renderProfile() {
  document.querySelectorAll('.profile-btn').forEach((btn) => {
    const isActive = btn.dataset.profile === state.profile;
    btn.classList.toggle('bg-primary-600', isActive);
    btn.classList.toggle('text-white', isActive);
    btn.classList.toggle('shadow-sm', isActive);
    btn.classList.toggle('bg-slate-100', !isActive);
    btn.classList.toggle('text-slate-600', !isActive);
    btn.classList.toggle('hover:bg-slate-200', !isActive);
  });
}

function updateCounters() {
  state.totalBalance = calculateTotalBalance(state);
  state.reservedBalance = calculateReservedBalance(state);
  state.freeBalance = calculateFreeBalance(state);

  if (totalBalanceEl) {
    totalBalanceEl.textContent = formatMoney(state.totalBalance);
  }
  if (freeBalanceEl) {
    freeBalanceEl.textContent = formatMoney(state.freeBalance);
  }
  if (reservedBalanceEl) {
    reservedBalanceEl.textContent = formatMoney(state.reservedBalance);
  }
}

function applyLoadedState(loaded) {
  state.profile = loaded.profile;
  state.accounts = loaded.accounts;
  state.categories = loaded.categories;
  state.transactions = loaded.transactions;
  state.obligations = loaded.obligations;
  state.savings = loaded.savings;
  state.debts = loaded.debts;
  state.exchangeRate = loaded.exchangeRate;
  state.activeTab = loaded.activeTab;
  reconcileLegacyTransactions(state);
}

function onStateChange() {
  updateCounters();
  saveState(state);
}

function resetAllData() {
  if (!confirm('Вы уверены? Все данные будут удалены без возможности восстановления.')) {
    return;
  }
  clearState();
  clearOfflineQueue();
  clearRemoteSharedState().finally(() => {
    location.reload();
  });
}

function finishTabRender() {
  closeAllModals();
  relocateModals(tabContent);
  syncHeaderHeight();
  onStateChange();
}

function renderTab(tab) {
  if (!tabContent || !TAB_MESSAGES[tab]) return;

  state.activeTab = tab;

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('bg-primary-100', isActive);
    btn.classList.toggle('text-primary-700', isActive);
    btn.classList.toggle('text-slate-600', !isActive);
    btn.classList.toggle('hover:bg-slate-100', !isActive);
  });

  if (tab === 'accounts') {
    renderAccounts(state, tabContent);
    initAccountsHandlers(state, tabContent, onStateChange, resetAllData);
    finishTabRender();
    return;
  }

  if (tab === 'categories') {
    renderCategories(state, tabContent);
    initCategoriesHandlers(state, tabContent, onStateChange);
    finishTabRender();
    return;
  }

  if (tab === 'history') {
    renderHistory(state, tabContent);
    initHistoryHandlers(state, tabContent, onStateChange);
    finishTabRender();
    return;
  }

  if (tab === 'savings') {
    renderSavings(state, tabContent);
    initSavingsHandlers(state, tabContent, onStateChange);
    finishTabRender();
    return;
  }

  if (tab === 'debts') {
    renderDebts(state, tabContent);
    initDebtsHandlers(state, tabContent, onStateChange, (nextTab) => renderTab(nextTab));
    finishTabRender();
    return;
  }

  if (tab === 'obligations') {
    renderObligations(state, tabContent);
    initObligationsHandlers(state, tabContent, onStateChange);
    finishTabRender();
    return;
  }

  if (tab === 'stats') {
    renderStats(state, tabContent);
    initStatsHandlers(state, tabContent, onStateChange);
    finishTabRender();
    return;
  }

  const label = TAB_LABELS[tab];
  tabContent.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <h2 class="text-lg font-semibold text-slate-900 mb-2">${label}</h2>
      <p class="text-slate-500">${TAB_MESSAGES[tab]}</p>
    </div>
  `;
  saveState(state);
}

const DISPLAY_MODE_TAB_MAP = {
  accounts: 'accounts',
  categories: 'categories',
  savings: 'savings',
  debts: 'debts',
  obligations: 'obligations'
};

function initDisplayModeRefresh() {
  document.addEventListener('joint-finance:display-mode-changed', (event) => {
    const moduleKey = event.detail?.moduleKey;
    const tab = DISPLAY_MODE_TAB_MAP[moduleKey];
    if (tab && state.activeTab === tab) {
      renderTab(tab);
    }
  });
}

function initProfileHandlers() {
  document.querySelectorAll('.profile-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.profile = btn.dataset.profile;
      renderProfile();
      renderTab(state.activeTab);
    });
  });
}

function initTabHandlers() {
  const tabNav = document.getElementById('tab-nav');
  if (!tabNav) return;

  tabNav.addEventListener('click', (event) => {
    const btn = event.target.closest('.tab-btn');
    if (!btn) return;
    renderTab(btn.dataset.tab);
  });
}

function syncHeaderHeight() {
  const header = document.getElementById('app-header');
  if (!header) return;
  const height = Math.ceil(header.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--header-height', `${height}px`);
}

function initHeaderHeightSync() {
  const header = document.getElementById('app-header');
  if (!header) return;

  syncHeaderHeight();

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      syncHeaderHeight();
    });
    observer.observe(header);
  }

  window.addEventListener('resize', syncHeaderHeight);
}

function refreshFromRemote() {
  updateCounters();
  renderTab(state.activeTab || 'accounts');
}

async function syncFromRemote() {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { ok: true, skipped: true, reason: 'offline' };
    }

    loadOfflineQueue();

    const priorRemoteSnapshot = getLastRemoteSnapshot();
    if (hasSharedStateData(state) && priorRemoteSnapshot) {
      const bootstrapPatch = validateNoStaleEntities(state, priorRemoteSnapshot);
      applyStatePatch(state, bootstrapPatch);
    }

    const flushResult = await flushOfflineQueue(state);
    if (!flushResult.ok && !flushResult.skipped) {
      return { ok: false, error: flushResult.error, reason: 'offline_queue_flush_failed' };
    }

    clearOfflineQueue();

    const fetchResult = await fetchRemoteSharedSnapshot();
    if (!fetchResult.ok) {
      return fetchResult;
    }

    const resetResult = await hardResetStateFromRemoteSnapshot(state, fetchResult.snapshot);
    if (!resetResult.ok) {
      return { ok: false, error: 'hard_reset_failed' };
    }

    const patch = validateNoStaleEntities(state, fetchResult.snapshot);
    applyStatePatch(state, patch);
    saveState(state, { skipRemote: true });
    markInitialSyncDone();

    console.log('[SYNC OK]', {
      accounts: state.accounts.length,
      categories: state.categories.length,
      debts: state.debts.length,
      obligations: state.obligations.length,
      savings: state.savings.length
    });

    refreshFromRemote();
    return { ok: true, snapshot: fetchResult.snapshot };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
}

async function init() {
  tabContent = document.getElementById('tab-content');
  totalBalanceEl = document.getElementById('total-balance');
  freeBalanceEl = document.getElementById('free-balance');
  reservedBalanceEl = document.getElementById('reserved-balance');

  if (!tabContent) return;

  try {
    validateEnvironmentIsolation();
    initDisplayModeSystem();
    initDisplayModeRefresh();
    applyLoadedState(loadState());
    reconcileLegacyTransactions(state);
    loadOfflineQueue();
    initOfflineSyncQueue(state, {
      onFlushed: async () => {
        await syncFromRemote();
      }
    });
    renderProfile();
    updateCounters();
    initProfileHandlers();
    initTabHandlers();
    initHeaderHeightSync();
    renderTab(state.activeTab || 'accounts');

    subscribeSharedState(state, async () => {
      await syncFromRemote();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      syncFromRemote();
    });

    syncFromRemote();
    console.log('[BOOT OK]', { build: '8b3ffb9', branch: 'experiment-full-sync' });
  } catch (error) {
    const bootError = document.getElementById('boot-error');
    if (bootError) {
      bootError.classList.remove('hidden');
      bootError.textContent = `Ошибка инициализации: ${error?.message ?? error}`;
    }
    console.error('[INIT FAILED]', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init();
  });
} else {
  init();
}
