/**
 * Domain-agnostic mutation execution engine.
 *
 * SUPPORTED DOMAINS:
 * - account (reference implementation in accounts.js)
 * - category (categories.js)
 * - obligation (obligations.js)
 * - saving (savings.js)
 *
 * Pipeline:
 * 1. dispatch(action)
 * 2. dispatch.ok → normalizeMutationResult → applyMutationResult
 *
 * Architectural guard (dev-only): architectureGuard.js
 */
import { isExperiment } from '../config/environmentConfig.js';
import {
  validateMutationStrategy,
  guardUnregisteredMutationStrategy,
  beginMutationPipeline,
  endMutationPipeline,
  guardApplyMutationResultEntry,
  beginApplyMutation,
  endApplyMutation
} from './architectureGuard.js';

export const MUTATION_DOMAINS = Object.freeze({
  ACCOUNT: 'account',
  CATEGORY: 'category',
  OBLIGATION: 'obligation',
  SAVING: 'saving'
});

const strategyRegistry = new Map();

function strategyKey(domain, actionType) {
  return `${domain}:${actionType}`;
}

/**
 * Register domain mutation strategy for an action type.
 * Strategy shape: { resolveEntityId, apply }
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
  if (!isExperiment()) {
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

    if (dispatchResult?.ok !== true) {
      logMutationExecution({
        domain,
        actionType,
        entityId,
        source: 'dispatch',
        ok: false
      });
      if (dispatchResult?.error) {
        alert(dispatchResult.error);
      }
      return false;
    }

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
  } finally {
    endMutationPipeline();
  }
}
