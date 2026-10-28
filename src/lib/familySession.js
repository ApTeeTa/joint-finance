import { isLocalOnlyTestMode } from '../config/environmentConfig.js';
import { postFamilySession } from './familySnapshotApi.js';

export const TOKEN_KEY = 'joint-finance-family-token';
export const EXP_KEY = 'joint-finance-family-token-exp';

export const FAMILY_UNAUTHORIZED_EVENT = 'joint-finance:family-unauthorized';

let gateEl = null;
let handlersBound = false;
let onReadyCallback = null;

function setMessage(text, isError = false) {
  const el = gateEl?.querySelector('[data-family-message]');
  if (!el) return;
  el.textContent = text ?? '';
  el.className = isError
    ? 'text-sm text-red-600 text-center min-h-[1.25rem]'
    : 'text-sm text-slate-500 text-center min-h-[1.25rem]';
}

function showGate() {
  gateEl = document.getElementById('family-gate');
  gateEl?.classList.remove('hidden');
  document.getElementById('app-shell')?.classList.add('hidden');
}

export function hideFamilyGate() {
  gateEl?.classList.add('hidden');
  document.getElementById('app-shell')?.classList.remove('hidden');
}

function renderGateShell() {
  gateEl = document.getElementById('family-gate');
  if (!gateEl || gateEl.dataset.rendered === 'true') {
    return;
  }
  gateEl.dataset.rendered = 'true';
  gateEl.innerHTML = `
    <div class="jf-gate-shell">
      <p class="text-center text-xs font-semibold uppercase tracking-widest text-primary-600 mb-2">Joint Finance</p>
      <h2 class="jf-gate-title mb-2">Семейный доступ</h2>
      <p class="text-sm text-slate-500 text-center mb-6">Введите семейный пароль для доступа на этом устройстве.</p>
      <label class="block text-sm font-medium text-slate-700 mb-1" for="family-passphrase">Семейный пароль</label>
      <input
        id="family-passphrase"
        name="passphrase"
        type="password"
        autocomplete="current-password"
        class="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-surface-border mb-4 focus:outline-none focus:ring-2 focus:ring-primary-500/25 focus:border-primary-600 jf-field"
        placeholder="Пароль"
      />
      <p data-family-message class="text-sm text-slate-500 text-center min-h-[1.25rem] mb-3"></p>
      <button type="button" data-action="family-unlock" class="jf-gate-btn jf-interactive">
        Открыть
      </button>
    </div>
  `;
}

function bindGateHandlers() {
  if (handlersBound || !gateEl) return;
  handlersBound = true;

  gateEl.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action="family-unlock"]');
    if (!button || button.disabled) return;

    const input = gateEl.querySelector('[name="passphrase"]');
    const passphrase = input?.value ?? '';
    if (!passphrase.trim()) {
      setMessage('Введите семейный пароль', true);
      return;
    }

    button.disabled = true;
    setMessage('Проверка…');
    try {
      const result = await loginWithPassphrase(passphrase);
      if (!result.ok) {
        setMessage(result.error ?? 'Неверный пароль', true);
        return;
      }

      input.value = '';
      setMessage('');
      hideFamilyGate();
      if (typeof onReadyCallback === 'function') {
        await onReadyCallback();
      }
    } catch {
      setMessage(
        'Не удалось связаться с сервером. Проверьте интернет или откройте приложение через локальный сервер на порту 8778.',
        true
      );
    } finally {
      button.disabled = false;
    }
  });

  gateEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      gateEl.querySelector('[data-action="family-unlock"]')?.click();
    }
  });
}

export function getStoredAccessToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredTokenExpiry() {
  try {
    return localStorage.getItem(EXP_KEY);
  } catch {
    return null;
  }
}

export function isAccessTokenValid() {
  const token = getStoredAccessToken();
  const exp = getStoredTokenExpiry();
  if (!token || !exp) {
    return false;
  }
  const expiresMs = Date.parse(exp);
  if (Number.isNaN(expiresMs)) {
    return false;
  }
  return Date.now() < expiresMs - 60_000;
}

export function persistAccessToken(accessToken, expiresAt) {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(EXP_KEY, expiresAt);
}

export function clearFamilySession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXP_KEY);
  } catch {
    /* noop */
  }
}

export function requireAccessToken() {
  if (!isAccessTokenValid()) {
    return { ok: false, error: new Error('no_family_token') };
  }
  return { ok: true, token: getStoredAccessToken() };
}

export function notifyUnauthorized() {
  clearFamilySession();
  window.dispatchEvent(new CustomEvent(FAMILY_UNAUTHORIZED_EVENT));
}

export async function loginWithPassphrase(passphrase) {
  try {
    const { response, data } = await postFamilySession(passphrase);
    if (response.status === 401) {
      return { ok: false, error: 'Неверный семейный пароль' };
    }
    if (response.status === 429) {
      return { ok: false, error: 'Слишком много попыток. Подождите минуту.' };
    }
    if (!response.ok || !data?.access_token) {
      return { ok: false, error: 'Не удалось войти. Проверьте сеть и настройки Supabase.' };
    }

    persistAccessToken(data.access_token, data.expires_at);
    return { ok: true, token: data.access_token };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { ok: false, error: 'Сервер не ответил вовремя. Попробуйте ещё раз.' };
    }
    return { ok: false, error: 'Нет связи с сервером. Проверьте интернет.' };
  }
}

/**
 * Gate before financial app boot.
 * @returns {Promise<{ ready: boolean }>}
 */
export async function ensureFamilyAccess({ onReady } = {}) {
  onReadyCallback = onReady;
  renderGateShell();
  bindGateHandlers();

  if (isLocalOnlyTestMode()) {
    hideFamilyGate();
    return { ready: true };
  }

  if (isAccessTokenValid()) {
    hideFamilyGate();
    return { ready: true };
  }

  clearFamilySession();
  showGate();
  return { ready: false };
}

export function lockAppAndShowGate() {
  renderGateShell();
  bindGateHandlers();
  showGate();
}

export function initFamilyUnauthorizedListener(onUnauthorized) {
  window.addEventListener(FAMILY_UNAUTHORIZED_EVENT, () => {
    lockAppAndShowGate();
    if (typeof onUnauthorized === 'function') {
      onUnauthorized();
    }
  });
}
