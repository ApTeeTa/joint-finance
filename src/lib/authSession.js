import { supabase } from './supabase.js';

const OAUTH_WAIT_MS = 10000;
let lastAuthBootstrapError = null;

function readOAuthCallbackParams() {
  if (typeof window === 'undefined') {
    return { code: null, flowId: null, error: null, errorDescription: null };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    code: params.get('code'),
    flowId: params.get('sb_flow_id'),
    error: params.get('error'),
    errorDescription: params.get('error_description')
  };
}

function hasOAuthCallbackParams() {
  const { code, error } = readOAuthCallbackParams();
  const hash = typeof window !== 'undefined' ? window.location.hash : '';
  return Boolean(code || error || hash.includes('access_token'));
}

export function clearAuthCallbackFromUrl() {
  if (typeof window === 'undefined' || !hasOAuthCallbackParams()) return;
  window.history.replaceState({}, document.title, window.location.pathname);
}

async function exchangeOAuthCallbackIfPresent() {
  lastAuthBootstrapError = null;
  const { code, flowId, error, errorDescription } = readOAuthCallbackParams();

  if (error) {
    const message = errorDescription || error;
    lastAuthBootstrapError = message;
    console.error('[AUTH] OAuth callback error', message);
    clearAuthCallbackFromUrl();
    return { session: null, error: message };
  }

  if (!code) {
    return { session: null, error: null };
  }

  console.log('[AUTH] Exchanging OAuth code for session…', flowId ? { flowId } : {});
  const exchangeOptions = flowId ? { flowId } : undefined;
  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(
    code,
    exchangeOptions
  );

  if (exchangeError) {
    lastAuthBootstrapError = exchangeError.message;
    console.error('[AUTH] exchangeCodeForSession failed', exchangeError);
    clearAuthCallbackFromUrl();
    return { session: null, error: exchangeError.message };
  }

  clearAuthCallbackFromUrl();
  return { session: data.session ?? null, error: null };
}

/**
 * After OAuth redirect, wait for PKCE exchange before the auth gate runs.
 */
export async function resolveSessionAfterBoot() {
  if (hasOAuthCallbackParams()) {
    const exchanged = await exchangeOAuthCallbackIfPresent();
    if (exchanged.session) {
      return exchanged.session;
    }
    if (exchanged.error) {
      return null;
    }
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('[AUTH] getSession failed', error);
  }
  if (data.session) {
    return data.session;
  }

  if (!hasOAuthCallbackParams()) {
    return null;
  }

  console.log('[AUTH] OAuth callback detected — waiting for session…');

  return new Promise((resolve) => {
    let settled = false;
    let subscription = null;
    let timer = null;

    const finish = (session) => {
      if (settled) return;
      settled = true;
      subscription?.unsubscribe();
      if (timer) clearTimeout(timer);
      resolve(session ?? null);
    };

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
        clearAuthCallbackFromUrl();
        finish(session);
      }
    });
    subscription = listener.subscription;

    timer = setTimeout(async () => {
      const { data: retry } = await supabase.auth.getSession();
      finish(retry.session ?? null);
    }, OAUTH_WAIT_MS);
  });
}

export function getOAuthCallbackError() {
  const { error, errorDescription } = readOAuthCallbackParams();
  if (error) {
    return errorDescription || error;
  }
  return lastAuthBootstrapError;
}

export function clearAuthBootstrapError() {
  lastAuthBootstrapError = null;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('[AUTH] getSession failed', error);
    return null;
  }
  return data.session ?? null;
}

export async function getCurrentUser() {
  const session = await getSession();
  return session?.user ?? null;
}

export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => data.subscription.unsubscribe();
}

export async function signUpWithEmail(email, password, displayName = '') {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: displayName ? { full_name: displayName } : undefined
    }
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, session: data.session, user: data.user };
}

export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, session: data.session, user: data.user };
}

export async function signInWithGoogle() {
  const redirectTo = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname || '/'}`
    : undefined;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: { prompt: 'select_account' }
    }
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  if (data?.url) {
    window.location.assign(data.url);
  }
  return { ok: true, redirecting: true, flowId: data.flowId ?? null };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
