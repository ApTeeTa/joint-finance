import {
  calculateFreeBalance,
  calculateTotalBalance
} from './financeEngine.js';
import { computePaidUntilFromPayments } from './obligationPaidUntil.js';

const DECISION_RANK = {
  ALLOW: 0,
  WARN: 1,
  BLOCK: 2
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function findCategory(state, categoryId) {
  return (state.categories ?? []).find((category) => category.id === categoryId);
}

function findSaving(state, savingId) {
  return (state.savings ?? []).find((saving) => saving.id === savingId);
}

function getSavingAccumulated(saving) {
  return saving?.accumulated ?? saving?.amount ?? 0;
}

function hasOverdueObligations(state) {
  return (state.obligations ?? []).some((obligation) => {
    const paidUntil = computePaidUntilFromPayments(obligation);
    return paidUntil && paidUntil <= todayIso();
  });
}

function checkOverspend(context) {
  const { operation, amount, state, categoryId } = context;
  if (operation !== 'createExpense' || !categoryId) {
    return null;
  }

  const category = findCategory(state, categoryId);
  if (!category) {
    return null;
  }

  const limit = category.limit ?? 0;
  if (limit <= 0) {
    return null;
  }

  const spent = category.spent ?? 0;
  const rubAmount = Number(amount);
  if (!Number.isFinite(rubAmount) || rubAmount <= 0) {
    return null;
  }

  if (rubAmount > limit || spent + rubAmount > limit) {
    return {
      decision: 'WARN',
      reason: 'Расход превышает лимит категории',
      ruleTriggered: 'OVERSPEND'
    };
  }

  return null;
}

function checkLowBalance(context) {
  const { state } = context;
  const total = calculateTotalBalance(state);
  if (total <= 0) {
    return null;
  }

  const free = calculateFreeBalance(state);
  if (free < total * 0.1) {
    return {
      decision: 'WARN',
      reason: 'Свободный баланс ниже 10% от общей суммы',
      ruleTriggered: 'LOW_BALANCE'
    };
  }

  return null;
}

function checkSavingsProtection(context) {
  const { operation, amount, state, savingId, action } = context;
  if (operation !== 'updateSavings' || action !== 'withdraw' || !savingId) {
    return null;
  }

  const saving = findSaving(state, savingId);
  if (!saving) {
    return null;
  }

  const targetAmount = saving.targetAmount;
  if (targetAmount == null || targetAmount <= 0) {
    return null;
  }

  const accumulated = getSavingAccumulated(saving);
  const withdrawAmount = Number(amount);
  if (!Number.isFinite(withdrawAmount) || withdrawAmount <= 0) {
    return null;
  }

  const remaining = accumulated - withdrawAmount;
  if (remaining < targetAmount * 0.2) {
    return {
      decision: 'WARN',
      reason: 'Вывод снизит накопления ниже 20% от цели',
      ruleTriggered: 'SAVINGS_PROTECTION'
    };
  }

  return null;
}

function checkObligationSafety(context) {
  const { operation, state } = context;
  if (operation !== 'createExpense') {
    return null;
  }

  if (!hasOverdueObligations(state)) {
    return null;
  }

  return {
    decision: 'WARN',
    reason: 'Есть просроченные обязательства',
    ruleTriggered: 'OBLIGATION_SAFETY'
  };
}

function mergeRuleDecisions(ruleResults) {
  if (!ruleResults.length) {
    return { decision: 'ALLOW' };
  }

  return ruleResults.reduce((strongest, current) =>
    (DECISION_RANK[current.decision] ?? 0) > (DECISION_RANK[strongest.decision] ?? 0)
      ? current
      : strongest
  );
}

export function evaluateBudgetRules(context) {
  const ruleResults = [
    checkOverspend(context),
    checkLowBalance(context),
    checkSavingsProtection(context),
    checkObligationSafety(context)
  ].filter(Boolean);

  ruleResults.forEach((rule) => {
    console.log('[FINANCE RULES]', {
      operation: context.operation,
      ruleTriggered: rule.ruleTriggered,
      decision: rule.decision
    });
  });

  return mergeRuleDecisions(ruleResults);
}

export function mergeGateAndRulesDecisions(gateDecision, rulesDecision) {
  const gateRank = DECISION_RANK[gateDecision.decision] ?? 0;
  const rulesRank = DECISION_RANK[rulesDecision?.decision ?? 'ALLOW'] ?? 0;
  const finalRank = Math.max(gateRank, rulesRank);
  const finalDecision = finalRank === DECISION_RANK.BLOCK
    ? 'BLOCK'
    : finalRank === DECISION_RANK.WARN
      ? 'WARN'
      : 'ALLOW';

  const warnings = [...(gateDecision.warnings ?? [])];
  if (rulesDecision?.decision === 'WARN' && rulesDecision.reason) {
    warnings.push(rulesDecision.reason);
  }

  return {
    decision: finalDecision,
    ok: finalDecision !== 'BLOCK',
    warnings,
    reason: rulesDecision?.reason ?? gateDecision.reason,
    ruleTriggered: rulesDecision?.ruleTriggered,
    gateDecision: gateDecision.decision,
    rulesDecision: rulesDecision?.decision ?? 'ALLOW'
  };
}
