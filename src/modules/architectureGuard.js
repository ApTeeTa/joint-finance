/**
 * Architectural enforcement layer (dev-only observability).
 * Detects drift from mutationContract patterns — never blocks production execution.
 */
import { isExperiment } from '../config/environmentConfig.js';

const REQUIRED_STRATEGY_METHODS = ['resolveEntityId', 'runFallback', 'apply'];

let mutationPipelineDepth = 0;
let legacyPipelineDepth = 0;
let legacyFallbackDepth = 0;
let applyMutationDepth = 0;

export function logArchGuardViolation({
  violationType,
  domain = null,
  actionType = null,
  module = 'unknown'
}) {
  if (!isExperiment()) {
    return;
  }
  console.warn('[ARCH GUARD]', {
    violationType,
    domain,
    actionType,
    module,
    severity: 'warning'
  });
}

function inferModuleFromStack(stack) {
  if (!stack) {
    return 'unknown';
  }
  const lines = stack.split('\n').slice(2);
  for (const line of lines) {
    const match = line.match(/[/\\](src[/\\][\w./\\-]+\.js)/);
    if (match && !match[1].includes('architectureGuard.js')) {
      return match[1].replace(/\\/g, '/');
    }
  }
  return 'unknown';
}

export function validateMutationStrategy(domain, actionType, strategy, module = 'mutationContract') {
  if (!isExperiment()) {
    return true;
  }

  const missing = REQUIRED_STRATEGY_METHODS.filter(
    (method) => typeof strategy?.[method] !== 'function'
  );

  if (missing.length) {
    logArchGuardViolation({
      violationType: 'incomplete_mutation_strategy',
      domain,
      actionType,
      module
    });
  }

  return missing.length === 0;
}

export function guardUnregisteredMutationStrategy(domain, actionType, module = 'mutationContract') {
  if (!isExperiment()) {
    return;
  }
  logArchGuardViolation({
    violationType: 'unregistered_mutation_strategy',
    domain,
    actionType,
    module
  });
}

export function beginMutationPipeline() {
  if (!isExperiment()) {
    return;
  }
  mutationPipelineDepth += 1;
}

export function endMutationPipeline() {
  if (!isExperiment()) {
    return;
  }
  mutationPipelineDepth = Math.max(0, mutationPipelineDepth - 1);
}

export function beginLegacyPipeline() {
  if (!isExperiment()) {
    return;
  }
  legacyPipelineDepth += 1;
}

export function endLegacyPipeline() {
  if (!isExperiment()) {
    return;
  }
  legacyPipelineDepth = Math.max(0, legacyPipelineDepth - 1);
}

export function beginLegacyFallbackAccess({ domain, actionType, module = 'mutationContract' }) {
  if (!isExperiment()) {
    return;
  }

  if (mutationPipelineDepth === 0 && legacyPipelineDepth === 0) {
    logArchGuardViolation({
      violationType: 'legacy_fallback_outside_pipeline',
      domain,
      actionType,
      module
    });
  }

  legacyFallbackDepth += 1;
}

export function endLegacyFallbackAccess() {
  if (!isExperiment()) {
    return;
  }
  legacyFallbackDepth = Math.max(0, legacyFallbackDepth - 1);
}

export function guardApplyMutationResultEntry({ domain, actionType, module = 'mutationContract' }) {
  if (!isExperiment()) {
    return;
  }

  if (mutationPipelineDepth === 0 && legacyPipelineDepth === 0) {
    logArchGuardViolation({
      violationType: 'apply_outside_mutation_pipeline',
      domain,
      actionType,
      module
    });
  }
}

export function beginApplyMutation() {
  if (!isExperiment()) {
    return;
  }
  applyMutationDepth += 1;
}

export function endApplyMutation() {
  if (!isExperiment()) {
    return;
  }
  applyMutationDepth = Math.max(0, applyMutationDepth - 1);
}

export function warnDirectStateMutation(module, detail = null) {
  if (!isExperiment()) {
    return;
  }

  if (applyMutationDepth > 0) {
    return;
  }

  logArchGuardViolation({
    violationType: 'direct_state_mutation_suspected',
    domain: null,
    actionType: detail,
    module
  });
}

export function installSupabaseWriteGuard(supabaseClient) {
  if (!isExperiment() || !supabaseClient?.from || supabaseClient.__archGuardInstalled) {
    return;
  }

  const originalFrom = supabaseClient.from.bind(supabaseClient);
  const writeMethods = ['insert', 'update', 'delete', 'upsert'];

  supabaseClient.from = (table) => {
    const query = originalFrom(table);

    writeMethods.forEach((method) => {
      if (typeof query[method] !== 'function') {
        return;
      }

      const originalMethod = query[method].bind(query);
      query[method] = (...args) => {
        const stack = new Error().stack ?? '';
        if (!stack.includes('stateRemote')) {
          logArchGuardViolation({
            violationType: 'direct_supabase_write',
            domain: null,
            actionType: `${method}:${table}`,
            module: inferModuleFromStack(stack)
          });
        }
        return originalMethod(...args);
      };
    });

    return query;
  };

  supabaseClient.__archGuardInstalled = true;
}

if (isExperiment()) {
  import('../lib/supabase.js')
    .then(({ supabase }) => installSupabaseWriteGuard(supabase))
    .catch(() => {});
}
