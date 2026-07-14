-- ============================================================
-- Migration 00031: Plan ID on approval + audience counts
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- 1. `plan_id`: free-text approval code the admin types when manually
--    approving a campaign that includes push channels. Stored on the
--    campaign row of either schema.
-- 2. `get_campaign_audience_counts_{drv,pax}()`: total distinct audience
--    ids per campaign, so the admin table can show the impacted cohort
--    size without downloading the raw campaign_audience rows.
-- ============================================================

-- 1. plan_id column --------------------------------------------------------
ALTER TABLE drv.campaigns ADD COLUMN IF NOT EXISTS plan_id text;
ALTER TABLE pax.campaigns ADD COLUMN IF NOT EXISTS plan_id text;

-- 2. Audience count RPCs ---------------------------------------------------
DROP FUNCTION IF EXISTS public.get_campaign_audience_counts_drv();
CREATE OR REPLACE FUNCTION public.get_campaign_audience_counts_drv()
RETURNS TABLE (campaign_id uuid, audience_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, drv
AS $$
  SELECT ca.campaign_id, COUNT(DISTINCT ca.drv_id)::bigint
  FROM drv.campaign_audience ca
  GROUP BY ca.campaign_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_campaign_audience_counts_drv() TO authenticated;

DROP FUNCTION IF EXISTS public.get_campaign_audience_counts_pax();
CREATE OR REPLACE FUNCTION public.get_campaign_audience_counts_pax()
RETURNS TABLE (campaign_id uuid, audience_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pax
AS $$
  SELECT ca.campaign_id, COUNT(DISTINCT ca.pax_id)::bigint
  FROM pax.campaign_audience ca
  GROUP BY ca.campaign_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_campaign_audience_counts_pax() TO authenticated;

-- 3. approve_campaign with optional Plan ID --------------------------------
-- The extra parameter has a DEFAULT so existing 1-arg callers keep working.
DROP FUNCTION IF EXISTS public.approve_campaign(uuid);
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
  IF NOT public.has_role(auth.uid(), 'admin') THEN
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

DROP FUNCTION IF EXISTS public.approve_campaign_pax(uuid);
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
  IF NOT public.has_role(auth.uid(), 'admin') THEN
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
