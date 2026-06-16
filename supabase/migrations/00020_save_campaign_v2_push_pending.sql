-- ============================================================
-- Migration 00020: save_campaign_v2 push always pending
-- ============================================================
-- Rules:
--  - Push (in/out, in, out) ALWAYS require manual approval (pending)
--  - At-risk overlap (any ±1h with approved/pending) = pending
--  - DRV conflict = pending
--  - Otherwise auto-approve
-- ============================================================

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
RETURNS uuid
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
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT (a->>'drv_id')::text
    FROM jsonb_array_elements(COALESCE(p_audience, '[]'::jsonb)) a
  ) INTO v_drv_ids;

  SELECT EXISTS (
    SELECT 1 FROM public.check_cohort_conflicts(
      v_drv_ids,
      p_country,
      COALESCE(p_start_date, CURRENT_DATE),
      COALESCE(p_end_date, CURRENT_DATE)
    ) WHERE conflicting_drv_count > 0
  ) INTO v_has_conflicts;

  SELECT EXISTS (
    SELECT 1
    FROM campaign_schedules cs
    JOIN campaigns c ON c.id = cs.campaign_id
    WHERE c.country = p_country
      AND c.status IN ('approved', 'pending')
      AND cs.schedule_date BETWEEN COALESCE(p_start_date, CURRENT_DATE) AND COALESCE(p_end_date, CURRENT_DATE)
      AND cs.action_key = ANY(p_action_keys)
      AND (
        p_city_codes IS NULL OR p_city_codes = '{}' OR c.city_codes && p_city_codes
      )
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
  ) INTO v_has_at_risk_overlap;

  v_has_push := (p_action_keys && ARRAY['Push in/out', 'Push in', 'Push out']);

  IF p_status IS NOT NULL THEN
    v_effective_status := p_status;
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

  RETURN v_campaign_id;
END;
$$;