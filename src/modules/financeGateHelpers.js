import { validateAvailableFunds } from './financeValidation.js';
import {
  evaluateBudgetRules,
  mergeGateAndRulesDecisions
} from './financeRulesEngine.js';
import {
  FINANCE_ENTRY_POINT_VALUES,
  OPERATION_TO_ENTRY_POINT
} from './financeEntryRegistry.js';
import { FINANCE_ENFORCEMENT_MODE } from './financeEnforcement.js';

let activeEntryPoint = null;
let internalFinanceDepth = 0;

export function getActiveEntryPoint() {
  return activeEntryPoint;
}

export function withGateContext(entryPoint, fn) {
  const previous = activeEntryPoint;
  activeEntryPoint = entryPoint;
  try {
    return fn();
  } finally {
    activeEntryPoint = previous;
  }
}

export function withInternalFinanceContext(fn) {
  internalFinanceDepth += 1;
  try {
    return fn();
  } finally {
    internalFinanceDepth -= 1;
  }
}

export function requireFinanceEntryPoint(operation) {
  if (!FINANCE_ENFORCEMENT_MODE || internalFinanceDepth > 0) {
    return { allowed: true };
  }

  const expectedEntry = OPERATION_TO_ENTRY_POINT[operation];
  if (!activeEntryPoint) {
    return {
      allowed: false,
      decision: 'BLOCK',
      error: 'Финансовая операция заблокирована: требуется вызов через financeGate.'
    };
  }

  if (expectedEntry && activeEntryPoint !== expectedEntry) {
    return {
      allowed: false,
      decision: 'BLOCK',
      error: 'Финансовая операция заблокирована: неверная точка входа.'
    };
  }

  return { allowed: true };
}

export function assertCalledFromAllowedEntryPoint(context) {
  const operation = context?.operation;
  const expectedEntry = operation ? OPERATION_TO_ENTRY_POINT[operation] : null;
  const check = {
    operation,
    expectedEntry,
    activeEntry: activeEntryPoint,
    context: context ?? null
  };

  console.log('[FINANCE GATE CHECK]', check);

  if (!FINANCE_ENFORCEMENT_MODE) {
    if (!context) {
      console.warn('[FINANCE GATE WARNING] Direct call detected', { reason: 'missing context' });
      return check;
    }

    if (!activeEntryPoint) {
      console.warn('[FINANCE GATE WARNING] Direct call detected', {
        operation,
        expectedEntry
      });
      return check;
    }

    if (expectedEntry && activeEntryPoint !== expectedEntry) {
      console.warn('[FINANCE GATE WARNING] Entry point mismatch', {
        operation,
        expectedEntry,
        activeEntry: activeEntryPoint
      });
    }
  }

  return check;
}

export function blockIfGateRejected(gateDecision) {
  if (gateDecision?.decision === 'BLOCK' || gateDecision?.ok === false) {
    return {
      ok: false,
      error: gateDecision.reason || gateDecision.error || 'Операция заблокирована финансовым gate.'
    };
  }
  return null;
}

function buildGateDecision(validation) {
  if (validation.ok) {
    return {
      decision: 'ALLOW',
      ok: true,
      warnings: []
    };
  }

  return {
    decision: 'WARN',
    ok: true,
    warnings: [validation.reason],
    reason: validation.reason
  };
}

export function runFinanceGate(operation, amount, state, extra = {}) {
  const entryGuard = requireFinanceEntryPoint(operation);
  if (!entryGuard.allowed) {
    const blocked = {
      decision: 'BLOCK',
      ok: false,
      error: entryGuard.error,
      reason: entryGuard.error,
      warnings: [entryGuard.error]
    };
    console.log('[FINANCE GATE]', {
      operation,
      amount,
      decision: blocked,
      entryPoint: activeEntryPoint,
      ...extra
    });
    return blocked;
  }

  assertCalledFromAllowedEntryPoint({ operation, ...extra });

  const validation = validateAvailableFunds(amount, state);
  const gateDecision = buildGateDecision(validation);
  const rulesDecision = evaluateBudgetRules({
    operation,
    amount,
    state,
    ...extra
  });
  const decision = mergeGateAndRulesDecisions(gateDecision, rulesDecision);

  if (decision.decision === 'BLOCK') {
    decision.ok = false;
  }

  console.log('[FINANCE GATE]', {
    operation,
    amount,
    validation,
    gateDecision,
    rulesDecision,
    decision,
    entryPoint: activeEntryPoint,
    ...extra
  });

  return decision;
}

export function isRegisteredEntryPoint(entryPoint) {
  return FINANCE_ENTRY_POINT_VALUES.has(entryPoint);
}

export { FINANCE_ENFORCEMENT_MODE };
