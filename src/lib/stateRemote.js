import { supabase } from './supabase.js';
import { exportSharedSnapshot, applySharedSnapshot, mergeSharedSnapshots, getEmptySharedSnapshot, hardReplaceStateFromRemoteSnapshot } from '../modules/storage.js';
import {
  assertSnapshotReadTarget,
  assertSnapshotWriteTarget,
  getActiveSnapshotRow,
  getRealtimeChannelName,
  getSeedReadSnapshotRow,
  isExperimentEnvironment,
  validateEnvironmentIsolation
} from '../config/environmentConfig.js';

const PUSH_DELAY_MS = 400;

let pushTimer = null;
let applyingRemote = false;
let lastRemoteUpdatedAt = null;
let lastPushedAt = 0;
let initialSyncDone = false;
let experimentSeedAttempted = false;

export function markInitialSyncDone() {
  initialSyncDone = true;
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

async function fetchSnapshotRow(snapshotRowId, { seedBootstrap = false } = {}) {
  assertSnapshotReadTarget(snapshotRowId, { seedBootstrap });

  const { data, error } = await supabase
    .from('household_snapshots')
    .select('payload, updated_at')
    .eq('id', snapshotRowId)
    .maybeSingle();

  if (error) {
    console.error(`Failed to load snapshot "${snapshotRowId}" from Supabase:`, error);
    return { ok: false, error };
  }

  return { ok: true, data };
}

async function upsertSnapshotRow(snapshotRowId, payload) {
  assertSnapshotWriteTarget(snapshotRowId);

  const updatedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('household_snapshots')
    .upsert({
      id: snapshotRowId,
      payload,
      updated_at: updatedAt
    })
    .select('updated_at')
    .single();

  if (error) {
    console.error(`Failed to upsert snapshot "${snapshotRowId}" in Supabase:`, error);
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
  const activeSnapshotRow = getActiveSnapshotRow();

  if (!isExperimentEnvironment()) {
    return fetchSnapshotRow(activeSnapshotRow);
  }

  const experimentResult = await fetchSnapshotRow(activeSnapshotRow);
  if (!experimentResult.ok) {
    return experimentResult;
  }

  const experimentPayload = experimentResult.data?.payload;
  const needsSeed = isExperimentSnapshotUnderInitialized(experimentPayload);
  const seedReadSnapshotRow = getSeedReadSnapshotRow();

  if (!needsSeed || experimentSeedAttempted || !seedReadSnapshotRow) {
    return experimentResult;
  }

  experimentSeedAttempted = true;

  const productionResult = await fetchSnapshotRow(seedReadSnapshotRow, { seedBootstrap: true });
  if (!productionResult.ok || !canSeedExperimentFromProduction(productionResult.data?.payload)) {
    return experimentResult;
  }

  const seedPayload = cloneSnapshotPayload(productionResult.data.payload);
  const seedResult = await upsertSnapshotRow(activeSnapshotRow, seedPayload);
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
  const activeSnapshotRow = getActiveSnapshotRow();
  assertSnapshotWriteTarget(activeSnapshotRow);

  const payload = exportSharedSnapshot(state);
  const updatedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from('household_snapshots')
    .upsert({
      id: activeSnapshotRow,
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

export async function pullSharedStateInto(state) {
  const localBeforeFetch = exportSharedSnapshot(state);

  const snapshotResult = await resolveActiveSnapshotRow();
  if (!snapshotResult.ok) {
    return { ok: false, error: snapshotResult.error };
  }

  const data = snapshotResult.data;
  if (!data?.payload || !hasSharedData(data.payload)) {
    applyingRemote = true;
    hardReplaceStateFromRemoteSnapshot(state, getEmptySharedSnapshot());
    applyingRemote = false;
    lastRemoteUpdatedAt = data?.updated_at ?? null;
    return { ok: true, hasData: false };
  }

  if (
    !snapshotResult.seededFromProduction
    && lastRemoteUpdatedAt
    && data.updated_at === lastRemoteUpdatedAt
  ) {
    return { ok: true, hasData: true, skipped: true };
  }

  const localNow = exportSharedSnapshot(state);
  const preferLocalOnConflict = JSON.stringify(localBeforeFetch) !== JSON.stringify(localNow);

  applyingRemote = true;
  const mergedSnapshot = mergeSharedSnapshots(localNow, data.payload, { preferLocalOnConflict });
  applySharedSnapshot(state, mergedSnapshot);
  applyingRemote = false;
  lastRemoteUpdatedAt = data.updated_at;
  return {
    ok: true,
    hasData: true,
    updatedAt: data.updated_at,
    mergedLocalChanges: preferLocalOnConflict,
    seededFromProduction: snapshotResult.seededFromProduction === true
  };
}

export async function clearRemoteSharedState() {
  const activeSnapshotRow = getActiveSnapshotRow();
  assertSnapshotWriteTarget(activeSnapshotRow);

  const { error } = await supabase
    .from('household_snapshots')
    .upsert({
      id: activeSnapshotRow,
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
  const activeSnapshotRow = getActiveSnapshotRow();
  validateEnvironmentIsolation();

  const channel = supabase
    .channel(getRealtimeChannelName())
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'household_snapshots',
        filter: `id=eq.${activeSnapshotRow}`
      },
      async (payload) => {
        const rowId = payload.new?.id ?? payload.old?.id;
        if (rowId !== activeSnapshotRow) {
          return;
        }

        const updatedAt = payload.new?.updated_at;
        if (updatedAt && Date.now() - lastPushedAt < 1500) {
          return;
        }

        const result = await pullSharedStateInto(state);
        if (result.ok && !result.skipped) {
          onChange(result);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
