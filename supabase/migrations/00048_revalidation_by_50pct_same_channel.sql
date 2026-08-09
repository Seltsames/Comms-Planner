-- ============================================================
-- Migration 00048: re-validación de estado por >50% con choque de mismo canal
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- PROBLEMA: finalize_campaign_upload y update_campaign decidían pending/approved
-- con dos chequeos ("solape mismo canal, cualquier conductor" + "conflicto de
-- cohorte, cualquier canal, cualquier conductor"). El segundo hacía un Seq Scan
-- de TODA la audiencia (1,3M filas) sondeando fila por fila. Con dos cohortes
-- de 469k en el mismo país, eso supera los 8 s de statement_timeout y guardar
-- una edición fallaba con "canceling statement due to statement timeout".
--
-- SOLUCIÓN: un solo chequeo, coherente con la regla del bloqueo de franjas
-- (00046): la campaña pasa a 'pending' sólo si alguna otra campaña que choca en
-- horario del MISMO canal (±60 min o día completo) comparte MÁS DEL 50% del
-- cohorte. Se calcula por campaña, guiado por campaign_id (usa el índice único),
-- y el filtro de canal descarta de entrada las que no comparten canal —sin
-- calcular la intersección cara—. Medido en el caso real MX 469k: 672 ms.
--
-- CAMBIO DE SEMÁNTICA: antes cualquier conductor compartido (cualquier canal)
-- mandaba a 'pending'; ahora sólo el choque de mismo canal con >50% de solape.
-- Aplica también a la creación (finalize), para que sea coherente con el bloqueo
-- de franjas. Nota: la 00049 le añade encima un filtro barato al día-bloqueado.
-- ============================================================

CREATE OR REPLACE FUNCTION public.finalize_campaign_upload(p_campaign_id uuid, p_status text DEFAULT NULL::text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'drv'
AS $function$
DECLARE
  v_user_id uuid := auth.uid(); c record;
  v_has_push boolean; v_lock boolean; v_pending boolean; v_cohort_size bigint; v_status text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO c FROM drv.campaigns
  WHERE id = p_campaign_id AND creator_id = v_user_id AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Borrador no encontrado o no pertenece al usuario'; END IF;

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
        AND cs.schedule_date BETWEEN COALESCE(c.start_date, CURRENT_DATE) AND COALESCE(c.end_date, CURRENT_DATE)
      GROUP BY otro.drv_id, cs.schedule_date HAVING COUNT(*) >= 3
    )
    SELECT EXISTS (SELECT 1 FROM ya_saturados s
      JOIN drv.campaign_audience mia ON mia.campaign_id = p_campaign_id AND mia.drv_id = s.drv_id) INTO v_lock;
  ELSE v_lock := false; END IF;

  SELECT COUNT(DISTINCT drv_id) INTO v_cohort_size FROM drv.campaign_audience WHERE campaign_id = p_campaign_id;
  SELECT EXISTS (
    SELECT 1 FROM drv.campaigns oc
    WHERE oc.country = c.country AND oc.status IN ('approved','pending') AND oc.id <> p_campaign_id
      AND EXISTS (
        SELECT 1 FROM drv.campaign_schedules ocs
        JOIN drv.campaign_schedules mis ON mis.campaign_id = p_campaign_id
          AND mis.action_key = ocs.action_key AND mis.schedule_date = ocs.schedule_date
        WHERE ocs.campaign_id = oc.id
          AND ( ocs.time_slot IN ('FULL_DAY','07:00-22:00','06:00-22:00')
             OR mis.time_slot IN ('FULL_DAY','07:00-22:00','06:00-22:00')
             OR ABS(public.time_slot_start_minutes(ocs.time_slot) -
                    public.time_slot_start_minutes(mis.time_slot)) < 60 ))
      AND ( (SELECT count(*) FROM drv.campaign_audience oa
              WHERE oa.campaign_id = oc.id
                AND EXISTS (SELECT 1 FROM drv.campaign_audience mia
                            WHERE mia.campaign_id = p_campaign_id AND mia.drv_id = oa.drv_id)
            ) * 2 > v_cohort_size )
  ) INTO v_pending;

  IF p_status IS NOT NULL THEN v_status := p_status;
  ELSIF v_lock THEN
    DELETE FROM drv.campaigns WHERE id = p_campaign_id;
    RAISE EXCEPTION 'No se puede crear la campana: algunos conductores ya tienen 3+ comunicaciones push ese dia. Dia bloqueado.';
  ELSIF v_pending THEN v_status := 'pending';
  ELSE v_status := 'approved'; END IF;

  UPDATE drv.campaigns SET status = v_status, deleted_at = NULL WHERE id = p_campaign_id;
  RETURN v_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_campaign_upload_pax(p_campaign_id uuid, p_status text DEFAULT NULL::text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pax'
AS $function$
DECLARE
  v_user_id uuid := auth.uid(); c record;
  v_has_push boolean; v_lock boolean; v_pending boolean; v_cohort_size bigint; v_status text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO c FROM pax.campaigns
  WHERE id = p_campaign_id AND creator_id = v_user_id AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Borrador no encontrado o no pertenece al usuario'; END IF;

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
        AND cs.schedule_date BETWEEN COALESCE(c.start_date, CURRENT_DATE) AND COALESCE(c.end_date, CURRENT_DATE)
      GROUP BY otro.pax_id, cs.schedule_date HAVING COUNT(*) >= 3
    )
    SELECT EXISTS (SELECT 1 FROM ya_saturados s
      JOIN pax.campaign_audience mia ON mia.campaign_id = p_campaign_id AND mia.pax_id = s.pax_id) INTO v_lock;
  ELSE v_lock := false; END IF;

  SELECT COUNT(DISTINCT pax_id) INTO v_cohort_size FROM pax.campaign_audience WHERE campaign_id = p_campaign_id;
  SELECT EXISTS (
    SELECT 1 FROM pax.campaigns oc
    WHERE oc.country = c.country AND oc.status IN ('approved','pending') AND oc.id <> p_campaign_id
      AND EXISTS (
        SELECT 1 FROM pax.campaign_schedules ocs
        JOIN pax.campaign_schedules mis ON mis.campaign_id = p_campaign_id
          AND mis.action_key = ocs.action_key AND mis.schedule_date = ocs.schedule_date
        WHERE ocs.campaign_id = oc.id
          AND ( ocs.time_slot IN ('FULL_DAY','07:00-22:00','06:00-22:00')
             OR mis.time_slot IN ('FULL_DAY','07:00-22:00','06:00-22:00')
             OR ABS(public.time_slot_start_minutes(ocs.time_slot) -
                    public.time_slot_start_minutes(mis.time_slot)) < 60 ))
      AND ( (SELECT count(*) FROM pax.campaign_audience oa
              WHERE oa.campaign_id = oc.id
                AND EXISTS (SELECT 1 FROM pax.campaign_audience mia
                            WHERE mia.campaign_id = p_campaign_id AND mia.pax_id = oa.pax_id)
            ) * 2 > v_cohort_size )
  ) INTO v_pending;

  IF p_status IS NOT NULL THEN v_status := p_status;
  ELSIF v_lock THEN
    DELETE FROM pax.campaigns WHERE id = p_campaign_id;
    RAISE EXCEPTION 'No se puede crear la campana: algunos usuarios ya tienen 3+ comunicaciones push ese dia. Dia bloqueado.';
  ELSIF v_pending THEN v_status := 'pending';
  ELSE v_status := 'approved'; END IF;

  UPDATE pax.campaigns SET status = v_status, deleted_at = NULL WHERE id = p_campaign_id;
  RETURN v_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_campaign(
  p_campaign_id uuid, p_name text, p_team text, p_sub_team text,
  p_types text[], p_action_keys text[], p_country text, p_city_codes text[],
  p_start_date date, p_end_date date, p_schedules jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'drv'
AS $function$
DECLARE
  c record; v_sched record; v_has_push boolean;
  v_lock boolean; v_pending boolean; v_cohort_size bigint; v_status text;
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
    SELECT (s->>'action_key')::text AS action_key, (s->>'schedule_date')::date AS schedule_date,
           (s->>'time_slot')::text AS time_slot, NULLIF(s->>'image_url', '') AS image_url
    FROM jsonb_array_elements(COALESCE(p_schedules, '[]'::jsonb)) AS s
  LOOP
    INSERT INTO drv.campaign_schedules (campaign_id, action_key, schedule_date, time_slot, image_url)
    VALUES (p_campaign_id, v_sched.action_key, v_sched.schedule_date, v_sched.time_slot, v_sched.image_url)
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
        AND cs.schedule_date BETWEEN COALESCE(c.start_date, CURRENT_DATE) AND COALESCE(c.end_date, CURRENT_DATE)
      GROUP BY otro.drv_id, cs.schedule_date HAVING COUNT(*) >= 3
    )
    SELECT EXISTS (SELECT 1 FROM ya_saturados s
      JOIN drv.campaign_audience mia ON mia.campaign_id = p_campaign_id AND mia.drv_id = s.drv_id) INTO v_lock;
  ELSE v_lock := false; END IF;

  SELECT COUNT(DISTINCT drv_id) INTO v_cohort_size FROM drv.campaign_audience WHERE campaign_id = p_campaign_id;
  SELECT EXISTS (
    SELECT 1 FROM drv.campaigns oc
    WHERE oc.country = c.country AND oc.status IN ('approved','pending') AND oc.id <> p_campaign_id
      AND EXISTS (
        SELECT 1 FROM drv.campaign_schedules ocs
        JOIN drv.campaign_schedules mis ON mis.campaign_id = p_campaign_id
          AND mis.action_key = ocs.action_key AND mis.schedule_date = ocs.schedule_date
        WHERE ocs.campaign_id = oc.id
          AND ( ocs.time_slot IN ('FULL_DAY','07:00-22:00','06:00-22:00')
             OR mis.time_slot IN ('FULL_DAY','07:00-22:00','06:00-22:00')
             OR ABS(public.time_slot_start_minutes(ocs.time_slot) -
                    public.time_slot_start_minutes(mis.time_slot)) < 60 ))
      AND ( (SELECT count(*) FROM drv.campaign_audience oa
              WHERE oa.campaign_id = oc.id
                AND EXISTS (SELECT 1 FROM drv.campaign_audience mia
                            WHERE mia.campaign_id = p_campaign_id AND mia.drv_id = oa.drv_id)
            ) * 2 > v_cohort_size )
  ) INTO v_pending;

  IF v_lock THEN
    RAISE EXCEPTION 'No se puede editar: algunos conductores quedarían con 3+ comunicaciones push ese día. Día bloqueado.';
  ELSIF v_pending THEN v_status := 'pending';
  ELSE v_status := 'approved'; END IF;

  UPDATE drv.campaigns SET status = v_status WHERE id = p_campaign_id;
  RETURN v_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_campaign_pax(
  p_campaign_id uuid, p_name text, p_team text, p_sub_team text,
  p_types text[], p_action_keys text[], p_country text, p_city_codes text[],
  p_start_date date, p_end_date date, p_schedules jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pax'
AS $function$
DECLARE
  c record; v_sched record; v_has_push boolean;
  v_lock boolean; v_pending boolean; v_cohort_size bigint; v_status text;
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
    SELECT (s->>'action_key')::text AS action_key, (s->>'schedule_date')::date AS schedule_date,
           (s->>'time_slot')::text AS time_slot, NULLIF(s->>'image_url', '') AS image_url
    FROM jsonb_array_elements(COALESCE(p_schedules, '[]'::jsonb)) AS s
  LOOP
    INSERT INTO pax.campaign_schedules (campaign_id, action_key, schedule_date, time_slot, image_url)
    VALUES (p_campaign_id, v_sched.action_key, v_sched.schedule_date, v_sched.time_slot, v_sched.image_url)
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
        AND cs.schedule_date BETWEEN COALESCE(c.start_date, CURRENT_DATE) AND COALESCE(c.end_date, CURRENT_DATE)
      GROUP BY otro.pax_id, cs.schedule_date HAVING COUNT(*) >= 3
    )
    SELECT EXISTS (SELECT 1 FROM ya_saturados s
      JOIN pax.campaign_audience mia ON mia.campaign_id = p_campaign_id AND mia.pax_id = s.pax_id) INTO v_lock;
  ELSE v_lock := false; END IF;

  SELECT COUNT(DISTINCT pax_id) INTO v_cohort_size FROM pax.campaign_audience WHERE campaign_id = p_campaign_id;
  SELECT EXISTS (
    SELECT 1 FROM pax.campaigns oc
    WHERE oc.country = c.country AND oc.status IN ('approved','pending') AND oc.id <> p_campaign_id
      AND EXISTS (
        SELECT 1 FROM pax.campaign_schedules ocs
        JOIN pax.campaign_schedules mis ON mis.campaign_id = p_campaign_id
          AND mis.action_key = ocs.action_key AND mis.schedule_date = ocs.schedule_date
        WHERE ocs.campaign_id = oc.id
          AND ( ocs.time_slot IN ('FULL_DAY','07:00-22:00','06:00-22:00')
             OR mis.time_slot IN ('FULL_DAY','07:00-22:00','06:00-22:00')
             OR ABS(public.time_slot_start_minutes(ocs.time_slot) -
                    public.time_slot_start_minutes(mis.time_slot)) < 60 ))
      AND ( (SELECT count(*) FROM pax.campaign_audience oa
              WHERE oa.campaign_id = oc.id
                AND EXISTS (SELECT 1 FROM pax.campaign_audience mia
                            WHERE mia.campaign_id = p_campaign_id AND mia.pax_id = oa.pax_id)
            ) * 2 > v_cohort_size )
  ) INTO v_pending;

  IF v_lock THEN
    RAISE EXCEPTION 'No se puede editar: algunos usuarios quedarían con 3+ comunicaciones push ese día. Día bloqueado.';
  ELSIF v_pending THEN v_status := 'pending';
  ELSE v_status := 'approved'; END IF;

  UPDATE pax.campaigns SET status = v_status WHERE id = p_campaign_id;
  RETURN v_status;
END;
$function$;
