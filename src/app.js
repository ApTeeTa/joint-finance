/*
BACKUP SNAPSHOT:
- UI Architecture: Phase 3 (DOM separation complete)
- Expanded: entity-only rendering, mode-agnostic
- Display Mode: collapsed-only system
- State: CARD_STATE controls expanded visibility
- Stable build checkpoint created for rollback
*/
import './lib/supabase.js';
import './lib/householdContext.js';
import { UI } from './modules/uiTheme.js';

import {
  calculateTotalBalance,
  calculateReservedBalance,
  calculateFreeBalance
} from './modules/financeEngine.js';
import { checkFinancialInvariants } from './modules/financeCoreInvariants.js';
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
import { validateEnvironmentIsolation, isLocalOnlyTestMode } from './config/environmentConfig.js';
import { ensureBetaAccess } from './modules/betaOnboarding.js';
import {
  initHouseholdInviteHandlers,
  mountInviteModal,
  updateInviteHeaderButton
} from './modules/householdInvite.js';
import {
  initHouseholdAccountHandlers,
  mountJoinHouseholdModal,
  mountEditDisplayNameModal,
  updateAccountHeaderButtons
} from './modules/householdAccount.js';
import { getCurrentUser } from './lib/authSession.js';
import {
  getProfileLabel,
  refreshHouseholdProfileLabels,
  findMemberByUserId,
  resolveProfileKeyForMember
} from './lib/householdMemberLabels.js';
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
let lastValidState = null;

const INVARIANT_ROLLBACK_ALERT = 'Операция отменена: свободный баланс не может быть отрицательным!';

function captureLastValidState() {
  return {
    accounts: structuredClone(state.accounts ?? []),
    categories: structuredClone(state.categories ?? []),
    transactions: structuredClone(state.transactions ?? []),
    savings: structuredClone(state.savings ?? []),
    obligations: structuredClone(state.obligations ?? []),
    debts: structuredClone(state.debts ?? []),
    exchangeRate: state.exchangeRate
  };
}

function restoreFromLastValidState() {
  if (!lastValidState) {
    return false;
  }

  state.accounts = structuredClone(lastValidState.accounts);
  state.categories = structuredClone(lastValidState.categories);
  state.transactions = structuredClone(lastValidState.transactions ?? []);
  state.savings = structuredClone(lastValidState.savings);
  state.obligations = structuredClone(lastValidState.obligations);
  state.debts = structuredClone(lastValidState.debts);
  state.exchangeRate = lastValidState.exchangeRate;
  return true;
}

function initLastValidStateIfValid() {
  const invariantResult = checkFinancialInvariants(state);
  if (invariantResult.ok) {
    lastValidState = captureLastValidState();
    return true;
  }

  console.warn('[INVARIANT GUARD] baseline not captured', invariantResult.errors);
  return false;
}

function formatMoney(amount) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0
  }).format(amount);
}

function renderProfile() {
  document.querySelectorAll('.profile-btn').forEach((btn) => {
    const profileKey = btn.dataset.profile;
    if (profileKey) {
      btn.textContent = getProfileLabel(profileKey);
    }
    btn.classList.toggle('profile-btn-active', btn.dataset.profile === state.profile);
  });
}

async function applyHouseholdProfileLabels() {
  await refreshHouseholdProfileLabels();

  if (!isLocalOnlyTestMode()) {
    const user = await getCurrentUser();
    const member = user?.id ? findMemberByUserId(user.id) : null;
    const profileKey = resolveProfileKeyForMember(member);
    if (profileKey) {
      state.profile = profileKey;
    }
  }

  renderProfile();
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
  const invariantResult = checkFinancialInvariants(state);

  if (!invariantResult.ok) {
    console.error('[INVARIANT GUARD] mutation rejected', invariantResult.errors);

    if (lastValidState) {
      restoreFromLastValidState();
      updateCounters();
      renderTab(state.activeTab || 'accounts');
    } else {
      updateCounters();
    }

    alert(INVARIANT_ROLLBACK_ALERT);
    return;
  }

  lastValidState = captureLastValidState();
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
    btn.classList.toggle('tab-btn-active', btn.dataset.tab === tab);
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
    <div class="${UI.panel} ${UI.panelPadding}">
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
  document.addEventListener('joint-finance:profile-labels-changed', () => {
    renderProfile();
  });

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

function showLocalTestModeBanner() {
  if (document.getElementById('local-test-banner')) {
    return;
  }

  const banner = document.createElement('div');
  banner.id = 'local-test-banner';
  banner.className = 'max-w-5xl mx-auto px-5 py-2 mt-2 rounded-xl bg-amber-50 text-amber-900 text-sm border border-amber-300 text-center';
  banner.textContent = 'Локальный тест: Supabase отключён, данные только в localStorage. Перед push на GitHub — LOCAL_ONLY_TEST_MODE = false в environmentConfig.js';
  const main = document.getElementById('tab-content');
  main?.parentNode?.insertBefore(banner, main);
}

async function syncFromRemote() {
  try {
    if (isLocalOnlyTestMode()) {
      return { ok: true, skipped: true, reason: 'local_only_test_mode' };
    }

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
    reconcileLegacyTransactions(state);
    saveState(state, { skipRemote: true });
    markInitialSyncDone();
    initLastValidStateIfValid();

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

async function bootFinancialApp() {
  initDisplayModeSystem();
  initDisplayModeRefresh();
  applyLoadedState(loadState());
  reconcileLegacyTransactions(state);
  initLastValidStateIfValid();

  if (isLocalOnlyTestMode()) {
    showLocalTestModeBanner();
    markInitialSyncDone();
    console.warn('[LOCAL TEST MODE] Supabase sync disabled — using localStorage only');
  } else {
    loadOfflineQueue();
    initOfflineSyncQueue(state, {
      onFlushed: async () => {
        await syncFromRemote();
      }
    });

    subscribeSharedState(state, async () => {
      await syncFromRemote();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      syncFromRemote();
    });

    await syncFromRemote();
  }

  await applyHouseholdProfileLabels();
  updateCounters();
  initProfileHandlers();
  initTabHandlers();
  initHeaderHeightSync();
  mountInviteModal();
  mountJoinHouseholdModal();
  mountEditDisplayNameModal();
  initHouseholdInviteHandlers();
  initHouseholdAccountHandlers();
  updateInviteHeaderButton();
  updateAccountHeaderButtons();
  renderTab(state.activeTab || 'accounts');
  console.log('[BOOT OK]', {
    build: 'beta-b3.1',
    branch: 'beta'
  });
}

async function init() {
  tabContent = document.getElementById('tab-content');
  totalBalanceEl = document.getElementById('total-balance');
  freeBalanceEl = document.getElementById('free-balance');
  reservedBalanceEl = document.getElementById('reserved-balance');

  if (!tabContent) return;

  try {
    validateEnvironmentIsolation();

    if (!isLocalOnlyTestMode()) {
      const access = await ensureBetaAccess({
        seedState: state,
        onReady: async () => {
          await bootFinancialApp();
        }
      });
      if (!access.ready) {
        return;
      }
    }

    await bootFinancialApp();
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
