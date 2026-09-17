import { supabase } from './supabase.js';

const OAUTH_WAIT_MS = 8000;

function hasOAuthCallbackParams() {
  if (typeof window === 'undefined') return false;
  const { hash, search } = window.location;
  return hash.includes('access_token')
    || search.includes('code=')
    || search.includes('error=');
}

export function clearAuthCallbackFromUrl() {
  if (typeof window === 'undefined' || !hasOAuthCallbackParams()) return;
  window.history.replaceState({}, document.title, window.location.pathname);
}

/**
 * After OAuth redirect, getSession() can run before Supabase finishes the callback exchange.
 * Wait briefly for SIGNED_IN / INITIAL_SESSION when auth params are present in the URL.
 */
export async function resolveSessionAfterBoot() {
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
  return { ok: true, redirecting: true };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
