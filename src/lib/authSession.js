import { supabase } from './supabase.js';

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
  const redirectTo = typeof window !== 'undefined' ? window.location.origin + window.location.pathname : undefined;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo }
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
