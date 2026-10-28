import {
  exportSharedSnapshot,
  normalizeSharedSnapshot
} from '../modules/storage.js';
import {
  assertSnapshotId,
  getActiveSnapshotId,
  isLocalOnlyTestMode,
  validateEnvironmentIsolation
} from '../config/environmentConfig.js';
import { hasSharedStateData } from './stateAuthority.js';
import { shouldAllowRemotePush } from './syncGuard.js';
import { getFamilySnapshot, putFamilySnapshot } from './familySnapshotApi.js';
import {
  notifyUnauthorized,
  requireAccessToken
} from './familySession.js';

export const FAMILY_SYNC_CONFLICT_EVENT = 'joint-finance:family-sync-conflict';

const PUSH_DELAY_MS = 400;

let pushTimer = null;
let applyingRemote = false;
let lastRemoteUpdatedAt = null;
let lastRemoteSnapshot = null;
let lastPushedAt = 0;
let initialSyncDone = false;

export function markInitialSyncDone() {
  initialSyncDone = true;
}

export function resetSyncSession() {
  initialSyncDone = false;
  applyingRemote = false;
  lastRemoteUpdatedAt = null;
  lastRemoteSnapshot = null;
  lastPushedAt = 0;
  clearTimeout(pushTimer);
  pushTimer = null;
}

export function isInitialSyncDone() {
  return initialSyncDone;
}

export function getLastRemoteUpdatedAt() {
  return lastRemoteUpdatedAt;
}

export function getLastRemoteSnapshot() {
  return lastRemoteSnapshot ? cloneSnapshotPayload(lastRemoteSnapshot) : null;
}

function cloneSnapshotPayload(payload) {
  return JSON.parse(JSON.stringify(payload));
}

function hasSharedData(snapshot) {
  return hasSharedStateData(snapshot);
}

function getSyncSnapshotId() {
  validateEnvironmentIsolation();
  return getActiveSnapshotId();
}

function handleHttpAuthFailure(status) {
  if (status === 401) {
    notifyUnauthorized();
  }
}

async function fetchSnapshotRow(snapshotId) {
  assertSnapshotId(snapshotId, 'read');

  const tokenResult = requireAccessToken();
  if (!tokenResult.ok) {
    return { ok: false, error: tokenResult.error, reason: 'no_family_token' };
  }

  const { response, data } = await getFamilySnapshot(tokenResult.token);
  handleHttpAuthFailure(response.status);

  if (response.status === 401) {
    return { ok: false, error: new Error('unauthorized'), reason: 'unauthorized' };
  }

  if (!response.ok || !data?.ok) {
    console.error('[SYNC] GET family-snapshot failed', response.status, data);
    return { ok: false, error: new Error('fetch_failed') };
  }

  return {
    ok: true,
    data: {
      payload: data.payload,
      updated_at: data.updated_at
    },
    rowExists: data.row_exists !== false && data.updated_at != null
  };
}

export function schedulePushSharedState(state) {
  if (isLocalOnlyTestMode() || applyingRemote || !initialSyncDone) {
    return;
  }

  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const result = await pushSharedState(state);
    if (result?.conflict && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FAMILY_SYNC_CONFLICT_EVENT));
    }
  }, PUSH_DELAY_MS);
}

export async function pushSharedState(state) {
  if (isLocalOnlyTestMode()) {
    return { ok: true, skipped: true, reason: 'local_only_test_mode' };
  }

  const activeSnapshotId = getSyncSnapshotId();
  const tokenResult = requireAccessToken();
  if (!tokenResult.ok) {
    return { ok: false, reason: 'no_family_token', error: tokenResult.error };
  }

  const pushGuard = shouldAllowRemotePush(state, lastRemoteSnapshot);
  if (!pushGuard.allow) {
    console.error('[SYNC] Push blocked:', pushGuard.reason);
    return { ok: false, reason: pushGuard.reason, error: new Error(pushGuard.reason) };
  }

  assertSnapshotId(activeSnapshotId, 'write');

  const payload = exportSharedSnapshot(state);
  const { response, data } = await putFamilySnapshot(tokenResult.token, {
    payload,
    expectedUpdatedAt: lastRemoteUpdatedAt
  });

  handleHttpAuthFailure(response.status);

  if (response.status === 401) {
    return { ok: false, reason: 'unauthorized', error: new Error('unauthorized') };
  }

  if (response.status === 409 && data?.current) {
    const normalized = normalizeSharedSnapshot(data.current.payload ?? {});
    lastRemoteSnapshot = hasSharedData(normalized)
      ? cloneSnapshotPayload(normalized)
      : null;
    lastRemoteUpdatedAt = data.current.updated_at ?? null;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FAMILY_SYNC_CONFLICT_EVENT));
    }
    return {
      ok: false,
      reason: 'conflict',
      error: new Error('conflict'),
      conflict: true,
      currentSnapshot: normalized,
      currentUpdatedAt: data.current.updated_at ?? null
    };
  }

  if (!response.ok || !data?.ok) {
    console.error('[SYNC] PUT family-snapshot failed', response.status, data);
    return { ok: false, error: new Error('push_failed') };
  }

  lastRemoteUpdatedAt = data.updated_at ?? new Date().toISOString();
  lastRemoteSnapshot = cloneSnapshotPayload(payload);
  lastPushedAt = Date.now();
  return { ok: true, updatedAt: lastRemoteUpdatedAt };
}

export async function fetchRemoteSharedSnapshot() {
  if (isLocalOnlyTestMode()) {
    return { ok: true, skipped: true, reason: 'local_only_test_mode', snapshot: null };
  }

  const snapshotId = getSyncSnapshotId();
  const snapshotResult = await fetchSnapshotRow(snapshotId);

  if (!snapshotResult.ok) {
    return {
      ok: false,
      error: snapshotResult.error,
      reason: snapshotResult.reason ?? 'fetch_failed'
    };
  }

  const data = snapshotResult.data;
  const rowExists = snapshotResult.rowExists;
  const rawPayload = data?.payload ?? null;
  const hasData = hasSharedData(rawPayload);
  const normalized = normalizeSharedSnapshot(rawPayload ?? {});

  lastRemoteSnapshot = hasData ? cloneSnapshotPayload(normalized) : null;
  lastRemoteUpdatedAt = data?.updated_at ?? null;

  return {
    ok: true,
    snapshot: normalized,
    meta: {
      snapshotId,
      rowExists,
      hasData,
      updatedAt: data?.updated_at ?? null
    }
  };
}

export async function pullSharedStateInto(_state) {
  void _state;
  return fetchRemoteSharedSnapshot();
}

export async function clearRemoteSharedState() {
  if (isLocalOnlyTestMode()) {
    return { ok: true, skipped: true };
  }

  const activeSnapshotId = getSyncSnapshotId();
  assertSnapshotId(activeSnapshotId, 'write');

  const emptyPayload = exportSharedSnapshot({
    accounts: [],
    categories: [],
    transactions: [],
    obligations: [],
    savings: [],
    debts: [],
    exchangeRate: 92
  });

  const tokenResult = requireAccessToken();
  if (!tokenResult.ok) {
    return { ok: false, reason: 'no_family_token', error: tokenResult.error };
  }

  const { response, data } = await putFamilySnapshot(tokenResult.token, {
    payload: emptyPayload,
    expectedUpdatedAt: lastRemoteUpdatedAt
  });

  handleHttpAuthFailure(response.status);

  if (!response.ok || !data?.ok) {
    console.error('[SYNC] clear remote failed', response.status);
    return { ok: false, error: new Error('clear_failed') };
  }

  lastRemoteUpdatedAt = null;
  lastRemoteSnapshot = null;
  return { ok: true };
}

/** Realtime disabled — use polling via startFamilySyncPolling in app.js */
export function subscribeSharedState(_state, _onChange) {
  void _state;
  void _onChange;
  return () => {};
}

const POLL_INTERVAL_MS = 50_000;

export function startFamilySyncPolling(onPoll) {
  if (isLocalOnlyTestMode()) {
    return () => {};
  }

  let timer = null;

  const tick = () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }
    onPoll();
  };

  timer = setInterval(tick, POLL_INTERVAL_MS);

  return () => {
    if (timer) {
      clearInterval(timer);
    }
  };
}
