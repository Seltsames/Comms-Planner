-- ============================================================
-- Migration 00015: Campaign lifecycle management
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- Adds soft-delete columns, new status values, RPCs for
-- cancel/approve/reject/delete, and auto-approve on save.
-- ============================================================

-- 1. Soft-delete columns on campaigns
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

-- 2. RLS: users can see their own non-deleted campaigns
DROP POLICY IF EXISTS "Users can view own campaigns" ON public.campaigns;
CREATE POLICY "Users can view own campaigns" ON public.campaigns
  FOR SELECT TO authenticated
  USING (
    creator_id = auth.uid()
    AND (deleted_at IS NULL)
  );

-- 3. RLS: users can update their own non-deleted campaigns (for cancel)
DROP POLICY IF EXISTS "Users can update own campaigns" ON public.campaigns;
CREATE POLICY "Users can update own campaigns" ON public.campaigns
  FOR UPDATE TO authenticated
  USING (
    creator_id = auth.uid()
    AND deleted_at IS NULL
  )
  WITH CHECK (
    creator_id = auth.uid()
    AND deleted_at IS NULL
  );

-- 4. RLS: admins can see all non-deleted campaigns
DROP POLICY IF EXISTS "Admins can view all campaigns" ON public.campaigns;
CREATE POLICY "Admins can view all campaigns" ON public.campaigns
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    AND deleted_at IS NULL
  );

-- 5. RLS: admins can hard-delete any campaign
DROP POLICY IF EXISTS "Admins can delete campaigns" ON public.campaigns;
CREATE POLICY "Admins can delete campaigns" ON public.campaigns
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 6. RPC: cancel_campaign — user soft-delete (sets status='cancelled', deleted_at=now)
CREATE OR REPLACE FUNCTION public.cancel_campaign(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.campaigns
  SET
    status = 'cancelled',
    deleted_at = now(),
    deleted_by = auth.uid(),
    updated_at = now()
  WHERE id = p_campaign_id
    AND creator_id = auth.uid()
    AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_campaign(uuid) TO authenticated;

-- 7. RPC: approve_campaign — admin sets status='approved'
CREATE OR REPLACE FUNCTION public.approve_campaign(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  UPDATE public.campaigns
  SET
    status = 'approved',
    approved_by = auth.uid(),
    approved_at = now(),
    updated_at = now()
  WHERE id = p_campaign_id
    AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_campaign(uuid) TO authenticated;

-- 8. RPC: reject_campaign — admin sets status='rejected'
CREATE OR REPLACE FUNCTION public.reject_campaign(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  UPDATE public.campaigns
  SET
    status = 'rejected',
    updated_at = now()
  WHERE id = p_campaign_id
    AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_campaign(uuid) TO authenticated;

-- 9. RPC: delete_campaign_hard — admin hard delete (cascades to schedules + audience)
CREATE OR REPLACE FUNCTION public.delete_campaign_hard(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM public.campaign_audience WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_schedules WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaigns WHERE id = p_campaign_id;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_campaign_hard(uuid) TO authenticated;

-- 10. Update save_campaign_v2 to auto-approve when no conflicts exist
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
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT (a->>'drv_id')::text
    FROM jsonb_array_elements(COALESCE(p_audience, '[]'::jsonb)) a
  INTO v_drv_ids;

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
  ELSIF v_has_conflicts THEN
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