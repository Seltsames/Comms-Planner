-- ============================================================
-- Migration 00007: Consolidate Multiple Permissive Policies
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================

-- Drop overlapping SELECT policies (FOR ALL with USING true already allows read)

DROP POLICY IF EXISTS "Read schedules" ON public.campaign_schedules;
DROP POLICY IF EXISTS "Read audience" ON public.campaign_audience;
DROP POLICY IF EXISTS "User roles read" ON public.user_roles;

-- The FOR ALL policies on Manage schedules/audience and "Admins manage user roles"
-- already allow SELECT via their USING clause (USING applies to all commands including SELECT).
-- The campaigns/profiles have separate read/write policies which is correct.

-- Re-add a single combined SELECT policy for user_roles so the "admin OR self" check is still fast
CREATE POLICY "User roles read" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    (select auth.uid()) = user_id
    OR public.has_role((select auth.uid()), 'admin')
  );
