-- ============================================================
-- Migration 00030: Per-user platform access (DRV / PAX)
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- Admins assign which platform(s) each user can work on from the
-- "Gestión de usuarios" screen. The client reads
-- profiles.platform_access to decide which side(s) to show after
-- login; the BEFORE INSERT triggers below are the server-side
-- guarantee that a user can only *create* campaigns on a platform
-- they were granted (the save RPCs are SECURITY DEFINER, so table
-- RLS does not apply inside them — triggers still fire).
--
-- Existing users default to both platforms so nobody is locked out
-- by this migration; admins can restrict from the UI afterwards.
-- ============================================================

-- 1. Column ------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS platform_access text[] NOT NULL DEFAULT ARRAY['drv', 'pax'];

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_platform_access_valid;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_platform_access_valid
  CHECK (platform_access <@ ARRAY['drv', 'pax']);

-- 2. Helper ------------------------------------------------------------
-- Admins implicitly have access to both platforms (they manage both
-- sides from /admin/campaigns regardless of their own grants).
CREATE OR REPLACE FUNCTION public.has_platform_access(_user_id uuid, _platform text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin')
      OR EXISTS (
           SELECT 1
           FROM public.profiles
           WHERE user_id = _user_id
             AND _platform = ANY (platform_access)
         );
$$;

GRANT EXECUTE ON FUNCTION public.has_platform_access(uuid, text) TO authenticated;

-- 3. Enforcement triggers ----------------------------------------------
-- TG_ARGV[0] carries the platform name ('drv' | 'pax').
CREATE OR REPLACE FUNCTION public.enforce_platform_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_platform_access(NEW.creator_id, TG_ARGV[0]) THEN
    RAISE EXCEPTION 'El usuario no tiene acceso a la plataforma %', TG_ARGV[0]
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_platform_access_drv ON drv.campaigns;
CREATE TRIGGER enforce_platform_access_drv
  BEFORE INSERT ON drv.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.enforce_platform_access('drv');

DROP TRIGGER IF EXISTS enforce_platform_access_pax ON pax.campaigns;
CREATE TRIGGER enforce_platform_access_pax
  BEFORE INSERT ON pax.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.enforce_platform_access('pax');
