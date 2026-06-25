-- ============================================================
-- Migration 00025: Fix delete_campaign_hard admin gate + return value
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- Two bugs in the version shipped by 00015:
--
--   1) Misleading error message: when the caller is not admin, the
--      function raised 'Not authenticated' (copy-pasted from the previous
--      IF). The real condition is "Admin only", which is what we now say.
--
--   2) FOUND was used implicitly by `RETURN FOUND` after the last DELETE.
--      In plpgsql FOUND reflects the most-recent statement, so the value
--      happened to be correct here, but reading it was ambiguous. We now
--      capture the deletion result with RETURNING … INTO … so the contract
--      is explicit: returns true iff a campaign row was deleted.
-- ============================================================

DROP FUNCTION IF EXISTS public.delete_campaign_hard(uuid);

CREATE OR REPLACE FUNCTION public.delete_campaign_hard(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  DELETE FROM public.campaign_audience WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_schedules WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaigns WHERE id = p_campaign_id RETURNING true INTO v_deleted;

  RETURN COALESCE(v_deleted, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_campaign_hard(uuid) TO authenticated;
