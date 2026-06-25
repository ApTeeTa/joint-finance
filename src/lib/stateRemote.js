import { supabase } from './supabase.js';
import { exportSharedSnapshot, applySharedSnapshot, mergeSharedSnapshots } from '../modules/storage.js';

const SNAPSHOT_ID = 'shared';
const PUSH_DELAY_MS = 400;

let pushTimer = null;
let applyingRemote = false;
let lastRemoteUpdatedAt = null;
let lastPushedAt = 0;
let initialSyncDone = false;

export function markInitialSyncDone() {
  initialSyncDone = true;
}

function hasSharedData(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return false;
  }

  return ['accounts', 'categories', 'transactions', 'obligations', 'savings', 'debts'].some(
    (key) => Array.isArray(snapshot[key]) && snapshot[key].length > 0
  );
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

  const { data, error } = await supabase
    .from('household_snapshots')
    .select('payload, updated_at')
    .eq('id', SNAPSHOT_ID)
    .maybeSingle();

  if (error) {
    console.error('Failed to load shared state from Supabase:', error);
    return { ok: false, error };
  }

  if (!data?.payload || !hasSharedData(data.payload)) {
    return { ok: true, hasData: false };
  }

  if (lastRemoteUpdatedAt && data.updated_at === lastRemoteUpdatedAt) {
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
    mergedLocalChanges: preferLocalOnConflict
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
    .channel('joint-finance-shared-state')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'household_snapshots' },
      async (payload) => {
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
