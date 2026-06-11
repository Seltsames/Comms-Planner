export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.5" }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string; admin_id: string; created_at: string;
          details: Json | null; id: string; target_user_id: string;
        };
        Insert: {
          action: string; admin_id: string; created_at?: string;
          details?: Json | null; id?: string; target_user_id: string;
        };
        Update: {
          action?: string; admin_id?: string; created_at?: string;
          details?: Json | null; id?: string; target_user_id?: string;
        };
        Relationships: [];
      };
      campaign_audience: {
        Row: {
          campaign_id: string; city_code: string | null; created_at: string;
          drv_id: string; id: string;
        };
        Insert: {
          campaign_id: string; city_code?: string | null; created_at?: string;
          drv_id: string; id?: string;
        };
        Update: {
          campaign_id?: string; city_code?: string | null; created_at?: string;
          drv_id?: string; id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaign_audience_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          }
        ];
      };
      campaign_schedules: {
        Row: {
          action_key: string; campaign_id: string; created_at: string;
          id: string; image_url: string | null; schedule_date: string; time_slot: string;
        };
        Insert: {
          action_key: string; campaign_id: string; created_at?: string;
          id?: string; image_url?: string | null; schedule_date: string; time_slot: string;
        };
        Update: {
          action_key?: string; campaign_id?: string; created_at?: string;
          id?: string; image_url?: string | null; schedule_date?: string; time_slot?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaign_schedules_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          }
        ];
      };
      campaigns: {
        Row: {
          action_keys: string[]; approved_at: string | null; approved_by: string | null;
          city_codes: string[]; country: string; created_at: string; creator_id: string;
          csv_file_name: string | null; end_date: string; id: string; name: string;
          start_date: string; status: string; sub_team: string | null; team: string;
          types: string[]; updated_at: string;
        };
        Insert: {
          action_keys?: string[]; approved_at?: string | null; approved_by?: string | null;
          city_codes?: string[]; country?: string; created_at?: string; creator_id: string;
          csv_file_name?: string | null; end_date: string; id?: string; name: string;
          start_date: string; status?: string; sub_team?: string | null; team?: string;
          types?: string[]; updated_at?: string;
        };
        Update: {
          action_keys?: string[]; approved_at?: string | null; approved_by?: string | null;
          city_codes?: string[]; country?: string; created_at?: string; creator_id?: string;
          csv_file_name?: string | null; end_date?: string; id?: string; name?: string;
          start_date?: string; status?: string; sub_team?: string | null; team?: string;
          types?: string[]; updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string; email: string; enabled_at: string | null;
          enabled_by: string | null; full_name: string | null; google_email: string | null;
          id: string; is_enabled: boolean; updated_at: string; user_id: string;
        };
        Insert: {
          created_at?: string; email: string; enabled_at?: string | null;
          enabled_by?: string | null; full_name?: string | null; google_email?: string | null;
          id?: string; is_enabled?: boolean; updated_at?: string; user_id: string;
        };
        Update: {
          created_at?: string; email?: string; enabled_at?: string | null;
          enabled_by?: string | null; full_name?: string | null; google_email?: string | null;
          id?: string; is_enabled?: boolean; updated_at?: string; user_id?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: { id: string; role: Database["public"]["Enums"]["app_role"]; user_id: string };
        Insert: { id?: string; role: Database["public"]["Enums"]["app_role"]; user_id: string };
        Update: { id?: string; role?: Database["public"]["Enums"]["app_role"]; user_id?: string };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      check_cohort_conflicts: {
        Args: { p_country: string; p_drv_ids: string[]; p_end_date: string; p_start_date: string };
        Returns: {
          action_key: string; campaign_id: string; campaign_name: string;
          conflicting_drv_count: number; schedule_date: string; time_slot: string;
        }[];
      };
      current_user_is_enabled: { Args: never; Returns: boolean };
      custom_access_token_hook: { Args: { event: Json }; Returns: Json };
      get_slot_availability: {
        Args: {
          p_action_keys: string[]; p_city_codes: string[]; p_country: string;
          p_end_date: string; p_start_date: string;
        };
        Returns: {
          action_key: string; conflict_count: number; is_available: boolean;
          schedule_date: string; severity: string; time_slot: string; total_campaigns: number;
        }[];
      };
      has_role: { Args: { _role: Database["public"]["Enums"]["app_role"]; _user_id: string }; Returns: boolean };
      save_campaign_v2: {
        Args: {
          p_action_keys: string[]; p_audience: Json; p_city_codes: string[];
          p_country: string; p_csv_file_name: string; p_end_date: string;
          p_name: string; p_schedules: Json; p_start_date: string; p_status: string;
          p_sub_team: string; p_team: string; p_types: string[];
        };
        Returns: string;
      };
    };
    Enums: { app_role: "admin" | "normal" };
    CompositeTypes: { [_ in never]: never };
  };
};