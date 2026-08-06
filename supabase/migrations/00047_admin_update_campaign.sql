-- ============================================================
-- Migration 00047: el admin edita una campaña existente
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- Permite a un admin (con alcance de plataforma) cambiar nombre, equipo,
-- tipos, canales, país, ciudades, fechas y horarios de una campaña ya creada.
-- El cohorte (audiencia) NO se toca: para cambiar el público se crea otra.
--
-- Al guardar se re-valida como en la creación: si el nuevo horario/canal choca
-- con otra campaña (>50% del cohorte) pasa a 'pending'; si no, 'approved'. Un
-- día bloqueado (3+ push al mismo conductor) aborta la edición entera (la
-- función es atómica, así que nada cambia). No hay regla push->pending (00045).
--
-- Los tres chequeos usan la audiencia de la propia campaña como cohorte y se
-- excluyen a sí misma (oc.id <> p_campaign_id), igual que finalize.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_campaign(
  p_campaign_id uuid, p_name text, p_team text, p_sub_team text,
  p_types text[], p_action_keys text[], p_country text, p_city_codes text[],
  p_start_date date, p_end_date date, p_schedules jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'drv'
AS $function$
DECLARE
  c record; v_sched record; v_has_push boolean;
  v_lock boolean; v_overlap boolean; v_conflicts boolean; v_status text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_platform_admin(auth.uid(), 'drv') THEN RAISE EXCEPTION 'Admin only'; END IF;

  UPDATE drv.campaigns SET
    name = p_name, team = p_team, sub_team = p_sub_team, types = p_types,
    action_keys = p_action_keys, country = p_country, city_codes = p_city_codes,
    start_date = p_start_date, end_date = p_end_date, updated_at = now()
  WHERE id = p_campaign_id AND deleted_at IS NULL;

  IF NOT FOUND THEN RAISE EXCEPTION 'Campaña no encontrada'; END IF;

  DELETE FROM drv.campaign_schedules WHERE campaign_id = p_campaign_id;
  FOR v_sched IN
    SELECT (s->>'action_key')::text AS action_key,
           (s->>'schedule_date')::date AS schedule_date,
           (s->>'time_slot')::text AS time_slot,
           NULLIF(s->>'image_url', '') AS image_url
    FROM jsonb_array_elements(COALESCE(p_schedules, '[]'::jsonb)) AS s
  LOOP
    INSERT INTO drv.campaign_schedules
      (campaign_id, action_key, schedule_date, time_slot, image_url)
    VALUES (p_campaign_id, v_sched.action_key, v_sched.schedule_date,
            v_sched.time_slot, v_sched.image_url)
    ON CONFLICT (campaign_id, action_key, schedule_date) DO UPDATE SET
      time_slot = EXCLUDED.time_slot, image_url = EXCLUDED.image_url;
  END LOOP;

  SELECT * INTO c FROM drv.campaigns WHERE id = p_campaign_id;
  v_has_push := (c.action_keys && ARRAY['Push in/out', 'Push in', 'Push out']);

  IF v_has_push THEN
    WITH ya_saturados AS MATERIALIZED (
      SELECT otro.drv_id, cs.schedule_date
      FROM drv.campaign_audience otro
      JOIN drv.campaign_schedules cs ON cs.campaign_id = otro.campaign_id
      JOIN drv.campaigns oc ON oc.id = otro.campaign_id
      WHERE oc.country = c.country AND oc.status IN ('approved', 'pending')
        AND oc.id <> p_campaign_id
        AND cs.action_key IN ('Push in/out', 'Push in', 'Push out')
        AND cs.schedule_date BETWEEN COALESCE(c.start_date, CURRENT_DATE)
                                 AND COALESCE(c.end_date, CURRENT_DATE)
      GROUP BY otro.drv_id, cs.schedule_date HAVING COUNT(*) >= 3
    )
    SELECT EXISTS (
      SELECT 1 FROM ya_saturados s
      JOIN drv.campaign_audience mia
        ON mia.campaign_id = p_campaign_id AND mia.drv_id = s.drv_id
    ) INTO v_lock;
  ELSE v_lock := false; END IF;

  SELECT EXISTS (
    SELECT 1 FROM drv.campaign_schedules cs
    JOIN drv.campaigns oc ON oc.id = cs.campaign_id
    WHERE oc.country = c.country AND oc.status IN ('approved', 'pending')
      AND oc.id <> p_campaign_id
      AND cs.schedule_date BETWEEN COALESCE(c.start_date, CURRENT_DATE)
                               AND COALESCE(c.end_date, CURRENT_DATE)
      AND cs.action_key = ANY(c.action_keys)
      AND (
        cs.time_slot IN ('FULL_DAY', '07:00-22:00', '06:00-22:00')
        OR EXISTS (
          SELECT 1 FROM drv.campaign_schedules mis
          WHERE mis.campaign_id = p_campaign_id
            AND mis.action_key = cs.action_key
            AND mis.schedule_date = cs.schedule_date
            AND ABS(public.time_slot_start_minutes(cs.time_slot) -
                    public.time_slot_start_minutes(mis.time_slot)) < 60
        )
      )
      AND EXISTS (
        SELECT 1 FROM drv.campaign_audience otro
        JOIN drv.campaign_audience mia
          ON mia.campaign_id = p_campaign_id AND mia.drv_id = otro.drv_id
        WHERE otro.campaign_id = cs.campaign_id
      )
  ) INTO v_overlap;

  SELECT EXISTS (
    SELECT 1 FROM drv.campaign_audience otro
    JOIN drv.campaigns oc ON oc.id = otro.campaign_id
    JOIN drv.campaign_schedules cs ON cs.campaign_id = otro.campaign_id
    WHERE oc.country = c.country AND oc.id <> p_campaign_id
      AND oc.status <> 'draft'
      AND cs.schedule_date BETWEEN COALESCE(c.start_date, CURRENT_DATE)
                               AND COALESCE(c.end_date, CURRENT_DATE)
      AND EXISTS (
        SELECT 1 FROM drv.campaign_audience mia
        WHERE mia.campaign_id = p_campaign_id AND mia.drv_id = otro.drv_id
      )
  ) INTO v_conflicts;

  IF v_lock THEN
    RAISE EXCEPTION 'No se puede editar: algunos conductores quedarían con 3+ comunicaciones push ese día. Día bloqueado.';
  ELSIF v_conflicts OR v_overlap THEN v_status := 'pending';
  ELSE v_status := 'approved';
  END IF;

  UPDATE drv.campaigns SET status = v_status WHERE id = p_campaign_id;
  RETURN v_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_campaign_pax(
  p_campaign_id uuid, p_name text, p_team text, p_sub_team text,
  p_types text[], p_action_keys text[], p_country text, p_city_codes text[],
  p_start_date date, p_end_date date, p_schedules jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pax'
AS $function$
DECLARE
  c record; v_sched record; v_has_push boolean;
  v_lock boolean; v_overlap boolean; v_conflicts boolean; v_status text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_platform_admin(auth.uid(), 'pax') THEN RAISE EXCEPTION 'Admin only'; END IF;

  UPDATE pax.campaigns SET
    name = p_name, team = p_team, sub_team = p_sub_team, types = p_types,
    action_keys = p_action_keys, country = p_country, city_codes = p_city_codes,
    start_date = p_start_date, end_date = p_end_date, updated_at = now()
  WHERE id = p_campaign_id AND deleted_at IS NULL;

  IF NOT FOUND THEN RAISE EXCEPTION 'Campaña no encontrada'; END IF;

  DELETE FROM pax.campaign_schedules WHERE campaign_id = p_campaign_id;
  FOR v_sched IN
    SELECT (s->>'action_key')::text AS action_key,
           (s->>'schedule_date')::date AS schedule_date,
           (s->>'time_slot')::text AS time_slot,
           NULLIF(s->>'image_url', '') AS image_url
    FROM jsonb_array_elements(COALESCE(p_schedules, '[]'::jsonb)) AS s
  LOOP
    INSERT INTO pax.campaign_schedules
      (campaign_id, action_key, schedule_date, time_slot, image_url)
    VALUES (p_campaign_id, v_sched.action_key, v_sched.schedule_date,
            v_sched.time_slot, v_sched.image_url)
    ON CONFLICT (campaign_id, action_key, schedule_date) DO UPDATE SET
      time_slot = EXCLUDED.time_slot, image_url = EXCLUDED.image_url;
  END LOOP;

  SELECT * INTO c FROM pax.campaigns WHERE id = p_campaign_id;
  v_has_push := (c.action_keys && ARRAY['Push in/out', 'Push in', 'Push out']);

  IF v_has_push THEN
    WITH ya_saturados AS MATERIALIZED (
      SELECT otro.pax_id, cs.schedule_date
      FROM pax.campaign_audience otro
      JOIN pax.campaign_schedules cs ON cs.campaign_id = otro.campaign_id
      JOIN pax.campaigns oc ON oc.id = otro.campaign_id
      WHERE oc.country = c.country AND oc.status IN ('approved', 'pending')
        AND oc.id <> p_campaign_id
        AND cs.action_key IN ('Push in/out', 'Push in', 'Push out')
        AND cs.schedule_date BETWEEN COALESCE(c.start_date, CURRENT_DATE)
                                 AND COALESCE(c.end_date, CURRENT_DATE)
      GROUP BY otro.pax_id, cs.schedule_date HAVING COUNT(*) >= 3
    )
    SELECT EXISTS (
      SELECT 1 FROM ya_saturados s
      JOIN pax.campaign_audience mia
        ON mia.campaign_id = p_campaign_id AND mia.pax_id = s.pax_id
    ) INTO v_lock;
  ELSE v_lock := false; END IF;

  SELECT EXISTS (
    SELECT 1 FROM pax.campaign_schedules cs
    JOIN pax.campaigns oc ON oc.id = cs.campaign_id
    WHERE oc.country = c.country AND oc.status IN ('approved', 'pending')
      AND oc.id <> p_campaign_id
      AND cs.schedule_date BETWEEN COALESCE(c.start_date, CURRENT_DATE)
                               AND COALESCE(c.end_date, CURRENT_DATE)
      AND cs.action_key = ANY(c.action_keys)
      AND (
        cs.time_slot IN ('FULL_DAY', '07:00-22:00', '06:00-22:00')
        OR EXISTS (
          SELECT 1 FROM pax.campaign_schedules mis
          WHERE mis.campaign_id = p_campaign_id
            AND mis.action_key = cs.action_key
            AND mis.schedule_date = cs.schedule_date
            AND ABS(public.time_slot_start_minutes(cs.time_slot) -
                    public.time_slot_start_minutes(mis.time_slot)) < 60
        )
      )
      AND EXISTS (
        SELECT 1 FROM pax.campaign_audience otro
        JOIN pax.campaign_audience mia
          ON mia.campaign_id = p_campaign_id AND mia.pax_id = otro.pax_id
        WHERE otro.campaign_id = cs.campaign_id
      )
  ) INTO v_overlap;

  SELECT EXISTS (
    SELECT 1 FROM pax.campaign_audience otro
    JOIN pax.campaigns oc ON oc.id = otro.campaign_id
    JOIN pax.campaign_schedules cs ON cs.campaign_id = otro.campaign_id
    WHERE oc.country = c.country AND oc.id <> p_campaign_id
      AND oc.status <> 'draft'
      AND cs.schedule_date BETWEEN COALESCE(c.start_date, CURRENT_DATE)
                               AND COALESCE(c.end_date, CURRENT_DATE)
      AND EXISTS (
        SELECT 1 FROM pax.campaign_audience mia
        WHERE mia.campaign_id = p_campaign_id AND mia.pax_id = otro.pax_id
      )
  ) INTO v_conflicts;

  IF v_lock THEN
    RAISE EXCEPTION 'No se puede editar: algunos usuarios quedarían con 3+ comunicaciones push ese día. Día bloqueado.';
  ELSIF v_conflicts OR v_overlap THEN v_status := 'pending';
  ELSE v_status := 'approved';
  END IF;

  UPDATE pax.campaigns SET status = v_status WHERE id = p_campaign_id;
  RETURN v_status;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.update_campaign(uuid,text,text,text,text[],text[],text,text[],date,date,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_campaign_pax(uuid,text,text,text,text[],text[],text,text[],date,date,jsonb) TO authenticated;
