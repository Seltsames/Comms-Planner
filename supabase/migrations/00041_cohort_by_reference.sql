-- ============================================================
-- Migration 00041: las previsualizaciones referencian el cohorte
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- La 00040 arregló el guardado, pero sólo la mitad del problema. El Builder
-- seguía mandando el cohorte entero ANTES de guardar:
--
--   get_slot_availability_v2  → una vez POR CANAL, en cada cambio de canal
--                               o fecha, con el arreglo completo de ids
--   check_cohort_conflicts    → ídem al previsualizar conflictos
--
-- Con 469.325 conductores son ~9 MB por llamada, repetidos. En los logs del
-- 2026-07-23 se ven 500 y 520 en ambas y, acto seguido, un 520 en
-- begin_campaign_upload — que no manda audiencia y debería ser instantáneo.
-- No fallaba el guardado: la instancia ya venía saturada.
--
-- Ahora la audiencia sube UNA vez al borrador (00040) en cuanto se valida el
-- CSV, y todo lo demás la referencia por campaign_id. La petición pasa de
-- ~9 MB a unos bytes, y el `= ANY(arreglo_de_469k)` se vuelve un EXISTS por
-- índice: la misma inversión que en finalize_campaign_upload.
--
-- Medido con el flujo completo: disponibilidad 277 ms, conflictos 6 ms.
--
-- Las variantes de disponibilidad se DERIVAN del cuerpo vivo de las
-- originales para no duplicar su lógica (es una función larga). Si el
-- original cambia, basta con volver a correr esta migración.
-- ============================================================

DO $gen$
DECLARE
  r record; v_src text; v_new text; v_col text; v_esquema text; v_param text;
  v_generadas int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN ('get_slot_availability_v2', 'get_slot_availability_v2_pax')
  LOOP
    IF r.proname LIKE '%_pax' THEN
      v_col := 'pax_id'; v_esquema := 'pax'; v_param := 'p_pax_ids';
    ELSE
      v_col := 'drv_id'; v_esquema := 'drv'; v_param := 'p_drv_ids';
    END IF;

    v_src := pg_get_functiondef(r.sig);

    v_new := replace(v_src,
      'FUNCTION public.' || r.proname || '(',
      'FUNCTION public.' || replace(r.proname, 'get_slot_availability_v2',
                                    'get_slot_availability_by_cohort') || '(');

    v_new := replace(v_new, v_param || ' text[])', 'p_cohort_id uuid)');

    v_new := regexp_replace(v_new,
      v_param || '\s+IS\s+NOT\s+NULL\s+AND\s+array_length\(' || v_param || ',\s*1\)\s*>\s*0',
      'p_cohort_id IS NOT NULL', 'g');

    v_new := regexp_replace(v_new,
      '(\w+)\.' || v_col || ' = ANY\(' || v_param || '\)',
      'EXISTS (SELECT 1 FROM ' || v_esquema || '.campaign_audience mia_c'
        || ' WHERE mia_c.campaign_id = p_cohort_id AND mia_c.' || v_col || ' = \1.' || v_col || ')',
      'g');

    IF position(v_param in v_new) > 0 THEN
      RAISE EXCEPTION 'Quedaron referencias a % en %. Revisar a mano.', v_param, r.proname;
    END IF;

    EXECUTE v_new;
    v_generadas := v_generadas + 1;
    RAISE NOTICE 'Generada variante por cohorte de %', r.proname;
  END LOOP;

  IF v_generadas < 2 THEN
    RAISE EXCEPTION 'Se esperaban 2 funciones de disponibilidad, se generaron %.', v_generadas;
  END IF;
END
$gen$;

-- Mismas columnas que check_cohort_conflicts para que la UI no cambie, pero
-- cruzando contra la audiencia ya cargada en vez de recibirla.
CREATE OR REPLACE FUNCTION public.check_cohort_conflicts_by_cohort(
  p_cohort_id uuid, p_country text, p_start_date date, p_end_date date
) RETURNS TABLE(campaign_id uuid, campaign_name text, schedule_date date,
                time_slot text, action_key text, conflicting_drv_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'drv'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  RETURN QUERY
  SELECT cs.campaign_id, c.name::text, cs.schedule_date,
         cs.time_slot::text, cs.action_key::text, COUNT(DISTINCT ca.drv_id)
  FROM drv.campaign_audience ca
  JOIN drv.campaigns c ON c.id = ca.campaign_id
  JOIN drv.campaign_schedules cs ON cs.campaign_id = ca.campaign_id
  WHERE c.country = p_country
    AND c.status <> 'draft'
    AND c.id <> p_cohort_id
    AND cs.schedule_date BETWEEN p_start_date AND p_end_date
    AND EXISTS (SELECT 1 FROM drv.campaign_audience mia
                WHERE mia.campaign_id = p_cohort_id AND mia.drv_id = ca.drv_id)
  GROUP BY cs.campaign_id, c.name, cs.schedule_date, cs.time_slot, cs.action_key
  ORDER BY COUNT(DISTINCT ca.drv_id) DESC, cs.schedule_date ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_cohort_conflicts_by_cohort_pax(
  p_cohort_id uuid, p_country text, p_start_date date, p_end_date date
) RETURNS TABLE(campaign_id uuid, campaign_name text, schedule_date date,
                time_slot text, action_key text, conflicting_drv_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pax'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  RETURN QUERY
  SELECT cs.campaign_id, c.name::text, cs.schedule_date,
         cs.time_slot::text, cs.action_key::text, COUNT(DISTINCT ca.pax_id)
  FROM pax.campaign_audience ca
  JOIN pax.campaigns c ON c.id = ca.campaign_id
  JOIN pax.campaign_schedules cs ON cs.campaign_id = ca.campaign_id
  WHERE c.country = p_country
    AND c.status <> 'draft'
    AND c.id <> p_cohort_id
    AND cs.schedule_date BETWEEN p_start_date AND p_end_date
    AND EXISTS (SELECT 1 FROM pax.campaign_audience mia
                WHERE mia.campaign_id = p_cohort_id AND mia.pax_id = ca.pax_id)
  GROUP BY cs.campaign_id, c.name, cs.schedule_date, cs.time_slot, cs.action_key
  ORDER BY COUNT(DISTINCT ca.pax_id) DESC, cs.schedule_date ASC;
END;
$function$;

-- El borrador nace al validar el CSV, antes de que exista nombre, canales o
-- fechas definitivas: estas funciones completan los metadatos al guardar.
CREATE OR REPLACE FUNCTION public.update_campaign_draft(
  p_campaign_id uuid, p_name text, p_team text, p_sub_team text,
  p_types text[], p_action_keys text[], p_country text, p_city_codes text[],
  p_csv_file_name text, p_start_date date, p_end_date date, p_schedules jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'drv'
AS $function$
DECLARE v_user_id uuid := auth.uid(); v_sched record;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE drv.campaigns SET
    name = p_name, team = p_team, sub_team = p_sub_team, types = p_types,
    action_keys = p_action_keys, country = p_country, city_codes = p_city_codes,
    csv_file_name = p_csv_file_name, start_date = p_start_date, end_date = p_end_date
  WHERE id = p_campaign_id AND creator_id = v_user_id AND status = 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Borrador no encontrado o no pertenece al usuario';
  END IF;

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
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_campaign_draft_pax(
  p_campaign_id uuid, p_name text, p_team text, p_sub_team text,
  p_types text[], p_action_keys text[], p_country text, p_city_codes text[],
  p_csv_file_name text, p_start_date date, p_end_date date, p_schedules jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pax'
AS $function$
DECLARE v_user_id uuid := auth.uid(); v_sched record;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE pax.campaigns SET
    name = p_name, team = p_team, sub_team = p_sub_team, types = p_types,
    action_keys = p_action_keys, country = p_country, city_codes = p_city_codes,
    csv_file_name = p_csv_file_name, start_date = p_start_date, end_date = p_end_date
  WHERE id = p_campaign_id AND creator_id = v_user_id AND status = 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Borrador no encontrado o no pertenece al usuario';
  END IF;

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
END;
$function$;

GRANT EXECUTE ON FUNCTION public.check_cohort_conflicts_by_cohort(uuid,text,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_cohort_conflicts_by_cohort_pax(uuid,text,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_campaign_draft(uuid,text,text,text,text[],text[],text,text[],text,date,date,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_campaign_draft_pax(uuid,text,text,text,text[],text[],text,text[],text,date,date,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_slot_availability_by_cohort(text,text[],date,date,text[],uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_slot_availability_by_cohort_pax(text,text[],date,date,text[],uuid) TO authenticated;
