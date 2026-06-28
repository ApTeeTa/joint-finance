/**
 * Standard entity header action renderer — enforces GLOBAL_ACTION_RULE from uiRulesEngine.
 */
import { IS_EXPERIMENT } from '../config/environment.js';
import {
  ENTITY_TYPES,
  VIEW_MODES,
  getAllowedActions,
  getActionRenderClass,
  normalizeViewMode,
  logUiActionRule,
  logUiMigrationPass
} from './uiRulesEngine.js';
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
  'open-repay-debt': {
    title: 'Погасить',
    markup: '₽',
    menuLabel: 'Погасить',
    tone: 'text-primary-600 hover:bg-primary-50 text-sm leading-none font-semibold'
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

function normalizeActionGroups(groups, entityType, viewMode) {
  if (groups && !Array.isArray(groups) && Array.isArray(groups.primary)) {
    return groups;
  }

  if (Array.isArray(groups)) {
    const allowed = new Set(groups);
    const catalogPrimary = groups.filter((id) => !id.startsWith('open-edit') && !id.startsWith('delete-'));
    return {
      primary: catalogPrimary,
      secondary: groups.filter((id) => id.startsWith('open-edit') || id.startsWith('delete-')),
      overflow: true
    };
  }

  return getAllowedActions(entityType, viewMode);
}

export function renderPrimaryActions({
  entityType,
  entityId,
  viewMode,
  actionGroups,
  filterAction = () => true
}) {
  const binding = resolveBinding(entityType);
  const groups = actionGroups ?? { primary: [], secondary: [], overflow: false };

  return groups.primary
    .filter((actionId) => filterAction(actionId))
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
  filterAction = () => true
}) {
  const binding = resolveBinding(entityType);
  const groups = actionGroups ?? { primary: [], secondary: [], overflow: false };
  const secondary = groups.secondary.filter((actionId) => filterAction(actionId));
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
        class="hidden absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-20 min-w-[140px]"
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
  filterAction = () => true
}) {
  const binding = resolveBinding(entityType);

  return actionIds
    .filter((actionId) => filterAction(actionId))
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
  filterAction = () => true
}) {
  const groups = normalizeActionGroups(
    displayRules?.allowedActions ?? getAllowedActions(entityType, viewMode),
    entityType,
    viewMode
  );

  if (!groups) {
    if (IS_EXPERIMENT) {
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
        return id.includes('reserve') || id.includes('unreserve') || id.includes('edit') || id.includes('delete-category');
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
      filterAction
    });
    logUiMigrationPass(moduleKey, viewMode, false, true);
    return legacyHtml;
  }

  logUiActionRule(moduleKey, entityType, groups);

  const html = [
    renderPrimaryActions({ entityType, entityId, viewMode, actionGroups: groups, filterAction }),
    renderOverflowMenuActions({ entityType, entityId, viewMode, actionGroups: groups, filterAction })
  ].join('');

  logUiMigrationPass(
    moduleKey,
    viewMode,
    html.includes('toggle-overflow-menu'),
    detectLegacyInlineActions(html)
  );

  return html;
}

function closeAllOverflowMenus() {
  document.querySelectorAll('[data-overflow-menu]').forEach((menu) => {
    menu.classList.add('hidden');
  });
}

export function initOverflowMenuHandlers() {
  if (document.body.dataset.overflowMenuHandlersBound === 'true') {
    return;
  }
  document.body.dataset.overflowMenuHandlersBound = 'true';

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

    if (!event.target.closest('[data-overflow-menu]')) {
      closeAllOverflowMenus();
    }
  });
}
