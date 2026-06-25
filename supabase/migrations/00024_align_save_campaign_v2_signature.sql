-- ============================================================
-- Migration 00024: Align save_campaign_v2 signature with the client
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- Fixes two issues left over from migration 00022:
--
--   1) SIGNATURE DRIFT. Migration 00022 redefined public.save_campaign_v2
--      with 16 parameters (added p_nomenclature, p_creator_id, p_timezone)
--      and reordered p_status / p_schedules / p_audience.
--      The client (src/lib/queries.ts → saveCampaignRpc) and the TypeScript
--      definition (src/types/database.ts) still call the original 13-param
--      version, so the live DB rejected the call.
--
--   2) RETURN TYPE. The function was RETURNS uuid while the client
--      treats the value as a string. UUIDs already serialize as strings
--      over the wire, so we now declare RETURNS text (uuid::text cast)
--      to keep both sides honest.
--
-- The dropped parameters (p_nomenclature, p_creator_id, p_timezone) were
-- never read inside the function body — p_creator_id was only used as a
-- COALESCE fallback to auth.uid() — so dropping them is a no-op for
-- behavior. The push-day-lock exception, the ±1h at-risk overlap check
-- and the cohort-conflict auto-pending logic from 00022 are preserved.
-- ============================================================

DROP FUNCTION IF EXISTS public.save_campaign_v2(
  text, text, text, text[], text[], text, text[], text, date, date,
  text, jsonb, jsonb
);
DROP FUNCTION IF EXISTS public.save_campaign_v2(
  text, text, text, text[], text[], text, text[], text, date, date,
  jsonb, jsonb, text, text, uuid, text
);
DROP FUNCTION IF EXISTS public.save_campaign_v2(
  uuid, text, text, text[], text[], text, text[], text, date, date,
  text, jsonb, jsonb
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
  p_status text,
  p_schedules jsonb,
  p_audience jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_id uuid;
  v_user_id uuid := auth.uid();
  v_sched record;
  v_effective_status text;
  v_drv_ids text[];
  v_has_conflicts boolean;
  v_has_at_risk_overlap boolean;
  v_has_push boolean;
  v_has_push_day_lock boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT (a->>'drv_id')::text
    FROM jsonb_array_elements(COALESCE(p_audience, '[]'::jsonb)) a
  ) INTO v_drv_ids;

  v_has_push := (p_action_keys && ARRAY['Push in/out', 'Push in', 'Push out']);

  -- Per-driver push day-lock check (3 total push per driver per day)
  IF v_has_push AND v_drv_ids IS NOT NULL AND array_length(v_drv_ids, 1) > 0 THEN
    SELECT EXISTS (
      SELECT 1
      FROM (
        SELECT ca.drv_id, cs.schedule_date, COUNT(*) AS push_count
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

  -- At-risk overlap: any schedule (approved OR pending) within ±1h of new
  -- schedule, same channel, sharing at least one DRV with the cohort.
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

  -- Per-DRV cohort conflict check
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
  SELECT v_campaign_id, (a->>'drv_id')::text, NULLIF((a->>'city_code')::text, '')::text
  FROM jsonb_array_elements(COALESCE(p_audience, '[]'::jsonb)) AS a
  ON CONFLICT (campaign_id, drv_id, city_code) DO NOTHING;

  RETURN v_campaign_id::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_campaign_v2(
  text, text, text, text[], text[], text, text[], text, date, date,
  text, jsonb, jsonb
) TO authenticated;
