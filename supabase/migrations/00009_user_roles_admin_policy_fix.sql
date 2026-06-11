-- ============================================================
-- Migration 00009: User roles admin policy without SELECT
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================

DROP POLICY IF EXISTS "Admins modify user roles" ON public.user_roles;
DROP POLICY IF EXISTS "User roles select" ON public.user_roles;

-- Single SELECT policy: admin OR self
CREATE POLICY "User roles select" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    (select auth.uid()) = user_id
    OR public.has_role((select auth.uid()), 'admin')
  );

-- Admin-only modifications (no SELECT overlap)
CREATE POLICY "Admins insert user roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role((select auth.uid()), 'admin'));

CREATE POLICY "Admins update user roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'))
  WITH CHECK (public.has_role((select auth.uid()), 'admin'));

CREATE POLICY "Admins delete user roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'));
