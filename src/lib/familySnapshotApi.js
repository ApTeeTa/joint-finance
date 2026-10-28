import {
  getFunctionsBaseUrl,
  getSupabaseApiHeaders,
  SUPABASE_ANON_KEY
} from './supabase.js';

const REQUEST_TIMEOUT_MS = 30_000;

function parseJsonResponse(response) {
  return response.json().catch(() => ({}));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function postFamilySession(passphrase) {
  const response = await fetchWithTimeout(`${getFunctionsBaseUrl()}/family-session`, {
    method: 'POST',
    headers: getSupabaseApiHeaders({
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({ passphrase })
  });

  const data = await parseJsonResponse(response);
  return { response, data };
}

export async function getFamilySnapshot(accessToken) {
  const response = await fetchWithTimeout(`${getFunctionsBaseUrl()}/family-snapshot`, {
    method: 'GET',
    headers: getSupabaseApiHeaders({
      Authorization: `Bearer ${accessToken}`
    })
  });

  const data = await parseJsonResponse(response);
  return { response, data };
}

export async function putFamilySnapshot(accessToken, { payload, expectedUpdatedAt }) {
  const response = await fetchWithTimeout(`${getFunctionsBaseUrl()}/family-snapshot`, {
    method: 'PUT',
    headers: getSupabaseApiHeaders({
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({
      payload,
      expected_updated_at: expectedUpdatedAt ?? null
    })
  });

  const data = await parseJsonResponse(response);
  return { response, data };
}

/** For diagnostics only — never log tokens. */
export function hasPublishableKey() {
  return Boolean(SUPABASE_ANON_KEY);
}
