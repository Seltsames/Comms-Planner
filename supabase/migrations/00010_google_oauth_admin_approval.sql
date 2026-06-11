-- ============================================================
-- Migration 00010: Google OAuth + Admin Approval
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================

-- 1. Add is_enabled and admin-approval tracking columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_email text,
  ADD COLUMN IF NOT EXISTS enabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS enabled_by uuid REFERENCES auth.users(id);

-- 2. Update handle_new_user trigger to capture Google email + set is_enabled = false
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name, google_email, is_enabled)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.email,
    false
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 3. Index for fast lookup of enabled users
CREATE INDEX IF NOT EXISTS idx_profiles_is_enabled ON public.profiles(is_enabled);

-- 4. Admin policy: admins can update any profile (to enable/disable)
CREATE POLICY "Admins enable/disable users" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'))
  WITH CHECK (public.has_role((select auth.uid()), 'admin'));

-- 5. Helper: get current user's enabled status (for guards)
CREATE OR REPLACE FUNCTION public.current_user_is_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_enabled FROM public.profiles WHERE user_id = (select auth.uid())),
    false
  )
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_is_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_enabled() TO authenticated;

-- 6. Admin audit log
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES auth.users(id) NOT NULL,
  target_user_id UUID REFERENCES auth.users(id) NOT NULL,
  action TEXT NOT NULL,
  details jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_admin ON public.admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON public.admin_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.admin_audit_log(created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read audit log" ON public.admin_audit_log
  FOR SELECT TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'));

CREATE POLICY "Admins insert audit log" ON public.admin_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role((select auth.uid()), 'admin'));
