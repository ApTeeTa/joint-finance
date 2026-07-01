/**
 * Environment Isolation — single switch for deployment mode.
 *
 * RULE: Only this file defines snapshot row ids and maps them to environments.
 * Sync modules (stateRemote, storage) resolve targets via exported getters.
 * Feature modules MUST NOT import snapshot row ids.
 */

export const ENVIRONMENT_ISOLATION_RULE = Object.freeze({
  id: 'ENVIRONMENT_ISOLATION_RULE',
  singleSwitch: 'ACTIVE_ENVIRONMENT',
  modes: Object.freeze(['production', 'experiment']),
  productionSnapshotRow: 'shared',
  experimentSnapshotRow: 'shared-experiment',
  invariants: Object.freeze({
    productionNeverUsesExperimentRow: true,
    experimentNeverWritesProductionRow: true,
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
    activeSnapshotRow: ENVIRONMENT_ISOLATION_RULE.productionSnapshotRow,
    seedReadSnapshotRow: null,
    allowSeedFromProduction: false,
    allowLegacyStorageKeyMigration: false,
    financialStorageKey: 'joint-finance-state-v2'
  }),
  experiment: Object.freeze({
    mode: 'experiment',
    activeSnapshotRow: ENVIRONMENT_ISOLATION_RULE.experimentSnapshotRow,
    seedReadSnapshotRow: ENVIRONMENT_ISOLATION_RULE.productionSnapshotRow,
    allowSeedFromProduction: true,
    allowLegacyStorageKeyMigration: true,
    financialStorageKey: `joint-finance-state-v2-${ENVIRONMENT_ISOLATION_RULE.experimentSnapshotRow}`
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

export function validateEnvironmentIsolation() {
  if (validated) {
    return resolveConfig();
  }

  const config = resolveConfig();
  const { productionSnapshotRow, experimentSnapshotRow } = ENVIRONMENT_ISOLATION_RULE;

  if (config.mode === 'production') {
    if (config.activeSnapshotRow !== productionSnapshotRow) {
      throw new Error('[ENVIRONMENT] Production mode must bind to production snapshot row only');
    }
    if (config.activeSnapshotRow === experimentSnapshotRow) {
      throw new Error('[ENVIRONMENT] Production mode cannot use experiment snapshot row');
    }
  }

  if (config.mode === 'experiment') {
    if (config.activeSnapshotRow !== experimentSnapshotRow) {
      throw new Error('[ENVIRONMENT] Experiment mode must bind to experiment snapshot row only');
    }
    if (config.activeSnapshotRow === productionSnapshotRow) {
      throw new Error('[ENVIRONMENT] Experiment mode cannot use production snapshot as active row');
    }
  }

  validated = true;

  if (typeof console !== 'undefined' && config.mode === 'experiment') {
    console.info('[ENVIRONMENT]', {
      rule: ENVIRONMENT_ISOLATION_RULE.id,
      mode: config.mode,
      activeSnapshotRow: config.activeSnapshotRow,
      seedReadAllowed: config.allowSeedFromProduction
    });
  }

  return config;
}

export function getActiveSnapshotRow() {
  return validateEnvironmentIsolation().activeSnapshotRow;
}

export function getSeedReadSnapshotRow() {
  const config = validateEnvironmentIsolation();
  return config.allowSeedFromProduction ? config.seedReadSnapshotRow : null;
}

export function getFinancialStorageKey() {
  return validateEnvironmentIsolation().financialStorageKey;
}

export function allowsLegacyStorageKeyMigration() {
  return validateEnvironmentIsolation().allowLegacyStorageKeyMigration;
}

export function isExperimentEnvironment() {
  return validateEnvironmentIsolation().mode === 'experiment';
}

export function isProductionEnvironment() {
  return validateEnvironmentIsolation().mode === 'production';
}

export function getRealtimeChannelName() {
  return `joint-finance-shared-state-${getActiveSnapshotRow()}`;
}

export function assertSnapshotWriteTarget(snapshotRowId) {
  const { productionSnapshotRow, experimentSnapshotRow } = ENVIRONMENT_ISOLATION_RULE;
  validateEnvironmentIsolation();

  if (snapshotRowId === productionSnapshotRow && !isProductionEnvironment()) {
    throw new Error('[ENVIRONMENT] Experiment deployment cannot write production snapshot row');
  }

  if (snapshotRowId === experimentSnapshotRow && isProductionEnvironment()) {
    throw new Error('[ENVIRONMENT] Production deployment cannot write experiment snapshot row');
  }

  if (snapshotRowId !== getActiveSnapshotRow()) {
    throw new Error(`[ENVIRONMENT] Write target "${snapshotRowId}" is not the active snapshot row`);
  }
}

export function assertSnapshotReadTarget(snapshotRowId, { seedBootstrap = false } = {}) {
  const { productionSnapshotRow, experimentSnapshotRow } = ENVIRONMENT_ISOLATION_RULE;
  validateEnvironmentIsolation();

  if (isProductionEnvironment()) {
    if (snapshotRowId === experimentSnapshotRow) {
      throw new Error('[ENVIRONMENT] Production deployment cannot read experiment snapshot row');
    }
    if (snapshotRowId !== productionSnapshotRow) {
      throw new Error(`[ENVIRONMENT] Production deployment cannot read snapshot row "${snapshotRowId}"`);
    }
    return;
  }

  if (snapshotRowId === getActiveSnapshotRow()) {
    return;
  }

  if (seedBootstrap && snapshotRowId === productionSnapshotRow && getSeedReadSnapshotRow() === productionSnapshotRow) {
    return;
  }

  if (snapshotRowId === productionSnapshotRow) {
    throw new Error('[ENVIRONMENT] Experiment cannot read production snapshot outside seed bootstrap');
  }

  throw new Error(`[ENVIRONMENT] Experiment deployment cannot read snapshot row "${snapshotRowId}"`);
}
