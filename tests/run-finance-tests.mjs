/**
 * Node runner for finance test suites (A2, A2.5, A3, A3.5).
 * Usage: node tests/run-finance-tests.mjs
 */
import {
  calculateFreeBalance,
  calculateTotalBalance,
  calculateReservedBalance
} from '../src/modules/financeEngine.js';
import { checkFinancialInvariants } from '../src/modules/financeCoreInvariants.js';
import { FINANCE_ENTRY_POINTS } from '../src/modules/financeEntryRegistry.js';
import { runFinanceGate } from '../src/modules/financeGateHelpers.js';
import {
  createExpense,
  updateSavings,
  payObligation,
  undoTransaction,
  spendSaving
} from '../src/modules/financeGate.js';
import { evaluateBudgetRules } from '../src/modules/financeRulesEngine.js';
import {
  recordReserve,
  recordAccountTransfer,
  recordExpense,
  recordObligationPayment,
  todayIso
} from '../src/modules/transactions.js';
import { computePaidUntilFromPayments } from '../src/modules/obligationPaidUntil.js';

const suites = [];
function assert(c, m) {
  if (!c) throw new Error(m);
}

function baseState() {
  return {
    profile: 'husband',
    exchangeRate: 92,
    accounts: [
      { id: 'acc1', name: 'RUB', currency: 'RUB', balance: 100000, owner: 'husband' },
      { id: 'acc2', name: 'RUB2', currency: 'RUB', balance: 5000, owner: 'husband' }
    ],
    categories: [{ id: 'food', name: 'Еда', limit: 50000, reserved: 0, spent: 0 }],
    obligations: [{
      id: 'obl',
      name: 'Интернет',
      accountId: 'acc1',
      reserveAmount: 0,
      paidUntil: '2026-06-01',
      status: 'overdue',
      payments: [],
      createdAt: new Date().toISOString()
    }],
    savings: [{
      id: 's1',
      name: 'Отпуск',
      accumulated: 10000,
      targetAmount: 10000,
      savingType: 'recurring'
    }],
    debts: [],
    transactions: []
  };
}

function baseStateGate() {
  const s = baseState();
  s.accounts = [{ id: 'acc', name: 'A', currency: 'RUB', balance: 100000, owner: 'husband' }];
  s.obligations[0].accountId = 'acc';
  s.obligations[0].reserveAmount = 5000;
  s.savings[0].accumulated = 0;
  return s;
}

async function runSuite(name, tests) {
  const results = {};
  for (const [key, title, fn] of tests) {
    try {
      await fn();
      results[key] = 'PASS';
      console.log(`  PASS  ${title}`);
    } catch (e) {
      results[key] = 'FAIL';
      console.log(`  FAIL  ${title}: ${e.message}`);
    }
  }
  suites.push({ name, results });
}

await runSuite('A2 — financeGate', [
  ['test1', 'Expense flow', () => {
    const gateLogs = [];
    const origLog = console.log;
    console.log = (...args) => {
      if (String(args[0]) === '[FINANCE GATE]') gateLogs.push(args[1]);
      origLog(...args);
    };
    try {
      const state = baseStateGate();
      recordReserve(state, 'food', 5000, '', todayIso(), 'husband');
      const result = createExpense(state, 'food', 2000, 'acc', 'тест', todayIso(), 'husband');
      assert(result.ok, result.error);
      assert(gateLogs.some((e) => e.operation === 'createExpense'), 'gate logged');
    } finally {
      console.log = origLog;
    }
  }],
  ['test2', 'Savings deposit/withdraw', () => {
    const state = baseStateGate();
    state.categories[0].reserved = 10000;
    const d = updateSavings(state, { action: 'deposit', savingId: 's1', amount: 3000, comment: '', date: todayIso(), author: 'husband' });
    assert(d.ok, d.error);
    const w = updateSavings(state, { action: 'withdraw', savingId: 's1', amount: 1000, comment: '', date: todayIso(), author: 'husband' });
    assert(w.ok, w.error);
    assert(state.savings[0].accumulated === 2000, 'accumulated');
  }],
  ['test3', 'Obligation payment', () => {
    const state = baseStateGate();
    const result = payObligation(state, 'obl', 2000, 'acc', '2026-08-01', '', todayIso(), 'husband');
    assert(result.ok, result.error);
    assert(state.obligations[0].payments.length === 1, 'payment');
  }],
  ['test4', 'Undo LIFO', () => {
    const state = baseStateGate();
    const first = payObligation(state, 'obl', 1000, 'acc', '2026-08-01', '', '2026-07-01', 'husband');
    const second = payObligation(state, 'obl', 1000, 'acc', '2026-10-01', '', '2026-09-01', 'husband');
    assert(first.ok && second.ok, 'payments');
    assert(!undoTransaction(state, first.transaction.id).ok, 'LIFO');
    assert(undoTransaction(state, second.transaction.id).ok, 'undo ok');
  }]
]);

await runSuite('A2.5 — Gate Discipline', [
  ['test1', 'Direct bypass detection', () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => {
      if (String(args[0]).includes('[FINANCE GATE WARNING]')) warnings.push(args);
      origWarn(...args);
    };
    try {
      const state = baseStateGate();
      state.categories[0].reserved = 5000;
      const result = recordExpense(state, 'food', 1000, 'acc', 'direct', todayIso(), 'husband');
      assert(result.ok, result.error);
      assert(warnings.some((w) => String(w[0]).includes('Direct call detected')), 'warning');
    } finally {
      console.warn = origWarn;
    }
  }],
  ['test2', 'Gate flow without bypass warnings', () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => {
      if (String(args[0]).includes('[FINANCE GATE WARNING]')) warnings.push(args);
      origWarn(...args);
    };
    try {
      const state = baseStateGate();
      state.categories[0].reserved = 5000;
      const result = createExpense(state, 'food', 500, 'acc', 'gate', todayIso(), 'husband');
      assert(result.ok, result.error);
      assert(warnings.length === 0, 'no warnings');
    } finally {
      console.warn = origWarn;
    }
  }],
  ['test3', 'Savings integrity', () => {
    const state = baseStateGate();
    state.categories[0].reserved = 10000;
    assert(updateSavings(state, { action: 'deposit', savingId: 's1', amount: 2500, comment: '', date: todayIso(), author: 'husband' }).ok, 'deposit');
    assert(updateSavings(state, { action: 'withdraw', savingId: 's1', amount: 500, comment: '', date: todayIso(), author: 'husband' }).ok, 'withdraw');
  }],
  ['test4', 'Obligations + undo LIFO', () => {
    const state = baseStateGate();
    const first = payObligation(state, 'obl', 1000, 'acc', '2026-08-01', '', '2026-07-01', 'husband');
    const second = payObligation(state, 'obl', 1000, 'acc', '2026-10-01', '', '2026-09-01', 'husband');
    assert(first.ok && second.ok, 'payments');
    assert(!undoTransaction(state, first.transaction.id).ok, 'LIFO');
    assert(undoTransaction(state, second.transaction.id).ok, 'undo');
  }],
  ['test5', 'Decision model', () => {
    const state = baseStateGate();
    state.categories[0].reserved = 50000;
    const allowDecision = runFinanceGate('createExpense', 1000, state, { categoryId: 'food', accountId: 'acc' });
    assert(allowDecision.decision === 'ALLOW', 'ALLOW');
    const warnDecision = runFinanceGate('createExpense', 90000, state, { categoryId: 'food', accountId: 'acc' });
    assert(warnDecision.decision === 'WARN', 'WARN');
    assert(FINANCE_ENTRY_POINTS.EXPENSE === 'createExpense', 'registry');
  }]
]);

await runSuite('A3 — Budget Rules', [
  ['test1', 'OVERSPEND rule', () => {
    const state = baseStateGate();
    const rule = evaluateBudgetRules({
      operation: 'createExpense',
      amount: 1000,
      state,
      categoryId: 'food'
    });
    assert(rule.ruleTriggered === 'OVERSPEND', rule.ruleTriggered);
  }],
  ['test2', 'LOW_BALANCE rule', () => {
    const state = baseStateGate();
    state.categories[0].reserved = 95000;
    const rule = evaluateBudgetRules({
      operation: 'createExpense',
      amount: 100,
      state,
      categoryId: 'food'
    });
    assert(rule.ruleTriggered === 'LOW_BALANCE', rule.ruleTriggered);
  }],
  ['test3', 'Gate merge with rules', () => {
    const state = baseStateGate();
    state.categories[0].reserved = 50000;
    const decision = runFinanceGate('createExpense', 90000, state, { categoryId: 'food', accountId: 'acc' });
    assert(decision.decision === 'WARN', 'merged WARN');
    assert(decision.warnings.length > 0, 'warnings');
  }]
]);

await runSuite('A3.5 — Financial Core Hardening', [
  ['test1', 'recordReserve protects free balance', () => {
    const state = baseState();
    state.categories[0].reserved = 99000;
    const fail = recordReserve(state, 'food', 2000, '', todayIso(), 'husband');
    assert(!fail.ok, 'must fail');
    assert(fail.error.includes('свобод'), fail.error);
    assert(calculateFreeBalance(state) === 1000, 'free unchanged');
  }],
  ['test2', 'recordAccountTransfer no negative source', () => {
    const state = baseState();
    state.accounts[0].balance = 1000;
    const fail = recordAccountTransfer(state, {
      sourceAccountId: 'acc1', destAccountId: 'acc2',
      sourceAmount: 5000, creditAmount: 5000,
      sourceCurrency: 'RUB', destCurrency: 'RUB', exchangeRate: 92,
      comment: '', date: todayIso(), author: 'husband'
    });
    assert(!fail.ok, 'must fail');
    assert(state.accounts[0].balance === 1000, 'source unchanged');
  }],
  ['test3', 'recordSavingSpend via gate', () => {
    const gateLogs = [];
    const origLog = console.log;
    console.log = (...args) => {
      if (String(args[0]) === '[FINANCE GATE]') gateLogs.push(args[1]);
      origLog(...args);
    };
    try {
      const state = baseState();
      const result = spendSaving(state, 's1', 'acc1', '', todayIso(), 'husband');
      assert(result.ok, result.error);
      assert(gateLogs.some((e) => e.operation === 'spendSaving'), 'gate logged spendSaving');
    } finally {
      console.log = origLog;
    }
  }],
  ['test4', 'Obligations without UI auto-reserve', () => {
    const state = baseState();
    const result = payObligation(state, 'obl', 2000, 'acc1', '2026-08-01', '', todayIso(), 'husband');
    assert(result.ok, result.error);
    assert(state.obligations[0].payments.length === 1, 'payment');
    assert(checkFinancialInvariants(state).ok, 'invariants');
  }],
  ['test5', 'LIFO undo preserved', () => {
    const state = baseState();
    state.obligations[0].reserveAmount = 5000;
    const first = payObligation(state, 'obl', 1000, 'acc1', '2026-08-01', '', '2026-07-01', 'husband');
    const second = payObligation(state, 'obl', 1000, 'acc1', '2026-10-01', '', '2026-09-01', 'husband');
    assert(first.ok && second.ok, 'payments');
    assert(!undoTransaction(state, first.transaction.id).ok, 'LIFO');
    assert(undoTransaction(state, second.transaction.id).ok, 'undo ok');
  }],
  ['test6', 'reserved never exceeds total', () => {
    const state = baseState();
    assert(recordReserve(state, 'food', 5000, '', todayIso(), 'husband').ok, 'reserve ok');
    assert(calculateReservedBalance(state) <= calculateTotalBalance(state), 'reserved <= total');
    assert(checkFinancialInvariants(state).ok, 'invariants');
  }],
  ['test7', 'Normal expense scenario 1:1', () => {
    const state = baseState();
    recordReserve(state, 'food', 5000, '', todayIso(), 'husband');
    const freeBefore = calculateFreeBalance(state);
    const expense = recordExpense(state, 'food', 2000, 'acc1', 'test', todayIso(), 'husband');
    assert(expense.ok, expense.error);
    assert(state.categories[0].spent === 2000, 'spent');
    assert(calculateFreeBalance(state) === freeBefore, 'free unchanged');
  }]
]);

console.log('\n=== SUMMARY ===');
let allPass = true;
for (const suite of suites) {
  const entries = Object.entries(suite.results);
  const failed = entries.filter(([, s]) => s === 'FAIL');
  console.log(`${suite.name}: ${entries.length - failed.length}/${entries.length} passed`);
  if (failed.length) allPass = false;
}
process.exit(allPass ? 0 : 1);
