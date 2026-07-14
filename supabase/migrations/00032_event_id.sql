-- ============================================================
-- Migration 00032: Event ID code on campaigns
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- Free-text "Event ID" code editable from "Gestión de campañas" (admin)
-- and "Mis campañas" (creator). Creators can only tag their own
-- campaigns; admins can tag any.
-- ============================================================

ALTER TABLE drv.campaigns ADD COLUMN IF NOT EXISTS event_id text;
ALTER TABLE pax.campaigns ADD COLUMN IF NOT EXISTS event_id text;

DROP FUNCTION IF EXISTS public.set_campaign_event_id(uuid, text);
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
    AND (creator_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_campaign_event_id(uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.set_campaign_event_id_pax(uuid, text);
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
    AND (creator_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_campaign_event_id_pax(uuid, text) TO authenticated;
