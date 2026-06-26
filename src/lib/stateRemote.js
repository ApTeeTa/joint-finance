import { supabase } from './supabase.js';
import { exportSharedSnapshot, applySharedSnapshot, mergeSharedSnapshots } from '../modules/storage.js';
import { SNAPSHOT_ID, SEED_SNAPSHOT_ID } from '../config/environment.js';

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

async function fetchSnapshotRow(snapshotId) {
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

async function resolveExperimentSnapshotRow() {
  if (SNAPSHOT_ID !== 'shared-experiment') {
    return fetchSnapshotRow(SNAPSHOT_ID);
  }

  const experimentResult = await fetchSnapshotRow(SNAPSHOT_ID);
  if (!experimentResult.ok) {
    return experimentResult;
  }

  const experimentPayload = experimentResult.data?.payload;
  const needsSeed = isExperimentSnapshotUnderInitialized(experimentPayload);

  if (!needsSeed || experimentSeedAttempted) {
    return experimentResult;
  }

  experimentSeedAttempted = true;

  const productionResult = await fetchSnapshotRow(SEED_SNAPSHOT_ID);
  if (!productionResult.ok || !canSeedExperimentFromProduction(productionResult.data?.payload)) {
    return experimentResult;
  }

  const seedPayload = cloneSnapshotPayload(productionResult.data.payload);
  const seedResult = await upsertSnapshotRow(SNAPSHOT_ID, seedPayload);
  if (!seedResult.ok) {
    return experimentResult;
  }

  console.info('Seeded shared-experiment snapshot from shared (read-only copy).');
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
  const payload = exportSharedSnapshot(state);
  const updatedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from('household_snapshots')
    .upsert({
      id: SNAPSHOT_ID,
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

  const snapshotResult = await resolveExperimentSnapshotRow();
  if (!snapshotResult.ok) {
    return { ok: false, error: snapshotResult.error };
  }

  const data = snapshotResult.data;
  if (!data?.payload || !hasSharedData(data.payload)) {
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
  const { error } = await supabase
    .from('household_snapshots')
    .upsert({
      id: SNAPSHOT_ID,
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
  const channel = supabase
    .channel(`joint-finance-shared-state-${SNAPSHOT_ID}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'household_snapshots',
        filter: `id=eq.${SNAPSHOT_ID}`
      },
      async (payload) => {
        const rowId = payload.new?.id ?? payload.old?.id;
        if (rowId !== SNAPSHOT_ID) {
          return;
        }

        const updatedAt = payload.new?.updated_at;
        if (updatedAt && Date.now() - lastPushedAt < 1500) {
          return;
        }

        const result = await pullSharedStateInto(state);
        if (result.ok && result.hasData && !result.skipped) {
          onChange();
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
