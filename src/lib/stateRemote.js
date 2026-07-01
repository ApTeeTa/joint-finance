import { supabase } from './supabase.js';
import {
  exportSharedSnapshot,
  getEmptySharedSnapshot,
  normalizeSharedSnapshot
} from '../modules/storage.js';
import {
  assertSnapshotId,
  getActiveSnapshotId,
  getRealtimeChannelName,
  getSeedReadSnapshotId,
  isExperiment,
  validateEnvironmentIsolation
} from '../config/environmentConfig.js';

const PUSH_DELAY_MS = 400;

let pushTimer = null;
let applyingRemote = false;
let lastRemoteUpdatedAt = null;
let lastRemoteSnapshot = null;
let lastPushedAt = 0;
let initialSyncDone = false;
let experimentSeedAttempted = false;

export function markInitialSyncDone() {
  initialSyncDone = true;
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
  if (!snapshot || typeof snapshot !== 'object') {
    return false;
  }

  return ['accounts', 'categories', 'transactions', 'obligations', 'savings', 'debts'].some(
    (key) => Array.isArray(snapshot[key]) && snapshot[key].length > 0
  );
}

function isExperimentSnapshotUnderInitialized(payload) {
  if (!payload || typeof payload !== 'object') {
    return true;
  }

  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  return accounts.length === 0;
}

function canSeedExperimentFromProduction(payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  return accounts.length > 0;
}

async function fetchSnapshotRow(snapshotId, { seedBootstrap = false } = {}) {
  assertSnapshotId(snapshotId, 'read', { seedBootstrap });

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

async function upsertSnapshotRow(snapshotId, payload) {
  assertSnapshotId(snapshotId, 'write');

  const updatedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('household_snapshots')
    .upsert({
      id: snapshotId,
      payload,
      updated_at: updatedAt
    })
    .select('updated_at')
    .single();

  if (error) {
    console.error(`Failed to upsert snapshot "${snapshotId}" in Supabase:`, error);
    return { ok: false, error };
  }

  return {
    ok: true,
    data: {
      payload,
      updated_at: data?.updated_at ?? updatedAt
    }
  };
}

async function resolveActiveSnapshotRow() {
  validateEnvironmentIsolation();
  const activeSnapshotId = getActiveSnapshotId();

  if (!isExperiment()) {
    return fetchSnapshotRow(activeSnapshotId);
  }

  const experimentResult = await fetchSnapshotRow(activeSnapshotId);
  if (!experimentResult.ok) {
    return experimentResult;
  }

  const experimentPayload = experimentResult.data?.payload;
  const needsSeed = isExperimentSnapshotUnderInitialized(experimentPayload);
  const seedReadSnapshotId = getSeedReadSnapshotId();

  if (!needsSeed || experimentSeedAttempted || !seedReadSnapshotId) {
    return experimentResult;
  }

  experimentSeedAttempted = true;

  const productionResult = await fetchSnapshotRow(seedReadSnapshotId, { seedBootstrap: true });
  if (!productionResult.ok || !canSeedExperimentFromProduction(productionResult.data?.payload)) {
    return experimentResult;
  }

  const seedPayload = cloneSnapshotPayload(productionResult.data.payload);
  const seedResult = await upsertSnapshotRow(activeSnapshotId, seedPayload);
  if (!seedResult.ok) {
    return experimentResult;
  }

  console.info('[ENVIRONMENT] Seeded experiment snapshot from production (one-time read-only bootstrap).');
  return { ok: true, data: seedResult.data, seededFromProduction: true };
}

export function schedulePushSharedState(state) {
  if (applyingRemote || !initialSyncDone) {
    return;
  }

  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushSharedState(state);
  }, PUSH_DELAY_MS);
}

export async function pushSharedState(state) {
  const activeSnapshotId = getActiveSnapshotId();
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
  lastPushedAt = Date.now();
  return { ok: true, updatedAt: lastRemoteUpdatedAt };
}

export async function fetchRemoteSharedSnapshot() {
  const snapshotResult = await resolveActiveSnapshotRow();
  if (!snapshotResult.ok) {
    return { ok: false, error: snapshotResult.error };
  }

  const data = snapshotResult.data;
  const payload = data?.payload && hasSharedData(data.payload)
    ? data.payload
    : getEmptySharedSnapshot();
  const normalized = normalizeSharedSnapshot(payload);

  lastRemoteSnapshot = normalized;
  lastRemoteUpdatedAt = data?.updated_at ?? null;

  return {
    ok: true,
    snapshot: normalized
  };
}

/** Fetch-only remote read — does not mutate in-memory state. */
export async function pullSharedStateInto(_state) {
  void _state;
  return fetchRemoteSharedSnapshot();
}

export async function clearRemoteSharedState() {
  const activeSnapshotId = getActiveSnapshotId();
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
  return { ok: true };
}

export function subscribeSharedState(state, onChange) {
  const activeSnapshotId = getActiveSnapshotId();
  validateEnvironmentIsolation();

  const channel = supabase
    .channel(getRealtimeChannelName())
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
