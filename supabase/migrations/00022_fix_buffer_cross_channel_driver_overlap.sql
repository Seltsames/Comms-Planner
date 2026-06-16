-- ============================================================
-- Migration 00022: Cross-channel conflict + driver overlap + day-lock enforcement
-- ============================================================
-- Rules:
--  1. ±1 hour buffer applies across ALL channels (not just same channel)
--  2. Only flag conflict if existing campaign shares drivers with cohort
--  3. Approved in buffer → red (blocked)
--  4. Pending in buffer → yellow (at risk)
--  5. Different drivers → no conflict (green)
--  6. Day lock: only if a driver has >= per_limit total push schedules (not per action_key)
--  7. Push limit (3/day) counts ALL push types combined per driver
--  8. save_campaign_v2 enforces per-driver push limit at save time
-- ============================================================

DROP FUNCTION IF EXISTS public.get_slot_availability_v2(text, text[], date, date, text[], text[]);

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
  v_loop_date date;
  v_loop_action_key text;
  v_loop_time_slot text;
  v_slots text[] := ARRAY[
    '07:00','07:30','08:00','08:30','09:00','09:30',
    '10:00','10:30','11:00','11:30','12:00','12:30',
    '13:00','13:30','14:00','14:30','15:00','15:30',
    '16:00','16:30','17:00','17:30','18:00','18:30',
    '19:00','19:30','20:00','20:30','21:00','21:30','22:00'
  ];
  v_per_limit integer;
  v_is_push_channel boolean;
  v_day_lock boolean := false;
  v_day_lock_msg text;
  v_drivers_with_limit bigint;
  v_slot_total bigint;
  v_has_approved_conflict boolean := false;
  v_has_pending_conflict boolean := false;
  v_result_severity text;
  v_sh integer;
  v_sm integer;
  v_slot_min integer;
  v_buf_start integer;
  v_buf_end integer;
BEGIN
  FOR v_loop_date IN
    SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date
  LOOP
    FOREACH v_loop_action_key IN ARRAY p_action_keys
    LOOP
      v_per_limit := CASE
        WHEN v_loop_action_key IN ('Push in/out', 'Push in', 'Push out') THEN 3
        WHEN v_loop_action_key = 'Whatsapp' THEN 2
        ELSE 0
      END;

      v_is_push_channel := v_loop_action_key IN ('Push in/out', 'Push in', 'Push out');

      v_drivers_with_limit := 0;
      v_day_lock := false;
      v_day_lock_msg := NULL;

      IF v_per_limit > 0 AND p_drv_ids IS NOT NULL AND array_length(p_drv_ids, 1) > 0 THEN
        IF v_is_push_channel THEN
          SELECT COUNT(*) INTO v_drivers_with_limit
          FROM (
            SELECT ca.drv_id
            FROM campaign_audience ca
            JOIN campaign_schedules cs ON cs.campaign_id = ca.campaign_id
            JOIN campaigns c ON c.id = cs.campaign_id
            WHERE ca.drv_id = ANY(p_drv_ids)
              AND cs.action_key IN ('Push in/out', 'Push in', 'Push out')
              AND cs.schedule_date = v_loop_date
              AND c.country = p_country
              AND c.status IN ('approved', 'pending')
              AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c.city_codes && p_city_codes)
            GROUP BY ca.drv_id
            HAVING COUNT(*) >= v_per_limit
          ) sub;
        ELSE
          SELECT COUNT(*) INTO v_drivers_with_limit
          FROM (
            SELECT ca.drv_id
            FROM campaign_audience ca
            JOIN campaign_schedules cs ON cs.campaign_id = ca.campaign_id
            JOIN campaigns c ON c.id = cs.campaign_id
            WHERE ca.drv_id = ANY(p_drv_ids)
              AND cs.action_key = v_loop_action_key
              AND cs.schedule_date = v_loop_date
              AND c.country = p_country
              AND c.status IN ('approved', 'pending')
              AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c.city_codes && p_city_codes)
            GROUP BY ca.drv_id
            HAVING COUNT(*) >= v_per_limit
          ) sub;
        END IF;

        IF v_drivers_with_limit > 0 THEN
          v_day_lock := true;
          v_day_lock_msg := format(
            '%s conductor(es) del cohorte ya tienen %s+ comunicaciones de %s ese día (máx. %s)',
            v_drivers_with_limit,
            CASE WHEN v_is_push_channel THEN '3 (total push)' ELSE v_per_limit::text END,
            CASE WHEN v_is_push_channel THEN 'Push (cualquier tipo)' ELSE v_loop_action_key END,
            CASE WHEN v_is_push_channel THEN '3' ELSE v_per_limit::text END
          );
        END IF;
      END IF;

      FOREACH v_loop_time_slot IN ARRAY v_slots
      LOOP
        v_sh := split_part(v_loop_time_slot, ':', 1)::integer;
        v_sm := split_part(v_loop_time_slot, ':', 2)::integer;
        v_slot_min := v_sh * 60 + v_sm;
        v_buf_start := v_slot_min - 60;
        v_buf_end := v_slot_min + 60;

        SELECT COUNT(DISTINCT cs2.campaign_id)
        INTO v_slot_total
        FROM campaign_schedules cs2
        JOIN campaigns c2 ON c2.id = cs2.campaign_id
        WHERE cs2.schedule_date = v_loop_date
          AND cs2.action_key = v_loop_action_key
          AND c2.country = p_country
          AND c2.status IN ('approved', 'pending')
          AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c2.city_codes && p_city_codes);

        SELECT EXISTS (
          SELECT 1
          FROM campaign_schedules cs2
          JOIN campaigns c2 ON c2.id = cs2.campaign_id
          WHERE cs2.schedule_date = v_loop_date
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
            AND EXISTS (
              SELECT 1 FROM campaign_audience ca2
              WHERE ca2.campaign_id = cs2.campaign_id
                AND ca2.drv_id = ANY(p_drv_ids)
            )
        ) INTO v_has_approved_conflict;

        SELECT EXISTS (
          SELECT 1
          FROM campaign_schedules cs2
          JOIN campaigns c2 ON c2.id = cs2.campaign_id
          WHERE cs2.schedule_date = v_loop_date
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
            AND EXISTS (
              SELECT 1 FROM campaign_audience ca2
              WHERE ca2.campaign_id = cs2.campaign_id
                AND ca2.drv_id = ANY(p_drv_ids)
            )
        ) INTO v_has_pending_conflict;

        IF v_day_lock THEN
          v_result_severity := 'red';
        ELSIF v_has_approved_conflict THEN
          v_result_severity := 'red';
        ELSIF v_has_pending_conflict THEN
          v_result_severity := 'yellow';
        ELSE
          v_result_severity := 'green';
        END IF;

        action_key := v_loop_action_key;
        schedule_date := v_loop_date;
        time_slot := v_loop_time_slot;
        severity := v_result_severity;
        day_locked := v_day_lock;
        day_lock_reason := v_day_lock_msg;
        conflicting_drivers := v_drivers_with_limit;
        total_schedules := v_slot_total;
        RETURN NEXT;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_slot_availability_v2(text, text[], date, date, text[], text[]) TO authenticated;

-- ============================================================
-- Update save_campaign_v2 to enforce per-driver push limit
-- ============================================================
DROP FUNCTION IF EXISTS public.save_campaign_v2(
  text, text, text, text[], text[], text, text[], text, date, date,
  jsonb, jsonb, text, text, uuid, text
);

CREATE OR REPLACE FUNCTION public.save_campaign_v2(
  p_name text,
  p_team text,
  p_sub_team text,
  p_types text[],
  p_action_keys text[],
  p_country text,
  p_city_codes text[],
  p_csv_file_name text,
  p_start_date date,
  p_end_date date,
  p_schedules jsonb,
  p_audience jsonb,
  p_status text,
  p_nomenclature text,
  p_creator_id uuid,
  p_timezone text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_campaign_id uuid;
  v_user_id uuid := COALESCE(p_creator_id, auth.uid());
  v_sched record;
  v_effective_status text;
  v_drv_ids text[];
  v_has_conflicts boolean;
  v_has_at_risk_overlap boolean;
  v_has_push boolean;
  v_has_push_day_lock boolean;
  v_push_day_lock_msg text;
  v_new_push_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT trim(both '"' from (a->>'drv_id'))
    FROM jsonb_array_elements(COALESCE(p_audience, '[]'::jsonb)) a
    WHERE a->>'drv_id' IS NOT NULL
  ) INTO v_drv_ids;

  v_has_push := (p_action_keys && ARRAY['Push in/out', 'Push in', 'Push out']);

  -- Per-driver push day-lock check (3 total push per driver per day)
  -- Check across ALL cities since DRV overlap is the conflict criterion
  IF v_has_push AND v_drv_ids IS NOT NULL AND array_length(v_drv_ids, 1) > 0 THEN
    SELECT EXISTS (
      SELECT 1
      FROM (
        SELECT ca.drv_id, cs.schedule_date, COUNT(*) as push_count
        FROM campaign_audience ca
        JOIN campaign_schedules cs ON cs.campaign_id = ca.campaign_id
        JOIN campaigns c ON c.id = cs.campaign_id
        WHERE ca.drv_id = ANY(v_drv_ids)
          AND cs.action_key IN ('Push in/out', 'Push in', 'Push out')
          AND c.country = p_country
          AND c.status IN ('approved', 'pending')
          AND cs.schedule_date BETWEEN COALESCE(p_start_date, CURRENT_DATE)
                                   AND COALESCE(p_end_date, CURRENT_DATE)
        GROUP BY ca.drv_id, cs.schedule_date
        HAVING COUNT(*) >= 3
      ) driver_days
    ) INTO v_has_push_day_lock;
  ELSE
    v_has_push_day_lock := false;
  END IF;

  -- At-risk overlap: any schedule (approved OR pending) within ±1h of new schedule
  -- Also check across ALL cities for same DRV overlap
  SELECT EXISTS (
    SELECT 1
    FROM campaign_schedules cs
    JOIN campaigns c ON c.id = cs.campaign_id
    WHERE c.country = p_country
      AND c.status IN ('approved', 'pending')
      AND cs.schedule_date BETWEEN COALESCE(p_start_date, CURRENT_DATE)
                               AND COALESCE(p_end_date, CURRENT_DATE)
      AND cs.action_key = ANY(p_action_keys)
      AND (
        cs.time_slot IN ('FULL_DAY','07:00-22:00','06:00-22:00')
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(p_schedules, '[]'::jsonb)) s
          WHERE (s->>'action_key')::text = cs.action_key
            AND (s->>'schedule_date')::date = cs.schedule_date
            AND ABS(
              (split_part(cs.time_slot, ':', 1)::integer * 60 + split_part(cs.time_slot, ':', 2)::integer) -
              (split_part((s->>'time_slot')::text, ':', 1)::integer * 60 + split_part((s->>'time_slot')::text, ':', 2)::integer)
            ) < 60
        )
      )
      AND EXISTS (
        SELECT 1 FROM campaign_audience ca2
        WHERE ca2.campaign_id = cs.campaign_id
          AND ca2.drv_id = ANY(v_drv_ids)
      )
  ) INTO v_has_at_risk_overlap;

  -- Per-DRV cohort conflict check (general DRV conflicts, not time-based)
  SELECT EXISTS (
    SELECT 1 FROM public.check_cohort_conflicts(
      v_drv_ids,
      p_country,
      COALESCE(p_start_date, CURRENT_DATE),
      COALESCE(p_end_date, CURRENT_DATE)
    ) WHERE conflicting_drv_count > 0
  ) INTO v_has_conflicts;

  -- Determine status
  IF p_status IS NOT NULL THEN
    v_effective_status := p_status;
  ELSIF v_has_push_day_lock THEN
    RAISE EXCEPTION 'No se puede crear la campaña: algunos conductores ya tienen 3+ comunicaciones push ese día. Día bloqueado.';
  ELSIF v_has_push THEN
    v_effective_status := 'pending';
  ELSIF v_has_conflicts OR v_has_at_risk_overlap THEN
    v_effective_status := 'pending';
  ELSE
    v_effective_status := 'approved';
  END IF;

  SELECT id INTO v_campaign_id
  FROM public.campaigns
  WHERE creator_id = v_user_id AND name = p_name
  LIMIT 1;

  IF v_campaign_id IS NULL THEN
    INSERT INTO public.campaigns (
      name, team, sub_team, types, action_keys, country, city_codes,
      csv_file_name, start_date, end_date, creator_id, status
    ) VALUES (
      p_name, p_team, p_sub_team, p_types, p_action_keys, p_country, p_city_codes,
      p_csv_file_name, p_start_date, p_end_date, v_user_id, v_effective_status
    )
    RETURNING id INTO v_campaign_id;
  ELSE
    UPDATE public.campaigns SET
      team = p_team,
      sub_team = p_sub_team,
      types = p_types,
      action_keys = p_action_keys,
      country = p_country,
      city_codes = p_city_codes,
      csv_file_name = p_csv_file_name,
      start_date = p_start_date,
      end_date = p_end_date,
      status = v_effective_status,
      updated_at = now()
    WHERE id = v_campaign_id;

    DELETE FROM public.campaign_schedules WHERE campaign_id = v_campaign_id;
    DELETE FROM public.campaign_audience WHERE campaign_id = v_campaign_id;
  END IF;

  FOR v_sched IN
    SELECT (s->>'action_key')::text AS action_key,
           (s->>'schedule_date')::date AS schedule_date,
           (s->>'time_slot')::text AS time_slot,
           NULLIF(s->>'image_url', '') AS image_url
    FROM jsonb_array_elements(COALESCE(p_schedules, '[]'::jsonb)) AS s
  LOOP
    INSERT INTO public.campaign_schedules
      (campaign_id, action_key, schedule_date, time_slot, image_url)
    VALUES
      (v_campaign_id, v_sched.action_key, v_sched.schedule_date, v_sched.time_slot, v_sched.image_url)
    ON CONFLICT (campaign_id, action_key, schedule_date) DO UPDATE SET
      time_slot = EXCLUDED.time_slot,
      image_url = EXCLUDED.image_url;
  END LOOP;

  INSERT INTO public.campaign_audience (campaign_id, drv_id, city_code)
  SELECT v_campaign_id, trim(both '"' from (a->>'drv_id')), NULLIF(trim(both '"' from (a->>'city_code')), '')::text
  FROM jsonb_array_elements(COALESCE(p_audience, '[]'::jsonb)) AS a
  ON CONFLICT (campaign_id, drv_id, city_code) DO NOTHING;

  RETURN v_campaign_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_campaign_v2(
  text, text, text, text[], text[], text, text[], text, date, date,
  jsonb, jsonb, text, text, uuid, text
) TO authenticated;