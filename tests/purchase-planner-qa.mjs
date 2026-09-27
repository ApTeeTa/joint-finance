/**
 * QA runner for Plan a purchase — run: node tests/purchase-planner-qa.mjs
 */
import { simulatePurchase, listReserveSources } from '../src/modules/purchaseSimulation.js';
import {
  calculateFreeBalance,
  calculateTotalBalance,
  calculateReservedBalance
} from '../src/modules/financeEngine.js';

const results = [];
let failed = 0;

function assert(condition, message) {
  if (condition) {
    results.push(`OK: ${message}`);
    return;
  }
  failed += 1;
  results.push(`FAIL: ${message}`);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function snapshotFinanceState(state) {
  return {
    free: calculateFreeBalance(state),
    total: calculateTotalBalance(state),
    reserved: calculateReservedBalance(state),
    accounts: (state.accounts ?? []).map((a) => ({ id: a.id, balance: a.balance ?? 0 })),
    categories: (state.categories ?? []).map((c) => ({ id: c.id, reserved: c.reserved ?? 0 })),
    savings: (state.savings ?? []).map((s) => ({
      id: s.id,
      accumulated: s.accumulated ?? s.amount ?? 0
    })),
    obligations: (state.obligations ?? []).map((o) => ({
      id: o.id,
      reserveAmount: o.reserveAmount ?? 0
    })),
    debts: (state.debts ?? []).map((d) => ({
      id: d.id,
      reserved: d.reserved ?? 0
    }))
  };
}

function assertStateUnchanged(before, after, label) {
  assert(deepEqual(before, after), `${label}: state unchanged after simulation`);
}

function baseState(overrides = {}) {
  return {
    exchangeRate: 92,
    accounts: [{ id: 'a1', balance: 10000, currency: 'RUB', owner: 'husband' }],
    categories: [
      { id: 'c1', name: 'Food', reserved: 800, limit: 1000, spent: 0 },
      { id: 'c2', name: 'Car maintenance', reserved: 1000, limit: 1000, spent: 0 }
    ],
    savings: [
      {
        id: 's1',
        name: 'Vacation',
        accumulated: 4000,
        targetAmount: 5000,
        deadlineType: 'date',
        deadlineDate: '2026-05-01'
      }
    ],
    obligations: [
      { id: 'o1', name: 'Rent', reserveAmount: 0, targetAmount: 3000, paidUntil: '2026-04-01' }
    ],
    debts: [{ id: 'd1', direction: 'we_owe', title: 'Loan', reserved: 0, amount: 5000 }],
    transactions: [],
    ...overrides
  };
}

function stateWithFree(freeTarget, reserveOverrides = {}) {
  const reservedParts = {
    categories: 1800,
    savings: 4000,
    obligations: 0,
    debts: 0,
    ...reserveOverrides
  };
  const reservedTotal =
    reservedParts.categories +
    reservedParts.savings +
    reservedParts.obligations +
    reservedParts.debts;
  const total = freeTarget + reservedTotal;

  return baseState({
    accounts: [{ id: 'a1', balance: total, currency: 'RUB', owner: 'husband' }],
    categories: [
      { id: 'c1', name: 'Food', reserved: 800, limit: 1000, spent: 0 },
      { id: 'c2', name: 'Car maintenance', reserved: reservedParts.categories - 800, limit: 1000, spent: 0 }
    ],
    savings: [
      {
        id: 's1',
        name: 'Vacation',
        accumulated: reservedParts.savings,
        targetAmount: 5000,
        deadlineType: 'date',
        deadlineDate: '2026-05-01'
      }
    ],
    obligations: reservedParts.obligations > 0
      ? [{ id: 'o1', name: 'Rent', reserveAmount: reservedParts.obligations, targetAmount: 3000 }]
      : [],
    debts: reservedParts.debts > 0
      ? [{ id: 'd1', direction: 'we_owe', title: 'Loan', reserved: reservedParts.debts, amount: 5000 }]
      : [{ id: 'd1', direction: 'we_owe', title: 'Loan', reserved: 0, amount: 5000 }]
  });
}

function runSimulationImmutabilityCheck(state, params, label) {
  const before = snapshotFinanceState(state);
  const clone = structuredClone(state);
  const simulation = simulatePurchase(clone, params);
  const after = snapshotFinanceState(state);
  assertStateUnchanged(before, after, label);
  assert(deepEqual(before, snapshotFinanceState(clone)), `${label}: clone matches original (simulate uses no mutation)`);
  return simulation;
}

// --- Smoke test (mirrors purchase-simulation-test.html) ---
{
  const state = baseState();
  const free = calculateFreeBalance(state);
  assert(free === 4200, `smoke: free=${free} (expected 4200)`);

  const fits = runSimulationImmutabilityCheck(state, { name: 'Headphones', amount: 200 }, 'smoke fits');
  assert(fits.ok && fits.fitsInFree, 'smoke: fits in free');
  assert(fits.freeAfter === 4000, `smoke: freeAfter=${fits.freeAfter}`);
  assert(fits.impacts.length === 0, 'smoke: no impacts when fits');

  const short = runSimulationImmutabilityCheck(state, { name: 'Laptop', amount: 5000 }, 'smoke shortfall');
  assert(short.ok && !short.fitsInFree, 'smoke: does not fit');
  assert(short.shortfall === 800, `smoke: shortfall=${short.shortfall}`);
  assert(short.impacts.length === 3, `smoke: impacts=${short.impacts.length}`);
  assert(short.impacts.every((item) => item.withdrawal === 800), 'smoke: each impact uses shortfall');

  assert(listReserveSources(state).length === 3, 'smoke: three reserve sources');
}

// Scenario 1: Free=500, purchase=200
{
  const state = stateWithFree(500);
  assert(calculateFreeBalance(state) === 500, 's1: free=500');
  const sim = runSimulationImmutabilityCheck(state, { name: 'Headphones', amount: 200 }, 's1');
  assert(sim.ok && sim.fitsInFree, 's1: simulation succeeds');
  assert(sim.freeAfter === 300, `s1: freeAfter=${sim.freeAfter}`);
  assert(sim.impacts.length === 0, 's1: reserved money not affected');
}

// Scenario 2: Free=0, purchase=200
{
  const state = stateWithFree(0);
  assert(calculateFreeBalance(state) === 0, 's2: free=0');
  const sim = runSimulationImmutabilityCheck(state, { name: 'Headphones', amount: 200 }, 's2');
  assert(sim.ok && !sim.fitsInFree, 's2: shortfall scenario');
  assert(sim.shortfall === 200, `s2: shortfall=${sim.shortfall}`);
  assert(sim.impacts.length >= 2, `s2: reserves listed (${sim.impacts.length})`);
  assert(sim.impacts.every((i) => i.withdrawal > 0), 's2: each reserve shows hypothetical withdrawal');
}

// Scenario 3: Free=100, purchase=200
{
  const state = stateWithFree(100);
  assert(calculateFreeBalance(state) === 100, 's3: free=100');
  const sim = runSimulationImmutabilityCheck(state, { name: 'Headphones', amount: 200 }, 's3');
  assert(sim.ok && !sim.fitsInFree, 's3: not fully covered by free');
  assert(sim.shortfall === 100, `s3: shortfall=${sim.shortfall}`);
  assert(sim.freeBefore === 100, `s3: freeBefore=${sim.freeBefore}`);
  assert(sim.impacts.length > 0, 's3: reserves show hypothetical impact');
  assert(sim.impacts.every((i) => i.withdrawal === 100), 's3: impact based on shortfall only');
}

// Scenario 4: Free = purchase amount (200)
{
  const state = stateWithFree(200);
  assert(calculateFreeBalance(state) === 200, 's4: free=200');
  const sim = runSimulationImmutabilityCheck(state, { name: 'Headphones', amount: 200 }, 's4');
  assert(sim.ok && sim.fitsInFree, 's4: fits exactly');
  assert(sim.freeAfter === 0, `s4: freeAfter=${sim.freeAfter}`);
  assert(sim.impacts.length === 0, 's4: no reserve affected');
}

// Scenario 5: Purchase larger than all available money
{
  const state = stateWithFree(0);
  const total = calculateTotalBalance(state);
  const purchase = total + 5000;
  const sim = runSimulationImmutabilityCheck(state, { name: 'Big', amount: purchase }, 's5');
  assert(sim.ok && !sim.fitsInFree, 's5: simulation still ok');
  assert(sim.shortfall === purchase, `s5: shortfall=${sim.shortfall}`);
  assert(sim.impacts.every((i) => i.remaining >= 0), 's5: no negative remaining in projection');
  assert(sim.impacts.some((i) => !i.canCoverFully), 's5: at least one reserve cannot cover full shortfall');
  const before = snapshotFinanceState(state);
  assert(before.free >= 0, 's5: free not negative in state');
}

// Read-only: multiple simulations on same state
{
  const state = stateWithFree(500);
  const snap = snapshotFinanceState(state);
  simulatePurchase(state, { amount: 100 });
  simulatePurchase(state, { amount: 99999 });
  simulatePurchase(state, { name: 'X', amount: 250 });
  assert(deepEqual(snap, snapshotFinanceState(state)), 'read-only: repeated simulations leave state intact');
}

console.log(results.join('\n'));
console.log(`\n--- ${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`} (${results.length} checks) ---`);
process.exit(failed > 0 ? 1 : 0);
