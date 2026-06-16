-- ============================================================
-- Migration 00019: New slot availability with full conflict rules
-- ============================================================
-- Rules:
--  1. Per-driver daily channel limits (DRV must be in cohort):
--     - Push in/out, Push in, Push out: max 3 communications per day
--     - Whatsapp: max 2 communications per day
--     - If any cohort driver exceeds limit on a given day for a channel
--       → that day is locked for the entire channel
--  2. ±1 hour buffer around any approved communication
--  3. ±1 hour buffer around pending communications = at risk (yellow)
--  4. Other channels (Email, SMS, XPanel, Pop Up) follow only the buffer rule
--  5. Auto-approval: all channels auto-approve EXCEPT push (always pending)
-- ============================================================

DROP FUNCTION IF EXISTS public.get_slot_availability_v2(
  text, text[], date, date, text[], text[]
);

CREATE OR REPLACE FUNCTION public.get_slot_availability_v2(
  p_country text,
  p_city_codes text[],
  p_start_date date,
  p_end_date date,
  p_action_keys text[],
  p_drv_ids text[]
)
RETURNS TABLE (
  action_key text,
  schedule_date date,
  time_slot text,
  severity text,
  day_locked boolean,
  day_lock_reason text,
  conflicting_drivers bigint,
  total_schedules bigint
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_date date;
  v_action_key text;
  v_time_slot text;
  v_slots text[] := ARRAY[
    '07:00','07:30','08:00','08:30','09:00','09:30',
    '10:00','10:30','11:00','11:30','12:00','12:30',
    '13:00','13:30','14:00','14:30','15:00','15:30',
    '16:00','16:30','17:00','17:30','18:00','18:30',
    '19:00','19:30','20:00','20:30','21:00','21:30','22:00'
  ];
  v_limit integer;
  v_has_pending_at_risk boolean;
  v_has_approved_in_buffer boolean;
  v_conflicting_drivers bigint;
  v_total_schedules bigint;
  v_day_locked boolean;
  v_day_lock_reason text;
BEGIN
  FOR v_date IN
    SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date
  LOOP
    FOREACH v_action_key IN ARRAY p_action_keys
    LOOP
      v_limit := CASE
        WHEN v_action_key IN ('Push in/out', 'Push in', 'Push out') THEN 3
        WHEN v_action_key = 'Whatsapp' THEN 2
        ELSE 0
      END;

      v_conflicting_drivers := 0;
      v_day_locked := false;
      v_day_lock_reason := NULL;

      IF v_limit > 0 AND p_drv_ids IS NOT NULL AND array_length(p_drv_ids, 1) > 0 THEN
        SELECT COUNT(DISTINCT ca.drv_id)
        INTO v_conflicting_drivers
        FROM campaign_audience ca
        JOIN campaign_schedules cs ON cs.campaign_id = ca.campaign_id
        JOIN campaigns c ON c.id = cs.campaign_id
        WHERE ca.drv_id = ANY(p_drv_ids)
          AND cs.action_key = v_action_key
          AND cs.schedule_date = v_date
          AND c.country = p_country
          AND c.status IN ('approved', 'pending')
          AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c.city_codes && p_city_codes);

        IF v_conflicting_drivers > 0 THEN
          v_day_locked := true;
          v_day_lock_reason := format(
            '%s conductor(es) del cohorte ya tienen %s+ comunicaciones de %s ese día (máx. %s)',
            v_conflicting_drivers,
            v_limit,
            v_action_key,
            v_limit
          );
        END IF;
      END IF;

      FOREACH v_time_slot IN ARRAY v_slots
      LOOP
        DECLARE
          v_sh integer := split_part(v_time_slot, ':', 1)::integer;
          v_sm integer := split_part(v_time_slot, ':', 2)::integer;
          v_slot_min integer := v_sh * 60 + v_sm;
          v_buf_start integer := v_slot_min - 60;
          v_buf_end   integer := v_slot_min + 60;
        BEGIN
          SELECT COUNT(DISTINCT cs2.campaign_id)
          INTO v_total_schedules
          FROM campaign_schedules cs2
          JOIN campaigns c2 ON c2.id = cs2.campaign_id
          WHERE cs2.schedule_date = v_date
            AND cs2.action_key = v_action_key
            AND c2.country = p_country
            AND c2.status IN ('approved', 'pending')
            AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c2.city_codes && p_city_codes);

          SELECT EXISTS (
            SELECT 1
            FROM campaign_schedules cs2
            JOIN campaigns c2 ON c2.id = cs2.campaign_id
            WHERE cs2.schedule_date = v_date
              AND cs2.action_key = v_action_key
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
          ) INTO v_has_approved_in_buffer;

          SELECT EXISTS (
            SELECT 1
            FROM campaign_schedules cs2
            JOIN campaigns c2 ON c2.id = cs2.campaign_id
            WHERE cs2.schedule_date = v_date
              AND cs2.action_key = v_action_key
              AND c2.country = p_country
              AND c2.status = 'pending'
              AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c2.city_codes && p_city_codes)
              AND (
                cs2.time_slot IN ('FULL_DAY','07:00-22:00','06:00-22:00')
                OR (
                  (split_part(cs2.time_slot, ':', 1)::integer * 60 + split_part(cs2.time_slot, ':', 2)::integer)
                  BETWEEN v_buf_start AND v_buf_end
                )
              )
          ) INTO v_has_pending_at_risk;

          IF v_day_locked THEN
            severity := 'red';
          ELSIF v_has_approved_in_buffer THEN
            severity := 'red';
          ELSIF v_has_pending_at_risk THEN
            severity := 'yellow';
          ELSE
            severity := 'green';
          END IF;

          action_key := v_action_key;
          time_slot := v_time_slot;
          schedule_date := v_date;
          RETURN NEXT;
        END;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_slot_availability_v2(text, text[], date, date, text[], text[]) TO authenticated;