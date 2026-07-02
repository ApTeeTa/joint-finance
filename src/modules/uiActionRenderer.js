/**
 * Standard entity header action renderer — enforces GLOBAL_ACTION_RULE from uiRulesEngine.
 */
import { isExperiment } from '../config/environmentConfig.js';
import {
  ENTITY_TYPES,
  VIEW_MODES,
  getAllowedActions,
  getActionRenderClass,
  normalizeViewMode,
  isActionAllowedForEntity,
  resolveEntityActionGroups,
  getAllowedDetailActions,
  logUiActionRule,
  logUiMigrationPass,
  logUiUxFix,
  buildEntityDisplay,
  validateEntityRenderContract,
  validateModuleRawValues,
  formatEntityMoney,
  getDisplayRules,
  getExpandedDisplayRules,
  readRawMoney,
  RAW_VALUE_KEYS
} from './uiRulesEngine.js';
import {
  renderDisplayItem,
  renderDisplaySummaryParts,
  renderExpandedDetailView
} from './displayMode.js';
import { renderUiIcon } from './uiIcons.js';

const ICONS = {
  pencil: renderUiIcon('pencil'),
  trash: renderUiIcon('trash'),
  reserve: renderUiIcon('reserve'),
  unreserve: renderUiIcon('unreserve'),
  dots: renderUiIcon('dots')
};

const ENTITY_BINDINGS = Object.freeze({
  [ENTITY_TYPES.ACCOUNT]: Object.freeze({
    idAttr: 'data-account-id',
    idKey: 'accountId'
  }),
  [ENTITY_TYPES.CATEGORY]: Object.freeze({
    idAttr: 'data-category-id',
    idKey: 'categoryId'
  }),
  [ENTITY_TYPES.SAVING]: Object.freeze({
    idAttr: 'data-saving-id',
    idKey: 'savingId'
  }),
  [ENTITY_TYPES.OBLIGATION]: Object.freeze({
    idAttr: 'data-obligation-id',
    idKey: 'obligationId'
  }),
  [ENTITY_TYPES.DEBT]: Object.freeze({
    idAttr: 'data-debt-id',
    idKey: 'debtId'
  })
});

const ACTION_DEFS = Object.freeze({
  'open-topup': {
    title: 'Пополнить',
    markup: '+',
    tone: 'text-emerald-600 hover:bg-emerald-100 text-base leading-none font-semibold'
  },
  'open-transfer': {
    title: 'Перевести',
    markup: '⇄',
    tone: 'text-primary-600 hover:bg-primary-50 text-sm leading-none font-semibold'
  },
  'open-edit': {
    title: 'Редактировать',
    menuLabel: 'Редактировать',
    icon: 'pencil',
    tone: 'text-slate-400 hover:text-primary-600 hover:bg-primary-50',
    menuTone: 'text-slate-700 hover:bg-slate-50'
  },
  'delete-account': {
    title: 'Удалить',
    menuLabel: 'Удалить',
    icon: 'trash',
    tone: 'text-red-500 hover:bg-red-50',
    menuTone: 'text-red-600 hover:bg-red-50'
  },
  'open-reserve': {
    title: 'Пополнить',
    icon: 'reserve',
    tone: 'text-emerald-600 hover:bg-emerald-100'
  },
  'open-unreserve': {
    title: 'Вернуть',
    icon: 'unreserve',
    tone: 'text-slate-500 hover:bg-slate-200'
  },
  'open-expense': {
    title: 'Расход',
    markup: '−',
    tone: 'text-amber-600 hover:bg-amber-100 text-base leading-none font-semibold'
  },
  'fill-to-limit': {
    title: 'Пополнить до лимита',
    menuLabel: 'Пополнить до лимита',
    tone: 'text-emerald-600 hover:bg-emerald-100'
  },
  'delete-category': {
    title: 'Удалить',
    menuLabel: 'Удалить',
    icon: 'trash',
    menuTone: 'text-red-600 hover:bg-red-50'
  },
  'open-deposit-saving': {
    title: 'Пополнить',
    markup: '+',
    tone: 'text-emerald-600 hover:bg-emerald-100 text-base leading-none font-semibold'
  },
  'open-edit-saving': {
    title: 'Редактировать',
    menuLabel: 'Редактировать',
    icon: 'pencil',
    menuTone: 'text-slate-700 hover:bg-slate-50'
  },
  'delete-saving': {
    title: 'Удалить',
    menuLabel: 'Удалить',
    icon: 'trash',
    menuTone: 'text-red-600 hover:bg-red-50'
  },
  'open-reserve-obligation': {
    title: 'Зарезервировать',
    markup: '+',
    tone: 'text-emerald-600 hover:bg-emerald-100 text-base leading-none'
  },
  'open-unreserve-obligation': {
    title: 'Снять резерв',
    markup: '−',
    tone: 'text-slate-500 hover:bg-slate-200 text-base leading-none'
  },
  'open-edit-obligation': {
    title: 'Редактировать',
    menuLabel: 'Редактировать',
    icon: 'pencil',
    menuTone: 'text-slate-700 hover:bg-slate-50'
  },
  'delete-obligation': {
    title: 'Удалить',
    menuLabel: 'Удалить',
    icon: 'trash',
    menuTone: 'text-red-600 hover:bg-red-50'
  },
  'open-pay-obligation': {
    title: 'Оплатить',
    menuLabel: 'Оплатить',
    tone: 'text-primary-600 hover:bg-primary-50'
  },
  'open-repay-debt': {
    title: 'Погасить',
    markup: '+',
    menuLabel: 'Погасить',
    tone: 'text-emerald-600 hover:bg-emerald-100 text-base leading-none font-semibold'
  },
  'open-edit-manual-debt': {
    title: 'Редактировать',
    menuLabel: 'Редактировать',
    icon: 'pencil',
    menuTone: 'text-slate-700 hover:bg-slate-50'
  },
  'delete-manual-debt': {
    title: 'Удалить',
    menuLabel: 'Удалить',
    icon: 'trash',
    menuTone: 'text-red-600 hover:bg-red-50'
  },
  'open-write-off-debt': {
    title: 'Списать долг',
    menuLabel: 'Списать долг',
    menuTone: 'text-red-600 hover:bg-red-50'
  }
});

function resolveBinding(entityType) {
  return ENTITY_BINDINGS[entityType] ?? {
    idAttr: 'data-entity-id',
    idKey: 'entityId'
  };
}

function resolveActionContent(def) {
  if (def.markup) {
    return def.markup;
  }
  if (def.icon && ICONS[def.icon]) {
    return ICONS[def.icon];
  }
  return '';
}

function getOverflowTriggerClass(viewMode) {
  return normalizeViewMode(viewMode) === VIEW_MODES.LIST
    ? 'display-list-action'
    : 'display-card-action';
}

function normalizeActionGroups(groups, entityType, viewMode, entityContext = {}) {
  if (groups && !Array.isArray(groups) && Array.isArray(groups.primary)) {
    return groups;
  }

  if (Array.isArray(groups)) {
    const catalogPrimary = groups.filter((id) => !id.startsWith('open-edit') && !id.startsWith('delete-'));
    return {
      primary: catalogPrimary.filter((id) => isActionAllowedForEntity(id, entityType, entityContext)),
      secondary: groups.filter((id) => id.startsWith('open-edit') || id.startsWith('delete-'))
        .filter((id) => isActionAllowedForEntity(id, entityType, entityContext)),
      overflow: true
    };
  }

  return resolveEntityActionGroups(entityType, entityContext)
    ?? getAllowedActions(entityType, viewMode, entityContext);
}

export function renderPrimaryActions({
  entityType,
  entityId,
  viewMode,
  actionGroups,
  entityContext = {}
}) {
  const binding = resolveBinding(entityType);
  const groups = actionGroups ?? { primary: [], secondary: [], overflow: false };

  return groups.primary
    .filter((actionId) => isActionAllowedForEntity(actionId, entityType, entityContext))
    .map((actionId) => {
      const def = ACTION_DEFS[actionId];
      if (!def) {
        return '';
      }

      const visibilityClass = getActionRenderClass(actionId, entityType, viewMode);
      if (!visibilityClass) {
        return '';
      }

      return `
    <button
      type="button"
      data-action="${actionId}"
      ${binding.idAttr}="${entityId}"
      title="${def.title}"
      class="${visibilityClass} p-1.5 rounded-lg transition-colors ${def.tone ?? ''}"
    >${resolveActionContent(def)}</button>`;
    })
    .join('');
}

function detectLegacyInlineActions(html) {
  if (!html) {
    return false;
  }
  const hasOverflow = html.includes('toggle-overflow-menu');
  const inlineSecondary = /data-action="(?:open-edit|delete-|open-edit-saving|open-edit-obligation)/.test(html);
  return inlineSecondary && !hasOverflow;
}

export function renderOverflowMenuActions({
  entityType,
  entityId,
  viewMode,
  actionGroups,
  entityContext = {}
}) {
  const binding = resolveBinding(entityType);
  const groups = actionGroups ?? { primary: [], secondary: [], overflow: false };
  const secondary = groups.secondary.filter((actionId) => isActionAllowedForEntity(actionId, entityType, entityContext));
  const triggerClass = getOverflowTriggerClass(viewMode);
  const menuItems = secondary.map((actionId) => {
    const def = ACTION_DEFS[actionId];
    if (!def) {
      return '';
    }

    const label = def.menuLabel ?? def.title;
    const icon = def.icon && ICONS[def.icon] ? ICONS[def.icon] : '';
    const tone = def.menuTone ?? 'text-slate-700 hover:bg-slate-50';

    return `
        <button
          type="button"
          data-action="${actionId}"
          ${binding.idAttr}="${entityId}"
          class="w-full flex items-center gap-2 px-3 py-2 text-sm ${tone}"
          data-overflow-menu-action="true"
        >${icon}<span>${label}</span></button>`;
  }).join('');

  return `
    <div class="relative display-overflow-menu">
      <button
        type="button"
        data-action="toggle-overflow-menu"
        data-overflow-menu-id="${entityId}"
        ${binding.idAttr}="${entityId}"
        title="Меню"
        class="${triggerClass} p-1.5 rounded-lg text-slate-400 hover:bg-slate-200 transition-colors"
      >${ICONS.dots}</button>
      <div
        data-overflow-menu="${entityId}"
        class="display-overflow-menu-panel hidden"
      >
        ${menuItems}
      </div>
    </div>`;
}

function renderLegacyInlineActions({
  entityType,
  entityId,
  viewMode,
  actionIds,
  entityContext = {}
}) {
  const binding = resolveBinding(entityType);

  return actionIds
    .filter((actionId) => isActionAllowedForEntity(actionId, entityType, entityContext))
    .map((actionId) => {
      const def = ACTION_DEFS[actionId];
      if (!def) {
        return '';
      }

      const visibilityClass = getActionRenderClass(actionId, entityType, viewMode)
        ?? getOverflowTriggerClass(viewMode);

      return `
    <button
      type="button"
      data-action="${actionId}"
      ${binding.idAttr}="${entityId}"
      title="${def.title}"
      class="${visibilityClass} p-1.5 rounded-lg transition-colors ${def.tone ?? ''}"
    >${resolveActionContent(def)}</button>`;
    })
    .join('');
}

export function renderEntityHeaderActions({
  moduleKey,
  entityType,
  entityId,
  viewMode,
  displayRules = null,
  entityContext = {}
}) {
  const groups = normalizeActionGroups(
    resolveEntityActionGroups(entityType, entityContext),
    entityType,
    viewMode,
    entityContext
  );

  if (!groups) {
    if (isExperiment()) {
      console.warn('[UI ACTION RULE] rulesEngine missing — fallback to inline actions', {
        module: moduleKey,
        entityType
      });
    }
    const fallbackIds = Object.keys(ACTION_DEFS).filter((id) => {
      if (entityType === ENTITY_TYPES.ACCOUNT) {
        return id.includes('topup') || id.includes('transfer') || id.includes('edit') || id.includes('delete-account');
      }
      if (entityType === ENTITY_TYPES.CATEGORY) {
        return id.includes('reserve') || id.includes('expense') || id.includes('edit') || id.includes('delete-category');
      }
      if (entityType === ENTITY_TYPES.SAVING) {
        return id.includes('deposit') || id.includes('edit-saving') || id.includes('delete-saving');
      }
      if (entityType === ENTITY_TYPES.OBLIGATION) {
        return id.includes('obligation');
      }
      if (entityType === ENTITY_TYPES.DEBT) {
        return id.includes('repay') || id.includes('write-off');
      }
      return false;
    });
    const legacyHtml = renderLegacyInlineActions({
      entityType,
      entityId,
      viewMode,
      actionIds: fallbackIds,
      entityContext
    });
    logUiMigrationPass(moduleKey, viewMode, false, true);
    return legacyHtml;
  }

  logUiActionRule(moduleKey, entityType, groups);

  if (entityType === ENTITY_TYPES.CATEGORY && !categoryMinusUxFixLogged) {
    logUiUxFix('category_minus');
    categoryMinusUxFixLogged = true;
  }

  const html = [
    renderPrimaryActions({ entityType, entityId, viewMode, actionGroups: groups, entityContext }),
    renderOverflowMenuActions({ entityType, entityId, viewMode, actionGroups: groups, entityContext })
  ].join('');

  logUiMigrationPass(
    moduleKey,
    viewMode,
    html.includes('toggle-overflow-menu'),
    detectLegacyInlineActions(html)
  );

  return html;
}

const SHORT_MONEY_K_PATTERN = /\d[\d\s]*[kK]\b/;

function formatRawMetric(metric, rules, currency = 'RUB') {
  if (!metric) {
    return '—';
  }
  if (metric.type === 'money') {
    return formatEntityMoney(metric.value, currency, rules);
  }
  if (metric.type === 'percent') {
    return metric.value != null ? `${metric.value}%` : '—';
  }
  if (metric.type === 'number') {
    return metric.value != null ? String(metric.value) : '—';
  }
  return '—';
}

function renderMetricsInline(metrics, rules, currency) {
  return (metrics ?? []).map((metric) => formatRawMetric(metric, rules, currency)).join(' / ');
}

function flattenContractMetrics(contract) {
  const seen = new Set();
  const metrics = [];

  for (const metric of [
    ...(contract.line3?.metrics ?? []),
    ...(contract.line4?.metrics ?? [])
  ]) {
    if (!metric || seen.has(metric.key)) {
      continue;
    }
    seen.add(metric.key);
    metrics.push(metric);
  }

  return metrics;
}

function resolveMetricDisplayLabel(metric, entityType) {
  if (metric.label) {
    return metric.label;
  }

  const key = metric.key;

  if (entityType === ENTITY_TYPES.ACCOUNT && key === RAW_VALUE_KEYS.BALANCE) {
    return 'Баланс';
  }
  if (entityType === ENTITY_TYPES.SAVING && key === RAW_VALUE_KEYS.BALANCE) {
    return 'Накоплено';
  }
  if (entityType === ENTITY_TYPES.OBLIGATION && key === RAW_VALUE_KEYS.SPENT) {
    return 'Оплачено';
  }
  if (entityType === ENTITY_TYPES.DEBT && key === RAW_VALUE_KEYS.PAID) {
    return 'Погашено';
  }
  if (entityType === ENTITY_TYPES.DEBT && key === RAW_VALUE_KEYS.TOTAL) {
    return 'Сумма';
  }
  if (entityType === ENTITY_TYPES.DEBT && key === 'remaining') {
    return 'Остаток';
  }
  if (key === RAW_VALUE_KEYS.SPENT) {
    return 'Потрачено';
  }
  if (key === RAW_VALUE_KEYS.RESERVE) {
    return 'Резерв';
  }
  if (key === RAW_VALUE_KEYS.LIMIT) {
    return entityType === ENTITY_TYPES.OBLIGATION ? 'Сумма' : 'Лимит';
  }
  if (key === 'available') {
    return 'Доступно';
  }
  if (key === RAW_VALUE_KEYS.GOAL) {
    return 'Цель';
  }
  if (key === 'progress') {
    return 'Прогресс';
  }

  return key;
}

function renderMetricLine(metric, rules, currency, entityType) {
  const label = resolveMetricDisplayLabel(metric, entityType);
  const value = formatRawMetric(metric, rules, currency);

  return `
    <div class="display-item-line display-item-line--metric">
      <span class="display-item-metric-label">${escapeHtml(label)}:</span>
      <span class="display-item-metric-value">${escapeHtml(value)}</span>
    </div>
  `;
}

function renderMetricLines(metrics, rules, currency, entityType) {
  return (metrics ?? [])
    .map((metric) => renderMetricLine(metric, rules, currency, entityType))
    .join('');
}

function resolveDisplayMeta(meta, rules, currency, entityType) {
  if (meta) {
    return meta;
  }
  if (entityType === ENTITY_TYPES.ACCOUNT) {
    return rules?.labelDensity === 'verbose' ? `Баланс · ${currency}` : currency;
  }
  return '';
}

function renderContractSummaryParts(contract, rules, currency, entityType) {
  const listMetrics = renderMetricsInline(contract.line3?.metrics ?? [], rules, currency);
  const reserveLine = renderMetricsInline(contract.line3?.metrics ?? [], rules, currency);
  const limitLine = renderMetricsInline(contract.line4?.metrics ?? [], rules, currency);
  const hasLine4 = (contract.line4?.metrics?.length ?? 0) > 0;
  const isListMode = rules?.viewMode === VIEW_MODES.LIST;
  const isMediumMode = rules?.viewMode === VIEW_MODES.MEDIUM;

  if (isMediumMode) {
    return renderDisplaySummaryParts({
      title: contract.line1?.title ?? '',
      meta: resolveDisplayMeta(contract.line1?.meta ?? '', rules, currency, entityType),
      metricLinesHtml: renderMetricLines(
        flattenContractMetrics(contract),
        rules,
        currency,
        entityType
      )
    });
  }

  return renderDisplaySummaryParts({
    title: contract.line1?.title ?? '',
    meta: resolveDisplayMeta(contract.line1?.meta ?? '', rules, currency, entityType),
    value: isListMode ? '' : (hasLine4 ? '' : listMetrics),
    listMetrics: isListMode ? listMetrics : '',
    reserveLineHtml: hasLine4 && !isListMode ? reserveLine : '',
    limitLineHtml: hasLine4 && !isListMode ? limitLine : ''
  });
}

function renderExpandedFieldsGrid(fields, rules, currency) {
  const cells = (fields ?? []).map((field) => {
    const formatted = formatRawMetric(field, rules, currency);
    if (rules?.moneyFormat === 'full' && field.type === 'money' && SHORT_MONEY_K_PATTERN.test(formatted)) {
      if (isExperiment()) {
        console.warn('[UI RENDER CONTRACT]', { violation: 'expanded_k_format', key: field.key });
      }
    }
    return `
      <div>
        <span class="text-slate-500">${field.label ?? field.key}</span>
        <div class="font-medium text-slate-900">${formatted}</div>
      </div>
    `;
  }).join('');

  return `<div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">${cells}</div>`;
}

function computeLimitOverflow(rawValues) {
  const spent = readRawMoney(rawValues, RAW_VALUE_KEYS.SPENT);
  const limit = readRawMoney(rawValues, RAW_VALUE_KEYS.LIMIT);
  if (limit > 0 && spent > limit) {
    return spent - limit;
  }
  return 0;
}

function formatIsoDateLabel(isoDate) {
  if (!isoDate) {
    return '—';
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString('ru-RU');
}

function renderExpandedPrimaryBlock(entityType, contract, rules, currency, rawValues = {}, context = {}) {
  const fields = contract.expanded?.fields ?? [];

  if (entityType === ENTITY_TYPES.SAVING) {
    const accumulatedField = fields.find((field) => field.key === RAW_VALUE_KEYS.BALANCE);
    const goalField = fields.find((field) => field.key === RAW_VALUE_KEYS.GOAL);
    const progressField = fields.find((field) => field.key === 'progress');
    const progressBar = progressField?.value != null
      ? `
        <div class="mt-2">
          <div class="h-2 rounded-full bg-slate-200 overflow-hidden">
            <div class="h-full rounded-full bg-primary-500 transition-all" style="width: ${progressField.value}%"></div>
          </div>
        </div>
      `
      : '';
    const goalHtml = goalField && goalField.type === 'money'
      ? `<p class="text-sm text-slate-500 mt-1">Цель: ${formatRawMetric(goalField, rules, currency)}</p>`
      : '';

    return `
      ${progressBar}
      <div class="text-2xl font-bold text-slate-900 mt-2">${formatRawMetric(accumulatedField, rules, currency)}</div>
      ${goalHtml}
    `;
  }

  if (entityType === ENTITY_TYPES.DEBT) {
    const remainingField = fields.find((field) => field.key === 'remaining');
    const paidField = fields.find((field) => field.key === RAW_VALUE_KEYS.PAID);
    const totalField = fields.find((field) => field.key === RAW_VALUE_KEYS.TOTAL);
    return `
      <div class="text-2xl font-bold text-slate-900">${formatRawMetric(remainingField, rules, currency)}</div>
      <p class="text-sm text-slate-500 mt-2">${formatRawMetric(paidField, rules, currency)} / ${formatRawMetric(totalField, rules, currency)}</p>
      ${context.comment ? `<p class="text-sm text-slate-500 mt-2">${escapeHtml(context.comment)}</p>` : ''}
      ${context.eventDateIso ? `<p class="text-xs text-slate-400 mt-1">${formatIsoDateLabel(context.eventDateIso)}</p>` : ''}
    `;
  }

  if (entityType === ENTITY_TYPES.ACCOUNT || entityType === ENTITY_TYPES.CATEGORY) {
    const primaryField = fields[0];
    const primaryHtml = primaryField
      ? `<div class="text-2xl font-bold text-slate-900">${formatRawMetric(primaryField, rules, currency)}</div>`
      : '';
    const limitOverflow = computeLimitOverflow(rawValues);
    const warningHtml = limitOverflow > 0
      ? `
        <div class="mt-3 p-2.5 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 text-sm">
          ⚠ Вы превысили лимит категории на ${formatEntityMoney(limitOverflow, currency, rules)}. Рекомендуется увеличить лимит.
        </div>
      `
      : '';
    const gridHtml = entityType === ENTITY_TYPES.CATEGORY && fields.length > 1
      ? renderExpandedFieldsGrid(fields, rules, currency)
      : '';

    if (entityType === ENTITY_TYPES.CATEGORY && fields.length > 1) {
      return `${gridHtml}${warningHtml}`;
    }

    return `${primaryHtml}${warningHtml}`;
  }

  if (entityType === ENTITY_TYPES.OBLIGATION) {
    const dueHtml = context.paidUntil
      ? `
        <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mt-3">
          <div>
            <span class="text-slate-500">Срок</span>
            <div class="font-medium text-slate-900">${formatIsoDateLabel(context.paidUntil)}</div>
          </div>
        </div>
      `
      : '';
    return `${renderExpandedFieldsGrid(fields, rules, currency)}${dueHtml}`;
  }

  const primaryField = fields[0];
  return primaryField
    ? `<div class="text-2xl font-bold text-slate-900">${formatRawMetric(primaryField, rules, currency)}</div>`
    : '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Single render pipeline: rawValues → buildEntityDisplay → uiActionRenderer → DOM.
 */
export function renderEntityCard({
  moduleKey,
  entityType,
  entityId,
  dataAttr,
  dataValue,
  itemClass = '',
  title,
  meta = '',
  currency = 'RUB',
  rawValues = {},
  flags = {},
  context = {},
  entityContext = {},
  viewMode,
  displayRules,
  expandedContentHtml = ''
}) {
  const rules = displayRules ?? getDisplayRules({
    entityType,
    viewMode: normalizeViewMode(viewMode ?? VIEW_MODES.MEDIUM)
  });
  const mode = rules.viewMode;

  const rawValidation = validateModuleRawValues(rawValues);
  if (!rawValidation.ok && isExperiment()) {
    console.warn('[UI RAW VALUES]', { violations: rawValidation.violations });
  }

  const entity = {
    entityType,
    title,
    meta,
    rawValues,
    flags
  };

  const contract = buildEntityDisplay(entity, mode);
  validateEntityRenderContract(contract, mode, rawValues);

  const summaryParts = renderContractSummaryParts(contract, rules, currency, entityType);

  const actionsHtml = renderEntityHeaderActions({
    moduleKey,
    entityType,
    entityId,
    viewMode: mode,
    displayRules: rules,
    entityContext
  });

  const expandedRules = getExpandedDisplayRules(entityType, {
    viewMode: mode,
    entityContext
  });

  const expandedInfoHtml = renderExpandedPrimaryBlock(
    entityType,
    contract,
    expandedRules,
    currency,
    rawValues,
    context
  );

  const detailHtml = renderExpandedDetailView({
    title: contract.line1.title,
    meta: resolveDisplayMeta(contract.line1.meta, expandedRules, currency, entityType),
    infoHtml: expandedInfoHtml,
    actionsHtml: renderEntityExpandedActions({
      entityType,
      entityId,
      viewMode: mode,
      entityContext
    }),
    contentHtml: expandedContentHtml
  });

  return renderDisplayItem({
    moduleKey,
    itemId: entityId,
    dataAttr,
    dataValue: dataValue ?? entityId,
    summaryTitleHtml: summaryParts.titleHtml,
    summaryMetricsHtml: summaryParts.metricsHtml,
    actionsHtml,
    detailHtml,
    itemClass
  });
}

/** Expanded card: all actions as visible buttons (no overflow-only). */
export function renderEntityExpandedActions({
  entityType,
  entityId,
  viewMode,
  entityContext = {}
}) {
  const groups = normalizeActionGroups(
    resolveEntityActionGroups(entityType, entityContext),
    entityType,
    viewMode,
    entityContext
  );
  const detailActions = getAllowedDetailActions(entityType) ?? [];
  const binding = resolveBinding(entityType);

  const actionIds = [...new Set([
    ...(groups?.primary ?? []),
    ...(groups?.secondary ?? []),
    ...detailActions
  ])].filter((actionId) => isActionAllowedForEntity(actionId, entityType, entityContext));

  const buttons = actionIds.map((actionId) => {
    const def = ACTION_DEFS[actionId];
    if (!def) {
      return '';
    }

    const label = def.menuLabel ?? def.title;
    const isDestructive = actionId.startsWith('delete') || actionId.includes('write-off');
    const btnClass = isDestructive
      ? 'bg-red-50 text-red-700 hover:bg-red-100'
      : 'bg-primary-600 text-white hover:bg-primary-700';

    return `
      <button
        type="button"
        data-action="${actionId}"
        ${binding.idAttr}="${entityId}"
        class="px-3 py-2 text-sm font-medium rounded-lg transition-colors ${btnClass}"
      >${label}</button>`;
  }).join('');

  return buttons;
}

export function closeAllOverflowMenus() {
  document.querySelectorAll('[data-overflow-menu]').forEach((menu) => {
    menu.classList.add('hidden');
  });
}

let overflowUxFixLogged = false;
let categoryMinusUxFixLogged = false;

export function initOverflowMenuHandlers() {
  if (document.body.dataset.overflowMenuHandlersBound === 'true') {
    return;
  }
  document.body.dataset.overflowMenuHandlersBound = 'true';

  if (!overflowUxFixLogged) {
    logUiUxFix('overflow_menu');
    overflowUxFixLogged = true;
  }

  document.addEventListener('click', (event) => {
    const toggleBtn = event.target.closest('[data-action="toggle-overflow-menu"]');
    if (toggleBtn) {
      event.stopPropagation();
      const menuId = toggleBtn.dataset.overflowMenuId;
      const menu = document.querySelector(`[data-overflow-menu="${menuId}"]`);
      if (menu) {
        const isHidden = menu.classList.contains('hidden');
        closeAllOverflowMenus();
        if (isHidden) {
          menu.classList.remove('hidden');
        }
      }
      return;
    }

    if (event.target.closest('[data-overflow-menu-action]')) {
      closeAllOverflowMenus();
      return;
    }

    if (!event.target.closest('[data-overflow-menu]')) {
      closeAllOverflowMenus();
    }
  });
}
