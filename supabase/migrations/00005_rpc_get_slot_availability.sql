-- ============================================================
-- Migration 00005: get_slot_availability RPC
-- DiDi Comms Planner v2 — Supabase Cloud
--
-- Returns availability matrix for the slot picker:
-- For each (date, time_slot, action_key) in the range:
--   - conflict_count: how many campaigns share at least one DRV
--   - is_available: green (0) / yellow (<30%) / red (>=30%)
-- Uses campaign_audience GIN index for fast overlap detection.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_slot_availability(
  p_country text,
  p_city_codes text[],
  p_start_date date,
  p_end_date date,
  p_action_keys text[]
)
RETURNS TABLE(
  schedule_date date,
  time_slot text,
  action_key text,
  conflict_count bigint,
  total_campaigns bigint,
  is_available boolean,
  severity text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date date;
  v_total_campaigns bigint;
BEGIN
  -- Count total active campaigns in this country/date/channel range
  SELECT COUNT(DISTINCT cs.campaign_id)
  INTO v_total_campaigns
  FROM campaign_schedules cs
  JOIN campaigns c ON c.id = cs.campaign_id
  WHERE c.country = p_country
    AND cs.schedule_date BETWEEN p_start_date AND p_end_date
    AND (p_action_keys IS NULL OR p_action_keys = '{}' OR cs.action_key = ANY(p_action_keys));

  -- Generate date series and cross-join with time slots
  FOR v_date IN
    SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date
  LOOP
    -- For each action key, return availability for common time slots
    FOREACH action_key IN ARRAY COALESCE(p_action_keys, ARRAY['Push in/out', 'Push in', 'Push out', 'Email', 'Whatsapp', 'SMS', 'Pop Up', 'XPanel'])
    LOOP
      FOR time_slot IN
        VALUES
          ('07:00-09:00'),
          ('09:00-12:00'),
          ('12:00-15:00'),
          ('15:00-18:00'),
          ('18:00-21:00'),
          ('21:00-07:00')
      LOOP
        -- Count campaigns that have at least one DRV overlap in this slot
        SELECT COUNT(DISTINCT cs.campaign_id)
        INTO conflict_count
        FROM campaign_schedules cs
        JOIN campaigns c ON c.id = cs.campaign_id
        JOIN campaign_audience ca ON ca.campaign_id = cs.campaign_id
        WHERE c.country = p_country
          AND cs.schedule_date = v_date
          AND cs.time_slot = time_slot
          AND cs.action_key = action_key
          AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c.city_codes && p_city_codes);

        -- Severity thresholds: green=0, yellow=<30%, red=>=30%
        severity := CASE
          WHEN conflict_count = 0 THEN 'green'
          WHEN v_total_campaigns > 0 AND (conflict_count::float / v_total_campaigns) < 0.3 THEN 'yellow'
          ELSE 'red'
        END;

        is_available := severity = 'green';

        schedule_date := v_date;
        total_campaigns := v_total_campaigns;

        RETURN NEXT;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;