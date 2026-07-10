// Hand-maintained Database typings for Supabase.
//
// Mirrors the live schema in this project:
//   - public: profiles, user_roles, admin_audit_log, app_role enum,
//     helper functions (has_role, current_user_is_enabled,
//     custom_access_token_hook, handle_new_user trigger, etc.)
//   - drv:    driver campaigns + audience + schedules (the legacy data)
//   - pax:    passenger campaigns + audience + schedules (parallel mirror)
//
// RPCs are kept in the public schema for backwards compatibility and
// appear in two flavors: `save_campaign_v2` / `save_campaign_pax`, etc.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type CampaignStatus = "pending" | "approved" | "rejected" | "draft" | "cancelled";

interface CampaignColumns {
  id: string;
  name: string;
  team: string;
  sub_team: string | null;
  types: string[];
  action_keys: string[];
  country: string;
  city_codes: string[];
  csv_file_name: string | null;
  start_date: string;
  end_date: string;
  creator_id: string;
  status: CampaignStatus | string;
  approved_by: string | null;
  approved_at: string | null;
  plan_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

interface AudienceColumnsDrv {
  id: string;
  campaign_id: string;
  drv_id: string;
  city_code: string | null;
  created_at: string;
}

interface AudienceColumnsPax {
  id: string;
  campaign_id: string;
  pax_id: string;
  city_code: string | null;
  created_at: string;
}

interface ScheduleColumns {
  id: string;
  campaign_id: string;
  action_key: string;
  schedule_date: string;
  time_slot: string;
  image_url: string | null;
  created_at: string;
}

type Row<T> = { Row: T; Insert: Partial<T> & { id?: string }; Update: Partial<T> };
type Enum<T extends string> = T;

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.5" };

  public: {
    Tables: {
      admin_audit_log: Row<{
        id: string;
        admin_id: string;
        target_user_id: string;
        action: string;
        details: Json | null;
        created_at: string;
      }>;
      profiles: Row<{
        id: string;
        user_id: string;
        email: string;
        full_name: string | null;
        google_email: string | null;
        is_enabled: boolean;
        enabled_at: string | null;
        enabled_by: string | null;
        platform_access: string[];
        created_at: string;
        updated_at: string;
      }>;
      user_roles: Row<{
        id: string;
        user_id: string;
        role: Enum<"admin" | "normal">;
      }>;
    };
    Views: { [_ in never]: never };
    Functions: {
      check_auth_hook_setup: {
        Args: Record<string, never>;
        Returns: Array<{ check_name: string; status: string; detail: string }>;
      };
      check_cohort_conflicts: {
        Args: { p_drv_ids: string[]; p_country: string; p_start_date: string; p_end_date: string };
        Returns: Array<{
          campaign_id: string;
          campaign_name: string;
          schedule_date: string;
          time_slot: string;
          action_key: string;
          conflicting_drv_count: number;
        }>;
      };
      check_cohort_conflicts_pax: {
        Args: { p_pax_ids: string[]; p_country: string; p_start_date: string; p_end_date: string };
        Returns: Array<{
          campaign_id: string;
          campaign_name: string;
          schedule_date: string;
          time_slot: string;
          action_key: string;
          conflicting_pax_count: number;
        }>;
      };
      current_user_is_enabled: { Args: Record<string, never>; Returns: boolean };
      custom_access_token_hook: { Args: { event: Json }; Returns: Json };
      get_slot_availability: {
        Args: { p_country: string; p_city_codes: string[]; p_start_date: string; p_end_date: string; p_action_keys: string[] };
        Returns: Array<{
          action_key: string;
          conflict_count: number;
          is_available: boolean;
          schedule_date: string;
          severity: string;
          time_slot: string;
          total_campaigns: number;
        }>;
      };
      get_slot_availability_v2: {
        Args: { p_country: string; p_city_codes: string[]; p_start_date: string; p_end_date: string; p_action_keys: string[]; p_drv_ids: string[] };
        Returns: Array<{
          action_key: string;
          schedule_date: string;
          time_slot: string;
          severity: string;
          day_locked: boolean | null;
          day_lock_reason: string | null;
          conflicting_drivers: number | null;
          total_schedules: number | null;
        }>;
      };
      get_slot_availability_v2_pax: {
        Args: { p_country: string; p_city_codes: string[]; p_start_date: string; p_end_date: string; p_action_keys: string[]; p_pax_ids: string[] };
        Returns: Array<{
          action_key: string;
          schedule_date: string;
          time_slot: string;
          severity: string;
          day_locked: boolean | null;
          day_lock_reason: string | null;
          conflicting_drivers: number | null;
          total_schedules: number | null;
        }>;
      };
      has_role: { Args: { _role: "admin" | "normal"; _user_id: string }; Returns: boolean };
      cancel_campaign: { Args: { p_campaign_id: string }; Returns: boolean };
      cancel_campaign_pax: { Args: { p_campaign_id: string }; Returns: boolean };
      approve_campaign: { Args: { p_campaign_id: string }; Returns: boolean };
      approve_campaign_pax: { Args: { p_campaign_id: string }; Returns: boolean };
      reject_campaign: { Args: { p_campaign_id: string }; Returns: boolean };
      reject_campaign_pax: { Args: { p_campaign_id: string }; Returns: boolean };
      delete_campaign_hard: { Args: { p_campaign_id: string }; Returns: boolean };
      delete_campaign_hard_pax: { Args: { p_campaign_id: string }; Returns: boolean };

      // Read RPCs introduced in migration 00029 — keep the client off the
      // /rest/v1/<schema>/<table> path that Supabase Cloud does not always
      // expose.
      list_user_campaigns_drv: { Args: Record<string, never>; Returns: Json };
      list_all_campaigns_drv:  { Args: Record<string, never>; Returns: Json };
      get_campaign_drv:         { Args: { p_id: string };         Returns: Json };
      list_campaign_schedules_drv: { Args: Record<string, never>; Returns: Json };
      list_user_campaigns_pax:  { Args: Record<string, never>; Returns: Json };
      list_all_campaigns_pax:   { Args: Record<string, never>; Returns: Json };
      get_campaign_pax:         { Args: { p_id: string };         Returns: Json };
      list_campaign_schedules_pax: { Args: Record<string, never>; Returns: Json };
      save_campaign_v2: {
        Args: {
          p_action_keys: string[];
          p_audience: Json;
          p_city_codes: string[];
          p_country: string;
          p_csv_file_name: string;
          p_end_date: string;
          p_name: string;
          p_schedules: Json;
          p_start_date: string;
          p_status: string;
          p_sub_team: string;
          p_team: string;
          p_types: string[];
        };
        Returns: string;
      };
      save_campaign_pax: {
        Args: {
          p_action_keys: string[];
          p_audience: Json;
          p_city_codes: string[];
          p_country: string;
          p_csv_file_name: string;
          p_end_date: string;
          p_name: string;
          p_schedules: Json;
          p_start_date: string;
          p_status: string;
          p_sub_team: string;
          p_team: string;
          p_types: string[];
        };
        Returns: string;
      };
      get_analytics_aggregates: {
        Args: { p_country?: string; p_channel?: string };
        Returns: Json;
      };
      get_analytics_aggregates_pax: {
        Args: { p_country?: string; p_channel?: string };
        Returns: Json;
      };
    };
    Enums: { app_role: "admin" | "normal" };
    CompositeTypes: { [_ in never]: never };
  };

  drv: {
    Tables: {
      campaigns: Row<CampaignColumns>;
      campaign_audience: Row<AudienceColumnsDrv>;
      campaign_schedules: Row<ScheduleColumns>;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };

  pax: {
    Tables: {
      campaigns: Row<CampaignColumns>;
      campaign_audience: Row<AudienceColumnsPax>;
      campaign_schedules: Row<ScheduleColumns>;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};