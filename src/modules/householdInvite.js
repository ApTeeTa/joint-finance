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
    return new Date(iso).toLocaleDateString('ru-RU', {
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
        <h3 class="${UI.modalTitle}">Пригласить партнёра</h3>
        <p class="text-sm text-slate-500">
          Поделитесь этим кодом. После присоединения партнёр увидит <strong>ваши общие данные</strong> (те же счета и категории).
        </p>
        <div class="rounded-xl bg-surface-muted border border-surface-border p-4 text-center">
          <p class="text-xs uppercase tracking-wide text-slate-500 mb-1">Код приглашения</p>
          <p data-invite-code class="text-2xl font-bold tracking-[0.2em] text-slate-900">——</p>
          <p data-invite-expiry class="text-xs text-slate-500 mt-2"></p>
        </div>
        <p data-invite-members class="text-sm text-slate-600"></p>
        <p data-invite-status class="text-sm text-slate-500 min-h-[1.25rem]"></p>
        <div class="${UI.modalActions}">
          <button type="button" data-action="close-modal" data-modal="${MODAL_NAME}" class="${UI.btnSecondaryBlock}">Закрыть</button>
          <button type="button" data-action="copy-invite-code" class="${UI.btnPrimaryBlock}">Скопировать код</button>
        </div>
        <button type="button" data-action="regenerate-invite-code" class="text-sm text-primary-700 hover:text-primary-800 w-full text-center mt-1">
          Создать новый код
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
    statusEl.textContent = 'Сначала войдите и создайте семью.';
    return;
  }

  statusEl.textContent = 'Загрузка кода…';
  const inviteResult = await getOrCreateInviteCode(household.id, user.id);
  if (!inviteResult.ok) {
    statusEl.textContent = inviteResult.error;
    return;
  }

  codeEl.textContent = inviteResult.code;
  expiryEl.textContent = `Действует до ${formatExpiry(inviteResult.expiresAt)}`;
  statusEl.textContent = inviteResult.reused ? 'Используется ваш активный код.' : 'Создан новый код приглашения.';

  const stats = await getHouseholdMemberStats(household.id);
  if (stats.ok) {
    membersEl.textContent = stats.memberCount <= 1
      ? 'Ждём, когда партнёр присоединится.'
      : `В семье ${stats.memberCount} участников.`;
  }
}

async function regenerateInviteCode() {
  const user = await getCurrentUser();
  const household = getActiveHousehold();
  if (!user?.id || !household?.id) return;

  const modal = document.querySelector(`[data-modal="${MODAL_NAME}"]`);
  const statusEl = modal?.querySelector('[data-invite-status]');
  if (statusEl) statusEl.textContent = 'Создание нового кода…';

  const result = await createInviteCode(household.id, user.id);
  if (!result.ok) {
    if (statusEl) statusEl.textContent = result.error;
    return;
  }

  modal.querySelector('[data-invite-code]').textContent = result.code;
  modal.querySelector('[data-invite-expiry]').textContent = `Действует до ${formatExpiry(result.expiresAt)}`;
  if (statusEl) statusEl.textContent = 'Новый код готов.';
}

async function copyInviteCode() {
  const modal = document.querySelector(`[data-modal="${MODAL_NAME}"]`);
  const code = modal?.querySelector('[data-invite-code]')?.textContent?.trim();
  const statusEl = modal?.querySelector('[data-invite-status]');
  if (!code || code === '——') return;

  try {
    await navigator.clipboard.writeText(code);
    if (statusEl) statusEl.textContent = 'Код скопирован.';
  } catch {
    if (statusEl) statusEl.textContent = `Скопируйте вручную: ${code}`;
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
