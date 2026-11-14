/**
 * Family Mode — single shared snapshot via Edge Functions (no Supabase Auth).
 * Experiment Vercel preview — isolated demo localStorage, no Supabase.
 */

export const FAMILY_SNAPSHOT_ID = 'family';

export const ENVIRONMENT_ISOLATION_RULE = Object.freeze({
  id: 'FAMILY_MODE',
  activeSnapshotId: FAMILY_SNAPSHOT_ID
});

const FINANCIAL_STORAGE_KEY_FAMILY = 'joint-finance-state-v2-family';
const FINANCIAL_STORAGE_KEY_EXPERIMENT = 'joint-finance-state-v2-experiment';

const PRODUCTION_HOST = 'joint-finance.vercel.app';

/**
 * Experiment preview on Vercel (branch experiment-full-sync).
 * Deliberately does not match beta / production hosts.
 */
export function matchesExperimentHost(hostname) {
  const host = String(hostname ?? '').toLowerCase();
  return host.includes('joint-finance-git-experiment-full-sync');
}

export function matchesBetaHost(hostname) {
  const host = String(hostname ?? '').toLowerCase();
  return host.includes('joint-finance-git-beta')
    || host.includes('joint-finance-git-family');
}

export function getDeploymentHostname() {
  if (typeof window === 'undefined' || !window.location?.hostname) {
    return '';
  }
  return window.location.hostname;
}

/** True only on Experiment Vercel preview — demo sandbox, no Supabase. */
export function isExperimentDeployment() {
  return matchesExperimentHost(getDeploymentHostname());
}

/**
 * UI / diagnostics experiment mode (same as isolated Experiment deployment).
 */
export function isExperiment() {
  return isExperimentDeployment();
}

export function isProduction() {
  return getDeploymentHostname() === PRODUCTION_HOST;
}

/**
 * Demo sandbox: localStorage only, no Edge Functions, no family gate.
 */
export function isLocalOnlyTestMode() {
  return isExperimentDeployment();
}

/**
 * @deprecated Constant ignored — use isLocalOnlyTestMode() (hostname-based).
 */
export const LOCAL_ONLY_TEST_MODE = false;

let validated = false;

export function validateEnvironmentIsolation() {
  validated = true;
  if (isExperimentDeployment()) {
    return { mode: 'experiment-demo', activeSnapshotId: null };
  }
  return { mode: 'family', activeSnapshotId: FAMILY_SNAPSHOT_ID };
}

export function getActiveSnapshotId() {
  validateEnvironmentIsolation();
  if (isExperimentDeployment()) {
    return null;
  }
  return FAMILY_SNAPSHOT_ID;
}

export function getFinancialStorageKey() {
  if (isExperimentDeployment()) {
    return FINANCIAL_STORAGE_KEY_EXPERIMENT;
  }
  return FINANCIAL_STORAGE_KEY_FAMILY;
}

export function getLegacyProductionStorageKey() {
  return 'joint-finance-state-v2';
}

export function getLegacyMigrationDoneKey() {
  const key = getFinancialStorageKey();
  return `${key}-legacy-migration-done`;
}

export function allowsLegacyStorageKeyMigration() {
  return false;
}

export function getSeedReadSnapshotId() {
  return null;
}

export function requiresHouseholdSnapshot() {
  return false;
}

export function isHouseholdSnapshotId(snapshotId) {
  return snapshotId === FAMILY_SNAPSHOT_ID;
}

export function assertSnapshotId(snapshotId, operation = 'read') {
  void operation;
  if (isExperimentDeployment()) {
    return;
  }
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

export function registerHouseholdSnapshotResolver() {}

export function getRealtimeChannelName() {
  throw new Error('[ENVIRONMENT] Realtime disabled in family mode');
}