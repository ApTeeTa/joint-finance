/**
 * Offline sync queue overlay — persists pending mutations until remote push succeeds.
 * Does not modify financeGate / mutationContract / uiRulesEngine.
 */
import { exportSharedSnapshot } from '../modules/storage.js';
import { ACTION_TYPES } from '../modules/actionRegistry.js';

export const OFFLINE_QUEUE_STORAGE_KEY = 'offline-actions-queue';

export const OFFLINE_ACTION_TYPES = Object.freeze({
  PUSH_SHARED_SNAPSHOT: 'PUSH_SHARED_SNAPSHOT',
  CREATE_ACCOUNT: 'CREATE_ACCOUNT',
  UPDATE_ACCOUNT: 'UPDATE_ACCOUNT',
  DELETE_ACCOUNT: 'DELETE_ACCOUNT',
  CREATE_CATEGORY: 'CREATE_CATEGORY',
  UPDATE_CATEGORY: 'UPDATE_CATEGORY',
  DELETE_CATEGORY: 'DELETE_CATEGORY',
  CREATE_SAVING: 'CREATE_SAVING',
  UPDATE_SAVING: 'UPDATE_SAVING',
  DELETE_SAVING: 'DELETE_SAVING',
  CREATE_OBLIGATION: 'CREATE_OBLIGATION',
  UPDATE_OBLIGATION: 'UPDATE_OBLIGATION',
  DELETE_OBLIGATION: 'DELETE_OBLIGATION',
  RATE_UPDATE: 'RATE_UPDATE'
});

const REGISTRY_TO_OFFLINE_TYPE = Object.freeze({
  [ACTION_TYPES.ACCOUNT_CREATE]: OFFLINE_ACTION_TYPES.CREATE_ACCOUNT,
  [ACTION_TYPES.ACCOUNT_UPDATE]: OFFLINE_ACTION_TYPES.UPDATE_ACCOUNT,
  [ACTION_TYPES.ACCOUNT_DELETE]: OFFLINE_ACTION_TYPES.DELETE_ACCOUNT,
  [ACTION_TYPES.CATEGORY_CREATE]: OFFLINE_ACTION_TYPES.CREATE_CATEGORY,
  [ACTION_TYPES.CATEGORY_UPDATE]: OFFLINE_ACTION_TYPES.UPDATE_CATEGORY,
  [ACTION_TYPES.CATEGORY_DELETE]: OFFLINE_ACTION_TYPES.DELETE_CATEGORY,
  [ACTION_TYPES.SAVING_CREATE]: OFFLINE_ACTION_TYPES.CREATE_SAVING,
  [ACTION_TYPES.SAVING_UPDATE]: OFFLINE_ACTION_TYPES.UPDATE_SAVING,
  [ACTION_TYPES.SAVING_DELETE]: OFFLINE_ACTION_TYPES.DELETE_SAVING,
  [ACTION_TYPES.OBLIGATION_CREATE]: OFFLINE_ACTION_TYPES.CREATE_OBLIGATION,
  [ACTION_TYPES.OBLIGATION_UPDATE]: OFFLINE_ACTION_TYPES.UPDATE_OBLIGATION,
  [ACTION_TYPES.OBLIGATION_DELETE]: OFFLINE_ACTION_TYPES.DELETE_OBLIGATION,
  [ACTION_TYPES.RATE_UPDATE]: OFFLINE_ACTION_TYPES.RATE_UPDATE
});

/** @type {Array<{ id: string, type: string, payload: object, timestamp: string }>} */
let offlineActionsQueue = [];
let flushing = false;

export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function createActionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function persistQueue() {
  try {
    localStorage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(offlineActionsQueue));
  } catch (error) {
    console.error('[offlineQueue] Failed to persist queue:', error);
  }
}

export function loadOfflineQueue() {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY);
    if (!raw) {
      offlineActionsQueue = [];
      return offlineActionsQueue;
    }
    const parsed = JSON.parse(raw);
    offlineActionsQueue = Array.isArray(parsed) ? parsed : [];
  } catch {
    offlineActionsQueue = [];
  }
  return offlineActionsQueue;
}

export function getOfflineActionsQueue() {
  return [...offlineActionsQueue];
}

export function hasPendingOfflineActions() {
  return offlineActionsQueue.length > 0;
}

export function mapRegistryTypeToOfflineType(registryType) {
  return REGISTRY_TO_OFFLINE_TYPE[registryType] ?? registryType;
}

export function serializeDispatchPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  const { state, ...rest } = payload;
  return JSON.parse(JSON.stringify(rest));
}

/**
 * @param {{ type: string, payload?: object, timestamp?: string, id?: string }} action
 */
export function enqueueOfflineAction(action) {
  loadOfflineQueue();

  const entry = {
    id: action.id ?? createActionId(),
    type: action.type,
    payload: action.payload ?? {},
    timestamp: action.timestamp ?? new Date().toISOString()
  };

  const last = offlineActionsQueue[offlineActionsQueue.length - 1];
  if (last?.type === OFFLINE_ACTION_TYPES.PUSH_SHARED_SNAPSHOT
    && entry.type === OFFLINE_ACTION_TYPES.PUSH_SHARED_SNAPSHOT) {
    offlineActionsQueue[offlineActionsQueue.length - 1] = entry;
  } else {
    offlineActionsQueue.push(entry);
  }

  persistQueue();
  return entry;
}

export function enqueueSnapshotPush(state) {
  return enqueueOfflineAction({
    type: OFFLINE_ACTION_TYPES.PUSH_SHARED_SNAPSHOT,
    payload: exportSharedSnapshot(state)
  });
}

export function enqueueRegistryAction(registryType, payload) {
  return enqueueOfflineAction({
    type: mapRegistryTypeToOfflineType(registryType),
    payload: serializeDispatchPayload(payload)
  });
}

function clearQueue() {
  offlineActionsQueue = [];
  try {
    localStorage.removeItem(OFFLINE_QUEUE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function clearOfflineQueue() {
  clearQueue();
}

/**
 * Flush queue: push current in-memory snapshot to remote.
 * Local mutations are already applied; queue records pending remote sync only.
 * Queue clears only after successful remote push.
 */
export async function flushOfflineQueue(state) {
  loadOfflineQueue();

  if (flushing || !hasPendingOfflineActions() || isOffline()) {
    return { ok: true, skipped: true };
  }

  flushing = true;

  try {
    const { pushSharedState } = await import('./stateRemote.js');
    const pushResult = await pushSharedState(state);
    if (!pushResult.ok) {
      return { ok: false, error: pushResult.error };
    }

    clearQueue();
    return { ok: true, flushed: true, updatedAt: pushResult.updatedAt };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  } finally {
    flushing = false;
  }
}

/**
 * Wire online listener + startup flush hook.
 * @param {object} state
 * @param {{ onFlushed?: (result: object) => void | Promise<void> }} [callbacks]
 */
export function initOfflineSyncQueue(state, callbacks = {}) {
  loadOfflineQueue();

  const handleOnline = async () => {
    const result = await flushOfflineQueue(state);
    if (result.flushed && typeof callbacks.onFlushed === 'function') {
      await callbacks.onFlushed(result);
    }
  };

  window.addEventListener('online', handleOnline);

  return () => {
    window.removeEventListener('online', handleOnline);
  };
}
