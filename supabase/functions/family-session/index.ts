import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { issueFamilyToken } from "../_shared/jwt.ts";
import { verifyPassphrase } from "../_shared/passphrase.ts";
import { checkRateLimit, clientKeyFromRequest } from "../_shared/rateLimit.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) {
    return options;
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { ok: false, error: "method_not_allowed" }, 405);
  }

  const clientKey = clientKeyFromRequest(req);
  if (!checkRateLimit(clientKey)) {
    return jsonResponse(req, { ok: false, error: "rate_limited" }, 429);
  }

  let body: { passphrase?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { ok: false, error: "invalid_json" }, 400);
  }

  const passphrase = typeof body.passphrase === "string" ? body.passphrase : "";
  if (!verifyPassphrase(passphrase)) {
    return jsonResponse(req, { ok: false, error: "invalid_passphrase" }, 401);
  }

  try {
    const { token, expiresAt } = await issueFamilyToken();
    return jsonResponse(req, {
      ok: true,
      access_token: token,
      expires_at: expiresAt,
      token_type: "Bearer",
    });
  } catch {
    return jsonResponse(req, { ok: false, error: "server_misconfigured" }, 500);
  }
});
