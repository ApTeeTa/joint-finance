import { UI } from './uiTheme.js';
import { getModalOverlayTemplateClasses } from './uiRulesEngine.js';
import { openModal, closeModal, getModalRoot } from './modalLayer.js';
import { getCurrentUser } from '../lib/authSession.js';
import { getActiveHousehold } from '../lib/householdContext.js';
import { joinHouseholdByInviteCode } from '../lib/householdService.js';
import { isLocalOnlyTestMode } from '../config/environmentConfig.js';
import { signOutToAuthGate } from './betaOnboarding.js';

const MODAL_NAME = 'join-household';
let handlersBound = false;

function renderJoinModalShell() {
  return `
    <div class="hidden ${getModalOverlayTemplateClasses()}" data-modal="${MODAL_NAME}">
      <div class="${UI.modalShell} ${UI.modalBody} max-w-md">
        <h3 class="${UI.modalTitle}">Join a household</h3>
        <p class="text-sm text-slate-500">
          Enter the invite code from your partner. You will see <strong>their shared data</strong>
          (accounts and categories). If you already created your own household, the app will switch to theirs.
        </p>
        <div class="space-y-3">
          <div>
            <label class="${UI.label}">Invite code</label>
            <input type="text" name="joinInviteCode" maxlength="12" class="${UI.field} uppercase" placeholder="AB12CD34" autocomplete="off">
          </div>
          <div>
            <label class="${UI.label}">Your name</label>
            <input type="text" name="joinDisplayName" maxlength="80" class="${UI.field}" placeholder="Sam">
          </div>
        </div>
        <p data-join-status class="text-sm text-slate-500 min-h-[1.25rem] mt-3"></p>
        <div class="${UI.modalActions}">
          <button type="button" data-action="close-modal" data-modal="${MODAL_NAME}" class="${UI.btnSecondaryBlock}">Cancel</button>
          <button type="button" data-action="submit-join-household" class="${UI.btnPrimaryBlock}">Join household</button>
        </div>
      </div>
    </div>
  `;
}

export function mountJoinHouseholdModal() {
  const root = getModalRoot();
  if (!root || root.querySelector(`[data-modal="${MODAL_NAME}"]`)) {
    return;
  }
  root.insertAdjacentHTML('beforeend', renderJoinModalShell());
}

export function updateAccountHeaderButtons() {
  const joinBtn = document.getElementById('join-household-btn');
  const signOutBtn = document.getElementById('sign-out-btn');
  const hide = isLocalOnlyTestMode();

  joinBtn?.classList.toggle('hidden', hide);
  signOutBtn?.classList.toggle('hidden', hide);
}

function resetJoinModalForm(modal) {
  modal.querySelector('[name="joinInviteCode"]').value = '';
  modal.querySelector('[name="joinDisplayName"]').value = '';
  modal.querySelector('[data-join-status]').textContent = '';
}

async function submitJoinHousehold() {
  const modal = document.querySelector(`[data-modal="${MODAL_NAME}"]`);
  if (!modal) return;

  const statusEl = modal.querySelector('[data-join-status]');
  const code = modal.querySelector('[name="joinInviteCode"]')?.value;
  const displayName = modal.querySelector('[name="joinDisplayName"]')?.value;

  const user = await getCurrentUser();
  if (!user?.id) {
    statusEl.textContent = 'Sign in first.';
    return;
  }

  statusEl.textContent = 'Joining…';
  const result = await joinHouseholdByInviteCode(user.id, code, displayName);
  if (!result.ok) {
    statusEl.textContent = result.error;
    return;
  }

  closeModal(MODAL_NAME);
  window.location.reload();
}

export function initHouseholdAccountHandlers() {
  if (handlersBound) return;
  handlersBound = true;

  document.addEventListener('click', async (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;

    if (action === 'open-join-household') {
      mountJoinHouseholdModal();
      const modal = document.querySelector(`[data-modal="${MODAL_NAME}"]`);
      if (modal) resetJoinModalForm(modal);
      openModal(MODAL_NAME);
      return;
    }

    if (action === 'submit-join-household') {
      await submitJoinHousehold();
      return;
    }

    if (action === 'auth-sign-out-app') {
      await signOutToAuthGate();
      return;
    }

    if (action === 'close-modal' && actionEl.dataset.modal === MODAL_NAME) {
      closeModal(MODAL_NAME);
    }
  });
}
