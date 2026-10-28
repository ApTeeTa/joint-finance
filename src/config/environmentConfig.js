/**
 * Family Mode — single shared snapshot via Edge Functions (no Supabase Auth).
 */

export const FAMILY_SNAPSHOT_ID = 'family';

export const ENVIRONMENT_ISOLATION_RULE = Object.freeze({
  id: 'FAMILY_MODE',
  activeSnapshotId: FAMILY_SNAPSHOT_ID
});

/**
 * MUST be false for production family sync (Supabase Edge Functions).
 */
export const LOCAL_ONLY_TEST_MODE = false;

export function isLocalOnlyTestMode() {
  return LOCAL_ONLY_TEST_MODE === true;
}

const FINANCIAL_STORAGE_KEY = 'joint-finance-state-v2-family';

let validated = false;

export function validateEnvironmentIsolation() {
  validated = true;
  return { mode: 'family', activeSnapshotId: FAMILY_SNAPSHOT_ID };
}

export function getActiveSnapshotId() {
  validateEnvironmentIsolation();
  return FAMILY_SNAPSHOT_ID;
}

export function getFinancialStorageKey() {
  return FINANCIAL_STORAGE_KEY;
}

export function getLegacyProductionStorageKey() {
  return 'joint-finance-state-v2';
}

export function getLegacyMigrationDoneKey() {
  return `${FINANCIAL_STORAGE_KEY}-legacy-migration-done`;
}

export function allowsLegacyStorageKeyMigration() {
  return false;
}

export function getSeedReadSnapshotId() {
  return null;
}

/** @deprecated Family mode — always false (no legacy shared rows). */
export function requiresHouseholdSnapshot() {
  return false;
}

export function isHouseholdSnapshotId(snapshotId) {
  return snapshotId === FAMILY_SNAPSHOT_ID;
}

export function isExperiment() {
  return true;
}

export function isProduction() {
  return false;
}

export function assertSnapshotId(snapshotId, operation = 'read') {
  void operation;
  if (snapshotId !== FAMILY_SNAPSHOT_ID) {
    throw new Error(`[ENVIRONMENT] Invalid snapshot id "${snapshotId}" — expected "${FAMILY_SNAPSHOT_ID}"`);
  }
}

export function assertSnapshotWriteTarget(snapshotId) {
  assertSnapshotId(snapshotId, 'write');
}

export function assertSnapshotReadTarget(snapshotId) {
  assertSnapshotId(snapshotId, 'read');
}

/** No-op — household resolver removed in family mode. */
export function registerHouseholdSnapshotResolver() {}

export function getRealtimeChannelName() {
  throw new Error('[ENVIRONMENT] Realtime disabled in family mode');
}
