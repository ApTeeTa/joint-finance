import { UI } from './uiTheme.js';
import { getModalOverlayTemplateClasses } from './uiRulesEngine.js';
import { openModal, closeModal, getModalRoot } from './modalLayer.js';
import { getCurrentUser } from '../lib/authSession.js';
import { getActiveHousehold } from '../lib/householdContext.js';
import {
  getOrCreateInviteCode,
  getHouseholdMemberStats,
  createInviteCode
} from '../lib/householdService.js';
import { isLocalOnlyTestMode } from '../config/environmentConfig.js';

const MODAL_NAME = 'invite-partner';
let handlersBound = false;

function formatExpiry(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return iso;
  }
}

function renderInviteModalShell() {
  return `
    <div class="hidden ${getModalOverlayTemplateClasses()}" data-modal="${MODAL_NAME}">
      <div class="${UI.modalShell} ${UI.modalBody} max-w-md">
        <h3 class="${UI.modalTitle}">Invite your partner</h3>
        <p class="text-sm text-slate-500">
          Share this code. When they join, they see <strong>your household data</strong> (same accounts and categories).
        </p>
        <div class="rounded-xl bg-surface-muted border border-surface-border p-4 text-center">
          <p class="text-xs uppercase tracking-wide text-slate-500 mb-1">Invite code</p>
          <p data-invite-code class="text-2xl font-bold tracking-[0.2em] text-slate-900">——</p>
          <p data-invite-expiry class="text-xs text-slate-500 mt-2"></p>
        </div>
        <p data-invite-members class="text-sm text-slate-600"></p>
        <p data-invite-status class="text-sm text-slate-500 min-h-[1.25rem]"></p>
        <div class="${UI.modalActions}">
          <button type="button" data-action="close-modal" data-modal="${MODAL_NAME}" class="${UI.btnSecondaryBlock}">Close</button>
          <button type="button" data-action="copy-invite-code" class="${UI.btnPrimaryBlock}">Copy code</button>
        </div>
        <button type="button" data-action="regenerate-invite-code" class="text-sm text-primary-700 hover:text-primary-800 w-full text-center mt-1">
          Generate new code
        </button>
      </div>
    </div>
  `;
}

export function mountInviteModal() {
  const root = getModalRoot();
  if (!root || root.querySelector(`[data-modal="${MODAL_NAME}"]`)) {
    return;
  }
  root.insertAdjacentHTML('beforeend', renderInviteModalShell());
}

export function updateInviteHeaderButton() {
  const btn = document.getElementById('invite-partner-btn');
  if (!btn) return;

  if (isLocalOnlyTestMode()) {
    btn.classList.add('hidden');
    return;
  }

  const household = getActiveHousehold();
  const show = household?.role === 'owner';
  btn.classList.toggle('hidden', !show);
}

async function loadInviteIntoModal() {
  const modal = document.querySelector(`[data-modal="${MODAL_NAME}"]`);
  if (!modal) return;

  const statusEl = modal.querySelector('[data-invite-status]');
  const codeEl = modal.querySelector('[data-invite-code]');
  const expiryEl = modal.querySelector('[data-invite-expiry]');
  const membersEl = modal.querySelector('[data-invite-members]');

  const user = await getCurrentUser();
  const household = getActiveHousehold();
  if (!user?.id || !household?.id) {
    statusEl.textContent = 'Sign in and create a household first.';
    return;
  }

  statusEl.textContent = 'Loading invite…';
  const inviteResult = await getOrCreateInviteCode(household.id, user.id);
  if (!inviteResult.ok) {
    statusEl.textContent = inviteResult.error;
    return;
  }

  codeEl.textContent = inviteResult.code;
  expiryEl.textContent = `Valid until ${formatExpiry(inviteResult.expiresAt)}`;
  statusEl.textContent = inviteResult.reused ? 'Using your active invite code.' : 'New invite code created.';

  const stats = await getHouseholdMemberStats(household.id);
  if (stats.ok) {
    membersEl.textContent = stats.memberCount <= 1
      ? 'Waiting for your partner to join.'
      : `${stats.memberCount} members in this household.`;
  }
}

async function regenerateInviteCode() {
  const user = await getCurrentUser();
  const household = getActiveHousehold();
  if (!user?.id || !household?.id) return;

  const modal = document.querySelector(`[data-modal="${MODAL_NAME}"]`);
  const statusEl = modal?.querySelector('[data-invite-status]');
  if (statusEl) statusEl.textContent = 'Creating new code…';

  const result = await createInviteCode(household.id, user.id);
  if (!result.ok) {
    if (statusEl) statusEl.textContent = result.error;
    return;
  }

  modal.querySelector('[data-invite-code]').textContent = result.code;
  modal.querySelector('[data-invite-expiry]').textContent = `Valid until ${formatExpiry(result.expiresAt)}`;
  if (statusEl) statusEl.textContent = 'New invite code ready.';
}

async function copyInviteCode() {
  const modal = document.querySelector(`[data-modal="${MODAL_NAME}"]`);
  const code = modal?.querySelector('[data-invite-code]')?.textContent?.trim();
  const statusEl = modal?.querySelector('[data-invite-status]');
  if (!code || code === '——') return;

  try {
    await navigator.clipboard.writeText(code);
    if (statusEl) statusEl.textContent = 'Code copied to clipboard.';
  } catch {
    if (statusEl) statusEl.textContent = `Copy manually: ${code}`;
  }
}

export function initHouseholdInviteHandlers() {
  if (handlersBound) return;
  handlersBound = true;

  document.addEventListener('click', async (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    if (action === 'open-invite-partner') {
      mountInviteModal();
      await loadInviteIntoModal();
      openModal(MODAL_NAME);
      return;
    }
    if (action === 'copy-invite-code') {
      await copyInviteCode();
      return;
    }
    if (action === 'regenerate-invite-code') {
      await regenerateInviteCode();
      return;
    }
    if (action === 'close-modal' && actionEl.dataset.modal === MODAL_NAME) {
      closeModal(MODAL_NAME);
    }
  });
}
