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

const ENTITY_VIEW_ACTIONS = Object.freeze({
  [ENTITY_TYPES.ACCOUNT]: Object.freeze({
    [VIEW_MODES.LIST]: ['open-topup', 'open-transfer'],
    [VIEW_MODES.MEDIUM]: ['open-topup', 'open-transfer', 'open-edit'],
    [VIEW_MODES.FULL]: ['open-topup', 'open-transfer', 'open-edit', 'delete-account']
  })
});

/**
 * Declarative action catalog per entity (header + detail zones).
 * visibility: list-primary → .display-list-action, card → .display-card-action
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
    listPrimary: ['open-reserve', 'open-unreserve'],
    card: ['open-edit', 'toggle-menu', 'delete-category'],
    detail: ['fill-to-limit', 'open-expense']
  }),
  [ENTITY_TYPES.OBLIGATION]: Object.freeze({
    listPrimary: ['open-reserve-obligation', 'open-unreserve-obligation'],
    card: ['open-edit-obligation', 'delete-obligation'],
    detail: ['open-pay-obligation']
  }),
  [ENTITY_TYPES.DEBT]: Object.freeze({
    listPrimary: [],
    card: [],
    detail: ['open-repay-debt', 'open-write-off-debt']
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

export function getAllowedActions(entityType, viewMode) {
  const mode = normalizeViewMode(viewMode);
  const viewActions = ENTITY_VIEW_ACTIONS[entityType]?.[mode];
  if (viewActions) {
    return [...viewActions];
  }

  const catalog = ENTITY_ACTION_CATALOG[entityType];
  if (!catalog) {
    return null;
  }

  if (mode === VIEW_MODES.LIST) {
    return [...catalog.listPrimary];
  }

  return [...catalog.card];
}

/**
 * CSS class for rendered action — aligns with active viewMode and existing display CSS.
 */
export function getActionRenderClass(actionId, entityType, viewMode) {
  const mode = normalizeViewMode(viewMode);
  const allowed = getAllowedActions(entityType, viewMode);
  if (allowed && !allowed.includes(actionId)) {
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

  if (catalog.card.includes(actionId)) {
    return 'display-card-action';
  }

  return null;
}

export function isHeaderActionAllowed(actionId, entityType, viewMode) {
  const allowed = getAllowedActions(entityType, viewMode);
  if (allowed === null) {
    return true;
  }
  return allowed.includes(actionId);
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
    allowedActions: getAllowedActions(entityType, viewMode) ?? [],
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

export { formatDisplayMoney as formatMoneyByRules } from './formatUi.js';
