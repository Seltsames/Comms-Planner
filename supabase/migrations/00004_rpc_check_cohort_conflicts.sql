-- ============================================================
-- Migration 00004: check_cohort_conflicts RPC
-- DiDi Comms Planner v2 — Supabase Cloud
--
-- Finds existing campaigns in the same country + overlapping date range
-- that share DRV IDs with the new campaign's cohort.
-- Uses campaign_audience GIN index for O(1) per-driver lookup.
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_cohort_conflicts(
  p_drv_ids text[],
  p_country text,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  campaign_id uuid,
  campaign_name text,
  schedule_date date,
  time_slot text,
  action_key text,
  conflicting_drv_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cs.campaign_id,
    c.name::text AS campaign_name,
    cs.schedule_date,
    cs.time_slot::text AS time_slot,
    cs.action_key::text AS action_key,
    COUNT(DISTINCT ca.drv_id) AS conflicting_drv_count
  FROM campaign_audience ca
  JOIN campaigns c ON c.id = ca.campaign_id
  JOIN campaign_schedules cs ON cs.campaign_id = ca.campaign_id
  WHERE
    -- GIN index lookup: O(1) per driver, not O(n) scan
    ca.drv_id = ANY(p_drv_ids)
    -- Same country
    AND c.country = p_country
    -- Overlapping date range
    AND cs.schedule_date BETWEEN p_start_date AND p_end_date
  GROUP BY cs.campaign_id, c.name, cs.schedule_date, cs.time_slot, cs.action_key
  ORDER BY conflicting_drv_count DESC, cs.schedule_date ASC;
END;
$$;