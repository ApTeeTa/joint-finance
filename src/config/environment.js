/**
 * Environment snapshot row id in household_snapshots.
 * Main branch MUST use 'shared'. Experiment branch uses 'shared-experiment'.
 */
export const SNAPSHOT_ID = 'shared-experiment';

/** Read-only source for one-time experiment bootstrap. Never written by experiment code. */
export const SEED_SNAPSHOT_ID = 'shared';

export const IS_EXPERIMENT = SNAPSHOT_ID !== 'shared';
