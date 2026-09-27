import { UI } from './uiTheme.js';
import { getModalOverlayTemplateClasses } from './uiRulesEngine.js';
import { openModal, closeModal, getModalRoot } from './modalLayer.js';
import { simulatePurchase, RESERVE_SOURCE_TYPES } from './purchaseSimulation.js';

const MODAL_NAME = 'purchase-planner';
const STEP_INPUT = 'input';
const STEP_RESULT = 'result';

let handlersBound = false;
let lastSimulation = null;

function formatMoney(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0
  }).format(amount ?? 0);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDeadline(deadlineType, deadlineDate) {
  if (!deadlineType || deadlineType === 'none' || !deadlineDate) {
    return null;
  }
  try {
    return new Date(deadlineDate).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return deadlineDate;
  }
}

function formatPaidUntil(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  } catch {
    return iso;
  }
}

function renderPurchasePlannerModalShell() {
  return `
    <div class="hidden ${getModalOverlayTemplateClasses()}" data-modal="${MODAL_NAME}">
      <div class="${UI.modalShell} ${UI.modalBody} max-w-lg max-h-[90vh] overflow-y-auto">
        <div data-purchase-step="${STEP_INPUT}">
          <h3 class="${UI.modalTitle}">Plan a purchase</h3>
          <p class="text-sm text-slate-500 mb-4">
            See what would change if you spent this amount. Nothing is saved until you take a separate action.
          </p>
          <form data-form="purchase-planner" class="space-y-4">
            <div>
              <label class="${UI.label}">What do you want to buy?</label>
              <input type="text" name="purchaseName" maxlength="120" class="${UI.field}" placeholder="e.g. Headphones">
            </div>
            <div>
              <label class="${UI.label}">Amount (RUB)</label>
              <input type="number" name="purchaseAmount" required min="1" step="1" class="${UI.field}" placeholder="0">
            </div>
            <p data-purchase-error class="text-sm text-red-600 hidden"></p>
            <div class="${UI.modalActions}">
              <button type="button" data-action="close-modal" data-modal="${MODAL_NAME}" class="${UI.btnSecondaryBlock}">Cancel</button>
              <button type="submit" class="${UI.btnPrimaryBlock}">Simulate</button>
            </div>
          </form>
        </div>
        <div data-purchase-step="${STEP_RESULT}" class="hidden">
          <div data-purchase-result-body></div>
          <div class="flex flex-col gap-2 pt-4 mt-4 border-t border-surface-border">
            <button type="button" data-action="purchase-planner-done" class="${UI.btnPrimaryBlock}">Done</button>
            <button type="button" data-action="save-for-purchase" class="${UI.btnSecondaryBlock}">Save for this purchase</button>
            <button type="button" data-action="purchase-planner-back" class="text-sm text-primary-700 hover:text-primary-800 w-full text-center mt-1">
              Simulate another purchase
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderFitsInFreeResult(simulation) {
  const title = simulation.name
    ? `<p class="text-base font-semibold text-slate-900 mb-3">${escapeHtml(simulation.name)} — ${formatMoney(simulation.purchaseAmount)}</p>`
    : `<p class="text-base font-semibold text-slate-900 mb-3">Purchase: ${formatMoney(simulation.purchaseAmount)}</p>`;

  return `
    <h3 class="${UI.modalTitle}">Simulation result</h3>
    ${title}
    <dl class="space-y-2 text-sm">
      <div class="flex justify-between gap-4">
        <dt class="text-slate-500">Free now</dt>
        <dd class="font-medium text-slate-900">${formatMoney(simulation.freeBefore)}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-slate-500">Free after purchase</dt>
        <dd class="font-medium text-emerald-700">${formatMoney(simulation.freeAfter)}</dd>
      </div>
    </dl>
    <p class="mt-4 text-sm text-slate-600 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
      No reserved money is affected.
    </p>
  `;
}

function renderImpactCard(impact, shortfall) {
  const lines = [
    `<p class="font-medium text-slate-900">${escapeHtml(impact.name)}</p>`,
    `<p class="text-sm text-slate-500">${escapeHtml(impact.kindLabel)}</p>`,
    `<p class="text-sm font-semibold text-amber-700 mt-1">−${formatMoney(impact.withdrawal)}</p>`,
    `<p class="text-sm text-slate-600">Remaining: ${formatMoney(impact.remaining)}</p>`
  ];

  if (!impact.canCoverFully) {
    lines.push(
      `<p class="text-xs text-amber-700 mt-1">This reserve alone cannot cover the full ${formatMoney(shortfall)} needed.</p>`
    );
  }

  if (impact.sourceType === RESERVE_SOURCE_TYPES.SAVING) {
    lines.push(`<p class="text-xs text-slate-500 mt-1">Accumulated now: ${formatMoney(impact.currentAmount)}</p>`);
    lines.push(`<p class="text-xs text-slate-500">After withdrawal: ${formatMoney(impact.remaining)}</p>`);
    if (impact.targetAmount != null && impact.targetAmount > 0) {
      lines.push(`<p class="text-xs text-slate-500">Target: ${formatMoney(impact.targetAmount)}</p>`);
    }
    const deadline = formatDeadline(impact.deadlineType, impact.deadlineDate);
    if (deadline) {
      lines.push(`<p class="text-xs text-slate-500">Deadline: ${escapeHtml(deadline)}</p>`);
    }
  }

  if (impact.sourceType === RESERVE_SOURCE_TYPES.OBLIGATION) {
    const paidUntil = formatPaidUntil(impact.paidUntil);
    if (paidUntil) {
      lines.push(`<p class="text-xs text-slate-500 mt-1">Paid until: ${escapeHtml(paidUntil)}</p>`);
    }
    lines.push(`<p class="text-xs text-slate-500">Reserve now: ${formatMoney(impact.currentAmount)}</p>`);
    lines.push(`<p class="text-xs text-slate-500">After withdrawal: ${formatMoney(impact.remaining)}</p>`);
  }

  if (impact.sourceType === RESERVE_SOURCE_TYPES.CATEGORY) {
    lines.push(`<p class="text-xs text-slate-500 mt-1">Reserved now: ${formatMoney(impact.currentAmount)}</p>`);
    lines.push(`<p class="text-xs text-slate-500">After withdrawal: ${formatMoney(impact.remaining)}</p>`);
  }

  if (impact.sourceType === RESERVE_SOURCE_TYPES.DEBT) {
    lines.push(`<p class="text-xs text-slate-500 mt-1">Reserved now: ${formatMoney(impact.currentAmount)}</p>`);
    lines.push(`<p class="text-xs text-slate-500">After withdrawal: ${formatMoney(impact.remaining)}</p>`);
  }

  return `
    <div class="rounded-xl border border-surface-border bg-surface-muted/60 px-3 py-3">
      ${lines.join('')}
    </div>
  `;
}

function renderShortfallResult(simulation) {
  const title = simulation.name
    ? `<p class="text-base font-semibold text-slate-900">${escapeHtml(simulation.name)} — ${formatMoney(simulation.purchaseAmount)}</p>`
    : `<p class="text-base font-semibold text-slate-900">Purchase: ${formatMoney(simulation.purchaseAmount)}</p>`;

  const freeUsedNote = simulation.freeBefore > 0
    ? `<p class="text-xs text-slate-500">
        ${formatMoney(simulation.freeBefore)} from Free would be used first.
      </p>`
    : '';

  const impactCards = simulation.impacts.length
    ? simulation.impacts.map((impact) => renderImpactCard(impact, simulation.shortfall)).join('')
    : `<p class="text-sm text-slate-500 rounded-lg bg-slate-50 border border-surface-border px-3 py-2">
        No reserved money is available. You would need to reduce the purchase amount or add funds first.
      </p>`;

  return `
    <h3 class="${UI.modalTitle}">Simulation result</h3>
    <div class="space-y-3 text-sm">
      ${title}
      <div class="flex justify-between gap-4">
        <span class="text-slate-500">Free</span>
        <span class="font-medium text-slate-900">${formatMoney(simulation.freeBefore)}</span>
      </div>
      ${freeUsedNote}
      <p class="text-sm text-amber-800 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
        You need ${formatMoney(simulation.shortfall)} from your reserved money.
      </p>
      <div>
        <p class="text-xs uppercase tracking-wide text-slate-500 mb-2">Possible impact</p>
        <p class="text-xs text-slate-500 mb-3">
          If you took the full ${formatMoney(simulation.shortfall)} from one of these reserves:
        </p>
        <div class="space-y-2">${impactCards}</div>
      </div>
    </div>
  `;
}

function showStep(step) {
  const modal = document.querySelector(`[data-modal="${MODAL_NAME}"]`);
  if (!modal) return;

  modal.querySelector(`[data-purchase-step="${STEP_INPUT}"]`)?.classList.toggle('hidden', step !== STEP_INPUT);
  modal.querySelector(`[data-purchase-step="${STEP_RESULT}"]`)?.classList.toggle('hidden', step !== STEP_RESULT);
}

function resetPurchasePlannerForm() {
  const modal = document.querySelector(`[data-modal="${MODAL_NAME}"]`);
  const form = modal?.querySelector('[data-form="purchase-planner"]');
  const errorEl = modal?.querySelector('[data-purchase-error]');
  if (form) form.reset();
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  }
  lastSimulation = null;
  showStep(STEP_INPUT);
}

function renderSimulationResult(simulation) {
  const modal = document.querySelector(`[data-modal="${MODAL_NAME}"]`);
  const body = modal?.querySelector('[data-purchase-result-body]');
  if (!body) return;

  body.innerHTML = simulation.fitsInFree
    ? renderFitsInFreeResult(simulation)
    : renderShortfallResult(simulation);

  showStep(STEP_RESULT);
}

export function mountPurchasePlannerModal() {
  const root = getModalRoot();
  if (!root || root.querySelector(`[data-modal="${MODAL_NAME}"]`)) {
    return;
  }
  root.insertAdjacentHTML('beforeend', renderPurchasePlannerModalShell());
}

export function openPurchasePlanner() {
  resetPurchasePlannerForm();
  openModal(MODAL_NAME);
}

export function initPurchasePlannerHandlers(state, { onSaveForPurchase } = {}) {
  if (handlersBound) return;
  handlersBound = true;

  document.addEventListener('click', (event) => {
    const target = event.target;

    if (target.closest('[data-action="open-purchase-planner"]')) {
      openPurchasePlanner();
      return;
    }

    if (target.closest('[data-action="purchase-planner-done"]')) {
      closeModal(MODAL_NAME);
      resetPurchasePlannerForm();
      return;
    }

    if (target.closest('[data-action="purchase-planner-back"]')) {
      resetPurchasePlannerForm();
      return;
    }

    if (target.closest('[data-action="save-for-purchase"]')) {
      if (!lastSimulation) return;
      closeModal(MODAL_NAME);
      const payload = {
        name: lastSimulation.name || '',
        targetAmount: lastSimulation.purchaseAmount
      };
      resetPurchasePlannerForm();
      if (typeof onSaveForPurchase === 'function') {
        onSaveForPurchase(payload);
      }
      return;
    }

    if (target.closest('[data-action="toggle-free-help"]')) {
      const popover = document.getElementById('free-help-popover');
      if (popover) {
        popover.classList.toggle('hidden');
      }
      return;
    }

    if (target.closest('[data-action="dismiss-free-help"]')) {
      document.getElementById('free-help-popover')?.classList.add('hidden');
      return;
    }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-form="purchase-planner"]');
    if (!form) return;

    event.preventDefault();

    const modal = document.querySelector(`[data-modal="${MODAL_NAME}"]`);
    const errorEl = modal?.querySelector('[data-purchase-error]');

    const simulation = simulatePurchase(state, {
      name: form.purchaseName.value,
      amount: form.purchaseAmount.value
    });

    if (!simulation.ok) {
      if (errorEl) {
        errorEl.textContent = simulation.error;
        errorEl.classList.remove('hidden');
      }
      return;
    }

    if (errorEl) {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
    }

    lastSimulation = simulation;
    renderSimulationResult(simulation);
  });
}
