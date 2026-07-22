-- ============================================================
-- Migration 00036: multiple Event IDs per campaign
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- A campaign can mix comm types (POPE and Ad Placement), and each one
-- needs its own Event ID code — plus room for extra ones. The single
-- `event_id` text column becomes `event_ids`, a JSONB array of
-- {label, value} entries, e.g.
--   [{"label":"Pope","value":"EV-1"},{"label":"Ad Placement","value":"EV-2"}]
--
-- The legacy `event_id` column is kept and mirrors the first entry's
-- value so any older reader keeps working.
-- ============================================================

ALTER TABLE drv.campaigns ADD COLUMN IF NOT EXISTS event_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE pax.campaigns ADD COLUMN IF NOT EXISTS event_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill the existing single event_id as the first entry.
UPDATE drv.campaigns
SET event_ids = jsonb_build_array(jsonb_build_object('label', 'Event ID', 'value', event_id))
WHERE COALESCE(trim(event_id), '') <> '' AND event_ids = '[]'::jsonb;

UPDATE pax.campaigns
SET event_ids = jsonb_build_array(jsonb_build_object('label', 'Event ID', 'value', event_id))
WHERE COALESCE(trim(event_id), '') <> '' AND event_ids = '[]'::jsonb;

-- Writers: campaign creator, or an admin scoped to that platform.
DROP FUNCTION IF EXISTS public.set_campaign_event_ids(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.set_campaign_event_ids(p_campaign_id uuid, p_event_ids jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, drv
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_event_ids IS NULL OR jsonb_typeof(p_event_ids) <> 'array' THEN
    RAISE EXCEPTION 'event_ids must be a JSON array';
  END IF;

  UPDATE drv.campaigns
  SET event_ids = p_event_ids,
      -- keep the legacy single column pointing at the first value
      event_id = NULLIF(trim(COALESCE(p_event_ids->0->>'value', '')), ''),
      updated_at = now()
  WHERE id = p_campaign_id
    AND deleted_at IS NULL
    AND (creator_id = auth.uid() OR public.is_platform_admin(auth.uid(), 'drv'));

  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_campaign_event_ids(uuid, jsonb) TO authenticated;

DROP FUNCTION IF EXISTS public.set_campaign_event_ids_pax(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.set_campaign_event_ids_pax(p_campaign_id uuid, p_event_ids jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pax
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_event_ids IS NULL OR jsonb_typeof(p_event_ids) <> 'array' THEN
    RAISE EXCEPTION 'event_ids must be a JSON array';
  END IF;

  UPDATE pax.campaigns
  SET event_ids = p_event_ids,
      event_id = NULLIF(trim(COALESCE(p_event_ids->0->>'value', '')), ''),
      updated_at = now()
  WHERE id = p_campaign_id
    AND deleted_at IS NULL
    AND (creator_id = auth.uid() OR public.is_platform_admin(auth.uid(), 'pax'));

  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_campaign_event_ids_pax(uuid, jsonb) TO authenticated;
