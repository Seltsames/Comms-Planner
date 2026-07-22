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

function audienceIdsParam(kind: AudienceKind) {
  return kind === "pax" ? "p_pax_ids" : "p_drv_ids";
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
  audienceIds: string[],
  kind: AudienceKind,
): Promise<SlotAvailabilityV2[]> {
  const { data, error } = await supabase.rpc(rpcName("get_slot_availability_v2", kind), {
    p_country: country,
    p_city_codes: cityCodes,
    p_start_date: startDate,
    p_end_date: endDate,
    p_action_keys: actionKeys,
    [audienceIdsParam(kind)]: audienceIds,
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
  start_date: string | null;
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
 * Performance metrics (CTR / CTOR) ingested from the governance Sheet,
 * with the CommsPlanner campaign resolved via its Event IDs. Admin-only
 * per platform (enforced by the RPC).
 */
export async function fetchCampaignMetrics(kind: AudienceKind): Promise<CampaignMetricRow[]> {
  const { data, error } = await supabase.rpc("get_campaign_metrics", { p_kind: kind });
  if (error) throw error;
  return (data ?? []) as CampaignMetricRow[];
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
  audienceIds: string[],
  country: string,
  startDate: string,
  endDate: string,
  kind: AudienceKind,
) {
  const baseName = "check_cohort_conflicts";
  const args: Record<string, unknown> = {
    p_country: country,
    p_start_date: startDate,
    p_end_date: endDate,
    [audienceIdsParam(kind)]: audienceIds,
  };
  const { data, error } = await supabase.rpc(rpcName(baseName, kind), args);
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
    audience: Array<{ id: string; city_code: string | null }>;
  },
  kind: AudienceKind,
) {
  const idKey = kind === "pax" ? "pax_id" : "drv_id";
  const audience = params.audience.map((a) => ({ [idKey]: a.id, city_code: a.city_code }));

  const { data, error } = await supabase.rpc(rpcName("save_campaign_v2", kind), {
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
    p_status: params.status ?? "pending",
    p_schedules: params.schedules,
    p_audience: audience,
  });
  if (error) throw error;
  return data as string;
}

export { };