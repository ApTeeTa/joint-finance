/**
 * UI Rule Engine — centralized display contract layer.
 *
 * SUPPORTED DOMAINS (entityType):
 * - account (reference wiring in accounts.js)
 * - category, saving, obligation, debt (catalog defined; gradual module adoption)
 *
 * UI = f(state, uiRulesEngine) — modules must not embed display policy.
 */
import { IS_EXPERIMENT } from '../config/environment.js';

export const ENTITY_TYPES = Object.freeze({
  ACCOUNT: 'account',
  CATEGORY: 'category',
  SAVING: 'saving',
  OBLIGATION: 'obligation',
  DEBT: 'debt'
});

export const VIEW_MODES = Object.freeze({
  LIST: 'list',
  MEDIUM: 'medium',
  FULL: 'full'
});

export const SCREEN_SIZES = Object.freeze({
  MOBILE: 'mobile',
  DESKTOP: 'desktop'
});

/** Global invariant: secondary actions (edit, delete) always live in ⋮ overflow menu. */
export const GLOBAL_ACTION_RULE = Object.freeze({
  primaryZone: 'inline',
  secondaryZone: 'overflow',
  overflow: true,
  secondaryPatterns: Object.freeze(['open-edit', 'delete-']),
  /** Core overflow actions are identical in every view mode (list / medium / full). */
  overflowViewModeInvariant: true
});

/** RULE 2: modules must not compose actions — only uiRulesEngine catalogs + filters. */
export const UI_ACTION_SOURCE_RULE = Object.freeze({
  source: 'uiRulesEngine',
  moduleCompositionAllowed: false
});

const DISPLAY_MODE_TO_VIEW = Object.freeze({
  compact: VIEW_MODES.LIST,
  medium: VIEW_MODES.MEDIUM,
  large: VIEW_MODES.FULL
});

const MODULE_KEY_TO_ENTITY = Object.freeze({
  accounts: ENTITY_TYPES.ACCOUNT,
  categories: ENTITY_TYPES.CATEGORY,
  savings: ENTITY_TYPES.SAVING,
  obligations: ENTITY_TYPES.OBLIGATION,
  debts: ENTITY_TYPES.DEBT
});

/**
 * Declarative action catalog per entity (header + detail zones).
 * Primary = listPrimary; edit/delete = card (overflow); overflow = menu-only actions.
 */
const ENTITY_ACTION_CATALOG = Object.freeze({
  [ENTITY_TYPES.ACCOUNT]: Object.freeze({
    listPrimary: ['open-topup', 'open-transfer'],
    card: ['open-edit', 'delete-account'],
    detail: ['open-topup', 'open-transfer']
  }),
  [ENTITY_TYPES.SAVING]: Object.freeze({
    listPrimary: ['open-deposit-saving'],
    card: ['open-edit-saving', 'delete-saving'],
    detail: ['open-deposit-saving']
  }),
  [ENTITY_TYPES.CATEGORY]: Object.freeze({
    listPrimary: ['open-reserve', 'open-expense'],
    card: ['open-edit', 'delete-category'],
    detail: ['fill-to-limit', 'open-expense']
  }),
  [ENTITY_TYPES.OBLIGATION]: Object.freeze({
    listPrimary: ['open-reserve-obligation', 'open-unreserve-obligation'],
    card: ['open-edit-obligation', 'delete-obligation'],
    detail: ['open-pay-obligation']
  }),
  [ENTITY_TYPES.DEBT]: Object.freeze({
    listPrimary: ['open-repay-debt'],
    card: [],
    overflow: ['open-write-off-debt'],
    detail: []
  })
});

export function normalizeViewMode(displayMode) {
  if (displayMode === VIEW_MODES.LIST
    || displayMode === VIEW_MODES.MEDIUM
    || displayMode === VIEW_MODES.FULL) {
    return displayMode;
  }
  return DISPLAY_MODE_TO_VIEW[displayMode] ?? VIEW_MODES.MEDIUM;
}

export function resolveEntityTypeFromModuleKey(moduleKey) {
  return MODULE_KEY_TO_ENTITY[moduleKey] ?? null;
}

export function createDisplayContext({
  entityType,
  viewMode,
  screenSize = SCREEN_SIZES.DESKTOP,
  expanded = false
}) {
  return {
    viewMode: normalizeViewMode(viewMode),
    entityType,
    screenSize,
    expanded: expanded === true
  };
}

export function isSecondaryAction(actionId) {
  if (!actionId || actionId === 'toggle-overflow-menu' || actionId === 'toggle-menu') {
    return false;
  }
  return GLOBAL_ACTION_RULE.secondaryPatterns.some((pattern) => actionId.startsWith(pattern));
}

function resolveSecondaryActions(entityType) {
  const catalog = ENTITY_ACTION_CATALOG[entityType];
  if (!catalog) {
    return [];
  }

  const cardSecondary = (catalog.card ?? []).filter(isSecondaryAction);
  const overflowOnly = [...(catalog.overflow ?? [])];

  return [...cardSecondary, ...overflowOnly];
}

/**
 * RULE 2: entity-specific action availability (replaces module-level filterAction).
 */
export function isActionAllowedForEntity(actionId, entityType, entityContext = {}) {
  if (entityType === ENTITY_TYPES.SAVING && actionId === 'open-deposit-saving') {
    return entityContext.goalReached !== true;
  }

  if (entityType === ENTITY_TYPES.DEBT && actionId === 'open-write-off-debt') {
    return entityContext.isOwedToUs === true;
  }

  return true;
}

export function resolveEntityActionGroups(entityType, entityContext = {}) {
  const catalog = ENTITY_ACTION_CATALOG[entityType];
  if (!catalog) {
    return null;
  }

  const base = buildActionGroups(entityType);
  if (!base) {
    return null;
  }

  return {
    primary: base.primary.filter((actionId) => isActionAllowedForEntity(actionId, entityType, entityContext)),
    secondary: base.secondary.filter((actionId) => isActionAllowedForEntity(actionId, entityType, entityContext)),
    overflow: base.overflow
  };
}

let overflowConsistencyFixLogged = false;

function maybeLogOverflowConsistencyFix() {
  if (!IS_EXPERIMENT || overflowConsistencyFixLogged) {
    return;
  }
  overflowConsistencyFixLogged = true;
  logUiRuleFix('overflow_consistency', { viewModesAffected: ['list', 'medium', 'full'] });
}

function buildActionGroups(entityType) {
  const catalog = ENTITY_ACTION_CATALOG[entityType];
  if (!catalog) {
    return null;
  }

  maybeLogOverflowConsistencyFix();

  const primary = [...(catalog.listPrimary ?? [])];
  const secondary = resolveSecondaryActions(entityType);

  return {
    primary,
    secondary,
    overflow: GLOBAL_ACTION_RULE.overflow
  };
}

function getBadgeRules(entityType, viewMode) {
  const mode = normalizeViewMode(viewMode);

  return {
    showReserveBadge: entityType === ENTITY_TYPES.CATEGORY || entityType === ENTITY_TYPES.OBLIGATION,
    showDebtBadge: entityType === ENTITY_TYPES.DEBT,
    showSavingProgress: entityType === ENTITY_TYPES.SAVING,
    density: mode === VIEW_MODES.LIST ? 'compact' : 'normal'
  };
}

/**
 * Pure mapping — action presentation strategy for an entity action id.
 * Does not mutate state.
 */
export function getDisplayStrategy(entityType, actionId) {
  const visibilityClass = getActionVisibilityClass(actionId, entityType);
  if (!visibilityClass) {
    return null;
  }

  return {
    actionId,
    entityType,
    visibilityClass,
    zone: visibilityClass === 'display-list-action' ? 'listPrimary' : 'card'
  };
}

/** Alias for display-strategy lookup (entityType, actionId). */
export function getMutationStrategy(domain, actionType) {
  return getDisplayStrategy(domain, actionType);
}

/**
 * Structured action groups for header rendering.
 * Overflow core actions (edit/delete) are view-mode invariant — RULE 1.
 * @returns {{ primary: string[], secondary: string[], overflow: boolean } | null}
 */
export function getAllowedActions(entityType, viewMode, entityContext = {}) {
  void viewMode;
  return resolveEntityActionGroups(entityType, entityContext);
}

/**
 * CSS class for rendered primary action — aligns with active viewMode and existing display CSS.
 */
export function getActionRenderClass(actionId, entityType, viewMode) {
  const mode = normalizeViewMode(viewMode);
  const groups = getAllowedActions(entityType, viewMode);
  if (!groups || !groups.primary.includes(actionId)) {
    return null;
  }

  if (mode === VIEW_MODES.LIST) {
    return getActionVisibilityClass(actionId, entityType) ?? 'display-list-action';
  }

  return 'display-card-action';
}

export function getAllowedDetailActions(entityType) {
  const catalog = ENTITY_ACTION_CATALOG[entityType];
  if (!catalog) {
    return null;
  }
  return [...(catalog.detail ?? [])];
}

export function getActionVisibilityClass(actionId, entityType) {
  const catalog = ENTITY_ACTION_CATALOG[entityType];
  if (!catalog) {
    return null;
  }

  if (catalog.listPrimary.includes(actionId)) {
    return 'display-list-action';
  }

  if (catalog.card.includes(actionId) && !isSecondaryAction(actionId)) {
    return 'display-card-action';
  }

  return null;
}

export function isHeaderActionAllowed(actionId, entityType, viewMode) {
  const groups = getAllowedActions(entityType, viewMode);
  if (groups === null) {
    return true;
  }
  return groups.primary.includes(actionId) || groups.secondary.includes(actionId);
}

export function getDisplayRules(displayContext) {
  if (!displayContext) {
    return null;
  }

  const viewMode = normalizeViewMode(displayContext.viewMode);
  const entityType = displayContext.entityType ?? ENTITY_TYPES.ACCOUNT;
  const expanded = displayContext.expanded === true;

  const moneyFormat = viewMode === VIEW_MODES.LIST ? 'short' : 'full';

  const actionMode = viewMode === VIEW_MODES.LIST
    ? 'compact'
    : (viewMode === VIEW_MODES.MEDIUM ? 'inline' : 'full');

  const rules = {
    moneyFormat,
    showSecondaryValues: viewMode !== VIEW_MODES.LIST,
    actionMode,
    allowedActions: getAllowedActions(entityType, viewMode, displayContext.entityContext ?? {})
      ?? { primary: [], secondary: [], overflow: false },
    allowedDetailActions: getAllowedDetailActions(entityType) ?? [],
    labelDensity: viewMode === VIEW_MODES.LIST
      ? 'minimal'
      : (viewMode === VIEW_MODES.FULL ? 'verbose' : 'normal'),
    badgeRules: getBadgeRules(entityType, viewMode),
    clickBehavior: viewMode === VIEW_MODES.FULL && !expanded ? 'navigate' : 'expand',
    viewMode
  };

  return rules;
}

export function logUiRulesActive(moduleKey, displayContext, rules) {
  if (!IS_EXPERIMENT || !rules) {
    return;
  }
  console.info('[UI RULES ACTIVE]', {
    module: moduleKey,
    viewMode: displayContext?.viewMode ?? rules.viewMode ?? null,
    moneyFormat: rules.moneyFormat,
    allowedActions: rules.allowedActions
  });
}

export function logUiActionRule(moduleKey, entityType, actionGroups) {
  if (!IS_EXPERIMENT || !actionGroups) {
    return;
  }
  console.info('[UI ACTION RULE]', {
    module: moduleKey,
    entityType,
    primaryActions: actionGroups.primary,
    overflowActions: actionGroups.secondary
  });
}

export function logUiMigrationPass(moduleKey, viewMode, hasOverflowMenu, legacyDetected) {
  if (!IS_EXPERIMENT) {
    return;
  }
  console.info('[UI MIGRATION PASS]', {
    module: moduleKey,
    viewMode: normalizeViewMode(viewMode),
    hasOverflowMenu,
    legacyDetected
  });
}

export function logUiUxFix(issue, status = 'fixed') {
  if (!IS_EXPERIMENT) {
    return;
  }
  console.info('[UI UX FIX]', { issue, status });
}

export function logUiRuleFix(fix, meta = {}) {
  if (!IS_EXPERIMENT) {
    return;
  }
  console.info('[UI RULE FIX]', { fix, ...meta });
}

export { formatDisplayMoney as formatMoneyByRules } from './formatUi.js';
