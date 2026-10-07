import { UI } from './uiTheme.js';
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signOut,
  resolveSessionAfterBoot,
  getOAuthCallbackError
} from '../lib/authSession.js';
import {
  createHousehold,
  joinHouseholdByInviteCode,
  resolveActiveHouseholdForUser
} from '../lib/householdService.js';
import { clearActiveHousehold } from '../lib/householdContext.js';
import { resetSyncSession } from '../lib/stateRemote.js';
import {
  BETA_ANALYTICS_EVENTS,
  trackBetaEventFireAndForget
} from '../lib/betaAnalytics.js';

let gateEl = null;
let onReadyCallback = null;
let handlersBound = false;

function showGate() {
  gateEl = document.getElementById('auth-gate');
  gateEl?.classList.remove('hidden');
  document.getElementById('app-shell')?.classList.add('hidden');
}

function hideGate() {
  gateEl?.classList.add('hidden');
  document.getElementById('app-shell')?.classList.remove('hidden');
}

function setMessage(text, isError = false) {
  const el = gateEl?.querySelector('[data-auth-message]');
  if (!el) return;
  el.textContent = text ?? '';
  el.className = isError
    ? 'text-sm text-red-600 text-center'
    : 'text-sm text-slate-500 text-center';
}

function ensureGateHandlers() {
  if (handlersBound || !gateEl) return;
  handlersBound = true;

  gateEl.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const action = button.dataset.action;

    if (action === 'auth-sign-out') {
      await signOutToAuthGate();
      return;
    }

    if (action === 'auth-google') {
      setMessage('Переход в Google…');
      const result = await signInWithGoogle();
      if (!result.ok) setMessage(result.error, true);
      return;
    }

    if (action === 'auth-sign-in' || action === 'auth-sign-up') {
      const email = gateEl.querySelector('[name="email"]')?.value.trim();
      const password = gateEl.querySelector('[name="password"]')?.value;
      if (!email || !password) {
        setMessage('Введите email и пароль', true);
        return;
      }

      setMessage(action === 'auth-sign-in' ? 'Вход…' : 'Создание аккаунта…');
      const result = action === 'auth-sign-in'
        ? await signInWithEmail(email, password)
        : await signUpWithEmail(email, password);

      if (!result.ok) {
        setMessage(result.error, true);
        return;
      }
      if (action === 'auth-sign-up') {
        trackBetaEventFireAndForget(BETA_ANALYTICS_EVENTS.SIGNUP, { auth_method: 'email' });
        if (!result.session) {
          setMessage('Подтвердите email и затем войдите.');
          return;
        }
      } else {
        trackBetaEventFireAndForget(BETA_ANALYTICS_EVENTS.SIGNIN, { auth_method: 'email' });
      }
      await continueAfterAuth(result.user);
      return;
    }

    if (action === 'household-create') {
      const userId = gateEl.dataset.userId;
      const householdName = gateEl.querySelector('[name="householdName"]')?.value;
      const displayName = gateEl.querySelector('[name="displayName"]')?.value;
      setMessage('Создание семьи…');
      const result = await createHousehold(userId, {
        name: householdName,
        displayName
      });
      if (!result.ok) {
        setMessage(result.error, true);
        return;
      }
      finishOnboarding(result.household);
      return;
    }

    if (action === 'household-join') {
      const userId = gateEl.dataset.userId;
      const code = gateEl.querySelector('[name="inviteCode"]')?.value;
      const displayName = gateEl.querySelector('[name="joinDisplayName"]')?.value;
      setMessage('Присоединение к семье…');
      const result = await joinHouseholdByInviteCode(userId, code, displayName);
      if (!result.ok) {
        setMessage(result.error, true);
        return;
      }
      finishOnboarding(result.household);
    }
  });
}

function renderAuthView() {
  showGate();
  gateEl.innerHTML = `
    <div class="max-w-md mx-auto ${UI.panel} ${UI.panelPadding} mt-10">
      <h2 class="${UI.panelTitle} mb-1 text-center">Семейные финансы · Beta</h2>
      <p class="text-sm text-slate-500 text-center mb-6">Войдите, чтобы синхронизировать семейный бюджет</p>
      <div class="space-y-4">
        <div>
          <label class="${UI.label}">Email</label>
          <input type="email" name="email" required autocomplete="email" class="${UI.field}" placeholder="you@example.com">
        </div>
        <div>
          <label class="${UI.label}">Пароль</label>
          <input type="password" name="password" required autocomplete="current-password" class="${UI.field}" placeholder="••••••••">
        </div>
        <p data-auth-message class="text-sm text-slate-500 text-center"></p>
        <div class="flex flex-col gap-2">
          <button type="button" data-action="auth-sign-in" class="${UI.btnPrimaryBlock}">Войти</button>
          <button type="button" data-action="auth-sign-up" class="${UI.btnSecondaryBlock}">Создать аккаунт</button>
          <button type="button" data-action="auth-google" class="${UI.btnSecondaryBlock}">Войти через Google</button>
        </div>
      </div>
    </div>
  `;
  ensureGateHandlers();
}

function renderHouseholdView(user) {
  showGate();

  gateEl.innerHTML = `
    <div class="max-w-lg mx-auto ${UI.panel} ${UI.panelPadding} mt-10 space-y-6">
      <div>
        <h2 class="${UI.panelTitle} mb-1">Настройте семью</h2>
        <p class="text-sm text-slate-500">Создайте новую семью или присоединитесь по коду приглашения. Данные того, кто пригласил, станут общими.</p>
      </div>

      <section class="space-y-3">
        <h3 class="text-sm font-semibold text-slate-800">Создать семью</h3>
        <div>
          <label class="${UI.label}">Название семьи</label>
          <input type="text" name="householdName" maxlength="80" class="${UI.field}" placeholder="Наша семья">
        </div>
        <div>
          <label class="${UI.label}">Ваше имя</label>
          <input type="text" name="displayName" maxlength="80" class="${UI.field}" placeholder="Алексей">
        </div>
        <button type="button" data-action="household-create" class="${UI.btnPrimaryBlock}">Создать семью</button>
      </section>

      <div class="border-t border-surface-border pt-4 space-y-3">
        <h3 class="text-sm font-semibold text-slate-800">Присоединиться по коду</h3>
        <div>
          <label class="${UI.label}">Код приглашения</label>
          <input type="text" name="inviteCode" maxlength="12" class="${UI.field} uppercase" placeholder="AB12CD34">
        </div>
        <div>
          <label class="${UI.label}">Ваше имя</label>
          <input type="text" name="joinDisplayName" maxlength="80" class="${UI.field}" placeholder="Мария">
        </div>
        <button type="button" data-action="household-join" class="${UI.btnSecondaryBlock}">Присоединиться</button>
      </div>

      <p data-auth-message class="text-sm text-slate-500 text-center"></p>
      <button type="button" data-action="auth-sign-out" class="text-sm text-slate-500 hover:text-slate-700 w-full text-center">Выйти</button>
    </div>
  `;

  gateEl.dataset.userId = user.id;
  ensureGateHandlers();
}

async function continueAfterAuth(user) {
  const resolved = await resolveActiveHouseholdForUser(user.id);
  if (!resolved.ok) {
    setMessage(resolved.error, true);
    return;
  }
  if (resolved.household) {
    finishOnboarding(resolved.household);
    return;
  }
  renderHouseholdView(user);
}

function finishOnboarding(household) {
  hideGate();
  onReadyCallback?.({ household });
}

export async function signOutToAuthGate() {
  clearActiveHousehold();
  resetSyncSession();
  await signOut();
  renderAuthView();
  setMessage('');
}

function renderAuthLoadingView() {
  showGate();
  gateEl.innerHTML = `
    <div class="max-w-md mx-auto ${UI.panel} ${UI.panelPadding} mt-10 text-center">
      <p class="text-sm text-slate-500">Вход в приложение…</p>
    </div>
  `;
}

export async function ensureBetaAccess({ onReady } = {}) {
  gateEl = document.getElementById('auth-gate');
  onReadyCallback = onReady ?? null;
  ensureGateHandlers();
  renderAuthLoadingView();

  const session = await resolveSessionAfterBoot();
  const oauthSignIn = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('code');
  if (session?.user && oauthSignIn) {
    trackBetaEventFireAndForget(BETA_ANALYTICS_EVENTS.SIGNIN, { auth_method: 'google' });
  }
  if (!session?.user) {
    renderAuthView();
    const oauthError = getOAuthCallbackError();
    if (oauthError) {
      setMessage(oauthError, true);
    }
    return { ready: false };
  }

  const resolved = await resolveActiveHouseholdForUser(session.user.id);
  if (!resolved.ok) {
    renderAuthView();
    setMessage(resolved.error, true);
    return { ready: false };
  }

  if (!resolved.household) {
    renderHouseholdView(session.user);
    return { ready: false };
  }

  hideGate();
  return { ready: true, household: resolved.household, user: session.user };
}
