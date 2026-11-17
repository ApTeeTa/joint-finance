/*
BACKUP SNAPSHOT:
- UI Architecture: Phase 3 (DOM separation complete)
- Expanded: entity-only rendering, mode-agnostic
- Display Mode: collapsed-only system
- State: CARD_STATE controls expanded visibility
- Stable build checkpoint created for rollback
*/
import { UI } from './modules/uiTheme.js';

/** Local static servers may serve .css as octet-stream; inject so rules apply. */
async function ensureDesignStylesLoaded() {
  if (document.getElementById('jf-design-system-injected')) return;
  const link = document.querySelector('link[href*="jf-design-system"]');
  const href = link?.getAttribute('href');
  if (!href) return;
  try {
    const response = await fetch(href, { cache: 'no-store' });
    if (!response.ok) return;
    const cssText = await response.text();
    if (!cssText.includes(':root')) return;
    const style = document.createElement('style');
    style.id = 'jf-design-system-injected';
    style.textContent = cssText;
    document.head.appendChild(style);
  } catch {
    /* production CDN / Vercel serves text/css — link alone is enough */
  }
}

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
import {
  reconcileLegacyTransactions,
  refreshCategorySpentCachesForCurrentMonth
} from './modules/transactions.js';
import { saveState, loadState, clearState, hardResetStateFromRemoteSnapshot } from './modules/storage.js';
import {
  relocateModals,
  closeAllModals,
  isAnyModalOpen,
  getOpenModalNames,
  restoreOpenModalsFromSession
} from './modules/modalLayer.js';
import { initModalDraftSystem } from './modules/modalDraftStore.js';
import { isAnyModalSubmitting } from './modules/modalFormSubmit.js';
import { ensureDefaultIncomeCategories } from './modules/incomeCategories.js';
import { initDisplayModeSystem } from './modules/displayMode.js';
import {
  validateEnvironmentIsolation,
  isLocalOnlyTestMode,
  isExperimentDeployment
} from './config/environmentConfig.js';
import { restoreDemoSeedToStorage } from './modules/storage.js';
import {
  ensureFamilyAccess,
  initFamilyUnauthorizedListener,
  clearFamilySession,
  lockAppAndShowGate
} from './lib/familySession.js';
import {
  mountPurchasePlannerModal,
  initPurchasePlannerHandlers
} from './modules/purchasePlanner.js';
import { openAddSavingPrefilled } from './modules/savings.js';
import { getProfileLabel } from './lib/householdMemberLabels.js';
import {
  fetchRemoteSharedSnapshot,
  startFamilySyncPolling,
  clearRemoteSharedState,
  markInitialSyncDone,
  getLastRemoteSnapshot,
  resetSyncSession,
  FAMILY_SYNC_CONFLICT_EVENT
} from './lib/stateRemote.js';
import {
  shouldApplyRemoteSnapshot,
  getSyncStatusMessage
} from './lib/syncGuard.js';
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
  incomeCategories: [],
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
let lastSyncReason = null;
let stopSyncPolling = null;
let financialAppBooted = false;
let pendingRemoteUiRefresh = false;
let pendingRemoteSnapshotApply = null;
let lastAppliedRemoteUpdatedAt = null;

function shouldDeferRemoteMutationApply() {
  return isAnyModalOpen() || isAnyModalSubmitting();
}

async function applyPendingRemoteSnapshot() {
  if (!pendingRemoteSnapshotApply) {
    return;
  }
  const pending = pendingRemoteSnapshotApply;
  pendingRemoteSnapshotApply = null;

  const resetResult = await hardResetStateFromRemoteSnapshot(state, pending.snapshot);
  if (!resetResult.ok) {
    console.error('[SYNC] deferred apply failed');
    return;
  }

  const patch = validateNoStaleEntities(state, pending.snapshot);
  applyStatePatch(state, patch);
  ensureDefaultIncomeCategories(state);
  reconcileLegacyTransactions(state);
  refreshCategorySpentCachesForCurrentMonth(state);
  saveState(state, { skipRemote: true });
  initLastValidStateIfValid();
  if (pending.meta?.updatedAt) {
    lastAppliedRemoteUpdatedAt = pending.meta.updatedAt;
  }
}

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
    btn.classList.toggle('profile-btn-active', profileKey === state.profile);
    btn.classList.remove('profile-btn-own');
    btn.title = '';
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
  state.incomeCategories = loaded.incomeCategories ?? [];
  state.transactions = loaded.transactions;
  state.obligations = loaded.obligations;
  state.savings = loaded.savings;
  state.debts = loaded.debts;
  state.exchangeRate = loaded.exchangeRate;
  state.activeTab = loaded.activeTab;
  ensureDefaultIncomeCategories(state);
  reconcileLegacyTransactions(state);
  refreshCategorySpentCachesForCurrentMonth(state);
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
  if (isExperimentDeployment()) {
    location.reload();
    return;
  }
  clearRemoteSharedState().finally(() => {
    location.reload();
  });
}

function resetDemoData() {
  if (!confirm('Восстановить исходные демонстрационные данные? Текущие изменения будут заменены.')) {
    return;
  }
  try {
    restoreDemoSeedToStorage();
    location.reload();
  } catch (error) {
    alert(error?.message ?? 'Не удалось восстановить демоданные');
  }
}

function finishTabRender(options = {}) {
  const {
    preserveModals = false,
    persistActiveTab = true,
    preserveOpenNames = []
  } = options;
  if (!preserveModals) {
    closeAllModals();
  }
  relocateModals(tabContent, {
    preserveOpen: preserveModals,
    preserveOpenNames: preserveOpenNames.length ? preserveOpenNames : getOpenModalNames()
  });
  mountPurchasePlannerModal();
  syncHeaderHeight();
  updateCounters();
  if (persistActiveTab) {
    saveState(state, { skipRemote: true });
  }
}

function refreshUiAfterRemoteSync(meta = {}) {
  const remoteStamp = meta.updatedAt ?? null;
  if (remoteStamp && remoteStamp === lastAppliedRemoteUpdatedAt) {
    updateCounters();
    return;
  }
  if (remoteStamp) {
    lastAppliedRemoteUpdatedAt = remoteStamp;
  }

  if (shouldDeferRemoteMutationApply()) {
    pendingRemoteUiRefresh = true;
    updateCounters();
    return;
  }

  if (isAnyModalOpen()) {
    pendingRemoteUiRefresh = true;
    updateCounters();
    return;
  }

  renderTab(state.activeTab || 'accounts', { passiveSync: true });
}

function renderTab(tab, options = {}) {
  if (!tabContent || !TAB_MESSAGES[tab]) return;

  const passiveSync = options.passiveSync === true;
  const openBeforeRender = getOpenModalNames();
  const preserveModals = options.preserveModals === true
    || (passiveSync && openBeforeRender.length > 0);

  state.activeTab = tab;

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('tab-btn-active', btn.dataset.tab === tab);
  });

  if (tab === 'accounts') {
    renderAccounts(state, tabContent);
    initAccountsHandlers(state, tabContent, onStateChange, resetAllData, resetDemoData);
    finishTabRender({
      preserveModals,
      persistActiveTab: !passiveSync,
      preserveOpenNames: openBeforeRender
    });
    return;
  }

  if (tab === 'categories') {
    renderCategories(state, tabContent);
    initCategoriesHandlers(state, tabContent, onStateChange);
    finishTabRender({
      preserveModals,
      persistActiveTab: !passiveSync,
      preserveOpenNames: openBeforeRender
    });
    return;
  }

  if (tab === 'history') {
    renderHistory(state, tabContent);
    initHistoryHandlers(state, tabContent, onStateChange);
    finishTabRender({
      preserveModals,
      persistActiveTab: !passiveSync,
      preserveOpenNames: openBeforeRender
    });
    return;
  }

  if (tab === 'savings') {
    renderSavings(state, tabContent);
    initSavingsHandlers(state, tabContent, onStateChange);
    finishTabRender({
      preserveModals,
      persistActiveTab: !passiveSync,
      preserveOpenNames: openBeforeRender
    });
    return;
  }

  if (tab === 'debts') {
    renderDebts(state, tabContent);
    initDebtsHandlers(state, tabContent, onStateChange, (nextTab) => renderTab(nextTab));
    finishTabRender({
      preserveModals,
      persistActiveTab: !passiveSync,
      preserveOpenNames: openBeforeRender
    });
    return;
  }

  if (tab === 'obligations') {
    renderObligations(state, tabContent);
    initObligationsHandlers(state, tabContent, onStateChange);
    finishTabRender({
      preserveModals,
      persistActiveTab: !passiveSync,
      preserveOpenNames: openBeforeRender
    });
    return;
  }

  if (tab === 'stats') {
    renderStats(state, tabContent);
    initStatsHandlers(state, tabContent, onStateChange);
    finishTabRender({
      preserveModals,
      persistActiveTab: !passiveSync,
      preserveOpenNames: openBeforeRender
    });
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
      const profileKey = btn.dataset.profile;
      state.profile = profileKey;
      renderProfile();
      renderTab(state.activeTab);
    });
  });
}

function syncExperimentUiChrome() {
  const lockBtn = document.getElementById('family-lock-btn');
  if (lockBtn) {
    lockBtn.classList.toggle('hidden', isExperimentDeployment());
    lockBtn.setAttribute('aria-hidden', isExperimentDeployment() ? 'true' : 'false');
  }
}

function initFamilyLockHandlers() {
  if (isExperimentDeployment()) {
    syncExperimentUiChrome();
    return;
  }
  document.getElementById('family-lock-btn')?.addEventListener('click', () => {
    if (!confirm('Выйти / заблокировать приложение на этом устройстве? Потребуется семейный пароль.')) {
      return;
    }
    stopSyncPolling?.();
    stopSyncPolling = null;
    resetSyncSession();
    clearFamilySession();
    financialAppBooted = false;
    lockAppAndShowGate();
  });
}

function handleTabNavClick(event) {
  const btn = event.target.closest('.tab-btn[data-tab]');
  if (!btn?.dataset.tab) return;
  renderTab(btn.dataset.tab);
}

function initTabHandlers() {
  document.getElementById('tab-nav')?.addEventListener('click', handleTabNavClick);
  document.getElementById('tab-nav-mobile-dock')?.addEventListener('click', handleTabNavClick);

  document.addEventListener('joint-finance:navigate-tab', (event) => {
    const tab = event.detail?.tab;
    if (tab) {
      renderTab(tab);
    }
  });
}

function initVisualActionBusyGuard() {
  const skipActions = new Set([
    'family-unlock',
    'close-modal',
    'toggle-free-help',
    'dismiss-free-help',
    'exchange-rate',
    'navigate-tab'
  ]);

  document.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn || btn.disabled || btn.dataset.busy === 'true') return;
    const action = btn.dataset.action;
    if (!action || skipActions.has(action)) return;
    btn.dataset.busy = 'true';
    window.setTimeout(() => {
      delete btn.dataset.busy;
    }, 400);
  }, true);
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

function showSyncStatusBanner(message, tone = 'error', options = {}) {
  if (!message) {
    document.getElementById('sync-status')?.classList.add('hidden');
    return;
  }

  let el = document.getElementById('sync-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sync-status';
    el.setAttribute('role', 'alert');
    const anchor = document.getElementById('boot-error') ?? document.getElementById('app-shell');
    anchor?.parentNode?.insertBefore(el, anchor?.nextSibling ?? null);
  }

  el.className = tone === 'warning'
    ? 'max-w-5xl mx-auto px-5 py-2 mt-2 rounded-xl bg-amber-50 text-amber-900 text-sm border border-amber-300 text-center'
    : 'max-w-5xl mx-auto px-5 py-2 mt-2 rounded-xl bg-red-50 text-red-800 text-sm border border-red-200 text-center';
  el.classList.remove('hidden');
  el.replaceChildren();
  el.appendChild(document.createTextNode(message));
  if (typeof options.onRetry === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ml-2 underline font-medium';
    btn.textContent = 'Повторить';
    btn.addEventListener('click', () => options.onRetry());
    el.appendChild(btn);
  }
}

function showLocalTestModeBanner() {
  if (document.getElementById('local-test-banner')) {
    return;
  }

  const banner = document.createElement('div');
  banner.id = 'local-test-banner';
  banner.className = 'max-w-5xl mx-auto px-5 py-2 mt-2 rounded-xl bg-amber-50 text-amber-900 text-sm border border-amber-300 text-center';
  banner.textContent = 'ТЕСТОВЫЙ РЕЖИМ — используются демонстрационные данные. Синхронизация с Supabase отключена.';
  const main = document.getElementById('tab-content');
  main?.parentNode?.insertBefore(banner, main);
}

async function syncFromRemote() {
  try {
    if (isLocalOnlyTestMode()) {
      showSyncStatusBanner(null);
      return { ok: true, skipped: true, reason: 'local_only_test_mode' };
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      lastSyncReason = 'offline';
      showSyncStatusBanner(getSyncStatusMessage('offline'), 'warning');
      return { ok: true, skipped: true, reason: 'offline' };
    }

    loadOfflineQueue();

    const priorRemoteSnapshot = getLastRemoteSnapshot();
    if (hasSharedStateData(state) && priorRemoteSnapshot) {
      const bootstrapPatch = validateNoStaleEntities(state, priorRemoteSnapshot);
      applyStatePatch(state, bootstrapPatch);
    }

    const flushResult = await flushOfflineQueue(state);
    if (!flushResult.ok && !flushResult.skipped && !flushResult.conflict) {
      lastSyncReason = 'offline_queue_flush_failed';
      showSyncStatusBanner(getSyncStatusMessage('fetch_failed'), 'error', {
        onRetry: () => syncFromRemote()
      });
      return { ok: false, error: flushResult.error, reason: 'offline_queue_flush_failed' };
    }

    clearOfflineQueue();

    const fetchResult = await fetchRemoteSharedSnapshot();
    if (!fetchResult.ok) {
      lastSyncReason = fetchResult.reason ?? 'fetch_failed';
      showSyncStatusBanner(getSyncStatusMessage(lastSyncReason), 'error', {
        onRetry: () => syncFromRemote()
      });
      return fetchResult;
    }

    const applyDecision = shouldApplyRemoteSnapshot(state, fetchResult.meta ?? {});

    if (applyDecision.apply) {
      if (shouldDeferRemoteMutationApply()) {
        pendingRemoteSnapshotApply = {
          snapshot: fetchResult.snapshot,
          meta: fetchResult.meta ?? {}
        };
        pendingRemoteUiRefresh = true;
        markInitialSyncDone();
        lastSyncReason = `${applyDecision.reason}_deferred_modal`;
        showSyncStatusBanner(null);
      } else {
        const resetResult = await hardResetStateFromRemoteSnapshot(state, fetchResult.snapshot);
        if (!resetResult.ok) {
          lastSyncReason = 'hard_reset_failed';
          showSyncStatusBanner(getSyncStatusMessage('fetch_failed'));
          return { ok: false, error: 'hard_reset_failed' };
        }

        const patch = validateNoStaleEntities(state, fetchResult.snapshot);
        applyStatePatch(state, patch);
        ensureDefaultIncomeCategories(state);
        reconcileLegacyTransactions(state);
        refreshCategorySpentCachesForCurrentMonth(state);
        saveState(state, { skipRemote: true });
        markInitialSyncDone();
        initLastValidStateIfValid();
        lastSyncReason = applyDecision.reason;
        showSyncStatusBanner(null);
      }
    } else {
      reconcileLegacyTransactions(state);
      ensureDefaultIncomeCategories(state);
      saveState(state, { skipRemote: true });
      markInitialSyncDone();
      initLastValidStateIfValid();
      lastSyncReason = applyDecision.reason;
      showSyncStatusBanner(getSyncStatusMessage(applyDecision.reason), 'warning');
    }

    console.log('[SYNC OK]', {
      reason: lastSyncReason,
      accounts: state.accounts.length,
      categories: state.categories.length,
      debts: state.debts.length,
      obligations: state.obligations.length,
      savings: state.savings.length
    });

    refreshUiAfterRemoteSync(fetchResult.meta ?? {});
    return { ok: true, snapshot: fetchResult.snapshot, reason: lastSyncReason };
  } catch (error) {
    lastSyncReason = 'fetch_failed';
    showSyncStatusBanner(getSyncStatusMessage('fetch_failed'), 'error', {
      onRetry: () => syncFromRemote()
    });
    return { ok: false, error: error?.message ?? String(error) };
  }
}

async function bootFinancialApp() {
  if (financialAppBooted) {
    return;
  }
  financialAppBooted = true;

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

    stopSyncPolling?.();
    stopSyncPolling = startFamilySyncPolling(() => {
      syncFromRemote();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      void syncFromRemote();
    });

    window.addEventListener('pageshow', (event) => {
      if (!event.persisted) {
        return;
      }
      const open = getOpenModalNames();
      if (open.length > 0) {
        return;
      }
      restoreOpenModalsFromSession();
    });

    window.addEventListener('online', () => {
      syncFromRemote();
    });

    window.addEventListener(FAMILY_SYNC_CONFLICT_EVENT, () => {
      syncFromRemote();
    });

    initFamilyUnauthorizedListener(() => {
      resetSyncSession();
      financialAppBooted = false;
    });

  }

  renderProfile();
  syncExperimentUiChrome();
  updateCounters();
  initProfileHandlers();
  initFamilyLockHandlers();
  initTabHandlers();
  initVisualActionBusyGuard();
  initHeaderHeightSync();
  initModalDraftSystem();
  mountPurchasePlannerModal();
  initPurchasePlannerHandlers(state, {
    onSaveForPurchase: ({ name, targetAmount }) => {
      renderTab('savings');
      openAddSavingPrefilled(tabContent, { name, targetAmount });
    }
  });
  renderTab(state.activeTab || 'accounts');
  restoreOpenModalsFromSession();

  if (!isLocalOnlyTestMode()) {
    void syncFromRemote().then((syncResult) => {
      if (!syncResult.ok && !hasSharedStateData(state)) {
        const bootError = document.getElementById('boot-error');
        if (bootError) {
          bootError.classList.remove('hidden');
          bootError.textContent = getSyncStatusMessage(syncResult.reason ?? 'fetch_failed');
        }
      }
    });
  }

  document.addEventListener('joint-finance:modal-closed', async () => {
    if (shouldDeferRemoteMutationApply()) {
      return;
    }

    if (pendingRemoteSnapshotApply) {
      await applyPendingRemoteSnapshot();
    }

    if (!pendingRemoteUiRefresh) {
      return;
    }
    pendingRemoteUiRefresh = false;
    renderTab(state.activeTab || 'accounts', { passiveSync: true });
  });
  console.log('[BOOT OK]', {
    build: 'family-mode',
    snapshot: 'family'
  });
}

async function init() {
  await ensureDesignStylesLoaded();

  tabContent = document.getElementById('tab-content');
  totalBalanceEl = document.getElementById('total-balance');
  freeBalanceEl = document.getElementById('free-balance');
  reservedBalanceEl = document.getElementById('reserved-balance');

  if (!tabContent) return;

  try {
    validateEnvironmentIsolation();

    const access = await ensureFamilyAccess({
      onReady: async () => {
        await bootFinancialApp();
      }
    });

    if (access.ready) {
      await bootFinancialApp();
    }
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
