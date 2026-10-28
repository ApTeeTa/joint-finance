/** Publishable Supabase credentials — safe in frontend; data access is via Edge Functions only. */

export const SUPABASE_URL = 'https://zbbhhlxdduhkvyhiesba.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_V1l8_4xCq5aJFvt7Vzph8w_5fGOS64u';

export function getFunctionsBaseUrl() {
  return `${SUPABASE_URL}/functions/v1`;
}

export function getSupabaseApiHeaders(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    ...extra
  };
}
