import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { verifyFamilyToken } from "../_shared/jwt.ts";

const SNAPSHOT_ID = "family";

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Supabase admin env missing");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireAuth(req: Request) {
  const claims = await verifyFamilyToken(req.headers.get("Authorization"));
  if (!claims) {
    return null;
  }
  return claims;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) {
    return options;
  }

  const auth = await requireAuth(req);
  if (!auth) {
    return jsonResponse(req, { ok: false, error: "unauthorized" }, 401);
  }

  let admin;
  try {
    admin = adminClient();
  } catch {
    return jsonResponse(req, { ok: false, error: "server_misconfigured" }, 500);
  }

  if (req.method === "GET") {
    const { data, error } = await admin
      .from("household_snapshots")
      .select("id, payload, updated_at")
      .eq("id", SNAPSHOT_ID)
      .maybeSingle();

    if (error) {
      console.error("[family-snapshot] GET failed", error.message);
      return jsonResponse(req, { ok: false, error: "read_failed" }, 500);
    }

    if (!data) {
      return jsonResponse(req, {
        ok: true,
        id: SNAPSHOT_ID,
        payload: {},
        updated_at: null,
        row_exists: false,
      });
    }

    return jsonResponse(req, {
      ok: true,
      id: data.id,
      payload: data.payload ?? {},
      updated_at: data.updated_at,
      row_exists: true,
    });
  }

  if (req.method === "PUT") {
    let body: { payload?: unknown; expected_updated_at?: string | null };
    try {
      body = await req.json();
    } catch {
      return jsonResponse(req, { ok: false, error: "invalid_json" }, 400);
    }

    if (!body.payload || typeof body.payload !== "object") {
      return jsonResponse(req, { ok: false, error: "invalid_payload" }, 400);
    }

    const expected = body.expected_updated_at ?? null;

    const { data: current, error: readError } = await admin
      .from("household_snapshots")
      .select("id, payload, updated_at")
      .eq("id", SNAPSHOT_ID)
      .maybeSingle();

    if (readError) {
      console.error("[family-snapshot] read before write failed", readError.message);
      return jsonResponse(req, { ok: false, error: "read_failed" }, 500);
    }

    const now = new Date().toISOString();

    if (!current) {
      if (expected !== null && expected !== undefined) {
        return jsonResponse(
          req,
          {
            ok: false,
            error: "conflict",
            current: { payload: {}, updated_at: null, row_exists: false },
          },
          409,
        );
      }
      const { data: inserted, error: insertError } = await admin
        .from("household_snapshots")
        .insert({
          id: SNAPSHOT_ID,
          payload: body.payload,
          updated_at: now,
        })
        .select("updated_at")
        .single();

      if (insertError) {
        console.error("[family-snapshot] insert failed", insertError.message);
        return jsonResponse(req, { ok: false, error: "write_failed" }, 500);
      }

      return jsonResponse(req, { ok: true, updated_at: inserted.updated_at });
    }

    const currentUpdatedAt = current.updated_at as string;
    if (expected !== null && expected !== undefined && expected !== currentUpdatedAt) {
      return jsonResponse(
        req,
        {
          ok: false,
          error: "conflict",
          current: {
            payload: current.payload ?? {},
            updated_at: currentUpdatedAt,
            row_exists: true,
          },
        },
        409,
      );
    }

    const { data: updated, error: updateError } = await admin
      .from("household_snapshots")
      .update({ payload: body.payload, updated_at: now })
      .eq("id", SNAPSHOT_ID)
      .eq("updated_at", currentUpdatedAt)
      .select("updated_at")
      .maybeSingle();

    if (updateError) {
      console.error("[family-snapshot] update failed", updateError.message);
      return jsonResponse(req, { ok: false, error: "write_failed" }, 500);
    }

    if (!updated) {
      const { data: fresh } = await admin
        .from("household_snapshots")
        .select("payload, updated_at")
        .eq("id", SNAPSHOT_ID)
        .maybeSingle();

      return jsonResponse(
        req,
        {
          ok: false,
          error: "conflict",
          current: {
            payload: fresh?.payload ?? {},
            updated_at: fresh?.updated_at ?? null,
            row_exists: Boolean(fresh),
          },
        },
        409,
      );
    }

    return jsonResponse(req, { ok: true, updated_at: updated.updated_at });
  }

  return jsonResponse(req, { ok: false, error: "method_not_allowed" }, 405);
});
