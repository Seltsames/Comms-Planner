-- ============================================================
-- Migration 00028: Schema split — DRV + PAX
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- Implements the "two apps sharing one Supabase project" model:
--
--   drv schema: existing driver campaigns + their logic.
--   pax schema: parallel passenger campaigns + their logic.
--
-- Shared in public (unchanged):
--   profiles, user_roles, admin_audit_log, has_role(),
--   current_user_is_enabled(), handle_new_user trigger,
--   custom_access_token_hook, update_updated_at_column().
--
-- Implementation:
--   1. CREATE SCHEMA drv / pax.
--   2. ALTER TABLE … SET SCHEMA drv  (moves public.campaigns,
--      campaign_audience, campaign_schedules + their indexes +
--      triggers + RLS policies; no data loss).
--   3. CREATE TABLE pax.campaigns / campaign_audience / schedules
--      as mirrors, but audience column is pax_id (not drv_id).
--   4. Recreate RLS policies for pax (same shape as drv).
--   5. Recreate every RPC to use schema-qualified drv.* table names
--      (so old save_campaign_v2 still works, but reads/writes drv).
--   6. Mirror each RPC into public.save_*_pax (and analytics/calendar
--      helpers) pointing at pax.* tables. Same signatures except
--      audience element key changes from drv_id → pax_id.
--   7. Expose drv and pax schemas to PostgREST (so direct table
--      queries via supabase-js work too).
-- ============================================================

-- 1. Schemas ------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS drv;
CREATE SCHEMA IF NOT EXISTS pax;

-- 2. Move existing tables from public → drv ------------------------------
ALTER TABLE public.campaigns          SET SCHEMA drv;
ALTER TABLE public.campaign_audience  SET SCHEMA drv;
ALTER TABLE public.campaign_schedules SET SCHEMA drv;

-- 3. Create the pax mirror tables ----------------------------------------
CREATE TABLE pax.campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  team            TEXT NOT NULL,
  sub_team        TEXT,
  types           TEXT[] NOT NULL DEFAULT '{}',
  action_keys     TEXT[] NOT NULL DEFAULT '{}',
  country         TEXT NOT NULL DEFAULT 'MX',
  city_codes      TEXT[] NOT NULL DEFAULT '{}',
  csv_file_name   TEXT,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  creator_id      UUID REFERENCES auth.users(id) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  approved_by     UUID REFERENCES auth.users(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID REFERENCES auth.users(id)
);

CREATE TABLE pax.campaign_audience (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID REFERENCES pax.campaigns(id) ON DELETE CASCADE NOT NULL,
  pax_id          TEXT NOT NULL,
  city_code       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, pax_id, city_code)
);

CREATE TABLE pax.campaign_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID REFERENCES pax.campaigns(id) ON DELETE CASCADE NOT NULL,
  action_key      TEXT NOT NULL,
  schedule_date   DATE NOT NULL,
  time_slot       TEXT NOT NULL,
  image_url       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, action_key, schedule_date)
);

-- 4. RLS for pax --------------------------------------------------------
ALTER TABLE pax.campaigns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pax.campaign_audience  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pax.campaign_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pax campaigns" ON pax.campaigns
  FOR SELECT TO authenticated
  USING (creator_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "Users can update own pax campaigns" ON pax.campaigns
  FOR UPDATE TO authenticated
  USING (creator_id = auth.uid() AND deleted_at IS NULL)
  WITH CHECK (creator_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "Users can insert own pax campaigns" ON pax.campaigns
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Admins can view all pax campaigns" ON pax.campaigns
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND deleted_at IS NULL);

CREATE POLICY "Admins can delete pax campaigns" ON pax.campaigns
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read pax schedules" ON pax.campaign_schedules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Manage pax schedules via campaign" ON pax.campaign_schedules
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM pax.campaigns
      WHERE id = campaign_id
        AND (creator_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "Authenticated read pax audience" ON pax.campaign_audience
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Manage pax audience via campaign" ON pax.campaign_audience
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM pax.campaigns
      WHERE id = campaign_id
        AND (creator_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

-- 5. updated_at trigger for pax ----------------------------------------
CREATE TRIGGER update_pax_campaigns_updated_at
  BEFORE UPDATE ON pax.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Grants -------------------------------------------------------------
GRANT USAGE ON SCHEMA drv TO authenticated;
GRANT USAGE ON SCHEMA pax TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA drv TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA pax TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA drv TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA pax TO authenticated;

-- 7. Indexes for pax (mirror of drv indexes from migration 00002) ------
CREATE INDEX pax_idx_audience_pax_id        ON pax.campaign_audience(pax_id);
CREATE INDEX pax_idx_audience_campaign_id   ON pax.campaign_audience(campaign_id);
CREATE INDEX pax_idx_audience_city_code     ON pax.campaign_audience(city_code);
CREATE INDEX pax_idx_schedules_campaign_dt ON pax.campaign_schedules(campaign_id, schedule_date);
CREATE INDEX pax_idx_schedules_date         ON pax.campaign_schedules(schedule_date);
CREATE INDEX pax_idx_campaigns_creator      ON pax.campaigns(creator_id);
CREATE INDEX pax_idx_campaigns_country      ON pax.campaigns(country);
CREATE INDEX pax_idx_campaigns_created_at   ON pax.campaigns(created_at DESC);
CREATE INDEX pax_idx_campaigns_country_cr   ON pax.campaigns(country, creator_id);
CREATE INDEX pax_idx_campaigns_status       ON pax.campaigns(status);

-- 8. Rebuild DRV RPCs with schema-qualified table names -----------------
--    search_path now includes drv, pax so unqualified helper lookups
--    (e.g. v_user_id := auth.uid()) still resolve via the public schema.

DROP FUNCTION IF EXISTS public.save_campaign_v2(
  text, text, text, text[], text[], text, text[], text, date, date,
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
SET search_path = public, drv
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

  IF v_has_push AND v_drv_ids IS NOT NULL AND array_length(v_drv_ids, 1) > 0 THEN
    SELECT EXISTS (
      SELECT 1
      FROM (
        SELECT ca.drv_id, cs.schedule_date, COUNT(*) AS push_count
        FROM drv.campaign_audience ca
        JOIN drv.campaign_schedules cs ON cs.campaign_id = ca.campaign_id
        JOIN drv.campaigns c ON c.id = cs.campaign_id
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

  SELECT EXISTS (
    SELECT 1
    FROM drv.campaign_schedules cs
    JOIN drv.campaigns c ON c.id = cs.campaign_id
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
        SELECT 1 FROM drv.campaign_audience ca2
        WHERE ca2.campaign_id = cs.campaign_id
          AND ca2.drv_id = ANY(v_drv_ids)
      )
  ) INTO v_has_at_risk_overlap;

  SELECT EXISTS (
    SELECT 1 FROM public.check_cohort_conflicts(
      v_drv_ids,
      p_country,
      COALESCE(p_start_date, CURRENT_DATE),
      COALESCE(p_end_date, CURRENT_DATE)
    ) WHERE conflicting_drv_count > 0
  ) INTO v_has_conflicts;

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
  FROM drv.campaigns
  WHERE creator_id = v_user_id AND name = p_name
  LIMIT 1;

  IF v_campaign_id IS NULL THEN
    INSERT INTO drv.campaigns (
      name, team, sub_team, types, action_keys, country, city_codes,
      csv_file_name, start_date, end_date, creator_id, status
    ) VALUES (
      p_name, p_team, p_sub_team, p_types, p_action_keys, p_country, p_city_codes,
      p_csv_file_name, p_start_date, p_end_date, v_user_id, v_effective_status
    )
    RETURNING id INTO v_campaign_id;
  ELSE
    UPDATE drv.campaigns SET
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

    DELETE FROM drv.campaign_schedules WHERE campaign_id = v_campaign_id;
    DELETE FROM drv.campaign_audience WHERE campaign_id = v_campaign_id;
  END IF;

  FOR v_sched IN
    SELECT (s->>'action_key')::text AS action_key,
           (s->>'schedule_date')::date AS schedule_date,
           (s->>'time_slot')::text AS time_slot,
           NULLIF(s->>'image_url', '') AS image_url
    FROM jsonb_array_elements(COALESCE(p_schedules, '[]'::jsonb)) AS s
  LOOP
    INSERT INTO drv.campaign_schedules
      (campaign_id, action_key, schedule_date, time_slot, image_url)
    VALUES
      (v_campaign_id, v_sched.action_key, v_sched.schedule_date, v_sched.time_slot, v_sched.image_url)
    ON CONFLICT (campaign_id, action_key, schedule_date) DO UPDATE SET
      time_slot = EXCLUDED.time_slot,
      image_url = EXCLUDED.image_url;
  END LOOP;

  INSERT INTO drv.campaign_audience (campaign_id, drv_id, city_code)
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

-- 8b. PAX mirror of save_campaign_v2 -----------------------------------
CREATE OR REPLACE FUNCTION public.save_campaign_pax(
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
SET search_path = public, pax
AS $$
DECLARE
  v_campaign_id uuid;
  v_user_id uuid := auth.uid();
  v_sched record;
  v_effective_status text;
  v_pax_ids text[];
  v_has_conflicts boolean;
  v_has_at_risk_overlap boolean;
  v_has_push boolean;
  v_has_push_day_lock boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT (a->>'pax_id')::text
    FROM jsonb_array_elements(COALESCE(p_audience, '[]'::jsonb)) a
  ) INTO v_pax_ids;

  v_has_push := (p_action_keys && ARRAY['Push in/out', 'Push in', 'Push out']);

  IF v_has_push AND v_pax_ids IS NOT NULL AND array_length(v_pax_ids, 1) > 0 THEN
    SELECT EXISTS (
      SELECT 1
      FROM (
        SELECT ca.pax_id, cs.schedule_date, COUNT(*) AS push_count
        FROM pax.campaign_audience ca
        JOIN pax.campaign_schedules cs ON cs.campaign_id = ca.campaign_id
        JOIN pax.campaigns c ON c.id = cs.campaign_id
        WHERE ca.pax_id = ANY(v_pax_ids)
          AND cs.action_key IN ('Push in/out', 'Push in', 'Push out')
          AND c.country = p_country
          AND c.status IN ('approved', 'pending')
          AND cs.schedule_date BETWEEN COALESCE(p_start_date, CURRENT_DATE)
                                   AND COALESCE(p_end_date, CURRENT_DATE)
        GROUP BY ca.pax_id, cs.schedule_date
        HAVING COUNT(*) >= 3
      ) passenger_days
    ) INTO v_has_push_day_lock;
  ELSE
    v_has_push_day_lock := false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pax.campaign_schedules cs
    JOIN pax.campaigns c ON c.id = cs.campaign_id
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
        SELECT 1 FROM pax.campaign_audience ca2
        WHERE ca2.campaign_id = cs.campaign_id
          AND ca2.pax_id = ANY(v_pax_ids)
      )
  ) INTO v_has_at_risk_overlap;

  SELECT EXISTS (
    SELECT 1 FROM public.check_cohort_conflicts_pax(
      v_pax_ids,
      p_country,
      COALESCE(p_start_date, CURRENT_DATE),
      COALESCE(p_end_date, CURRENT_DATE)
    ) WHERE conflicting_pax_count > 0
  ) INTO v_has_conflicts;

  IF p_status IS NOT NULL THEN
    v_effective_status := p_status;
  ELSIF v_has_push_day_lock THEN
    RAISE EXCEPTION 'No se puede crear la campaña: algunos pasajeros ya tienen 3+ comunicaciones push ese día. Día bloqueado.';
  ELSIF v_has_push THEN
    v_effective_status := 'pending';
  ELSIF v_has_conflicts OR v_has_at_risk_overlap THEN
    v_effective_status := 'pending';
  ELSE
    v_effective_status := 'approved';
  END IF;

  SELECT id INTO v_campaign_id
  FROM pax.campaigns
  WHERE creator_id = v_user_id AND name = p_name
  LIMIT 1;

  IF v_campaign_id IS NULL THEN
    INSERT INTO pax.campaigns (
      name, team, sub_team, types, action_keys, country, city_codes,
      csv_file_name, start_date, end_date, creator_id, status
    ) VALUES (
      p_name, p_team, p_sub_team, p_types, p_action_keys, p_country, p_city_codes,
      p_csv_file_name, p_start_date, p_end_date, v_user_id, v_effective_status
    )
    RETURNING id INTO v_campaign_id;
  ELSE
    UPDATE pax.campaigns SET
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

    DELETE FROM pax.campaign_schedules WHERE campaign_id = v_campaign_id;
    DELETE FROM pax.campaign_audience WHERE campaign_id = v_campaign_id;
  END IF;

  FOR v_sched IN
    SELECT (s->>'action_key')::text AS action_key,
           (s->>'schedule_date')::date AS schedule_date,
           (s->>'time_slot')::text AS time_slot,
           NULLIF(s->>'image_url', '') AS image_url
    FROM jsonb_array_elements(COALESCE(p_schedules, '[]'::jsonb)) AS s
  LOOP
    INSERT INTO pax.campaign_schedules
      (campaign_id, action_key, schedule_date, time_slot, image_url)
    VALUES
      (v_campaign_id, v_sched.action_key, v_sched.schedule_date, v_sched.time_slot, v_sched.image_url)
    ON CONFLICT (campaign_id, action_key, schedule_date) DO UPDATE SET
      time_slot = EXCLUDED.time_slot,
      image_url = EXCLUDED.image_url;
  END LOOP;

  INSERT INTO pax.campaign_audience (campaign_id, pax_id, city_code)
  SELECT v_campaign_id, (a->>'pax_id')::text, NULLIF((a->>'city_code')::text, '')::text
  FROM jsonb_array_elements(COALESCE(p_audience, '[]'::jsonb)) AS a
  ON CONFLICT (campaign_id, pax_id, city_code) DO NOTHING;

  RETURN v_campaign_id::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_campaign_pax(
  text, text, text, text[], text[], text, text[], text, date, date,
  text, jsonb, jsonb
) TO authenticated;

-- 9. Lifecycle RPCs — DRV (cancel / approve / reject / hard delete) ----
--    These already work via search_path = public and unqualified table
--    names, but after the move those unqualified names no longer resolve.
--    Recreate each with schema-qualified references.

DROP FUNCTION IF EXISTS public.cancel_campaign(uuid);
CREATE OR REPLACE FUNCTION public.cancel_campaign(p_campaign_id uuid)
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
  SET status = 'cancelled', deleted_at = now(), deleted_by = auth.uid(), updated_at = now()
  WHERE id = p_campaign_id AND creator_id = auth.uid() AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_campaign(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_campaign_pax(p_campaign_id uuid)
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
  SET status = 'cancelled', deleted_at = now(), deleted_by = auth.uid(), updated_at = now()
  WHERE id = p_campaign_id AND creator_id = auth.uid() AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_campaign_pax(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.approve_campaign(uuid);
CREATE OR REPLACE FUNCTION public.approve_campaign(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, drv
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  UPDATE drv.campaigns
  SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  WHERE id = p_campaign_id AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_campaign(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_campaign_pax(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pax
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  UPDATE pax.campaigns
  SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  WHERE id = p_campaign_id AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_campaign_pax(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.reject_campaign(uuid);
CREATE OR REPLACE FUNCTION public.reject_campaign(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, drv
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  UPDATE drv.campaigns
  SET status = 'rejected', updated_at = now()
  WHERE id = p_campaign_id AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reject_campaign(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_campaign_pax(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pax
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  UPDATE pax.campaigns
  SET status = 'rejected', updated_at = now()
  WHERE id = p_campaign_id AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reject_campaign_pax(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.delete_campaign_hard(uuid);
CREATE OR REPLACE FUNCTION public.delete_campaign_hard(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, drv
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

  DELETE FROM drv.campaign_audience WHERE campaign_id = p_campaign_id;
  DELETE FROM drv.campaign_schedules WHERE campaign_id = p_campaign_id;
  DELETE FROM drv.campaigns WHERE id = p_campaign_id RETURNING true INTO v_deleted;

  RETURN COALESCE(v_deleted, false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_campaign_hard(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_campaign_hard_pax(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pax
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

  DELETE FROM pax.campaign_audience WHERE campaign_id = p_campaign_id;
  DELETE FROM pax.campaign_schedules WHERE campaign_id = p_campaign_id;
  DELETE FROM pax.campaigns WHERE id = p_campaign_id RETURNING true INTO v_deleted;

  RETURN COALESCE(v_deleted, false);
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_campaign_hard_pax(uuid) TO authenticated;

-- 10. Slot availability v2 — DRV + PAX -------------------------------
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
SECURITY DEFINER
SET search_path = public, drv
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
            FROM drv.campaign_audience ca
            JOIN drv.campaign_schedules cs ON cs.campaign_id = ca.campaign_id
            JOIN drv.campaigns c ON c.id = cs.campaign_id
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
            FROM drv.campaign_audience ca
            JOIN drv.campaign_schedules cs ON cs.campaign_id = ca.campaign_id
            JOIN drv.campaigns c ON c.id = cs.campaign_id
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
        FROM drv.campaign_schedules cs2
        JOIN drv.campaigns c2 ON c2.id = cs2.campaign_id
        WHERE cs2.schedule_date = v_loop_date
          AND cs2.action_key = v_loop_action_key
          AND c2.country = p_country
          AND c2.status IN ('approved', 'pending')
          AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c2.city_codes && p_city_codes);

        SELECT EXISTS (
          SELECT 1
          FROM drv.campaign_schedules cs2
          JOIN drv.campaigns c2 ON c2.id = cs2.campaign_id
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
              SELECT 1 FROM drv.campaign_audience ca2
              WHERE ca2.campaign_id = cs2.campaign_id
                AND ca2.drv_id = ANY(p_drv_ids)
            )
        ) INTO v_has_approved_conflict;

        SELECT EXISTS (
          SELECT 1
          FROM drv.campaign_schedules cs2
          JOIN drv.campaigns c2 ON c2.id = cs2.campaign_id
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
              SELECT 1 FROM drv.campaign_audience ca2
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

GRANT EXECUTE ON FUNCTION public.get_slot_availability_v2(
  text, text[], date, date, text[], text[]
) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_slot_availability_v2_pax(
  p_country text,
  p_city_codes text[],
  p_start_date date,
  p_end_date date,
  p_action_keys text[],
  p_pax_ids text[]
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
SECURITY DEFINER
SET search_path = public, pax
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
  v_pax_with_limit bigint;
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

      v_pax_with_limit := 0;
      v_day_lock := false;
      v_day_lock_msg := NULL;

      IF v_per_limit > 0 AND p_pax_ids IS NOT NULL AND array_length(p_pax_ids, 1) > 0 THEN
        IF v_is_push_channel THEN
          SELECT COUNT(*) INTO v_pax_with_limit
          FROM (
            SELECT ca.pax_id
            FROM pax.campaign_audience ca
            JOIN pax.campaign_schedules cs ON cs.campaign_id = ca.campaign_id
            JOIN pax.campaigns c ON c.id = cs.campaign_id
            WHERE ca.pax_id = ANY(p_pax_ids)
              AND cs.action_key IN ('Push in/out', 'Push in', 'Push out')
              AND cs.schedule_date = v_loop_date
              AND c.country = p_country
              AND c.status IN ('approved', 'pending')
              AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c.city_codes && p_city_codes)
            GROUP BY ca.pax_id
            HAVING COUNT(*) >= v_per_limit
          ) sub;
        ELSE
          SELECT COUNT(*) INTO v_pax_with_limit
          FROM (
            SELECT ca.pax_id
            FROM pax.campaign_audience ca
            JOIN pax.campaign_schedules cs ON cs.campaign_id = ca.campaign_id
            JOIN pax.campaigns c ON c.id = cs.campaign_id
            WHERE ca.pax_id = ANY(p_pax_ids)
              AND cs.action_key = v_loop_action_key
              AND cs.schedule_date = v_loop_date
              AND c.country = p_country
              AND c.status IN ('approved', 'pending')
              AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c.city_codes && p_city_codes)
            GROUP BY ca.pax_id
            HAVING COUNT(*) >= v_per_limit
          ) sub;
        END IF;

        IF v_pax_with_limit > 0 THEN
          v_day_lock := true;
          v_day_lock_msg := format(
            '%s pasajero(s) del cohorte ya tienen %s+ comunicaciones de %s ese día (máx. %s)',
            v_pax_with_limit,
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
        FROM pax.campaign_schedules cs2
        JOIN pax.campaigns c2 ON c2.id = cs2.campaign_id
        WHERE cs2.schedule_date = v_loop_date
          AND cs2.action_key = v_loop_action_key
          AND c2.country = p_country
          AND c2.status IN ('approved', 'pending')
          AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c2.city_codes && p_city_codes);

        SELECT EXISTS (
          SELECT 1
          FROM pax.campaign_schedules cs2
          JOIN pax.campaigns c2 ON c2.id = cs2.campaign_id
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
              SELECT 1 FROM pax.campaign_audience ca2
              WHERE ca2.campaign_id = cs2.campaign_id
                AND ca2.pax_id = ANY(p_pax_ids)
            )
        ) INTO v_has_approved_conflict;

        SELECT EXISTS (
          SELECT 1
          FROM pax.campaign_schedules cs2
          JOIN pax.campaigns c2 ON c2.id = cs2.campaign_id
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
              SELECT 1 FROM pax.campaign_audience ca2
              WHERE ca2.campaign_id = cs2.campaign_id
                AND ca2.pax_id = ANY(p_pax_ids)
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
        conflicting_drivers := v_pax_with_limit;
        total_schedules := v_slot_total;
        RETURN NEXT;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_slot_availability_v2_pax(
  text, text[], date, date, text[], text[]
) TO authenticated;

-- 11. check_cohort_conflicts — DRV + PAX ------------------------------
-- The DRV version stays with the same signature so the analytics RPC
-- can call it unchanged. The PAX version uses pax_id / pax.campaign_audience.

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
SET search_path = public, drv
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
  FROM drv.campaign_audience ca
  JOIN drv.campaigns c ON c.id = ca.campaign_id
  JOIN drv.campaign_schedules cs ON cs.campaign_id = ca.campaign_id
  WHERE
    ca.drv_id = ANY(p_drv_ids)
    AND c.country = p_country
    AND cs.schedule_date BETWEEN p_start_date AND p_end_date
  GROUP BY cs.campaign_id, c.name, cs.schedule_date, cs.time_slot, cs.action_key
  ORDER BY conflicting_drv_count DESC, cs.schedule_date ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_cohort_conflicts(
  text[], text, date, date
) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_cohort_conflicts_pax(
  p_pax_ids text[],
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
  conflicting_pax_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pax
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cs.campaign_id,
    c.name::text AS campaign_name,
    cs.schedule_date,
    cs.time_slot::text AS time_slot,
    cs.action_key::text AS action_key,
    COUNT(DISTINCT ca.pax_id) AS conflicting_pax_count
  FROM pax.campaign_audience ca
  JOIN pax.campaigns c ON c.id = ca.campaign_id
  JOIN pax.campaign_schedules cs ON cs.campaign_id = ca.campaign_id
  WHERE
    ca.pax_id = ANY(p_pax_ids)
    AND c.country = p_country
    AND cs.schedule_date BETWEEN p_start_date AND p_end_date
  GROUP BY cs.campaign_id, c.name, cs.schedule_date, cs.time_slot, cs.action_key
  ORDER BY conflicting_pax_count DESC, cs.schedule_date ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_cohort_conflicts_pax(
  text[], text, date, date
) TO authenticated;

-- 12. Analytics aggregates — DRV + PAX --------------------------------
-- Mirrors migration 00023 for pax. DRV version already exists from 00026.

CREATE OR REPLACE FUNCTION public.get_analytics_aggregates_pax(
  p_country text DEFAULT NULL,
  p_channel text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pax
AS $$
DECLARE
  v_is_admin boolean;
  v_result jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  WITH
  active_camps AS (
    SELECT id, name, team, country, city_codes
    FROM pax.campaigns c
    WHERE status NOT IN ('rejected', 'cancelled')
      AND (p_country IS NULL OR p_country = 'all' OR country = p_country)
      AND (
        p_channel IS NULL OR p_channel = 'all'
        OR EXISTS (
          SELECT 1 FROM pax.campaign_schedules cs
          WHERE cs.campaign_id = c.id AND cs.action_key = p_channel
        )
      )
  ),
  filtered_schedules AS (
    SELECT cs.id, cs.campaign_id, cs.action_key, cs.schedule_date
    FROM pax.campaign_schedules cs
    JOIN active_camps ac ON ac.id = cs.campaign_id
    WHERE (p_channel IS NULL OR p_channel = 'all' OR cs.action_key = p_channel)
  ),
  active_audience AS (
    SELECT ca.campaign_id, ca.pax_id, ca.city_code, ac.country AS camp_country
    FROM pax.campaign_audience ca
    JOIN active_camps ac ON ac.id = ca.campaign_id
  ),
  per_camp_drivers AS (
    SELECT campaign_id, COUNT(DISTINCT pax_id) AS drivers
    FROM active_audience
    GROUP BY campaign_id
  ),
  drivers_by_country AS (
    SELECT camp_country AS country, COUNT(DISTINCT pax_id) AS cnt
    FROM active_audience
    GROUP BY camp_country
    ORDER BY cnt DESC
  ),
  drivers_by_city AS (
    SELECT city_code, camp_country AS country, COUNT(DISTINCT pax_id) AS cnt
    FROM active_audience
    WHERE city_code IS NOT NULL
    GROUP BY city_code, camp_country
    ORDER BY cnt DESC
    LIMIT 50
  ),
  camps_by_country AS (
    SELECT ac.country,
           COUNT(DISTINCT ac.id) AS campaign_count,
           COUNT(DISTINCT fs.id) AS comm_count,
           COUNT(DISTINCT ca.pax_id) AS driver_count
    FROM active_camps ac
    LEFT JOIN filtered_schedules fs ON fs.campaign_id = ac.id
    LEFT JOIN active_audience ca ON ca.campaign_id = ac.id
    GROUP BY ac.country
    ORDER BY campaign_count DESC
  ),
  camps_by_city AS (
    SELECT unnested_city AS city_code, ac.country,
           COUNT(DISTINCT ac.id) AS campaign_count,
           COUNT(DISTINCT ca.pax_id) AS driver_count
    FROM active_camps ac
    CROSS JOIN LATERAL unnest(ac.city_codes) AS unnested_city
    LEFT JOIN active_audience ca ON ca.campaign_id = ac.id
    GROUP BY unnested_city, ac.country
    ORDER BY campaign_count DESC
    LIMIT 50
  ),
  top_drivers AS (
    SELECT drv_id, total_comms AS count, channels, campaigns
    FROM (
      SELECT ca.pax_id AS drv_id,
             COUNT(*) AS total_comms,
             array_agg(DISTINCT fs.action_key) FILTER (WHERE fs.action_key IS NOT NULL) AS channels,
             array_agg(DISTINCT ac.name) AS campaigns
      FROM active_audience ca
      JOIN active_camps ac ON ac.id = ca.campaign_id
      LEFT JOIN filtered_schedules fs ON fs.campaign_id = ca.campaign_id
      GROUP BY ca.pax_id
    ) x
    ORDER BY total_comms DESC
    LIMIT 10
  ),
  per_camp_drv_list AS (
    SELECT campaign_id, drivers FROM per_camp_drivers
  )
  SELECT jsonb_build_object(
    'kpis', jsonb_build_object(
      'total_comms',     (SELECT COUNT(*) FROM filtered_schedules),
      'total_drivers',   (SELECT COUNT(DISTINCT pax_id) FROM active_audience),
      'total_campaigns', (SELECT COUNT(DISTINCT campaign_id) FROM filtered_schedules),
      'total_countries', (SELECT COUNT(DISTINCT country) FROM active_camps),
      'total_cities',    (
        SELECT COUNT(DISTINCT city)
        FROM (SELECT unnest(city_codes) AS city FROM active_camps) x
        WHERE city IS NOT NULL
      ),
      'total_days',      (SELECT COUNT(DISTINCT schedule_date) FROM filtered_schedules)
    ),
    'top_drivers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'drv_id', drv_id, 'count', count,
        'channels',  to_jsonb(COALESCE(channels, '{}'::text[])),
        'campaigns', to_jsonb(COALESCE(campaigns, '{}'::text[]))
      ) ORDER BY count DESC)
      FROM top_drivers
    ), '[]'::jsonb),
    'drivers_by_country', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('country', country, 'count', cnt))
      FROM drivers_by_country
    ), '[]'::jsonb),
    'drivers_by_city', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('city', city_code, 'country', country, 'count', cnt))
      FROM drivers_by_city
    ), '[]'::jsonb),
    'campaigns_by_country', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'country', country, 'campaigns', campaign_count,
        'comms', comm_count, 'drivers', driver_count
      ))
      FROM camps_by_country
    ), '[]'::jsonb),
    'campaigns_by_city', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'city', city_code, 'country', country,
        'campaigns', campaign_count, 'drivers', driver_count
      ))
      FROM camps_by_city
    ), '[]'::jsonb),
    'per_campaign_drivers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('campaign_id', campaign_id, 'drivers', drivers))
      FROM per_camp_drv_list
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_analytics_aggregates_pax(text, text) TO authenticated;

-- 13. Expose drv + pax to PostgREST -----------------------------------
DO $$
BEGIN
  EXECUTE format(
    'ALTER ROLE authenticator SET pgrst.db_schemas = %L',
    current_setting('pgrst.db_schemas', true)
  );
EXCEPTION WHEN OTHERS THEN
  -- pgrst setting may not exist on this server; ignore silently.
  NULL;
END $$;

-- Force PostgREST to reload its schema cache.
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';