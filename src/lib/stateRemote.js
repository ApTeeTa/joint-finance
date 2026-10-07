import { supabase } from './supabase.js';
import {
  exportSharedSnapshot,
  normalizeSharedSnapshot
} from '../modules/storage.js';
import {
  assertSnapshotId,
  getRealtimeChannelName,
  isHouseholdSnapshotId,
  isLocalOnlyTestMode,
  requiresHouseholdSnapshot,
  validateEnvironmentIsolation
} from '../config/environmentConfig.js';
import { getActiveHouseholdSnapshotId, resolveSnapshotIdForSync } from './householdContext.js';
import { hasSharedStateData } from './stateAuthority.js';
import { shouldAllowRemotePush } from './syncGuard.js';

function getSyncSnapshotId() {
  return resolveSnapshotIdForSync(null);
}

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

async function fetchSnapshotRow(snapshotId) {
  assertSnapshotId(snapshotId, 'read');

  const { data, error } = await supabase
    .from('household_snapshots')
    .select('payload, updated_at')
    .eq('id', snapshotId)
    .maybeSingle();

  if (error) {
    console.error(`Failed to load snapshot "${snapshotId}" from Supabase:`, error);
    return { ok: false, error };
  }

  return { ok: true, data };
}

async function resolveActiveSnapshotRow() {
  validateEnvironmentIsolation();
  const activeSnapshotId = getSyncSnapshotId();

  if (!activeSnapshotId) {
    return {
      ok: false,
      error: new Error('No active household snapshot'),
      reason: 'no_active_household'
    };
  }

  return fetchSnapshotRow(activeSnapshotId);
}

export function schedulePushSharedState(state) {
  if (isLocalOnlyTestMode() || applyingRemote || !initialSyncDone) {
    return;
  }

  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushSharedState(state);
  }, PUSH_DELAY_MS);
}

export async function pushSharedState(state) {
  if (isLocalOnlyTestMode()) {
    return { ok: true, skipped: true, reason: 'local_only_test_mode' };
  }

  const activeSnapshotId = getSyncSnapshotId();
  if (!activeSnapshotId) {
    return { ok: false, reason: 'no_active_household', error: new Error('No active household snapshot') };
  }

  const pushGuard = shouldAllowRemotePush(state, lastRemoteSnapshot);
  if (!pushGuard.allow) {
    console.error('[SYNC] Push blocked:', pushGuard.reason);
    return { ok: false, reason: pushGuard.reason, error: new Error(pushGuard.reason) };
  }

  assertSnapshotId(activeSnapshotId, 'write');

  const payload = exportSharedSnapshot(state);
  const updatedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from('household_snapshots')
    .upsert({
      id: activeSnapshotId,
      payload,
      updated_at: updatedAt
    })
    .select('updated_at')
    .single();

  if (error) {
    console.error('Failed to save shared state to Supabase:', error);
    return { ok: false, error };
  }

  lastRemoteUpdatedAt = data?.updated_at ?? updatedAt;
  lastRemoteSnapshot = cloneSnapshotPayload(payload);
  lastPushedAt = Date.now();
  return { ok: true, updatedAt: lastRemoteUpdatedAt };
}

export async function fetchRemoteSharedSnapshot() {
  if (isLocalOnlyTestMode()) {
    return { ok: true, skipped: true, reason: 'local_only_test_mode', snapshot: null };
  }

  const snapshotId = getSyncSnapshotId();
  if (!snapshotId) {
    return {
      ok: false,
      reason: 'no_active_household',
      error: new Error('No active household snapshot')
    };
  }

  const snapshotResult = await resolveActiveSnapshotRow();
  if (!snapshotResult.ok) {
    return {
      ok: false,
      error: snapshotResult.error,
      reason: snapshotResult.reason ?? 'fetch_failed'
    };
  }

  const data = snapshotResult.data;
  const rowExists = Boolean(data);
  const rawPayload = data?.payload ?? null;
  const hasData = hasSharedData(rawPayload);
  const normalized = normalizeSharedSnapshot(rawPayload ?? {});

  if (requiresHouseholdSnapshot() && isHouseholdSnapshotId(snapshotId) && !rowExists) {
    return {
      ok: false,
      reason: 'snapshot_row_missing',
      error: new Error(`Household snapshot row missing: ${snapshotId}`)
    };
  }

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

/** Fetch-only remote read — does not mutate in-memory state. */
export async function pullSharedStateInto(_state) {
  void _state;
  return fetchRemoteSharedSnapshot();
}

export async function clearRemoteSharedState() {
  const activeSnapshotId = getSyncSnapshotId();
  if (!activeSnapshotId) {
    return { ok: false, reason: 'no_active_household', error: new Error('No active household snapshot') };
  }

  assertSnapshotId(activeSnapshotId, 'write');

  const { error } = await supabase
    .from('household_snapshots')
    .upsert({
      id: activeSnapshotId,
      payload: exportSharedSnapshot({
        accounts: [],
        categories: [],
        transactions: [],
        obligations: [],
        savings: [],
        debts: [],
        exchangeRate: 92
      }),
      updated_at: new Date().toISOString()
    });

  if (error) {
    console.error('Failed to clear shared state in Supabase:', error);
    return { ok: false, error };
  }

  lastRemoteUpdatedAt = null;
  lastRemoteSnapshot = null;
  return { ok: true };
}

export function subscribeSharedState(state, onChange) {
  void state;
  if (isLocalOnlyTestMode()) {
    return () => {};
  }

  const activeSnapshotId = getActiveHouseholdSnapshotId();
  if (!activeSnapshotId) {
    console.warn('[SYNC] Realtime subscribe skipped: no active household');
    return () => {};
  }

  validateEnvironmentIsolation();

  const channel = supabase
    .channel(getRealtimeChannelName(activeSnapshotId))
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'household_snapshots',
        filter: `id=eq.${activeSnapshotId}`
      },
      async (payload) => {
        const rowId = payload.new?.id ?? payload.old?.id;
        if (rowId !== activeSnapshotId) {
          return;
        }
        onChange();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
