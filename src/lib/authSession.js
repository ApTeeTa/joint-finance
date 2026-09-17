import { supabase } from './supabase.js';

const OAUTH_WAIT_MS = 10000;
let lastAuthBootstrapError = null;

function readOAuthCallbackParams() {
  if (typeof window === 'undefined') {
    return { error: null, errorDescription: null, hasCode: false };
  }
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash;
  return {
    error: params.get('error'),
    errorDescription: params.get('error_description'),
    hasCode: Boolean(params.get('code') || hash.includes('access_token'))
  };
}

function hasOAuthCallbackParams() {
  const { error, hasCode } = readOAuthCallbackParams();
  return Boolean(error || hasCode);
}

export function clearAuthCallbackFromUrl() {
  if (typeof window === 'undefined' || !hasOAuthCallbackParams()) return;
  window.history.replaceState({}, document.title, window.location.pathname);
}

function waitForOAuthSession(timeoutMs) {
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
        finish(session);
      }
    });
    subscription = listener.subscription;

    const poll = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        finish(data.session);
      }
    };

    poll();
    timer = setTimeout(async () => {
      await poll();
      finish(null);
    }, timeoutMs);
  });
}

/**
 * After OAuth redirect, let the Supabase client exchange the PKCE code (detectSessionInUrl).
 * Do NOT call exchangeCodeForSession manually — that causes "code verifier should be non-empty".
 */
export async function resolveSessionAfterBoot() {
  lastAuthBootstrapError = null;

  const { error, errorDescription, hasCode } = readOAuthCallbackParams();
  if (error) {
    lastAuthBootstrapError = errorDescription || error;
    clearAuthCallbackFromUrl();
    return null;
  }

  if (hasCode) {
    console.log('[AUTH] OAuth callback — waiting for Supabase PKCE exchange…');
    const session = await waitForOAuthSession(OAUTH_WAIT_MS);
    if (session) {
      clearAuthCallbackFromUrl();
      return session;
    }
    lastAuthBootstrapError = 'Sign-in link expired or invalid. Please try Google again.';
    clearAuthCallbackFromUrl();
    return null;
  }

  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    console.error('[AUTH] getSession failed', sessionError);
  }
  return data.session ?? null;
}

export function getOAuthCallbackError() {
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
  clearAuthCallbackFromUrl();
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
  return { ok: true, redirecting: true };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
