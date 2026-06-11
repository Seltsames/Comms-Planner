-- ============================================================
-- Migration 00006: RLS Performance & Security Fixes
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================

-- --- Fix 1: Add missing FK index ---
CREATE INDEX IF NOT EXISTS idx_campaigns_approved_by ON public.campaigns(approved_by);

-- --- Fix 2: Revoke EXECUTE on RPCs from PUBLIC/anon, grant to authenticated only ---

-- has_role: not callable from the API (only used in RLS), but revoke anyway for safety
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- save_campaign_v2: only authenticated users
REVOKE EXECUTE ON FUNCTION public.save_campaign_v2(text, text, text, text[], text[], text, text[], text, date, date, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_campaign_v2(text, text, text, text[], text[], text, text[], text, date, date, text, jsonb, jsonb) TO authenticated;

-- check_cohort_conflicts: only authenticated users
REVOKE EXECUTE ON FUNCTION public.check_cohort_conflicts(text[], text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_cohort_conflicts(text[], text, date, date) TO authenticated;

-- get_slot_availability: only authenticated users
REVOKE EXECUTE ON FUNCTION public.get_slot_availability(text, text[], date, date, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_slot_availability(text, text[], date, date, text[]) TO authenticated;

-- handle_new_user: not callable from API (trigger function), revoke for safety
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated;

-- --- Fix 3: Drop and re-create RLS policies with (select auth.<func>()) pattern + consolidate ---

-- Drop all existing policies
DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users read own role" ON public.user_roles;
DROP POLICY IF EXISTS "Admins manage all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Authenticated read campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Users create campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Creators update own pending campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Admins update any campaign" ON public.campaigns;
DROP POLICY IF EXISTS "Admins delete campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Authenticated read schedules" ON public.campaign_schedules;
DROP POLICY IF EXISTS "Manage schedules via campaign" ON public.campaign_schedules;
DROP POLICY IF EXISTS "Authenticated read audience" ON public.campaign_audience;
DROP POLICY IF EXISTS "Manage audience via campaign" ON public.campaign_audience;

-- --- Re-create consolidated policies with (select auth.<func>()) ---

-- profiles: combine into single policies
CREATE POLICY "Profiles read" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    (select auth.uid()) = user_id
    OR public.has_role((select auth.uid()), 'admin')
  );

CREATE POLICY "Profiles update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    (select auth.uid()) = user_id
    OR public.has_role((select auth.uid()), 'admin')
  )
  WITH CHECK (
    (select auth.uid()) = user_id
    OR public.has_role((select auth.uid()), 'admin')
  );

-- user_roles: combine
CREATE POLICY "User roles read" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    (select auth.uid()) = user_id
    OR public.has_role((select auth.uid()), 'admin')
  );

CREATE POLICY "Admins manage user roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'))
  WITH CHECK (public.has_role((select auth.uid()), 'admin'));

-- campaigns: consolidate UPDATE into a single policy
CREATE POLICY "Authenticated read campaigns" ON public.campaigns
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users create own campaigns" ON public.campaigns
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = creator_id);

CREATE POLICY "Update campaigns" ON public.campaigns
  FOR UPDATE TO authenticated
  USING (
    (((select auth.uid()) = creator_id) AND status = 'pending')
    OR public.has_role((select auth.uid()), 'admin')
  )
  WITH CHECK (
    (((select auth.uid()) = creator_id) AND status = 'pending')
    OR public.has_role((select auth.uid()), 'admin')
  );

CREATE POLICY "Admins delete campaigns" ON public.campaigns
  FOR DELETE TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'));

-- campaign_schedules: combine into one policy per action
CREATE POLICY "Read schedules" ON public.campaign_schedules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Manage schedules" ON public.campaign_schedules
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.campaigns
      WHERE id = campaign_id
        AND (
          creator_id = (select auth.uid())
          OR public.has_role((select auth.uid()), 'admin')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.campaigns
      WHERE id = campaign_id
        AND (
          creator_id = (select auth.uid())
          OR public.has_role((select auth.uid()), 'admin')
        )
    )
  );

-- campaign_audience: combine into one policy per action
CREATE POLICY "Read audience" ON public.campaign_audience
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Manage audience" ON public.campaign_audience
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.campaigns
      WHERE id = campaign_id
        AND (
          creator_id = (select auth.uid())
          OR public.has_role((select auth.uid()), 'admin')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.campaigns
      WHERE id = campaign_id
        AND (
          creator_id = (select auth.uid())
          OR public.has_role((select auth.uid()), 'admin')
        )
    )
  );
