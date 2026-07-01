/**
 * UI Rule Engine — centralized display contract layer.
 *
 * SUPPORTED DOMAINS (entityType):
 * - account (reference wiring in accounts.js)
 * - category, saving, obligation, debt (catalog defined; gradual module adoption)
 *
 * UI = f(state, uiRulesEngine) — modules must not embed display policy.
 */
import { isExperiment } from '../config/environmentConfig.js';

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

/**
 * RULE 4: stacked vertical card layout — actions on dedicated row, never absolute.
 */
export const GLOBAL_ENTITY_LAYOUT_RULE = Object.freeze({
  actionsNeverOverlapTitle: true,
  titleFlexShrink: true,
  actionsFlexShrink: false,
  layoutClass: 'display-item-header--stacked'
});

/**
 * RULE 5: list → compact money; medium/full → full money with currency.
 */
export const GLOBAL_MONEY_FORMAT_RULE = Object.freeze({
  list: 'short',
  medium: 'full',
  full: 'full'
});

/**
 * RULE 6: primary card value must not repeat in secondary stats rows.
 */
export const GLOBAL_INFO_DEDUP_RULE = Object.freeze({
  omitStatsMatchingPrimary: true
});

/**
 * RULE 7: wherever money is reserved, always show Limit + Reserve in stats.
 */
export const GLOBAL_RESERVE_DISPLAY_RULE = Object.freeze({
  alwaysShowLimit: true,
  alwaysShowReserve: true,
  limitExceededLabel: 'Превышен лимит',
  insufficientReserveLabel: 'Недостаточно денег'
});

/**
 * RULE 8: remote snapshot is the sole source of entity existence.
 * Sync hard-replaces shared arrays from remote; local-only ids are dropped after first sync.
 */
export const EMPTY_STATE_SYNC_RULE = Object.freeze({
  emptyRemoteHardReplace: true,
  remoteArrayAuthoritative: true,
  remoteHardReplaceOnSync: true
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
    card: ['open-edit-manual-debt', 'delete-manual-debt'],
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

  if (entityType === ENTITY_TYPES.DEBT) {
    const isManual = entityContext.isManualDebt === true;
    if (actionId === 'open-edit-manual-debt' || actionId === 'delete-manual-debt') {
      return isManual;
    }
  }

  return true;
}

export function getEntityHeaderLayoutClass() {
  return GLOBAL_ENTITY_LAYOUT_RULE.layoutClass;
}

function normalizeMoneyAmount(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/** Stats row pairs: [label, formattedValue]. Drops rows whose numeric value equals primaryValue. */
export function buildDedupedStatsRows(rows, primaryValue, rules = null) {
  if (!GLOBAL_INFO_DEDUP_RULE.omitStatsMatchingPrimary || primaryValue == null) {
    return rows;
  }

  const primaryNum = normalizeMoneyAmount(primaryValue);
  return rows.filter((row) => {
    if (!row || row.numericValue == null) {
      return true;
    }
    return normalizeMoneyAmount(row.numericValue) !== primaryNum;
  });
}

export function renderStatsRowsHtml(rows) {
  return rows
    .filter((row) => row && row.label && row.formattedValue != null)
    .map((row) => `
      <span class="text-slate-500">${row.label}:</span>
      <span class="text-slate-900 font-medium text-right">${row.formattedValue}</span>
    `)
    .join('');
}

/** List mode: spent / limit / reserve — always 3 values, short format. */
export function formatListTripleMetrics(spent, limit, reserve, formatMoney, rules = null) {
  return [
    formatMoney(spent, 'RUB', rules),
    formatMoney(limit, 'RUB', rules),
    formatMoney(reserve, 'RUB', rules)
  ].join(' / ');
}

function renderMetricPair(label, formattedValue) {
  return `<span class="display-metric-pair"><span class="text-slate-500">${label}:</span> <span class="text-slate-900 font-medium">${formattedValue}</span></span>`;
}

function renderReserveLimitLines({
  spent,
  limit,
  reserve,
  available,
  formatMoney,
  rules
}) {
  const reserveLineHtml = [
    renderMetricPair('Потрачено', formatMoney(spent, 'RUB', rules)),
    renderMetricPair('Резерв', formatMoney(reserve, 'RUB', rules))
  ].join('<span class="text-slate-300 mx-1">·</span>');

  const limitLineHtml = [
    renderMetricPair('Лимит', formatMoney(limit, 'RUB', rules)),
    renderMetricPair('Доступно', formatMoney(available, 'RUB', rules))
  ].join('<span class="text-slate-300 mx-1">·</span>');

  return { reserveLineHtml, limitLineHtml };
}

/**
 * Reserve-aware display for categories and obligations.
 * @returns {{ meta: string, value: string, statsHtml: string, primaryNumeric: number|null }}
 */
export function buildReserveEntityDisplay({
  limit,
  reserve,
  spent = 0,
  primaryNumeric,
  primaryLabel = null,
  formatMoney,
  rules = null
}) {
  const limitNum = normalizeMoneyAmount(limit);
  const reserveNum = normalizeMoneyAmount(reserve);
  const spentNum = normalizeMoneyAmount(spent);
  const available = primaryNumeric != null ? normalizeMoneyAmount(primaryNumeric) : limitNum - spentNum;
  const isListMode = rules?.viewMode === VIEW_MODES.LIST || rules?.moneyFormat === 'short';

  const warnings = [];
  if (spentNum > limitNum && limitNum > 0) {
    warnings.push(GLOBAL_RESERVE_DISPLAY_RULE.limitExceededLabel);
  }
  if (spentNum > reserveNum && reserveNum >= 0) {
    warnings.push(GLOBAL_RESERVE_DISPLAY_RULE.insufficientReserveLabel);
  }

  const metaParts = [];
  if (warnings.length) {
    metaParts.push(warnings.join(' · '));
  }

  if (isListMode) {
    return {
      meta: metaParts.join(' · '),
      value: '',
      statsHtml: '',
      listMetrics: formatListTripleMetrics(spentNum, limitNum, reserveNum, formatMoney, rules),
      reserveLineHtml: '',
      limitLineHtml: '',
      primaryNumeric: available
    };
  }

  const { reserveLineHtml, limitLineHtml } = renderReserveLimitLines({
    spent: spentNum,
    limit: limitNum,
    reserve: reserveNum,
    available,
    formatMoney,
    rules
  });

  return {
    meta: metaParts.join(' · '),
    value: '',
    statsHtml: '',
    listMetrics: '',
    reserveLineHtml,
    limitLineHtml,
    primaryNumeric: available
  };
}

export function buildDebtEntityDisplay(item, formatMoney, rules) {
  const remaining = normalizeMoneyAmount(item.remainingAmount);
  const viewMode = rules?.viewMode ?? VIEW_MODES.MEDIUM;

  let meta = '';
  if (item.type === 'manual_debt_event' && item.category) {
    meta = MANUAL_DEBT_CATEGORY_LABELS[item.category] ?? MANUAL_DEBT_CATEGORY_LABELS.other;
  } else if (viewMode === VIEW_MODES.FULL && rules?.labelDensity === 'verbose') {
    meta = `Погашено ${formatMoney(item.paidAmount, 'RUB', rules)}`;
  }

  const statsRows = viewMode === VIEW_MODES.FULL && rules?.labelDensity === 'verbose'
    ? buildDedupedStatsRows([
      {
        label: 'Из суммы',
        formattedValue: formatMoney(item.amount, 'RUB', rules),
        numericValue: item.amount
      },
      {
        label: 'Погашено',
        formattedValue: formatMoney(item.paidAmount, 'RUB', rules),
        numericValue: item.paidAmount
      }
    ], remaining, rules)
    : [];

  return {
    meta,
    value: formatMoney(remaining, 'RUB', rules),
    statsHtml: renderStatsRowsHtml(statsRows),
    listMetrics: '',
    reserveLineHtml: '',
    limitLineHtml: '',
    primaryNumeric: remaining
  };
}

export function buildSavingEntityDisplay(item, formatMoney, rules, extras = {}) {
  const accumulated = normalizeMoneyAmount(extras.accumulated ?? item.accumulated);
  const targetAmount = extras.targetAmount;
  const percent = extras.percent;

  const statsRows = buildDedupedStatsRows(
    [
      targetAmount != null && targetAmount > 0
        ? {
          label: 'Цель',
          formattedValue: formatMoney(targetAmount, 'RUB', rules),
          numericValue: targetAmount
        }
        : null,
      ...(extras.extraStatsRows ?? [])
    ].filter(Boolean),
    accumulated,
    rules
  );

  let meta = '';
  if (percent != null) {
    meta = `Прогресс ${percent}%`;
  } else if (extras.goalReached) {
    meta = 'Цель достигнута';
  }

  return {
    meta,
    value: formatMoney(accumulated, 'RUB', rules),
    statsHtml: renderStatsRowsHtml(statsRows),
    listMetrics: '',
    reserveLineHtml: '',
    limitLineHtml: '',
    primaryNumeric: accumulated
  };
}

const MANUAL_DEBT_CATEGORY_LABELS = Object.freeze({
  emergency: 'Экстренные расходы',
  rent: 'Аренда / задержка',
  fees: 'Комиссии / штрафы',
  other: 'Другое'
});

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
  if (!isExperiment() || overflowConsistencyFixLogged) {
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

  const moneyFormat = GLOBAL_MONEY_FORMAT_RULE[viewMode] ?? 'full';

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
  if (!isExperiment() || !rules) {
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
  if (!isExperiment() || !actionGroups) {
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
  if (!isExperiment()) {
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
  if (!isExperiment()) {
    return;
  }
  console.info('[UI UX FIX]', { issue, status });
}

export function logUiRuleFix(fix, meta = {}) {
  if (!isExperiment()) {
    return;
  }
  console.info('[UI RULE FIX]', { fix, ...meta });
}

export { formatDisplayMoney as formatMoneyByRules } from './formatUi.js';
