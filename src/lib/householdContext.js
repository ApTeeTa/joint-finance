import { getFinancialStorageKey, registerHouseholdSnapshotResolver } from '../config/environmentConfig.js';

const HOUSEHOLD_SNAPSHOT_PREFIX = 'household_';

let activeHousehold = null;

function storageKey() {
  return `${getFinancialStorageKey()}-active-household`;
}

export function isHouseholdSnapshotId(snapshotId) {
  return typeof snapshotId === 'string'
    && snapshotId.startsWith(HOUSEHOLD_SNAPSHOT_PREFIX)
    && snapshotId.length > HOUSEHOLD_SNAPSHOT_PREFIX.length;
}

export function buildHouseholdSnapshotId(householdUuid) {
  return `${HOUSEHOLD_SNAPSHOT_PREFIX}${householdUuid}`;
}

export function getActiveHousehold() {
  return activeHousehold;
}

export function getActiveHouseholdSnapshotId() {
  return activeHousehold?.snapshot_id ?? null;
}

/** Snapshot id for sync: household row when logged in, else null → env default. */
export function resolveSnapshotIdForSync(fallbackSnapshotId) {
  const householdSnapshotId = getActiveHouseholdSnapshotId();
  if (householdSnapshotId) {
    return householdSnapshotId;
  }
  return fallbackSnapshotId;
}

export function setActiveHousehold(household) {
  if (!household?.id || !household?.snapshot_id) {
    throw new Error('[HOUSEHOLD] Invalid household context');
  }
  activeHousehold = {
    id: household.id,
    snapshot_id: household.snapshot_id,
    name: household.name ?? 'My household',
    owner_user_id: household.owner_user_id,
    role: household.role ?? 'member',
    display_name: household.display_name ?? ''
  };
  try {
    localStorage.setItem(storageKey(), JSON.stringify(activeHousehold));
  } catch (error) {
    console.warn('[HOUSEHOLD] Failed to persist active household', error);
  }
}

export function loadPersistedHousehold() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.id || !parsed?.snapshot_id) return null;
    activeHousehold = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function clearActiveHousehold() {
  activeHousehold = null;
  try {
    localStorage.removeItem(storageKey());
  } catch {
    /* noop */
  }
}

registerHouseholdSnapshotResolver(() => getActiveHouseholdSnapshotId());
