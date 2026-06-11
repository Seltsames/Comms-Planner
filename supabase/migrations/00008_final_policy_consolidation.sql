-- ============================================================
-- Migration 00008: Final policy consolidation
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================

-- Consolidate user_roles: single SELECT policy that handles both admin and self-read
DROP POLICY IF EXISTS "Admins manage user roles" ON public.user_roles;
DROP POLICY IF EXISTS "User roles read" ON public.user_roles;

CREATE POLICY "User roles select" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    (select auth.uid()) = user_id
    OR public.has_role((select auth.uid()), 'admin')
  );

CREATE POLICY "Admins modify user roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'))
  WITH CHECK (public.has_role((select auth.uid()), 'admin'));
