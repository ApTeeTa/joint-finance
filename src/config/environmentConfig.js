/**
 * Environment Isolation — single configuration layer for deployment mode + snapshot ids.
 *
 * RULE: Snapshot row ids exist ONLY in SNAPSHOT_IDS below.
 * All runtime code must use getActiveSnapshotId(), isExperiment(), isProduction().
 */

const SNAPSHOT_IDS = Object.freeze({
  PRODUCTION: 'shared',
  EXPERIMENT: 'shared-experiment'
});

export const ENVIRONMENT_ISOLATION_RULE = Object.freeze({
  id: 'ENVIRONMENT_ISOLATION_RULE',
  singleSwitch: 'ACTIVE_ENVIRONMENT',
  modes: Object.freeze(['production', 'experiment']),
  productionSnapshotId: SNAPSHOT_IDS.PRODUCTION,
  experimentSnapshotId: SNAPSHOT_IDS.EXPERIMENT,
  invariants: Object.freeze({
    productionNeverUsesExperimentSnapshot: true,
    experimentNeverWritesProductionSnapshot: true,
    experimentSeedReadsProductionOnce: true
  })
});

/**
 * ONLY switch for deployment environment.
 * experiment-full-sync branch: 'experiment'
 * main branch: 'production'
 */
export const ACTIVE_ENVIRONMENT = 'experiment';

const MODE_REGISTRY = Object.freeze({
  production: Object.freeze({
    mode: 'production',
    activeSnapshotId: SNAPSHOT_IDS.PRODUCTION,
    seedReadSnapshotId: null,
    allowSeedFromProduction: false,
    allowLegacyStorageKeyMigration: false,
    financialStorageKey: 'joint-finance-state-v2'
  }),
  experiment: Object.freeze({
    mode: 'experiment',
    activeSnapshotId: SNAPSHOT_IDS.EXPERIMENT,
    seedReadSnapshotId: SNAPSHOT_IDS.PRODUCTION,
    allowSeedFromProduction: true,
    allowLegacyStorageKeyMigration: true,
    financialStorageKey: `joint-finance-state-v2-${SNAPSHOT_IDS.EXPERIMENT}`
  })
});

let validated = false;

function resolveConfig() {
  const config = MODE_REGISTRY[ACTIVE_ENVIRONMENT];
  if (!config) {
    throw new Error(
      `[ENVIRONMENT] Invalid ACTIVE_ENVIRONMENT "${ACTIVE_ENVIRONMENT}". `
      + `Expected one of: ${ENVIRONMENT_ISOLATION_RULE.modes.join(', ')}`
    );
  }
  return config;
}

function getSnapshotIds() {
  return {
    production: ENVIRONMENT_ISOLATION_RULE.productionSnapshotId,
    experiment: ENVIRONMENT_ISOLATION_RULE.experimentSnapshotId
  };
}

export function validateEnvironmentIsolation() {
  if (validated) {
    return resolveConfig();
  }

  const config = resolveConfig();
  const { production, experiment } = getSnapshotIds();

  if (config.mode === 'production') {
    if (config.activeSnapshotId !== production) {
      throw new Error('[ENVIRONMENT] Production mode must bind to production snapshot id only');
    }
    if (config.activeSnapshotId === experiment) {
      throw new Error('[ENVIRONMENT] Production mode cannot use experiment snapshot id');
    }
  }

  if (config.mode === 'experiment') {
    if (config.activeSnapshotId !== experiment) {
      throw new Error('[ENVIRONMENT] Experiment mode must bind to experiment snapshot id only');
    }
    if (config.activeSnapshotId === production) {
      throw new Error('[ENVIRONMENT] Experiment mode cannot use production snapshot as active id');
    }
  }

  validated = true;

  if (typeof console !== 'undefined' && config.mode === 'experiment') {
    console.info('[ENVIRONMENT]', {
      rule: ENVIRONMENT_ISOLATION_RULE.id,
      mode: config.mode,
      activeSnapshotId: config.activeSnapshotId,
      seedReadAllowed: config.allowSeedFromProduction
    });
  }

  return config;
}

/** Active Supabase household_snapshots row id for this deployment. */
export function getActiveSnapshotId() {
  return validateEnvironmentIsolation().activeSnapshotId;
}

export function getSeedReadSnapshotId() {
  const config = validateEnvironmentIsolation();
  return config.allowSeedFromProduction ? config.seedReadSnapshotId : null;
}

export function getFinancialStorageKey() {
  return validateEnvironmentIsolation().financialStorageKey;
}

export function getLegacyProductionStorageKey() {
  return MODE_REGISTRY.production.financialStorageKey;
}

export function allowsLegacyStorageKeyMigration() {
  return validateEnvironmentIsolation().allowLegacyStorageKeyMigration;
}

export function isExperiment() {
  return validateEnvironmentIsolation().mode === 'experiment';
}

export function isProduction() {
  return validateEnvironmentIsolation().mode === 'production';
}

export function getRealtimeChannelName() {
  return `joint-finance-shared-state-${getActiveSnapshotId()}`;
}

/**
 * Guard any snapshot id usage. Throws on cross-environment access.
 * @param {'read'|'write'} operation
 */
export function assertSnapshotId(snapshotId, operation = 'read', { seedBootstrap = false } = {}) {
  if (operation === 'write') {
    assertSnapshotWriteTarget(snapshotId);
    return;
  }
  assertSnapshotReadTarget(snapshotId, { seedBootstrap });
}

export function assertSnapshotWriteTarget(snapshotId) {
  const { production, experiment } = getSnapshotIds();
  validateEnvironmentIsolation();

  if (snapshotId === production && !isProduction()) {
    throw new Error('[ENVIRONMENT] Experiment deployment cannot write production snapshot id');
  }

  if (snapshotId === experiment && isProduction()) {
    throw new Error('[ENVIRONMENT] Production deployment cannot write experiment snapshot id');
  }

  if (snapshotId !== getActiveSnapshotId()) {
    throw new Error(`[ENVIRONMENT] Write target "${snapshotId}" is not the active snapshot id`);
  }
}

export function assertSnapshotReadTarget(snapshotId, { seedBootstrap = false } = {}) {
  const { production, experiment } = getSnapshotIds();
  validateEnvironmentIsolation();

  if (isProduction()) {
    if (snapshotId === experiment) {
      throw new Error('[ENVIRONMENT] Production deployment cannot read experiment snapshot id');
    }
    if (snapshotId !== production) {
      throw new Error(`[ENVIRONMENT] Production deployment cannot read snapshot id "${snapshotId}"`);
    }
    return;
  }

  if (snapshotId === getActiveSnapshotId()) {
    return;
  }

  if (seedBootstrap && snapshotId === production && getSeedReadSnapshotId() === production) {
    return;
  }

  if (snapshotId === production) {
    throw new Error('[ENVIRONMENT] Experiment cannot read production snapshot outside seed bootstrap');
  }

  throw new Error(`[ENVIRONMENT] Experiment deployment cannot read snapshot id "${snapshotId}"`);
}

/** @deprecated Use getActiveSnapshotId */
export function getActiveSnapshotRow() {
  return getActiveSnapshotId();
}

/** @deprecated Use isExperiment */
export function isExperimentEnvironment() {
  return isExperiment();
}

/** @deprecated Use isProduction */
export function isProductionEnvironment() {
  return isProduction();
}
