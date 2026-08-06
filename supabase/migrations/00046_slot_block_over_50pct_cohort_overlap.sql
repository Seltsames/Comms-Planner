-- ============================================================
-- Migration 00046: bloquear franja si otra campaña que solapa en tiempo
-- cubre >50% del cohorte que se está creando
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- Antes: una franja salía 'red' (no seleccionable) si compartía UN solo
-- conductor con una campaña que solapara en tiempo. Demasiado estricto.
--
-- Ahora: la franja se bloquea sólo si alguna campaña que choca en horario
-- (±60 min, o día completo) comparte MÁS DEL 50% del cohorte que estoy
-- creando —|intersección| / |mi_cohorte| > 0,5 para esa campaña—. Un solape
-- parcial (>0 y ≤50%) queda 'yellow': aviso pero SÍ seleccionable. Sin
-- solape: 'green'. En el Builder 'red' ya es no seleccionable, así que
-- "sólo se muestran los disponibles" se cumple solo.
--
-- El solape de audiencia NO depende de la franja, así que se calcula una vez
-- por (fecha, canal): para cada campaña existente, cuántos de mis conductores
-- comparte y a qué hora está. El bucle de franjas sólo compara cercanía
-- horaria. Así el costo no se multiplica por las 31 franjas (medido: cohorte
-- de 469k, 1 día 1 canal = 27 ms).
--
-- El día bloqueado (3+ push / 2+ whatsapp al mismo conductor) se conserva
-- igual: es una regla aparte que el usuario no pidió cambiar.
--
-- TRIGGER y FULL_DAY: time_slot_start_minutes devuelve NULL (verificado), así
-- que un trigger nunca bloquea franjas (no tiene ventana). FULL_DAY se trata
-- como -1 = choca con todas las franjas del día.
--
-- Interpretación de "50% del cohorte": el cohorte que se está creando. Si se
-- quisiera relativo a la otra campaña, cambiar el denominador (v_cohort_size).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_slot_availability_by_cohort(
  p_country text, p_city_codes text[], p_start_date date, p_end_date date,
  p_action_keys text[], p_cohort_id uuid)
RETURNS TABLE(action_key text, schedule_date date, time_slot text, severity text,
              day_locked boolean, day_lock_reason text,
              conflicting_drivers bigint, total_schedules bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'drv'
AS $function$
DECLARE
  v_loop_date date; v_loop_action_key text; v_loop_time_slot text;
  v_slots text[] := ARRAY[
    '07:00','07:30','08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30',
    '13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00','18:30',
    '19:00','19:30','20:00','20:30','21:00','21:30','22:00'];
  v_per_limit integer; v_is_push_channel boolean;
  v_day_lock boolean := false; v_day_lock_msg text;
  v_drivers_with_limit bigint; v_slot_total bigint;
  v_cohort_size bigint;
  v_starts int[]; v_overlaps bigint[]; v_i int;
  v_slot_min integer; v_blocked boolean; v_partial boolean;
  v_result_severity text;
BEGIN
  -- Tamaño del cohorte que se está creando (constante en toda la llamada).
  SELECT COUNT(DISTINCT drv_id) INTO v_cohort_size
  FROM drv.campaign_audience WHERE campaign_id = p_cohort_id;

  FOR v_loop_date IN SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date LOOP
    FOREACH v_loop_action_key IN ARRAY p_action_keys LOOP
      v_per_limit := CASE
        WHEN v_loop_action_key IN ('Push in/out','Push in','Push out') THEN 3
        WHEN v_loop_action_key = 'Whatsapp' THEN 2 ELSE 0 END;
      v_is_push_channel := v_loop_action_key IN ('Push in/out','Push in','Push out');
      v_drivers_with_limit := 0; v_day_lock := false; v_day_lock_msg := NULL;

      -- Día bloqueado por límite por canal (sin cambios).
      IF v_per_limit > 0 AND p_cohort_id IS NOT NULL THEN
        IF v_is_push_channel THEN
          SELECT COUNT(*) INTO v_drivers_with_limit FROM (
            SELECT ca.drv_id
            FROM drv.campaign_audience ca
            JOIN drv.campaign_schedules cs ON cs.campaign_id = ca.campaign_id
            JOIN drv.campaigns c ON c.id = cs.campaign_id
            WHERE EXISTS (SELECT 1 FROM drv.campaign_audience mia_c WHERE mia_c.campaign_id = p_cohort_id AND mia_c.drv_id = ca.drv_id)
              AND cs.action_key IN ('Push in/out','Push in','Push out')
              AND cs.schedule_date = v_loop_date AND c.country = p_country
              AND c.status IN ('approved','pending') AND c.id <> p_cohort_id
              AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c.city_codes && p_city_codes)
            GROUP BY ca.drv_id HAVING COUNT(*) >= v_per_limit) sub;
        ELSE
          SELECT COUNT(*) INTO v_drivers_with_limit FROM (
            SELECT ca.drv_id
            FROM drv.campaign_audience ca
            JOIN drv.campaign_schedules cs ON cs.campaign_id = ca.campaign_id
            JOIN drv.campaigns c ON c.id = cs.campaign_id
            WHERE EXISTS (SELECT 1 FROM drv.campaign_audience mia_c WHERE mia_c.campaign_id = p_cohort_id AND mia_c.drv_id = ca.drv_id)
              AND cs.action_key = v_loop_action_key
              AND cs.schedule_date = v_loop_date AND c.country = p_country
              AND c.status IN ('approved','pending') AND c.id <> p_cohort_id
              AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c.city_codes && p_city_codes)
            GROUP BY ca.drv_id HAVING COUNT(*) >= v_per_limit) sub;
        END IF;
        IF v_drivers_with_limit > 0 THEN
          v_day_lock := true;
          v_day_lock_msg := format(
            '%s conductor(es) del cohorte ya tienen %s+ comunicaciones de %s ese día (máx. %s)',
            v_drivers_with_limit,
            CASE WHEN v_is_push_channel THEN '3 (total push)' ELSE v_per_limit::text END,
            CASE WHEN v_is_push_channel THEN 'Push (cualquier tipo)' ELSE v_loop_action_key END,
            CASE WHEN v_is_push_channel THEN '3' ELSE v_per_limit::text END);
        END IF;
      END IF;

      -- Solape de audiencia por campaña, UNA vez por (fecha, canal). start_min
      -- = hora de inicio de esa campaña (-1 si día completo, NULL si trigger).
      SELECT array_agg(start_min), array_agg(ov)
      INTO v_starts, v_overlaps
      FROM (
        SELECT
          CASE WHEN cs2.time_slot IN ('FULL_DAY','07:00-22:00','06:00-22:00') THEN -1
               ELSE public.time_slot_start_minutes(cs2.time_slot) END AS start_min,
          (SELECT COUNT(*) FROM drv.campaign_audience ca2
            WHERE ca2.campaign_id = cs2.campaign_id
              AND EXISTS (SELECT 1 FROM drv.campaign_audience mia
                          WHERE mia.campaign_id = p_cohort_id AND mia.drv_id = ca2.drv_id)) AS ov
        FROM drv.campaign_schedules cs2 JOIN drv.campaigns c2 ON c2.id = cs2.campaign_id
        WHERE cs2.schedule_date = v_loop_date AND cs2.action_key = v_loop_action_key
          AND c2.country = p_country AND c2.status IN ('approved','pending')
          AND c2.id <> p_cohort_id
          AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c2.city_codes && p_city_codes)
      ) t
      WHERE t.ov > 0;   -- sólo campañas que comparten algún conductor

      v_slot_total := COALESCE(array_length(v_starts, 1), 0);

      FOREACH v_loop_time_slot IN ARRAY v_slots LOOP
        v_slot_min := split_part(v_loop_time_slot, ':', 1)::integer * 60
                    + split_part(v_loop_time_slot, ':', 2)::integer;
        v_blocked := false; v_partial := false;

        IF v_starts IS NOT NULL THEN
          FOR v_i IN 1 .. array_length(v_starts, 1) LOOP
            -- ¿choca en tiempo? día completo (-1) o dentro de ±60 min.
            IF v_starts[v_i] = -1
               OR (v_starts[v_i] IS NOT NULL AND abs(v_starts[v_i] - v_slot_min) <= 60) THEN
              v_partial := true;
              -- bloqueo sólo si esa campaña cubre >50% de mi cohorte.
              IF v_cohort_size > 0 AND v_overlaps[v_i] * 2 > v_cohort_size THEN
                v_blocked := true;
              END IF;
            END IF;
          END LOOP;
        END IF;

        IF v_day_lock OR v_blocked THEN v_result_severity := 'red';
        ELSIF v_partial THEN v_result_severity := 'yellow';
        ELSE v_result_severity := 'green'; END IF;

        action_key := v_loop_action_key; schedule_date := v_loop_date; time_slot := v_loop_time_slot;
        severity := v_result_severity; day_locked := v_day_lock; day_lock_reason := v_day_lock_msg;
        conflicting_drivers := v_drivers_with_limit; total_schedules := v_slot_total;
        RETURN NEXT;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$function$;

-- Espejo PAX (pax_id / pax).
CREATE OR REPLACE FUNCTION public.get_slot_availability_by_cohort_pax(
  p_country text, p_city_codes text[], p_start_date date, p_end_date date,
  p_action_keys text[], p_cohort_id uuid)
RETURNS TABLE(action_key text, schedule_date date, time_slot text, severity text,
              day_locked boolean, day_lock_reason text,
              conflicting_drivers bigint, total_schedules bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pax'
AS $function$
DECLARE
  v_loop_date date; v_loop_action_key text; v_loop_time_slot text;
  v_slots text[] := ARRAY[
    '07:00','07:30','08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30',
    '13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00','18:30',
    '19:00','19:30','20:00','20:30','21:00','21:30','22:00'];
  v_per_limit integer; v_is_push_channel boolean;
  v_day_lock boolean := false; v_day_lock_msg text;
  v_drivers_with_limit bigint; v_slot_total bigint;
  v_cohort_size bigint;
  v_starts int[]; v_overlaps bigint[]; v_i int;
  v_slot_min integer; v_blocked boolean; v_partial boolean;
  v_result_severity text;
BEGIN
  SELECT COUNT(DISTINCT pax_id) INTO v_cohort_size
  FROM pax.campaign_audience WHERE campaign_id = p_cohort_id;

  FOR v_loop_date IN SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date LOOP
    FOREACH v_loop_action_key IN ARRAY p_action_keys LOOP
      v_per_limit := CASE
        WHEN v_loop_action_key IN ('Push in/out','Push in','Push out') THEN 3
        WHEN v_loop_action_key = 'Whatsapp' THEN 2 ELSE 0 END;
      v_is_push_channel := v_loop_action_key IN ('Push in/out','Push in','Push out');
      v_drivers_with_limit := 0; v_day_lock := false; v_day_lock_msg := NULL;

      IF v_per_limit > 0 AND p_cohort_id IS NOT NULL THEN
        IF v_is_push_channel THEN
          SELECT COUNT(*) INTO v_drivers_with_limit FROM (
            SELECT ca.pax_id
            FROM pax.campaign_audience ca
            JOIN pax.campaign_schedules cs ON cs.campaign_id = ca.campaign_id
            JOIN pax.campaigns c ON c.id = cs.campaign_id
            WHERE EXISTS (SELECT 1 FROM pax.campaign_audience mia_c WHERE mia_c.campaign_id = p_cohort_id AND mia_c.pax_id = ca.pax_id)
              AND cs.action_key IN ('Push in/out','Push in','Push out')
              AND cs.schedule_date = v_loop_date AND c.country = p_country
              AND c.status IN ('approved','pending') AND c.id <> p_cohort_id
              AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c.city_codes && p_city_codes)
            GROUP BY ca.pax_id HAVING COUNT(*) >= v_per_limit) sub;
        ELSE
          SELECT COUNT(*) INTO v_drivers_with_limit FROM (
            SELECT ca.pax_id
            FROM pax.campaign_audience ca
            JOIN pax.campaign_schedules cs ON cs.campaign_id = ca.campaign_id
            JOIN pax.campaigns c ON c.id = cs.campaign_id
            WHERE EXISTS (SELECT 1 FROM pax.campaign_audience mia_c WHERE mia_c.campaign_id = p_cohort_id AND mia_c.pax_id = ca.pax_id)
              AND cs.action_key = v_loop_action_key
              AND cs.schedule_date = v_loop_date AND c.country = p_country
              AND c.status IN ('approved','pending') AND c.id <> p_cohort_id
              AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c.city_codes && p_city_codes)
            GROUP BY ca.pax_id HAVING COUNT(*) >= v_per_limit) sub;
        END IF;
        IF v_drivers_with_limit > 0 THEN
          v_day_lock := true;
          v_day_lock_msg := format(
            '%s usuario(s) del cohorte ya tienen %s+ comunicaciones de %s ese día (máx. %s)',
            v_drivers_with_limit,
            CASE WHEN v_is_push_channel THEN '3 (total push)' ELSE v_per_limit::text END,
            CASE WHEN v_is_push_channel THEN 'Push (cualquier tipo)' ELSE v_loop_action_key END,
            CASE WHEN v_is_push_channel THEN '3' ELSE v_per_limit::text END);
        END IF;
      END IF;

      SELECT array_agg(start_min), array_agg(ov)
      INTO v_starts, v_overlaps
      FROM (
        SELECT
          CASE WHEN cs2.time_slot IN ('FULL_DAY','07:00-22:00','06:00-22:00') THEN -1
               ELSE public.time_slot_start_minutes(cs2.time_slot) END AS start_min,
          (SELECT COUNT(*) FROM pax.campaign_audience ca2
            WHERE ca2.campaign_id = cs2.campaign_id
              AND EXISTS (SELECT 1 FROM pax.campaign_audience mia
                          WHERE mia.campaign_id = p_cohort_id AND mia.pax_id = ca2.pax_id)) AS ov
        FROM pax.campaign_schedules cs2 JOIN pax.campaigns c2 ON c2.id = cs2.campaign_id
        WHERE cs2.schedule_date = v_loop_date AND cs2.action_key = v_loop_action_key
          AND c2.country = p_country AND c2.status IN ('approved','pending')
          AND c2.id <> p_cohort_id
          AND (p_city_codes IS NULL OR p_city_codes = '{}' OR c2.city_codes && p_city_codes)
      ) t
      WHERE t.ov > 0;

      v_slot_total := COALESCE(array_length(v_starts, 1), 0);

      FOREACH v_loop_time_slot IN ARRAY v_slots LOOP
        v_slot_min := split_part(v_loop_time_slot, ':', 1)::integer * 60
                    + split_part(v_loop_time_slot, ':', 2)::integer;
        v_blocked := false; v_partial := false;

        IF v_starts IS NOT NULL THEN
          FOR v_i IN 1 .. array_length(v_starts, 1) LOOP
            IF v_starts[v_i] = -1
               OR (v_starts[v_i] IS NOT NULL AND abs(v_starts[v_i] - v_slot_min) <= 60) THEN
              v_partial := true;
              IF v_cohort_size > 0 AND v_overlaps[v_i] * 2 > v_cohort_size THEN
                v_blocked := true;
              END IF;
            END IF;
          END LOOP;
        END IF;

        IF v_day_lock OR v_blocked THEN v_result_severity := 'red';
        ELSIF v_partial THEN v_result_severity := 'yellow';
        ELSE v_result_severity := 'green'; END IF;

        action_key := v_loop_action_key; schedule_date := v_loop_date; time_slot := v_loop_time_slot;
        severity := v_result_severity; day_locked := v_day_lock; day_lock_reason := v_day_lock_msg;
        conflicting_drivers := v_drivers_with_limit; total_schedules := v_slot_total;
        RETURN NEXT;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_slot_availability_by_cohort(text,text[],date,date,text[],uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_slot_availability_by_cohort_pax(text,text[],date,date,text[],uuid) TO authenticated;
