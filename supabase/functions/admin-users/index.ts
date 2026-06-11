// supabase/functions/admin-users/index.ts
// Edge Function: admin-user-management
// Handles enable/disable and grant/revoke admin actions via service_role key.
// Verifies caller is admin before mutating anything.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.1";

const ALLOWED_ACTIONS = new Set([
  "enable",
  "disable",
  "grant_admin",
  "revoke_admin",
]);

interface RequestBody {
  action: string;
  targetUserId: string;
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return json({ error: "Server misconfigured" }, 500);
  }

  // 1. Verify caller is authenticated (using their JWT)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !callerData?.user) {
    return json({ error: "Invalid session" }, 401);
  }
  const callerId = callerData.user.id;

  // 2. Service-role client (bypasses RLS) for verification + mutations
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 3. Verify caller is admin
  const { data: roleRow, error: roleErr } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId)
    .eq("role", "admin")
    .maybeSingle();

  if (roleErr) return json({ error: "Role check failed: " + roleErr.message }, 500);
  if (!roleRow) return json({ error: "Forbidden: caller is not admin" }, 403);

  // 4. Parse and validate body
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body.action !== "string" || typeof body.targetUserId !== "string") {
    return json({ error: "Missing action or targetUserId" }, 400);
  }
  if (!ALLOWED_ACTIONS.has(body.action)) {
    return json({ error: "Invalid action" }, 400);
  }

  const { action, targetUserId } = body;

  // Refuse to disable yourself
  if (targetUserId === callerId && (action === "disable" || action === "revoke_admin")) {
    return json(
      { error: "No puedes deshabilitarte o quitarte el rol de admin a ti mismo" },
      400,
    );
  }

  let result: { error: string | null } = { error: null };

  if (action === "enable" || action === "disable") {
    const enabled = action === "enable";
    const { error } = await admin
      .from("profiles")
      .update({
        is_enabled: enabled,
        enabled_at: enabled ? new Date().toISOString() : null,
        enabled_by: enabled ? callerId : null,
      })
      .eq("user_id", targetUserId);

    if (error) result = { error: error.message };
  } else if (action === "grant_admin") {
    const { error } = await admin
      .from("user_roles")
      .upsert({ user_id: targetUserId, role: "admin" }, { onConflict: "user_id,role" });
    if (error) result = { error: error.message };
  } else if (action === "revoke_admin") {
    const { error } = await admin
      .from("user_roles")
      .delete()
      .eq("user_id", targetUserId)
      .eq("role", "admin");
    if (error) result = { error: error.message };
  }

  if (result.error) return json({ error: result.error }, 500);

  // 5. Audit log (use service role, bypasses RLS)
  const { error: auditErr } = await admin.from("admin_audit_log").insert({
    admin_id: callerId,
    target_user_id: targetUserId,
    action,
    details: {},
  });
  if (auditErr) console.error("Audit log write failed:", auditErr);

  return json({ success: true });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
