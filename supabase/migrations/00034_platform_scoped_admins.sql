-- ============================================================
-- Migration 00034: Platform-scoped admins (DRV / PAX / both)
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- An admin's scope is now: role 'admin' INTERSECTED with their
-- profiles.platform_access. An admin with platform_access={pax} can
-- approve/reject/delete campaigns and read analytics only on the PAX
-- side; {drv,pax} keeps full scope. The admin toggles in "Gestión de
-- usuarios" (DRV/PAX chips) therefore define each admin's scope.
--
--   1. has_platform_access() loses its former "admins always have
--      both" bypass — an admin's platforms are exactly their
--      platform_access.
--   2. New is_platform_admin(uid, platform) helper.
--   3. approve/reject/delete_campaign(+_pax) and
--      set_campaign_event_id(+_pax) enforce the platform-scoped admin.
--   4. get_analytics_aggregates(+_pax) surgically patched to require
--      platform access on top of the admin role.
--
-- User management (admin-users Edge Function) stays shared across all
-- admins; it additionally refuses changes to your own platform access.
-- ============================================================

-- 1. has_platform_access: exact platform_access, no admin bypass ---------
CREATE OR REPLACE FUNCTION public.has_platform_access(_user_id uuid, _platform text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE user_id = _user_id
      AND _platform = ANY (platform_access)
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_platform_access(uuid, text) TO authenticated;

-- 2. is_platform_admin ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid, _platform text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin')
     AND public.has_platform_access(_user_id, _platform);
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid, text) TO authenticated;

-- 3a. approve ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_campaign(p_campaign_id uuid, p_plan_id text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, drv
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_platform_admin(auth.uid(), 'drv') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  UPDATE drv.campaigns
  SET status = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      updated_at = now(),
      plan_id = COALESCE(NULLIF(trim(p_plan_id), ''), plan_id)
  WHERE id = p_campaign_id AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_campaign(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_campaign_pax(p_campaign_id uuid, p_plan_id text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pax
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_platform_admin(auth.uid(), 'pax') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  UPDATE pax.campaigns
  SET status = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      updated_at = now(),
      plan_id = COALESCE(NULLIF(trim(p_plan_id), ''), plan_id)
  WHERE id = p_campaign_id AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_campaign_pax(uuid, text) TO authenticated;

-- 3b. reject -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_campaign(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, drv
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_platform_admin(auth.uid(), 'drv') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  UPDATE drv.campaigns
  SET status = 'rejected', updated_at = now()
  WHERE id = p_campaign_id AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reject_campaign(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_campaign_pax(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pax
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_platform_admin(auth.uid(), 'pax') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  UPDATE pax.campaigns
  SET status = 'rejected', updated_at = now()
  WHERE id = p_campaign_id AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reject_campaign_pax(uuid) TO authenticated;

-- 3c. hard delete --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_campaign_hard(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, drv
AS $$
DECLARE
  v_deleted boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_platform_admin(auth.uid(), 'drv') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  DELETE FROM drv.campaign_audience WHERE campaign_id = p_campaign_id;
  DELETE FROM drv.campaign_schedules WHERE campaign_id = p_campaign_id;
  DELETE FROM drv.campaigns WHERE id = p_campaign_id RETURNING true INTO v_deleted;

  RETURN COALESCE(v_deleted, false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_campaign_hard(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_campaign_hard_pax(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pax
AS $$
DECLARE
  v_deleted boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_platform_admin(auth.uid(), 'pax') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  DELETE FROM pax.campaign_audience WHERE campaign_id = p_campaign_id;
  DELETE FROM pax.campaign_schedules WHERE campaign_id = p_campaign_id;
  DELETE FROM pax.campaigns WHERE id = p_campaign_id RETURNING true INTO v_deleted;

  RETURN COALESCE(v_deleted, false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_campaign_hard_pax(uuid) TO authenticated;

-- 3d. event id (creator, or platform-scoped admin) -----------------------
CREATE OR REPLACE FUNCTION public.set_campaign_event_id(p_campaign_id uuid, p_event_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, drv
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE drv.campaigns
  SET event_id = NULLIF(trim(p_event_id), ''), updated_at = now()
  WHERE id = p_campaign_id
    AND deleted_at IS NULL
    AND (creator_id = auth.uid() OR public.is_platform_admin(auth.uid(), 'drv'));

  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_campaign_event_id(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_campaign_event_id_pax(p_campaign_id uuid, p_event_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pax
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE pax.campaigns
  SET event_id = NULLIF(trim(p_event_id), ''), updated_at = now()
  WHERE id = p_campaign_id
    AND deleted_at IS NULL
    AND (creator_id = auth.uid() OR public.is_platform_admin(auth.uid(), 'pax'));

  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_campaign_event_id_pax(uuid, text) TO authenticated;

-- 4. Analytics: require platform access on top of the admin role ---------
DO $mig$
DECLARE
  fn    record;
  v_def text;
  v_new text;
  v_side text;
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_analytics_aggregates', 'get_analytics_aggregates_pax')
  LOOP
    v_def := pg_get_functiondef(fn.oid);
    IF position('has_platform_access' IN v_def) > 0 THEN
      CONTINUE; -- already patched
    END IF;
    v_side := CASE WHEN fn.proname LIKE '%_pax' THEN 'pax' ELSE 'drv' END;
    v_new := replace(
      v_def,
      'IF NOT v_is_admin THEN',
      format('IF NOT v_is_admin OR NOT public.has_platform_access(auth.uid(), %L) THEN', v_side)
    );
    IF v_new = v_def THEN
      RAISE EXCEPTION 'platform-scoped admin fix: pattern not found in %', fn.proname;
    END IF;
    EXECUTE v_new;
  END LOOP;
END;
$mig$;
