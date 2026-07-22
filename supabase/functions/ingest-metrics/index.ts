// supabase/functions/ingest-metrics/index.ts
// Edge Function: ingest campaign performance metrics (CTR / CTOR) pushed
// from the Comms Governance Google Sheet by its Apps Script.
//
// Auth: this endpoint is called by Apps Script, which cannot hold a
// Supabase user session, so JWT verification is disabled and the caller
// must instead present the shared secret in `x-ingest-secret` (stored as
// the METRICS_INGEST_SECRET function secret). Requests without it are
// rejected before touching the database.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.1";

interface MetricRow {
  kind: string;                 // 'drv' | 'pax'  (from the sheet's user_type)
  country_code: string;
  external_campaign_id: string; // POPE/Ad Placement campaign_id
  step_id?: string;
  template_id?: string;
  channel: string;
  comm_platform?: string;       // POPE | AD PLACEMENT
  activity_name?: string;
  creator?: string;
  start_date?: string | null;   // YYYY-MM-DD
  start_week?: number | null;
  cohort_size?: number | null;
  request_uv?: number | null;
  send_uv?: number | null;
  deliver_uv?: number | null;
  arrive_uv?: number | null;
  show_uv?: number | null;
  click_uv?: number | null;
  open_rate?: number | null;
  ctr?: number | null;
  ctor?: number | null;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-ingest-secret",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const INGEST_SECRET = Deno.env.get("METRICS_INGEST_SECRET");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "Server misconfigured" }, 500);
  }
  if (!INGEST_SECRET) {
    return json({ error: "METRICS_INGEST_SECRET is not set" }, 500);
  }
  if (req.headers.get("x-ingest-secret") !== INGEST_SECRET) {
    return json({ error: "Forbidden" }, 403);
  }

  let body: { rows?: MetricRow[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rows) return json({ error: "Missing rows array" }, 400);
  if (rows.length > 5000) return json({ error: "Too many rows (max 5000 per call)" }, 400);

  const num = (v: unknown): number | null =>
    v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

  const clean: Record<string, unknown>[] = [];
  for (const r of rows) {
    const kind = String(r.kind ?? "").toLowerCase();
    const externalId = String(r.external_campaign_id ?? "").trim();
    const channel = String(r.channel ?? "").trim();
    // Skip rows we could never key or join on.
    if ((kind !== "drv" && kind !== "pax") || !externalId || !channel) continue;

    clean.push({
      kind,
      country_code: String(r.country_code ?? "").trim().toUpperCase(),
      external_campaign_id: externalId,
      step_id: String(r.step_id ?? "").trim(),
      template_id: String(r.template_id ?? "").trim(),
      channel,
      comm_platform: String(r.comm_platform ?? "").trim().toUpperCase(),
      activity_name: r.activity_name ?? null,
      creator: r.creator ?? null,
      start_date: r.start_date || null,
      start_week: num(r.start_week),
      cohort_size: num(r.cohort_size),
      request_uv: num(r.request_uv),
      send_uv: num(r.send_uv),
      deliver_uv: num(r.deliver_uv),
      arrive_uv: num(r.arrive_uv),
      show_uv: num(r.show_uv),
      click_uv: num(r.click_uv),
      open_rate: num(r.open_rate),
      ctr: num(r.ctr),
      ctor: num(r.ctor),
      synced_at: new Date().toISOString(),
    });
  }

  if (clean.length === 0) return json({ success: true, upserted: 0, skipped: rows.length });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Re-running the sync updates existing rows instead of duplicating them.
  const { error } = await admin
    .from("campaign_metrics")
    .upsert(clean, {
      onConflict:
        "kind,country_code,external_campaign_id,step_id,template_id,channel,start_date",
    });

  if (error) return json({ error: error.message }, 500);

  return json({ success: true, upserted: clean.length, skipped: rows.length - clean.length });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
