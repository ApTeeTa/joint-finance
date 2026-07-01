/**
 * @deprecated Import from environmentConfig.js directly.
 * Thin re-export barrel for backward compatibility during migration.
 */
export {
  getActiveSnapshotId,
  isExperiment,
  isProduction,
  validateEnvironmentIsolation,
  getFinancialStorageKey,
  getLegacyProductionStorageKey,
  allowsLegacyStorageKeyMigration
} from './environmentConfig.js';
