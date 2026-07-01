/**
 * Phase 1 — Action Contract Registry
 * Central dispatch layer for ActionIntents → financeGate.
 * Legacy UI may still call financeGate directly; this module is an additive wrapper.
 */
import { isExperiment } from '../config/environmentConfig.js';
import {
  createAccount,
  updateAccountRecord,
  deleteAccountRecord,
  deleteCategory,
  createSaving,
  updateSavingRecord,
  deleteSavingRecord
} from './financeGate.js';

/** Log dispatch activity in experiment / local dev builds only. */
const DEV_LOGGING = isExperiment();

export const ACTION_TYPES = Object.freeze({
  ACCOUNT_CREATE: 'ACCOUNT_CREATE',
  ACCOUNT_UPDATE: 'ACCOUNT_UPDATE',
  ACCOUNT_DELETE: 'ACCOUNT_DELETE',
  CATEGORY_CREATE: 'CATEGORY_CREATE',
  CATEGORY_UPDATE: 'CATEGORY_UPDATE',
  CATEGORY_DELETE: 'CATEGORY_DELETE',
  SAVING_CREATE: 'SAVING_CREATE',
  SAVING_UPDATE: 'SAVING_UPDATE',
  SAVING_DELETE: 'SAVING_DELETE',
  OBLIGATION_CREATE: 'OBLIGATION_CREATE',
  OBLIGATION_UPDATE: 'OBLIGATION_UPDATE',
  OBLIGATION_DELETE: 'OBLIGATION_DELETE',
  RATE_UPDATE: 'RATE_UPDATE'
});

const REGISTERED_TYPES = new Set(Object.values(ACTION_TYPES));

/**
 * Phase 1: lifecycle actions wired to existing financeGate exports.
 * Phase 2 will add handlers for not-yet-implemented types.
 */
const IMPLEMENTED_TYPES = new Set([
  ACTION_TYPES.ACCOUNT_CREATE,
  ACTION_TYPES.ACCOUNT_UPDATE,
  ACTION_TYPES.ACCOUNT_DELETE,
  ACTION_TYPES.CATEGORY_DELETE,
  ACTION_TYPES.SAVING_CREATE,
  ACTION_TYPES.SAVING_UPDATE,
  ACTION_TYPES.SAVING_DELETE
]);

const PHASE2_PENDING_MESSAGE = 'Действие зарегистрировано, обработчик будет добавлен в Phase 2';

function devLog(level, message, detail) {
  if (!DEV_LOGGING) {
    return;
  }
  const prefix = '[actionRegistry]';
  if (level === 'warn') {
    console.warn(prefix, message, detail ?? '');
  } else {
    console.info(prefix, message, detail ?? '');
  }
}

function missingPayloadError(field) {
  return { ok: false, error: `Отсутствует обязательное поле payload.${field}` };
}

function notImplementedResult(type) {
  devLog('warn', `Phase 2 pending: ${type}`);
  return { ok: false, error: PHASE2_PENDING_MESSAGE, pending: true, type };
}

function routeToGate(type, payload) {
  const { state } = payload;

  switch (type) {
    case ACTION_TYPES.ACCOUNT_CREATE: {
      const { account, initialBalance, author } = payload;
      if (!account) return missingPayloadError('account');
      if (author == null) return missingPayloadError('author');
      return createAccount(state, account, initialBalance ?? 0, author);
    }

    case ACTION_TYPES.ACCOUNT_UPDATE: {
      const { accountId, changes, author } = payload;
      if (!accountId) return missingPayloadError('accountId');
      if (!changes) return missingPayloadError('changes');
      if (author == null) return missingPayloadError('author');
      return updateAccountRecord(state, accountId, changes, author);
    }

    case ACTION_TYPES.ACCOUNT_DELETE: {
      const { account, author } = payload;
      if (!account) return missingPayloadError('account');
      if (author == null) return missingPayloadError('author');
      return deleteAccountRecord(state, account, author);
    }

    case ACTION_TYPES.CATEGORY_DELETE: {
      const { category, author } = payload;
      if (!category) return missingPayloadError('category');
      if (author == null) return missingPayloadError('author');
      return deleteCategory(state, category, author);
    }

    case ACTION_TYPES.SAVING_CREATE: {
      const { saving, author } = payload;
      if (!saving) return missingPayloadError('saving');
      if (author == null) return missingPayloadError('author');
      return createSaving(state, saving, author);
    }

    case ACTION_TYPES.SAVING_UPDATE: {
      const { savingId, changes, author } = payload;
      if (!savingId) return missingPayloadError('savingId');
      if (!changes) return missingPayloadError('changes');
      if (author == null) return missingPayloadError('author');
      return updateSavingRecord(state, savingId, changes, author);
    }

    case ACTION_TYPES.SAVING_DELETE: {
      const { saving, author, customComment, options } = payload;
      if (!saving) return missingPayloadError('saving');
      if (author == null) return missingPayloadError('author');
      return deleteSavingRecord(state, saving, author, customComment, options);
    }

    case ACTION_TYPES.CATEGORY_CREATE:
    case ACTION_TYPES.CATEGORY_UPDATE:
    case ACTION_TYPES.OBLIGATION_CREATE:
    case ACTION_TYPES.OBLIGATION_UPDATE:
    case ACTION_TYPES.OBLIGATION_DELETE:
    case ACTION_TYPES.RATE_UPDATE:
      return notImplementedResult(type);

    default:
      return null;
  }
}

export function isRegisteredActionType(type) {
  return REGISTERED_TYPES.has(type);
}

export function isImplementedActionType(type) {
  return IMPLEMENTED_TYPES.has(type);
}

export function getRegisteredActionTypes() {
  return Object.values(ACTION_TYPES);
}

/**
 * Dispatch an ActionIntent through financeGate.
 *
 * @param {{ type: string, payload?: object, meta?: { source?: string } }} action
 * @returns {object} Gate result ({ ok, error?, … }) or registry error envelope
 */
export function dispatch(action) {
  const type = action?.type;
  const payload = action?.payload ?? {};
  const meta = action?.meta ?? {};
  const source = meta.source ?? 'unknown';

  if (!type || typeof type !== 'string') {
    const error = 'Не указан type действия';
    devLog('warn', error, { action, source });
    return { ok: false, error };
  }

  if (!isRegisteredActionType(type)) {
    const error = `Неизвестный тип действия: ${type}`;
    devLog('warn', error, { source });
    return { ok: false, error, unknown: true, type };
  }

  if (!payload.state || typeof payload.state !== 'object') {
    const error = 'Отсутствует payload.state';
    devLog('warn', error, { type, source });
    return { ok: false, error };
  }

  devLog('info', `dispatch ${type}`, { source });

  let result;
  try {
    result = routeToGate(type, payload);
    if (result == null) {
      const error = `Неизвестный тип действия: ${type}`;
      devLog('warn', error, { source });
      return { ok: false, error, unknown: true, type };
    }
  } catch (error) {
    devLog('warn', `dispatch failed: ${type}`, { source, error: String(error) });
    return { ok: false, error: error?.message ?? String(error), type };
  }

  if (result?.ok) {
    devLog('info', `dispatch ok: ${type}`, { source });
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      import('../lib/offlineActionsQueue.js').then(({ enqueueRegistryAction }) => {
        enqueueRegistryAction(type, payload);
      });
    }
  } else {
    devLog('warn', `dispatch rejected: ${type}`, { source, error: result?.error });
  }

  return result;
}

export class ActionRegistryError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ActionRegistryError';
    this.details = details;
  }
}
