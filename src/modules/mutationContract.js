/**
 * Domain-agnostic mutation execution engine.
 *
 * SUPPORTED DOMAINS:
 * - account (reference implementation in accounts.js)
 * - category (future)
 * - saving (future)
 * - obligation (future)
 *
 * Pipeline:
 * 1. dispatch(action)
 * 2. dispatch.ok → normalizeMutationResult → applyMutationResult
 * 3. else → runLegacyFallback → normalizeMutationResult → applyMutationResult
 *
 * Architectural guard (dev-only): architectureGuard.js
 */
import { IS_EXPERIMENT } from '../config/environment.js';
import {
  validateMutationStrategy,
  guardUnregisteredMutationStrategy,
  beginMutationPipeline,
  endMutationPipeline,
  beginLegacyPipeline,
  endLegacyPipeline,
  beginLegacyFallbackAccess,
  endLegacyFallbackAccess,
  guardApplyMutationResultEntry,
  beginApplyMutation,
  endApplyMutation
} from './architectureGuard.js';

export const MUTATION_DOMAINS = Object.freeze({
  ACCOUNT: 'account'
  // CATEGORY: 'category',
  // SAVING: 'saving',
  // OBLIGATION: 'obligation'
});

const strategyRegistry = new Map();

function strategyKey(domain, actionType) {
  return `${domain}:${actionType}`;
}

/**
 * Register domain mutation strategy for an action type.
 * Strategy shape: { resolveEntityId, runFallback, apply }
 * Strategies MUST NOT mutate state except via apply invoked by the engine.
 */
export function registerMutationStrategy(domain, actionType, strategy) {
  validateMutationStrategy(domain, actionType, strategy);
  strategyRegistry.set(strategyKey(domain, actionType), strategy);
}

/**
 * Pure mapping — returns strategy for domain/action; does not mutate state.
 */
export function getMutationStrategy(domain, actionType) {
  return strategyRegistry.get(strategyKey(domain, actionType)) ?? null;
}

export function normalizeMutationResult({
  domain,
  source,
  data,
  actionType,
  entityId,
  state,
  payload
}) {
  const strategy = getMutationStrategy(domain, actionType);
  const resolvedEntityId = entityId
    ?? strategy?.resolveEntityId?.(payload)
    ?? payload?.entityId
    ?? null;

  return {
    domain,
    actionType,
    entityId: resolvedEntityId,
    source,
    ok: data?.ok !== false,
    state,
    payload: { ...payload }
  };
}

export function runLegacyFallback(domain, actionType, state, payload) {
  beginLegacyFallbackAccess({ domain, actionType });
  try {
    const strategy = getMutationStrategy(domain, actionType);
    if (!strategy?.runFallback) {
      guardUnregisteredMutationStrategy(domain, actionType);
      return { ok: false };
    }
    return strategy.runFallback(state, payload);
  } finally {
    endLegacyFallbackAccess();
  }
}

/**
 * Single domain-agnostic mutation sink — delegates to registered strategy.apply.
 */
export function applyMutationResult(result) {
  guardApplyMutationResultEntry({
    domain: result.domain,
    actionType: result.actionType
  });

  const strategy = getMutationStrategy(result.domain, result.actionType);
  if (!strategy?.apply) {
    guardUnregisteredMutationStrategy(result.domain, result.actionType);
    return false;
  }

  beginApplyMutation();
  try {
    return strategy.apply(result);
  } finally {
    endApplyMutation();
  }
}

export function logMutationExecution({ domain, actionType, entityId, source, ok }) {
  if (!IS_EXPERIMENT) {
    return;
  }
  console.info('[mutation] execution', {
    domain,
    actionType,
    entityId: entityId ?? null,
    source,
    ok: ok ?? false
  });
}

export function executeMutation({
  domain,
  actionType,
  entityId,
  state,
  dispatchPayload,
  payload,
  dispatchFn,
  dispatchMeta = {}
}) {
  beginMutationPipeline();
  try {
    const dispatchResult = dispatchFn({
      type: actionType,
      payload: dispatchPayload,
      meta: dispatchMeta
    });

    if (dispatchResult?.ok === true) {
      const normalized = normalizeMutationResult({
        domain,
        source: 'dispatch',
        data: dispatchResult,
        actionType,
        entityId,
        state,
        payload
      });
      const ok = applyMutationResult(normalized);
      logMutationExecution({
        domain,
        actionType,
        entityId: normalized.entityId,
        source: 'dispatch',
        ok
      });
      return ok;
    }

    const fallbackResult = runLegacyFallback(domain, actionType, state, payload);
    if (fallbackResult?.ok === false) {
      logMutationExecution({
        domain,
        actionType,
        entityId,
        source: 'fallback',
        ok: false
      });
      if (dispatchResult?.error) {
        alert(dispatchResult.error);
      }
      return false;
    }

    const normalized = normalizeMutationResult({
      domain,
      source: 'fallback',
      data: fallbackResult,
      actionType,
      entityId,
      state,
      payload
    });
    const ok = applyMutationResult(normalized);
    logMutationExecution({
      domain,
      actionType,
      entityId: normalized.entityId,
      source: 'fallback',
      ok
    });

    if (!ok && dispatchResult?.error) {
      alert(dispatchResult.error);
    }

    return ok;
  } finally {
    endMutationPipeline();
  }
}

export function executeLegacyMutation({
  domain,
  actionType,
  entityId,
  state,
  payload
}) {
  beginLegacyPipeline();
  try {
    const fallbackResult = runLegacyFallback(domain, actionType, state, payload);
    if (fallbackResult?.ok === false) {
      logMutationExecution({
        domain,
        actionType,
        entityId,
        source: 'fallback',
        ok: false
      });
      return false;
    }

    const normalized = normalizeMutationResult({
      domain,
      source: 'fallback',
      data: fallbackResult,
      actionType,
      entityId,
      state,
      payload
    });
    const ok = applyMutationResult(normalized);
    logMutationExecution({
      domain,
      actionType,
      entityId: normalized.entityId,
      source: 'fallback',
      ok
    });
    return ok;
  } finally {
    endLegacyPipeline();
  }
}
