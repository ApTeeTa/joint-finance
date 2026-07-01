/**
 * UI Rule Engine — centralized display contract layer.
 *
 * SUPPORTED DOMAINS (entityType):
 * - account (reference wiring in accounts.js)
 * - category, saving, obligation, debt (catalog defined; gradual module adoption)
 *
 * UI = f(state, uiRulesEngine) — modules must not embed display policy.
 */
import { formatFullMoney, formatUiMoney } from './formatUi.js';
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
  FULL: 'full',
  EXPANDED: 'expanded'
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
 * RULE 5: single money formatting policy for all entity display modes.
 * formatEntityMoney() is ONLY allowed in uiActionRenderer (final render stage).
 */
export const GLOBAL_MONEY_FORMAT_RULE = Object.freeze({
  list: 'short',
  medium: 'short',
  full: 'full',
  expanded: 'full'
});

/** Fallback when validateEntityRenderContract detects violations. */
export const GLOBAL_DISPLAY_RULE = Object.freeze({
  listRequiresMetrics: true,
  mediumRequiresActions: true,
  mediumRequiresMetrics: true,
  expandedRequiresFullFormat: true
});

/** Central money formatter — import ONLY from uiActionRenderer. */
export function formatEntityMoney(amount, currency = 'RUB', rules = null) {
  const format = rules?.moneyFormat ?? GLOBAL_MONEY_FORMAT_RULE.medium;
  if (format === 'full' || format === 'expanded') {
    return formatFullMoney(amount, currency);
  }
  return formatUiMoney(amount, currency);
}

export function createEmptyEntityDisplay() {
  return {
    line1: { title: '', meta: '' },
    line2: { actions: null },
    line3: { metrics: [] },
    line4: { metrics: [] },
    expanded: { fields: [] }
  };
}

/** Canonical raw numeric keys modules may populate (subset only). */
export const RAW_VALUE_KEYS = Object.freeze({
  BALANCE: 'balance',
  PAID: 'paid',
  TOTAL: 'total',
  LIMIT: 'limit',
  RESERVE: 'reserve',
  SPENT: 'spent',
  GOAL: 'goal',
  PERCENT: 'percent'
});

export const RAW_VALUE_TYPES = Object.freeze({
  MONEY: 'money',
  PERCENT: 'percent'
});

const ALLOWED_RAW_VALUE_TYPES = new Set(Object.values(RAW_VALUE_TYPES));

/** Layer 1 helper — modules must use typed raw values only. */
export function createRawMoney(raw) {
  return {
    type: RAW_VALUE_TYPES.MONEY,
    raw: normalizeMoneyAmount(raw)
  };
}

/** Layer 1 helper — percent raw value (null when unknown). */
export function createRawPercent(raw) {
  const num = raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
  return {
    type: RAW_VALUE_TYPES.PERCENT,
    raw: num
  };
}

function readTypedEntry(rawValues, key) {
  return rawValues?.[key] ?? null;
}

/** Layer 2/3 — read numeric money from typed rawValues entry. */
export function readRawMoney(rawValues, key, fallback = 0) {
  const entry = readTypedEntry(rawValues, key);
  if (!entry || typeof entry !== 'object' || entry.type !== RAW_VALUE_TYPES.MONEY) {
    return normalizeMoneyAmount(fallback);
  }
  return normalizeMoneyAmount(entry.raw ?? fallback);
}

/** Layer 2/3 — read numeric percent from typed rawValues entry. */
export function readRawPercent(rawValues, key = RAW_VALUE_KEYS.PERCENT) {
  const entry = readTypedEntry(rawValues, key);
  if (!entry || typeof entry !== 'object' || entry.type !== RAW_VALUE_TYPES.PERCENT) {
    return null;
  }
  if (entry.raw == null || !Number.isFinite(Number(entry.raw))) {
    return null;
  }
  return Number(entry.raw);
}

function pickRaw(rawValues, key, fallback = 0) {
  return readRawMoney(rawValues, key, fallback);
}

export function validateModuleRawValues(rawValues) {
  const violations = [];

  if (!rawValues || typeof rawValues !== 'object' || Array.isArray(rawValues)) {
    return { ok: false, violations: ['rawValues_invalid_object'] };
  }

  for (const [key, value] of Object.entries(rawValues)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      violations.push(`rawValues_${key}_primitive_not_allowed`);
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      violations.push(`rawValues_${key}_not_typed_object`);
      continue;
    }
    if (!ALLOWED_RAW_VALUE_TYPES.has(value.type)) {
      violations.push(`rawValues_${key}_invalid_type`);
      continue;
    }
    if (value.type === RAW_VALUE_TYPES.MONEY && typeof value.raw !== 'number') {
      violations.push(`rawValues_${key}_money_raw_not_number`);
    }
    if (value.type === RAW_VALUE_TYPES.PERCENT && value.raw != null && typeof value.raw !== 'number') {
      violations.push(`rawValues_${key}_percent_raw_not_number`);
    }
  }

  return {
    ok: violations.length === 0,
    violations
  };
}

function createMetric(key, label, value, type) {
  if (type === 'percent') {
    const num = value != null && Number.isFinite(Number(value)) ? Number(value) : null;
    return { key, label, value: num, type };
  }
  return {
    key,
    label,
    value: normalizeMoneyAmount(value),
    type
  };
}

function cloneMetrics(metrics) {
  return (metrics ?? []).map((metric) => ({ ...metric }));
}

function computeRemaining(rawValues) {
  const total = pickRaw(rawValues, RAW_VALUE_KEYS.TOTAL);
  const paid = pickRaw(rawValues, RAW_VALUE_KEYS.PAID);
  return Math.max(0, total - paid);
}

function computeAvailable(rawValues) {
  return pickRaw(rawValues, RAW_VALUE_KEYS.LIMIT) - pickRaw(rawValues, RAW_VALUE_KEYS.SPENT);
}

function computeProgressPercent(rawValues) {
  const fromRaw = readRawPercent(rawValues, RAW_VALUE_KEYS.PERCENT);
  if (fromRaw != null) {
    return fromRaw;
  }
  const goal = pickRaw(rawValues, RAW_VALUE_KEYS.GOAL);
  const balance = pickRaw(rawValues, RAW_VALUE_KEYS.BALANCE);
  if (goal <= 0) {
    return null;
  }
  return Math.min(100, Math.round((balance / goal) * 100));
}

function buildReserveWarningMeta(rawValues, existingMeta = '') {
  const spent = pickRaw(rawValues, RAW_VALUE_KEYS.SPENT);
  const limit = pickRaw(rawValues, RAW_VALUE_KEYS.LIMIT);
  const reserve = pickRaw(rawValues, RAW_VALUE_KEYS.RESERVE);
  const warnings = [];
  if (spent > limit && limit > 0) {
    warnings.push(GLOBAL_RESERVE_DISPLAY_RULE.limitExceededLabel);
  }
  if (spent > reserve && reserve >= 0) {
    warnings.push(GLOBAL_RESERVE_DISPLAY_RULE.insufficientReserveLabel);
  }
  const warningMeta = warnings.join(' · ');
  if (existingMeta && warningMeta) {
    return `${existingMeta} · ${warningMeta}`;
  }
  return existingMeta || warningMeta;
}

function buildSavingMeta(entityMeta = '', flags = {}) {
  if (flags.goalReached) {
    return entityMeta ? `${entityMeta} · Цель достигнута` : 'Цель достигнута';
  }
  return entityMeta ?? '';
}

function buildAccountDisplayContract(entity, viewMode) {
  const contract = createEmptyEntityDisplay();
  const rawValues = entity.rawValues ?? {};
  const balance = pickRaw(rawValues, RAW_VALUE_KEYS.BALANCE);

  contract.line1.title = entity.title ?? '';
  contract.line1.meta = entity.meta ?? '';
  contract.line3.metrics = [createMetric(RAW_VALUE_KEYS.BALANCE, '', balance, 'money')];
  contract.line4.metrics = [];
  contract.expanded.fields = buildExpandedFields(ENTITY_TYPES.ACCOUNT, rawValues, entity);

  void viewMode;
  return contract;
}

function buildReserveDisplayContract(entity, viewMode, entityType) {
  const contract = createEmptyEntityDisplay();
  const rawValues = entity.rawValues ?? {};
  const spent = pickRaw(rawValues, RAW_VALUE_KEYS.SPENT);
  const limit = pickRaw(rawValues, RAW_VALUE_KEYS.LIMIT);
  const reserve = pickRaw(rawValues, RAW_VALUE_KEYS.RESERVE);

  contract.line1.title = entity.title ?? '';
  contract.line1.meta = buildReserveWarningMeta(rawValues, entity.meta ?? '');

  if (viewMode === VIEW_MODES.LIST) {
    contract.line3.metrics = [
      createMetric(RAW_VALUE_KEYS.SPENT, '', spent, 'money'),
      createMetric(RAW_VALUE_KEYS.LIMIT, '', limit, 'money'),
      createMetric(RAW_VALUE_KEYS.RESERVE, '', reserve, 'money')
    ];
  } else {
    contract.line3.metrics = [
      createMetric(RAW_VALUE_KEYS.SPENT, '', spent, 'money'),
      createMetric(RAW_VALUE_KEYS.RESERVE, '', reserve, 'money')
    ];
    contract.line4.metrics = [
      createMetric(RAW_VALUE_KEYS.LIMIT, '', limit, 'money'),
      createMetric('available', '', computeAvailable(rawValues), 'money')
    ];
  }

  contract.expanded.fields = buildExpandedFields(entityType, rawValues, entity);
  return contract;
}

function buildMiscCategoryDisplayContract(entity, viewMode) {
  const contract = createEmptyEntityDisplay();
  const rawValues = entity.rawValues ?? {};
  const spent = pickRaw(rawValues, RAW_VALUE_KEYS.SPENT);

  contract.line1.title = entity.title ?? '';
  contract.line1.meta = entity.meta ?? 'Системная категория';
  contract.line3.metrics = [createMetric(RAW_VALUE_KEYS.SPENT, '', spent, 'money')];
  contract.line4.metrics = [];
  contract.expanded.fields = buildExpandedFields(ENTITY_TYPES.CATEGORY, rawValues, {
    ...entity,
    flags: { ...(entity.flags ?? {}), isMiscCategory: true }
  });

  void viewMode;
  return contract;
}

function buildDebtDisplayContract(entity, viewMode) {
  const contract = createEmptyEntityDisplay();
  const rawValues = entity.rawValues ?? {};
  const paid = pickRaw(rawValues, RAW_VALUE_KEYS.PAID);
  const total = pickRaw(rawValues, RAW_VALUE_KEYS.TOTAL);
  const remaining = computeRemaining(rawValues);

  contract.line1.title = entity.title ?? '';
  contract.line1.meta = entity.meta ?? '';

  contract.line3.metrics = [
    createMetric(RAW_VALUE_KEYS.PAID, '', paid, 'money'),
    createMetric(RAW_VALUE_KEYS.TOTAL, '', total, 'money')
  ];
  contract.line4.metrics = viewMode === VIEW_MODES.LIST
    ? []
    : [
      createMetric('remaining', '', remaining, 'money'),
      createMetric(RAW_VALUE_KEYS.TOTAL, '', total, 'money')
    ];

  contract.expanded.fields = buildExpandedFields(ENTITY_TYPES.DEBT, rawValues, entity);
  return contract;
}

function buildSavingDisplayContract(entity, viewMode) {
  const contract = createEmptyEntityDisplay();
  const rawValues = entity.rawValues ?? {};
  const balance = pickRaw(rawValues, RAW_VALUE_KEYS.BALANCE);
  const goal = pickRaw(rawValues, RAW_VALUE_KEYS.GOAL);
  const percent = computeProgressPercent(rawValues);
  const hasGoal = goal > 0;

  contract.line1.title = entity.title ?? '';
  contract.line1.meta = buildSavingMeta(entity.meta ?? '', entity.flags ?? {});

  if (viewMode === VIEW_MODES.LIST) {
    contract.line3.metrics = [
      createMetric('progress', '', percent, 'percent'),
      createMetric(RAW_VALUE_KEYS.BALANCE, '', balance, 'money'),
      ...(hasGoal ? [createMetric(RAW_VALUE_KEYS.GOAL, '', goal, 'money')] : [])
    ];
  } else {
    contract.line3.metrics = [
      createMetric(RAW_VALUE_KEYS.BALANCE, '', balance, 'money'),
      ...(hasGoal ? [createMetric(RAW_VALUE_KEYS.GOAL, '', goal, 'money')] : [])
    ];
    contract.line4.metrics = [
      createMetric('progress', '', percent, 'percent'),
      ...(hasGoal ? [createMetric(RAW_VALUE_KEYS.GOAL, '', goal, 'money')] : [])
    ];
  }

  contract.expanded.fields = buildExpandedFields(ENTITY_TYPES.SAVING, rawValues, entity);
  return contract;
}

/**
 * Expanded fields always recomputed from rawValues — never copied from line3/line4.
 */
function buildExpandedFields(entityType, rawValues, entity = {}) {
  const flags = entity.flags ?? {};
  const fields = [];

  if (entityType === ENTITY_TYPES.ACCOUNT) {
    fields.push(createMetric(RAW_VALUE_KEYS.BALANCE, 'Баланс', pickRaw(rawValues, RAW_VALUE_KEYS.BALANCE), 'money'));
    return cloneMetrics(fields);
  }

  if (entityType === ENTITY_TYPES.CATEGORY) {
    if (flags.isMiscCategory) {
      fields.push(createMetric(RAW_VALUE_KEYS.SPENT, 'Потрачено', pickRaw(rawValues, RAW_VALUE_KEYS.SPENT), 'money'));
      return cloneMetrics(fields);
    }
    fields.push(
      createMetric(RAW_VALUE_KEYS.SPENT, 'Потрачено', pickRaw(rawValues, RAW_VALUE_KEYS.SPENT), 'money'),
      createMetric(RAW_VALUE_KEYS.RESERVE, 'Резерв', pickRaw(rawValues, RAW_VALUE_KEYS.RESERVE), 'money'),
      createMetric(RAW_VALUE_KEYS.LIMIT, 'Лимит', pickRaw(rawValues, RAW_VALUE_KEYS.LIMIT), 'money'),
      createMetric('available', 'Доступно', computeAvailable(rawValues), 'money')
    );
    return cloneMetrics(fields);
  }

  if (entityType === ENTITY_TYPES.OBLIGATION) {
    fields.push(
      createMetric(RAW_VALUE_KEYS.RESERVE, 'Резерв', pickRaw(rawValues, RAW_VALUE_KEYS.RESERVE), 'money'),
      createMetric(RAW_VALUE_KEYS.PAID, 'Оплачено', pickRaw(rawValues, RAW_VALUE_KEYS.SPENT), 'money')
    );
    const target = pickRaw(rawValues, RAW_VALUE_KEYS.LIMIT);
    if (target > 0) {
      fields.push(createMetric(RAW_VALUE_KEYS.LIMIT, 'Сумма', target, 'money'));
    }
    return cloneMetrics(fields);
  }

  if (entityType === ENTITY_TYPES.DEBT) {
    fields.push(
      createMetric('remaining', 'Остаток', computeRemaining(rawValues), 'money'),
      createMetric(RAW_VALUE_KEYS.PAID, 'Погашено', pickRaw(rawValues, RAW_VALUE_KEYS.PAID), 'money'),
      createMetric(RAW_VALUE_KEYS.TOTAL, 'Из суммы', pickRaw(rawValues, RAW_VALUE_KEYS.TOTAL), 'money')
    );
    return cloneMetrics(fields);
  }

  if (entityType === ENTITY_TYPES.SAVING) {
    fields.push(
      createMetric(RAW_VALUE_KEYS.BALANCE, 'Накоплено', pickRaw(rawValues, RAW_VALUE_KEYS.BALANCE), 'money')
    );
    const goal = pickRaw(rawValues, RAW_VALUE_KEYS.GOAL);
    if (goal > 0) {
      fields.push(createMetric(RAW_VALUE_KEYS.GOAL, 'Цель', goal, 'money'));
    }
    fields.push(createMetric('progress', 'Прогресс', computeProgressPercent(rawValues), 'percent'));
    const recommended = rawValues?.recommendedPayment;
    if (recommended?.type === RAW_VALUE_TYPES.MONEY && typeof recommended.raw === 'number') {
      fields.push(createMetric('recommendedPayment', 'Рекомендуемый платёж', recommended.raw, 'money'));
    }
    return cloneMetrics(fields);
  }

  return fields;
}

/**
 * Strict entity display contract — structure only, no formatting.
 * @param {{ entityType: string, title?: string, meta?: string, rawValues?: object, flags?: object }} entity
 * @param {string} mode
 */
export function buildEntityDisplay(entity, mode) {
  const viewMode = normalizeViewMode(mode);
  const entityType = entity?.entityType;

  if (entityType === ENTITY_TYPES.ACCOUNT) {
    return buildAccountDisplayContract(entity, viewMode);
  }

  if (entityType === ENTITY_TYPES.CATEGORY && entity.flags?.isMiscCategory) {
    return buildMiscCategoryDisplayContract(entity, viewMode);
  }

  if (entityType === ENTITY_TYPES.CATEGORY || entityType === ENTITY_TYPES.OBLIGATION) {
    return buildReserveDisplayContract(entity, viewMode, entityType);
  }

  if (entityType === ENTITY_TYPES.DEBT) {
    return buildDebtDisplayContract(entity, viewMode);
  }

  if (entityType === ENTITY_TYPES.SAVING) {
    return buildSavingDisplayContract(entity, viewMode);
  }

  return createEmptyEntityDisplay();
}

const FORBIDDEN_FORMAT_IN_VALUE = /[kK₽%]|\/|\u2212|\u2014/;

function metricStructureSignature(metrics) {
  return (metrics ?? [])
    .map((metric) => `${metric.key}:${metric.label ?? ''}:${metric.type}`)
    .sort()
    .join('|');
}

export function validateEntityRenderContract(entityDisplay, mode, rawValues = null) {
  const viewMode = normalizeViewMode(mode);
  const violations = [];

  if (rawValues != null) {
    const rawValidation = validateModuleRawValues(rawValues);
    if (!rawValidation.ok) {
      violations.push(...rawValidation.violations);
    }
  }

  if (!entityDisplay?.line1 || !entityDisplay?.line2 || !entityDisplay?.line3 || !entityDisplay?.line4) {
    violations.push('missing_line_structure');
  }

  if (!entityDisplay?.expanded || !Array.isArray(entityDisplay.expanded.fields)) {
    violations.push('missing_expanded_fields');
  }

  const metricGroups = [
    { name: 'line3', metrics: entityDisplay?.line3?.metrics ?? [] },
    { name: 'line4', metrics: entityDisplay?.line4?.metrics ?? [] },
    { name: 'expanded', metrics: entityDisplay?.expanded?.fields ?? [] }
  ];

  for (const group of metricGroups) {
    for (const metric of group.metrics) {
      if (typeof metric === 'string') {
        violations.push(`${group.name}_string_concatenation`);
      }
      if (metric?.formatted != null || metric?.display != null || metric?.text != null) {
        violations.push(`${group.name}_preformatted_metric`);
      }
      if (metric?.currency != null) {
        violations.push(`${group.name}_currency_in_metric`);
      }
      if (typeof metric?.value === 'string') {
        violations.push(`${group.name}_value_is_string`);
      }
      if (metric?.type === 'money' && typeof metric.value !== 'number') {
        violations.push(`${group.name}_money_not_numeric`);
      }
      if (metric?.type === 'percent' && metric.value != null && typeof metric.value !== 'number') {
        violations.push(`${group.name}_percent_not_numeric`);
      }
      if (typeof metric?.label === 'string' && FORBIDDEN_FORMAT_IN_VALUE.test(metric.label)) {
        violations.push(`${group.name}_formatted_label`);
      }
    }
  }

  const line3Signature = metricStructureSignature(entityDisplay?.line3?.metrics);
  const line4Signature = metricStructureSignature(entityDisplay?.line4?.metrics);
  const expandedSignature = metricStructureSignature(entityDisplay?.expanded?.fields);

  if (expandedSignature && (expandedSignature === line3Signature || expandedSignature === line4Signature)) {
    violations.push('expanded_reuses_compact_structure');
  }

  const expandedFields = entityDisplay?.expanded?.fields ?? [];
  if (expandedFields.length > 0 && !expandedFields.every((field) => field.label)) {
    violations.push('expanded_missing_labels');
  }

  if (entityDisplay?.line3?.metrics === entityDisplay?.expanded?.fields) {
    violations.push('expanded_reuses_line3_reference');
  }

  if (GLOBAL_DISPLAY_RULE.listRequiresMetrics && viewMode === VIEW_MODES.LIST) {
    if (!(entityDisplay?.line3?.metrics?.length > 0)) {
      violations.push('list_missing_metrics');
    }
  }

  if (GLOBAL_DISPLAY_RULE.mediumRequiresMetrics && viewMode === VIEW_MODES.MEDIUM) {
    const hasMetrics = (entityDisplay?.line3?.metrics?.length ?? 0) > 0
      || (entityDisplay?.line4?.metrics?.length ?? 0) > 0;
    if (!hasMetrics) {
      violations.push('medium_missing_metrics');
    }
  }

  const result = {
    ok: violations.length === 0,
    violations,
    fallback: GLOBAL_DISPLAY_RULE
  };

  if (!result.ok && isExperiment()) {
    console.warn('[UI RENDER CONTRACT]', { mode: viewMode, violations });
  }

  return result;
}

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
  const isExpanded = displayContext.expanded === true;

  const moneyFormat = isExpanded
    ? GLOBAL_MONEY_FORMAT_RULE.expanded
    : (GLOBAL_MONEY_FORMAT_RULE[viewMode] ?? GLOBAL_MONEY_FORMAT_RULE.full);

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
    clickBehavior: viewMode === VIEW_MODES.FULL && !isExpanded ? 'navigate' : 'expand',
    viewMode,
    expanded: isExpanded
  };

  return rules;
}

export function getExpandedDisplayRules(entityType, options = {}) {
  return getDisplayRules(createDisplayContext({
    entityType,
    viewMode: options.viewMode ?? VIEW_MODES.MEDIUM,
    expanded: true,
    entityContext: options.entityContext ?? {}
  }));
}

/** @deprecated Use validateEntityRenderContract */
export function validateEntityDisplay(entityType, displayPayload, mode) {
  void entityType;
  void displayPayload;
  return validateEntityRenderContract(createEmptyEntityDisplay(), mode);
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
