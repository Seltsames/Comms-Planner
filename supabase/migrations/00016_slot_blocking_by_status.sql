-- ============================================================
-- Migration 00016: Slot blocking by campaign status
-- ============================================================
-- - Approved campaigns: red/blocked (±30min buffer)
-- - Pending/rejected: yellow/at-risk but selectable
-- - Rejected/cancelled: ignored
-- - DRV-overlap severity counts only approved campaigns
-- ============================================================

DROP FUNCTION IF EXISTS public.get_slot_availability(text, text[], date, date, text[]);

CREATE OR REPLACE FUNCTION public.get_slot_availability(
  p_country text,
  p_city_codes text[],
  p_start_date date,
  p_end_date date,
  p_action_keys text[]
)
RETURNS TABLE (
  action_key text,
  conflict_count bigint,
  is_available boolean,
  schedule_date date,
  severity text,
  time_slot text,
  total_campaigns bigint
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_date date;
  v_total_campaigns bigint;
  v_slots text[] := ARRAY[
    '07:00','07:30','08:00','08:30','09:00','09:30',
    '10:00','10:30','11:00','11:30','12:00','12:30',
    '13:00','13:30','14:00','14:30','15:00','15:30',
    '16:00','16:30','17:00','17:30','18:00','18:30',
    '19:00','19:30','20:00','20:30','21:00','21:30','22:00'
  ];
BEGIN
  SELECT COUNT(DISTINCT cs.campaign_id)
  INTO v_total_campaigns
  FROM campaign_schedules cs
  JOIN campaigns c ON c.id = cs.campaign_id
  WHERE c.country = p_country
    AND c.status = 'approved'
    AND cs.schedule_date BETWEEN p_start_date AND p_end_date
    AND (p_action_keys IS NULL OR p_action_keys = '{}' OR cs.action_key = ANY(p_action_keys));

  FOR v_date IN
    SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date
  LOOP
    FOREACH action_key IN ARRAY COALESCE(p_action_keys, ARRAY[
      'Push in/out','Push in','Push out','Email','Whatsapp','SMS','Pop Up','XPanel'
    ])
    LOOP
      FOREACH time_slot IN ARRAY v_slots
      LOOP
        DECLARE
          v_sh integer := split_part(time_slot, ':', 1)::integer;
          v_sm integer := split_part(time_slot, ':', 2)::integer;
          v_slot_min integer := v_sh * 60 + v_sm;
          v_buf_start integer := v_slot_min - 30;
          v_buf_end   integer := v_slot_min + 30;
          v_has_approved boolean;
          v_has_pending boolean;
          v_conflict_count bigint;
        BEGIN
          SELECT EXISTS (
            SELECT 1
            FROM campaign_schedules cs2
            JOIN campaigns c2 ON c2.id = cs2.campaign_id
            WHERE cs2.schedule_date = v_date
              AND cs2.action_key = action_key
              AND c2.country = p_country
              AND c2.status = 'approved'
              AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c2.city_codes && p_city_codes)
              AND (
                cs2.time_slot IN ('FULL_DAY','07:00-22:00','06:00-22:00')
                OR (
                  (split_part(cs2.time_slot, ':', 1)::integer * 60 + split_part(cs2.time_slot, ':', 2)::integer)
                  BETWEEN v_buf_start AND v_buf_end
                )
              )
          ) INTO v_has_approved;

          SELECT EXISTS (
            SELECT 1
            FROM campaign_schedules cs2
            JOIN campaigns c2 ON c2.id = cs2.campaign_id
            WHERE cs2.schedule_date = v_date
              AND cs2.action_key = action_key
              AND c2.country = p_country
              AND c2.status IN ('pending', 'rejected')
              AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c2.city_codes && p_city_codes)
              AND (
                cs2.time_slot IN ('FULL_DAY','07:00-22:00','06:00-22:00')
                OR (
                  (split_part(cs2.time_slot, ':', 1)::integer * 60 + split_part(cs2.time_slot, ':', 2)::integer)
                  BETWEEN v_buf_start AND v_buf_end
                )
              )
          ) INTO v_has_pending;

          IF v_has_approved THEN
            severity := 'red';
            is_available := false;
            conflict_count := 0;
          ELSIF v_has_pending THEN
            severity := 'yellow';
            is_available := true;
            conflict_count := 0;
          ELSE
            SELECT COUNT(DISTINCT cs2.campaign_id)
            INTO v_conflict_count
            FROM campaign_schedules cs2
            JOIN campaigns c2 ON c2.id = cs2.campaign_id
            WHERE cs2.schedule_date = v_date
              AND cs2.action_key = action_key
              AND cs2.time_slot = time_slot
              AND c2.country = p_country
              AND c2.status = 'approved'
              AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c2.city_codes && p_city_codes);

            conflict_count := v_conflict_count;

            severity := CASE
              WHEN v_conflict_count = 0 THEN 'green'
              WHEN v_total_campaigns > 0 AND (v_conflict_count::float / v_total_campaigns) < 0.3 THEN 'yellow'
              ELSE 'red'
            END;
            is_available := severity != 'red';
          END IF;

          schedule_date := v_date;
          total_campaigns := v_total_campaigns;
          RETURN NEXT;
        END;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_slot_availability(text, text[], date, date, text[]) TO authenticated;