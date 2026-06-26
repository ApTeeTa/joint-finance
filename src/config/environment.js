/**
 * Environment snapshot row id in household_snapshots.
 * Main branch MUST use 'shared'. Experiment branch uses 'shared-experiment'.
 */
export const SNAPSHOT_ID = 'shared-experiment';

export const IS_EXPERIMENT = SNAPSHOT_ID !== 'shared';
