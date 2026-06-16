import { supabase } from "./supabase";
import type { Database } from "@/types/database";

export type SlotAvailability = Database["public"]["Functions"]["get_slot_availability"]["Returns"][number];

export async function getSlotAvailability(
  country: string,
  cityCodes: string[],
  startDate: string,
  endDate: string,
  actionKeys: string[],
): Promise<SlotAvailability[]> {
  const { data, error } = await supabase.rpc("get_slot_availability", {
    p_country: country,
    p_city_codes: cityCodes,
    p_start_date: startDate,
    p_end_date: endDate,
    p_action_keys: actionKeys,
  });
  if (error) throw error;
  return data as SlotAvailability[];
}

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

export async function getSlotAvailabilityV2(
  country: string,
  cityCodes: string[],
  startDate: string,
  endDate: string,
  actionKeys: string[],
  drvIds: string[],
): Promise<SlotAvailabilityV2[]> {
  const { data, error } = await supabase.rpc("get_slot_availability_v2", {
    p_country: country,
    p_city_codes: cityCodes,
    p_start_date: startDate,
    p_end_date: endDate,
    p_action_keys: actionKeys,
    p_drv_ids: drvIds,
  });
  if (error) throw error;
  return (data ?? []) as SlotAvailabilityV2[];
}

export type CampaignRow = Database["public"]["Tables"]["campaigns"]["Row"];
export type CampaignScheduleRow =
  Database["public"]["Tables"]["campaign_schedules"]["Row"];

export async function fetchUserCampaigns(
  userId: string,
): Promise<CampaignRow[] | null> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("creator_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as CampaignRow[];
}

export async function fetchAllCampaigns(): Promise<CampaignRow[] | null> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as CampaignRow[];
}

export async function cancelCampaignRpc(campaignId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_campaign", { p_campaign_id: campaignId });
  if (error) throw error;
}

export async function approveCampaignRpc(campaignId: string): Promise<void> {
  const { error } = await supabase.rpc("approve_campaign", { p_campaign_id: campaignId });
  if (error) throw error;
}

export async function rejectCampaignRpc(campaignId: string): Promise<void> {
  const { error } = await supabase.rpc("reject_campaign", { p_campaign_id: campaignId });
  if (error) throw error;
}

export async function deleteCampaignHardRpc(campaignId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_campaign_hard", { p_campaign_id: campaignId });
  if (error) throw error;
}

export async function fetchDashboardStats() {
  const { data, error } = await supabase.rpc("get_dashboard_stats");
  if (error && error.code !== "PGRST116") throw error;
  return data ?? null;
}

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

export async function fetchAnalyticsAggregates(
  country: string = "all",
  channel: string = "all",
): Promise<AnalyticsAggregates | null> {
  const { data, error } = await supabase.rpc("get_analytics_aggregates", {
    p_country: country,
    p_channel: channel,
  });
  if (error) throw error;
  return (data as AnalyticsAggregates) ?? null;
}

export async function checkCohortConflictsRpc(
  drvIds: string[],
  country: string,
  startDate: string,
  endDate: string,
) {
  const { data, error } = await supabase.rpc("check_cohort_conflicts", {
    p_drv_ids: drvIds,
    p_country: country,
    p_start_date: startDate,
    p_end_date: endDate,
  });
  if (error) throw error;
  return data as Array<{
    campaign_id: string;
    campaign_name: string;
    schedule_date: string;
    time_slot: string;
    action_key: string;
    conflicting_drv_count: number;
  }>;
}

export async function saveCampaignRpc(params: {
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
  audience: Array<{ drv_id: string; city_code: string | null }>;
}) {
  const { data, error } = await supabase.rpc("save_campaign_v2", {
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
    p_audience: params.audience,
  });
  if (error) throw error;
  return data as string;
}

export async function fetchCampaignById(id: string): Promise<CampaignRow | null> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error) throw error;
  return data as CampaignRow;
}