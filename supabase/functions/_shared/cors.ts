/** Allowed browser origins — no wildcard. Add preview URLs as needed. */
const ALLOWED_ORIGINS = new Set([
  "https://joint-finance.vercel.app",
  "https://joint-finance-git-beta-apteetas-projects.vercel.app",
  "https://joint-finance-git-family-apteetas-projects.vercel.app",
  "https://joint-finance-git-experiment-full-sync-apteetas-projects.vercel.app",
  "http://127.0.0.1:8080",
  "http://localhost:8080",
  "http://127.0.0.1:8778",
  "http://localhost:8778",
]);

/** Vercel preview deployments for this repo (branch previews). */
function isJointFinanceVercelOrigin(hostname: string): boolean {
  if (hostname === "joint-finance.vercel.app") {
    return true;
  }
  if (!hostname.endsWith(".vercel.app")) {
    return false;
  }
  return hostname.startsWith("joint-finance")
    || hostname.startsWith("joint-finance-git-");
}

function isAllowedOrigin(origin: string): boolean {
  if (!origin) {
    return false;
  }
  if (ALLOWED_ORIGINS.has(origin)) {
    return true;
  }
  try {
    const url = new URL(origin);
    if (url.protocol === "https:" && isJointFinanceVercelOrigin(url.hostname)) {
      return true;
    }
    return url.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

export function corsHeaders(req: Request): Headers {
  const origin = req.headers.get("Origin") ?? "";
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    Vary: "Origin",
  });
  if (isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

export function handleOptions(req: Request): Response | null {
  if (req.method !== "OPTIONS") {
    return null;
  }
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function jsonResponse(
  req: Request,
  body: unknown,
  status = 200,
): Response {
  const headers = corsHeaders(req);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}
