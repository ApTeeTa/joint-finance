import { create, verify, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const REQUIRED_SCOPE = "family_snapshot";

let cachedKey: CryptoKey | null = null;

async function getSigningKey(): Promise<CryptoKey> {
  if (cachedKey) {
    return cachedKey;
  }
  const secret = Deno.env.get("FAMILY_TOKEN_SECRET");
  if (!secret) {
    throw new Error("FAMILY_TOKEN_SECRET is not configured");
  }
  cachedKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return cachedKey;
}

export async function issueFamilyToken(): Promise<{ token: string; expiresAt: string }> {
  const key = await getSigningKey();
  const exp = getNumericDate(TOKEN_TTL_SECONDS);
  const token = await create(
    { alg: "HS256", typ: "JWT" },
    { scope: REQUIRED_SCOPE, iat: getNumericDate(0), exp },
    key,
  );
  const expiresAt = new Date(exp * 1000).toISOString();
  return { token, expiresAt };
}

export type VerifiedFamilyClaims = {
  scope: string;
  exp: number;
};

export async function verifyFamilyToken(
  bearer: string | null,
): Promise<VerifiedFamilyClaims | null> {
  if (!bearer?.startsWith("Bearer ")) {
    return null;
  }
  const token = bearer.slice("Bearer ".length).trim();
  if (!token) {
    return null;
  }
  try {
    const key = await getSigningKey();
    const payload = await verify(token, key);
    if (payload.scope !== REQUIRED_SCOPE) {
      return null;
    }
    return payload as VerifiedFamilyClaims;
  } catch {
    return null;
  }
}
