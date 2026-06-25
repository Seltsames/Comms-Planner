-- ============================================================
-- Migration 00029: Read RPCs for DRV + PAX
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- Migration 00028 split the data into drv.* and pax.* schemas and added
-- the PostgREST setting `pgrst.db_schemas = 'public, drv, pax'`. On
-- Supabase Cloud that ALTER ROLE setting is not always honoured by the
-- gateway (the gateway reads its own config from the platform config),
-- so direct requests to `/rest/v1/drv/campaigns` return 404.
--
-- Workaround: stop hitting tables directly. Wrap every read in a
-- SECURITY DEFINER RPC that lives in the public schema, so the client
-- only ever calls /rest/v1/rpc/<fn_name> which is always available.
-- Each function takes `p_kind text` ('drv'|'pax') and dispatches to the
-- right schema internally.
-- ============================================================

-- ---------------------------------------------------------------------------
-- DRV side
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_user_campaigns_drv();
CREATE OR REPLACE FUNCTION public.list_user_campaigns_drv()
RETURNS SETOF drv.campaigns
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, drv
AS $$
  SELECT * FROM drv.campaigns
  WHERE creator_id = auth.uid() AND deleted_at IS NULL
  ORDER BY created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_user_campaigns_drv() TO authenticated;

DROP FUNCTION IF EXISTS public.list_all_campaigns_drv();
CREATE OR REPLACE FUNCTION public.list_all_campaigns_drv()
RETURNS SETOF drv.campaigns
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, drv
AS $$
  SELECT * FROM drv.campaigns
  WHERE deleted_at IS NULL
  ORDER BY created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_all_campaigns_drv() TO authenticated;

DROP FUNCTION IF EXISTS public.get_campaign_drv(uuid);
CREATE OR REPLACE FUNCTION public.get_campaign_drv(p_id uuid)
RETURNS drv.campaigns
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, drv
AS $$
  SELECT * FROM drv.campaigns
  WHERE id = p_id AND deleted_at IS NULL
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_campaign_drv(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.list_campaign_schedules_drv();
CREATE OR REPLACE FUNCTION public.list_campaign_schedules_drv()
RETURNS SETOF drv.campaign_schedules
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, drv
AS $$
  SELECT * FROM drv.campaign_schedules;
$$;
GRANT EXECUTE ON FUNCTION public.list_campaign_schedules_drv() TO authenticated;

-- ---------------------------------------------------------------------------
-- PAX side
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_user_campaigns_pax();
CREATE OR REPLACE FUNCTION public.list_user_campaigns_pax()
RETURNS SETOF pax.campaigns
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pax
AS $$
  SELECT * FROM pax.campaigns
  WHERE creator_id = auth.uid() AND deleted_at IS NULL
  ORDER BY created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_user_campaigns_pax() TO authenticated;

DROP FUNCTION IF EXISTS public.list_all_campaigns_pax();
CREATE OR REPLACE FUNCTION public.list_all_campaigns_pax()
RETURNS SETOF pax.campaigns
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pax
AS $$
  SELECT * FROM pax.campaigns
  WHERE deleted_at IS NULL
  ORDER BY created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.list_all_campaigns_pax() TO authenticated;

DROP FUNCTION IF EXISTS public.get_campaign_pax(uuid);
CREATE OR REPLACE FUNCTION public.get_campaign_pax(p_id uuid)
RETURNS pax.campaigns
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pax
AS $$
  SELECT * FROM pax.campaigns
  WHERE id = p_id AND deleted_at IS NULL
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_campaign_pax(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.list_campaign_schedules_pax();
CREATE OR REPLACE FUNCTION public.list_campaign_schedules_pax()
RETURNS SETOF pax.campaign_schedules
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pax
AS $$
  SELECT * FROM pax.campaign_schedules;
$$;
GRANT EXECUTE ON FUNCTION public.list_campaign_schedules_pax() TO authenticated;