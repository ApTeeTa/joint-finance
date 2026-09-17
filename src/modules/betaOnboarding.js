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
import { exportSharedSnapshot } from './storage.js';
import { clearActiveHousehold } from '../lib/householdContext.js';

let gateEl = null;
let onReadyCallback = null;
let seedStateRef = null;
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
      setMessage('Redirecting to Google…');
      const result = await signInWithGoogle();
      if (!result.ok) setMessage(result.error, true);
      return;
    }

    if (action === 'auth-sign-in' || action === 'auth-sign-up') {
      const email = gateEl.querySelector('[name="email"]')?.value.trim();
      const password = gateEl.querySelector('[name="password"]')?.value;
      if (!email || !password) {
        setMessage('Enter email and password', true);
        return;
      }

      setMessage(action === 'auth-sign-in' ? 'Signing in…' : 'Creating account…');
      const result = action === 'auth-sign-in'
        ? await signInWithEmail(email, password)
        : await signUpWithEmail(email, password);

      if (!result.ok) {
        setMessage(result.error, true);
        return;
      }
      if (action === 'auth-sign-up' && !result.session) {
        setMessage('Check your email to confirm signup, then sign in.');
        return;
      }
      await continueAfterAuth(result.user);
      return;
    }

    if (action === 'household-create') {
      const userId = gateEl.dataset.userId;
      const householdName = gateEl.querySelector('[name="householdName"]')?.value;
      const displayName = gateEl.querySelector('[name="displayName"]')?.value;
      setMessage('Creating household…');
      const seedPayload = seedStateRef ? exportSharedSnapshot(seedStateRef) : null;
      const result = await createHousehold(userId, {
        name: householdName,
        displayName,
        seedPayload
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
      setMessage('Joining household…');
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
      <h2 class="${UI.panelTitle} mb-1 text-center">Joint Finance Beta</h2>
      <p class="text-sm text-slate-500 text-center mb-6">Sign in to sync your household finances</p>
      <div class="space-y-4">
        <div>
          <label class="${UI.label}">Email</label>
          <input type="email" name="email" required autocomplete="email" class="${UI.field}" placeholder="you@example.com">
        </div>
        <div>
          <label class="${UI.label}">Password</label>
          <input type="password" name="password" required autocomplete="current-password" class="${UI.field}" placeholder="••••••••">
        </div>
        <p data-auth-message class="text-sm text-slate-500 text-center"></p>
        <div class="flex flex-col gap-2">
          <button type="button" data-action="auth-sign-in" class="${UI.btnPrimaryBlock}">Sign in</button>
          <button type="button" data-action="auth-sign-up" class="${UI.btnSecondaryBlock}">Create account</button>
          <button type="button" data-action="auth-google" class="${UI.btnSecondaryBlock}">Continue with Google</button>
        </div>
      </div>
    </div>
  `;
  ensureGateHandlers();
}

function renderHouseholdView(user, { seedState = null } = {}) {
  showGate();
  seedStateRef = seedState;
  const seedHint = seedState
    ? '<p class="text-xs text-slate-500">Your current local data will be uploaded to this household.</p>'
    : '';

  gateEl.innerHTML = `
    <div class="max-w-lg mx-auto ${UI.panel} ${UI.panelPadding} mt-10 space-y-6">
      <div>
        <h2 class="${UI.panelTitle} mb-1">Set up your household</h2>
        <p class="text-sm text-slate-500">Create a new household or join with an invite code. The inviter's data becomes shared.</p>
      </div>

      <section class="space-y-3">
        <h3 class="text-sm font-semibold text-slate-800">Create household</h3>
        <div>
          <label class="${UI.label}">Household name</label>
          <input type="text" name="householdName" maxlength="80" class="${UI.field}" placeholder="Our family">
        </div>
        <div>
          <label class="${UI.label}">Your name</label>
          <input type="text" name="displayName" maxlength="80" class="${UI.field}" placeholder="Alex">
        </div>
        ${seedHint}
        <button type="button" data-action="household-create" class="${UI.btnPrimaryBlock}">Create household</button>
      </section>

      <div class="border-t border-surface-border pt-4 space-y-3">
        <h3 class="text-sm font-semibold text-slate-800">Join with invite code</h3>
        <div>
          <label class="${UI.label}">Invite code</label>
          <input type="text" name="inviteCode" maxlength="12" class="${UI.field} uppercase" placeholder="AB12CD34">
        </div>
        <div>
          <label class="${UI.label}">Your name</label>
          <input type="text" name="joinDisplayName" maxlength="80" class="${UI.field}" placeholder="Sam">
        </div>
        <button type="button" data-action="household-join" class="${UI.btnSecondaryBlock}">Join household</button>
      </div>

      <p data-auth-message class="text-sm text-slate-500 text-center"></p>
      <button type="button" data-action="auth-sign-out" class="text-sm text-slate-500 hover:text-slate-700 w-full text-center">Sign out</button>
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
  renderHouseholdView(user, { seedState: seedStateRef });
}

function finishOnboarding(household) {
  hideGate();
  onReadyCallback?.({ household });
}

export async function signOutToAuthGate() {
  clearActiveHousehold();
  await signOut();
  renderAuthView();
  setMessage('');
}

function renderAuthLoadingView() {
  showGate();
  gateEl.innerHTML = `
    <div class="max-w-md mx-auto ${UI.panel} ${UI.panelPadding} mt-10 text-center">
      <p class="text-sm text-slate-500">Signing you in…</p>
    </div>
  `;
}

export async function ensureBetaAccess({ seedState = null, onReady } = {}) {
  gateEl = document.getElementById('auth-gate');
  onReadyCallback = onReady ?? null;
  seedStateRef = seedState;
  ensureGateHandlers();
  renderAuthLoadingView();

  const session = await resolveSessionAfterBoot();
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
    renderHouseholdView(session.user, { seedState });
    return { ready: false };
  }

  hideGate();
  return { ready: true, household: resolved.household, user: session.user };
}
