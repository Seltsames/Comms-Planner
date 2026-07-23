import { supabase } from "./supabase";
import type { Database } from "@/types/database";
import type { AudienceKind } from "./auth";

export type SlotAvailabilityV2 = {
  action_key: string;
  schedule_date: string;
  time_slot: string;
  severity: "green" | "yellow" | "red";
  day_locked: boolean | null;
  day_lock_reason: string | null;
  conflicting_drivers: number | null;
  total_schedules: number | null;
};

// Helper: pick the right RPC name for DRV vs PAX.
// Most PAX variants follow the {base}_pax pattern (cancel_campaign_pax,
// approve_campaign_pax, etc.). The save RPC is the exception: it is named
// save_campaign_pax in the database (not save_campaign_v2_pax).
function rpcName(base: string, kind: AudienceKind): string {
  if (kind === "pax" && base === "save_campaign_v2") return "save_campaign_pax";
  return kind === "pax" ? `${base}_pax` : base;
}

// ---------------------------------------------------------------------------
// Slot availability
// ---------------------------------------------------------------------------
export async function getSlotAvailabilityV2(
  country: string,
  cityCodes: string[],
  startDate: string,
  endDate: string,
  actionKeys: string[],
  // The cohort is referenced by the draft campaign that already holds it,
  // never re-sent. Passing the ids meant ~9 MB per call, once per channel and
  // on every date change: that is what saturated the instance before the save
  // even started (500/520 on this RPC in the logs).
  cohortId: string | null,
  kind: AudienceKind,
): Promise<SlotAvailabilityV2[]> {
  const { data, error } = await supabase.rpc(rpcName("get_slot_availability_by_cohort", kind), {
    p_country: country,
    p_city_codes: cityCodes,
    p_start_date: startDate,
    p_end_date: endDate,
    p_action_keys: actionKeys,
    p_cohort_id: cohortId,
  });
  if (error) throw error;
  return (data ?? []) as SlotAvailabilityV2[];
}

// ---------------------------------------------------------------------------
// Campaign row types
// ---------------------------------------------------------------------------
export type CampaignRow =
  | Database["drv"]["Tables"]["campaigns"]["Row"]
  | Database["pax"]["Tables"]["campaigns"]["Row"];
export type CampaignScheduleRow =
  | Database["drv"]["Tables"]["campaign_schedules"]["Row"]
  | Database["pax"]["Tables"]["campaign_schedules"]["Row"];

function readRpcFor(
  base: "list_user" | "list_all" | "get_one" | "list_schedules",
  kind: AudienceKind,
): string {
  // DRV keeps the original names; PAX is suffixed _pax.
  if (kind === "drv") {
    switch (base) {
      case "list_user":      return "list_user_campaigns_drv";
      case "list_all":       return "list_all_campaigns_drv";
      case "get_one":        return "get_campaign_drv";
      case "list_schedules": return "list_campaign_schedules_drv";
    }
  }
  switch (base) {
    case "list_user":      return "list_user_campaigns_pax";
    case "list_all":       return "list_all_campaigns_pax";
    case "get_one":        return "get_campaign_pax";
    case "list_schedules": return "list_campaign_schedules_pax";
  }
  throw new Error("unreachable");
}

// ---------------------------------------------------------------------------
// Campaign list / lookup (all routed through RPCs to avoid relying on
// PostgREST exposing the drv/pax schemas, which Supabase Cloud does not
// honour via ALTER ROLE alone — see migration 00029.)
// ---------------------------------------------------------------------------
export async function fetchUserCampaigns(
  _userId: string,
  kind: AudienceKind,
): Promise<CampaignRow[] | null> {
  // The RPC filters by auth.uid() itself, so _userId is intentionally
  // unused but kept in the signature for API stability.
  void _userId;
  const { data, error } = await supabase.rpc(readRpcFor("list_user", kind));
  if (error) throw error;
  return (data ?? []) as CampaignRow[];
}

export async function fetchAllCampaigns(kind: AudienceKind): Promise<CampaignRow[] | null> {
  const { data, error } = await supabase.rpc(readRpcFor("list_all", kind));
  if (error) throw error;
  return (data ?? []) as CampaignRow[];
}

/**
 * Unified admin view: returns campaigns from BOTH drv and pax, with
 * a `kind` tag on every row so the UI can label and dispatch actions
 * (approve / reject / delete) to the right schema.
 */
export type AdminCampaignRow = CampaignRow & { kind: AudienceKind };

export async function fetchAllCampaignsBoth(): Promise<AdminCampaignRow[]> {
  const [drv, pax] = await Promise.all([
    fetchAllCampaigns("drv").catch(() => []),
    fetchAllCampaigns("pax").catch(() => []),
  ]);
  return [
    ...(drv ?? []).map((c) => ({ ...c, kind: "drv" as const })),
    ...(pax ?? []).map((c) => ({ ...c, kind: "pax" as const })),
  ];
}

/**
 * Distinct audience ids per campaign of one side (server-side aggregate —
 * the client never downloads the raw campaign_audience rows). Returns a
 * map keyed by campaign_id.
 */
export async function fetchAudienceCounts(kind: AudienceKind): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc(`get_campaign_audience_counts_${kind}`);
  if (error) throw error;
  const map: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ campaign_id: string; audience_count: number }>) {
    map[row.campaign_id] = Number(row.audience_count);
  }
  return map;
}

/**
 * Audience counts for BOTH sides, keyed by `${kind}-${campaign_id}` so
 * DRV and PAX rows never collide (admin campaigns table).
 */
export async function fetchAudienceCountsBoth(): Promise<Record<string, number>> {
  const [drv, pax] = await Promise.all([
    fetchAudienceCounts("drv").catch(() => ({}) as Record<string, number>),
    fetchAudienceCounts("pax").catch(() => ({}) as Record<string, number>),
  ]);
  const map: Record<string, number> = {};
  for (const [id, n] of Object.entries(drv)) map[`drv-${id}`] = n;
  for (const [id, n] of Object.entries(pax)) map[`pax-${id}`] = n;
  return map;
}

export interface CampaignMetricRow {
  external_campaign_id: string;
  activity_name: string | null;
  channel: string;
  comm_platform: string;
  country_code: string;
  /** Range covered by the aggregated report rows. */
  first_date: string | null;
  last_date: string | null;
  /** How many raw report rows were rolled up into this one. */
  report_rows: number;
  request_uv: number | null;
  send_uv: number | null;
  deliver_uv: number | null;
  arrive_uv: number | null;
  show_uv: number | null;
  click_uv: number | null;
  open_rate: number | null;
  ctr: number | null;
  ctor: number | null;
  campaign_id: string | null;
  campaign_name: string | null;
  synced_at: string;
}

/**
 * Performance metrics aggregated per campaign + channel (the report
 * splits a campaign across many step/template/date rows), with the
 * CommsPlanner campaign resolved via its Event IDs. Rates come from the
 * summed counters using each channel's own formula. Admin-only per
 * platform (enforced by the RPC).
 */
export async function fetchCampaignMetrics(kind: AudienceKind): Promise<CampaignMetricRow[]> {
  const { data, error } = await supabase.rpc("get_campaign_metrics", { p_kind: kind });
  if (error) throw error;
  return (data ?? []) as CampaignMetricRow[];
}

export interface MyCampaignMetric {
  campaign_id: string;
  channel: string;
  request_uv: number | null;
  arrive_uv: number | null;
  show_uv: number | null;
  click_uv: number | null;
  ctr: number | null;
  ctor: number | null;
  report_rows: number;
}

/**
 * Metrics for the caller's own campaigns, aggregated per campaign +
 * channel. Available to any signed-in user (the admin-wide view lives in
 * fetchCampaignMetrics).
 */
export async function fetchMyCampaignMetrics(kind: AudienceKind): Promise<MyCampaignMetric[]> {
  const { data, error } = await supabase.rpc("get_my_campaign_metrics", { p_kind: kind });
  if (error) throw error;
  return (data ?? []) as MyCampaignMetric[];
}

export async function fetchCampaignById(
  id: string,
  kind: AudienceKind,
): Promise<CampaignRow | null> {
  const { data, error } = await supabase.rpc(readRpcFor("get_one", kind), { p_id: id });
  if (error) throw error;
  return (data as CampaignRow | null) ?? null;
}

export async function fetchCampaignSchedules(
  kind: AudienceKind,
): Promise<CampaignScheduleRow[] | null> {
  const { data, error } = await supabase.rpc(readRpcFor("list_schedules", kind));
  if (error) throw error;
  return (data ?? []) as CampaignScheduleRow[];
}

// ---------------------------------------------------------------------------
// Campaign lifecycle RPCs
// ---------------------------------------------------------------------------
export async function cancelCampaignRpc(campaignId: string, kind: AudienceKind): Promise<void> {
  const { error } = await supabase.rpc(rpcName("cancel_campaign", kind), {
    p_campaign_id: campaignId,
  });
  if (error) throw error;
}

export async function approveCampaignRpc(
  campaignId: string,
  kind: AudienceKind,
  planId?: string,
): Promise<void> {
  const { error } = await supabase.rpc(rpcName("approve_campaign", kind), {
    p_campaign_id: campaignId,
    p_plan_id: planId?.trim() || null,
  });
  if (error) throw error;
}

export async function setCampaignEventIdsRpc(
  campaignId: string,
  kind: AudienceKind,
  entries: Array<{ label: string; value: string }>,
): Promise<void> {
  const { error } = await supabase.rpc(rpcName("set_campaign_event_ids", kind), {
    p_campaign_id: campaignId,
    p_event_ids: entries,
  });
  if (error) throw error;
}

export async function rejectCampaignRpc(campaignId: string, kind: AudienceKind): Promise<void> {
  const { error } = await supabase.rpc(rpcName("reject_campaign", kind), {
    p_campaign_id: campaignId,
  });
  if (error) throw error;
}

export async function deleteCampaignHardRpc(
  campaignId: string,
  kind: AudienceKind,
): Promise<void> {
  const { error } = await supabase.rpc(rpcName("delete_campaign_hard", kind), {
    p_campaign_id: campaignId,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Analytics aggregates
// ---------------------------------------------------------------------------
export type AnalyticsAggregates = {
  kpis: {
    total_comms: number;
    total_drivers: number;
    total_campaigns: number;
    total_countries: number;
    total_cities: number;
    total_days: number;
  };
  top_drivers: Array<{
    drv_id: string;
    count: number;
    channels: string[];
    campaigns: string[];
  }>;
  drivers_by_country: Array<{ country: string; count: number }>;
  drivers_by_city: Array<{ city: string; country: string; count: number }>;
  campaigns_by_country: Array<{
    country: string;
    campaigns: number;
    comms: number;
    drivers: number;
  }>;
  campaigns_by_city: Array<{
    city: string;
    country: string;
    campaigns: number;
    drivers: number;
  }>;
  per_campaign_drivers: Array<{ campaign_id: string; drivers: number }>;
};

// ---------------------------------------------------------------------------
// Cohort conflict check
// ---------------------------------------------------------------------------
export async function checkCohortConflictsRpc(
  // Same reasoning as getSlotAvailabilityV2: reference the cohort, never resend it.
  cohortId: string,
  country: string,
  startDate: string,
  endDate: string,
  kind: AudienceKind,
) {
  const args: Record<string, unknown> = {
    p_cohort_id: cohortId,
    p_country: country,
    p_start_date: startDate,
    p_end_date: endDate,
  };
  const { data, error } = await supabase.rpc(
    rpcName("check_cohort_conflicts_by_cohort", kind),
    args,
  );
  if (error) throw error;
  return data as Array<{
    campaign_id: string;
    campaign_name: string;
    schedule_date: string;
    time_slot: string;
    action_key: string;
    conflicting_drv_count?: number;
    conflicting_pax_count?: number;
  }>;
}

// ---------------------------------------------------------------------------
// Save campaign
// ---------------------------------------------------------------------------
export async function saveCampaignRpc(
  params: {
    name: string;
    team: string;
    subTeam: string;
    types: string[];
    actionKeys: string[];
    country: string;
    cityCodes: string[];
    csvFileName: string;
    startDate: string;
    endDate: string;
    status?: string;
    schedules: Array<{
      action_key: string;
      schedule_date: string;
      time_slot: string;
      image_url?: string;
    }>;
    /** Draft that already holds the uploaded audience (see uploadCohortDraft). */
    cohortId: string;
  },
  kind: AudienceKind,
) {
  const { error: updErr } = await supabase.rpc(rpcName("update_campaign_draft", kind), {
    p_campaign_id: params.cohortId,
    p_name: params.name,
    p_team: params.team,
    p_sub_team: params.subTeam,
    p_types: params.types,
    p_action_keys: params.actionKeys,
    p_country: params.country,
    p_city_codes: params.cityCodes,
    p_csv_file_name: params.csvFileName,
    p_start_date: params.startDate,
    p_end_date: params.endDate,
    p_schedules: params.schedules,
  });
  if (updErr) throw updErr;

  const { data, error } = await supabase.rpc(rpcName("finalize_campaign_upload", kind), {
    p_campaign_id: params.cohortId,
    p_status: params.status ?? null,
  });
  if (error) throw error;
  void data;
  return params.cohortId;
}

/**
 * Uploads a cohort once, in batches, into a hidden draft campaign and returns
 * its id. Everything afterwards (slot availability, conflict preview, saving)
 * references that id instead of resending the ids.
 */
export async function uploadCohortDraft(
  params: {
    audience: Array<{ id: string; city_code: string | null }>;
    country: string;
    cityCodes: string[];
    startDate: string;
    endDate: string;
  },
  kind: AudienceKind,
  onProgress?: (uploaded: number, total: number) => void,
): Promise<string> {
  const idKey = kind === "pax" ? "pax_id" : "drv_id";
  const audience = params.audience.map((a) => ({ [idKey]: a.id, city_code: a.city_code }));

  // The audience travels in batches instead of one request. A real cohort of
  // 469k rows is a 25 MB body that Postgres expands into the parsed JSON plus
  // a 469k-element array plus the insert, all in memory at once: ~17 s against
  // an 8 s statement_timeout, and enough memory pressure to take the instance
  // down (it did, twice, on 2026-07-23). At 25k rows a batch is ~1.4 MB and
  // ~0.7 s, so every request stays far inside both limits.
  const CHUNK = 25_000;

  const { data: campaignId, error: beginErr } = await supabase.rpc(
    rpcName("begin_campaign_upload", kind),
    {
      // Placeholders: the draft is created as soon as the CSV is validated,
      // before the campaign has a name or channels. update_campaign_draft
      // fills in the real values at save time.
      p_name: "(borrador)",
      p_team: "",
      p_sub_team: null,
      p_types: [],
      p_action_keys: [],
      p_country: params.country,
      p_city_codes: params.cityCodes,
      p_csv_file_name: "",
      p_start_date: params.startDate,
      p_end_date: params.endDate,
      p_schedules: [],
    },
  );
  if (beginErr) throw beginErr;
  const id = campaignId as string;

  try {
    onProgress?.(0, audience.length);
    for (let i = 0; i < audience.length; i += CHUNK) {
      const { error } = await supabase.rpc(rpcName("append_campaign_audience", kind), {
        p_campaign_id: id,
        p_audience: audience.slice(i, i + CHUNK),
      });
      if (error) throw error;
      onProgress?.(Math.min(i + CHUNK, audience.length), audience.length);
    }
  } catch (e) {
    // Leave no half-uploaded draft behind. It is already invisible (it carries
    // deleted_at), and the server purges stale ones after 2 h, but dropping it
    // now keeps the table clean. A failure here must not mask the real error.
    try {
      await supabase.rpc(rpcName("abort_campaign_upload", kind), { p_campaign_id: id });
    } catch {
      /* ignore */
    }
    throw e;
  }

  return id;
}

export { };