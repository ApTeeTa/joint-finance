/**
 * State authority enforcement — single source of truth rules.
 *
 * Priority (strict, no exceptions after successful remote sync):
 * 1. Supabase snapshot (when sync succeeds)
 * 2. in-memory state
 * 3. localStorage cache (bootstrap fallback only)
 * 4. legacy migration (one-time, then disabled)
 * 5. offline queue (before sync only, cleared after successful sync)
 *
 * After hardResetStateFromRemote(), only applyStatePatch() or financeGate user actions
 * may mutate shared state.
 */
import { getEmptySharedSnapshot, normalizeSharedSnapshot } from '../modules/storage.js';

export const STATE_AUTHORITY_PRIORITY = Object.freeze([
  'supabase_snapshot',
  'in_memory_state',
  'local_storage_cache',
  'legacy_migration_one_time',
  'offline_queue_pre_sync'
]);

export const STATE_AUTHORITY_RULE = Object.freeze({
  afterRemoteSync: Object.freeze({
    localStorageMustNotReintroduceStaleEntities: true,
    legacyMigrationNeverRunsAgain: true,
    offlineQueueClearedBeforePull: true,
    inMemoryReplacedNotMerged: true,
    mutationGateway: 'applyStatePatch'
  }),
  syncMode: 'full_replace',
  entityTruth: 'remote_snapshot_presence_only'
});

const SHARED_ENTITY_KEYS = Object.freeze([
  'accounts',
  'categories',
  'obligations',
  'savings',
  'debts'
]);

/**
 * @typedef {{ key: string, id: string|null, reason: string }} EntityPatch
 * @typedef {{ removals: EntityPatch[], orphans: EntityPatch[] }} StatePatch
 */

export function createEmptyStatePatch() {
  return {
    removals: [],
    orphans: []
  };
}

function collectEntityIdSets(snapshot) {
  const sets = {};
  for (const key of SHARED_ENTITY_KEYS) {
    sets[key] = new Set(
      (snapshot?.[key] ?? [])
        .map((entity) => entity?.id)
        .filter(Boolean)
    );
  }
  return sets;
}

function createPatchEntry(key, id, reason) {
  return { key, id, reason };
}

export function hasSharedStateData(state) {
  if (!state || typeof state !== 'object') {
    return false;
  }

  return SHARED_ENTITY_KEYS.some((key) => (state[key]?.length ?? 0) > 0)
    || (state.transactions?.length ?? 0) > 0;
}

/**
 * Pure validation — compares state to remote snapshot; never mutates state.
 * Entity validity is defined ONLY by presence in the remote snapshot.
 */
export function validateNoStaleEntities(state, remoteSnapshot) {
  const baseline = normalizeSharedSnapshot(remoteSnapshot ?? getEmptySharedSnapshot());
  const remoteIdSets = collectEntityIdSets(baseline);
  const removals = [];
  const orphans = [];

  for (const key of SHARED_ENTITY_KEYS) {
    for (const entity of state?.[key] ?? []) {
      if (!entity?.id) {
        removals.push(createPatchEntry(key, null, 'missing_id'));
        continue;
      }
      if (!remoteIdSets[key].has(entity.id)) {
        removals.push(createPatchEntry(key, entity.id, 'stale_not_in_remote'));
      }
    }
  }

  for (const tx of state?.transactions ?? []) {
    if (!tx?.id) {
      continue;
    }

    if (tx.accountId && !remoteIdSets.accounts.has(tx.accountId)) {
      orphans.push(createPatchEntry('transactions', tx.id, 'orphan_account'));
    }

    if (tx.categoryId && !remoteIdSets.categories.has(tx.categoryId)) {
      orphans.push(createPatchEntry('transactions', tx.id, 'orphan_category'));
    }
  }

  const result = {
    ok: removals.length === 0 && orphans.length === 0,
    removals,
    orphans
  };

  return result;
}

function removalIdsForKey(removals, key) {
  return new Set(
    removals
      .filter((entry) => entry.key === key && entry.id)
      .map((entry) => entry.id)
  );
}

/**
 * Sole mutation gateway for sync-time corrections after hardResetStateFromRemote().
 */
export function applyStatePatch(state, patch = createEmptyStatePatch()) {
  const removals = patch.removals ?? [];
  const orphans = patch.orphans ?? [];

  for (const key of SHARED_ENTITY_KEYS) {
    const idsToRemove = removalIdsForKey(removals, key);
    const dropMissingId = removals.some(
      (entry) => entry.key === key && entry.reason === 'missing_id'
    );

    state[key] = (state[key] ?? []).filter((entity) => {
      if (!entity?.id) {
        return !dropMissingId;
      }
      return !idsToRemove.has(entity.id);
    });
  }

  let appliedOrphans = 0;
  for (const orphan of orphans) {
    if (orphan.key !== 'transactions' || !orphan.id) {
      continue;
    }

    const tx = (state.transactions ?? []).find((item) => item.id === orphan.id);
    if (!tx) {
      continue;
    }

    if (orphan.reason === 'orphan_account' && tx.accountId) {
      tx.accountId = null;
      appliedOrphans += 1;
    }

    if (orphan.reason === 'orphan_category' && tx.categoryId) {
      tx.categoryId = null;
      appliedOrphans += 1;
    }
  }

  return {
    appliedRemovals: removals.length,
    appliedOrphans,
    appliedTotal: removals.length + appliedOrphans
  };
}
