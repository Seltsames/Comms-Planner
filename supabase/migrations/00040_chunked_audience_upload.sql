-- ============================================================
-- Migration 00040: subida de audiencia por lotes
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- PROBLEMA
-- save_campaign_v2 recibía toda la audiencia en un solo jsonb. Con un
-- cohorte real de 469.325 conductores eso son 25 MB de petición que dentro
-- de Postgres se convierten en: el jsonb parseado + un arreglo de 469k
-- textos + el INSERT, todo vivo en memoria a la vez. Medido en producción:
--
--   parseo + ids distintos ....  3.453 ms
--   INSERT de la audiencia .... 13.600 ms  (~34.400 filas/seg)
--   ------------------------------------
--   total ..................... ~17 s     contra statement_timeout = 8 s
--
-- No solo excedía el límite: el pico de memoria tumbó la instancia
-- (reinicios por apagado sucio el 2026-07-23). Se reprodujo dos veces.
--
-- Subir statement_timeout NO sirve: el temporizador se arma al inicio de la
-- sentencia, así que un `SET` dentro de la función no lo re-arma (probado).
-- Y darle más tiempo solo dejaría acumular más memoria antes de caer.
--
-- SOLUCIÓN
-- Tres fases, invisibles para quien usa la app (sube un CSV, un clic):
--
--   1. begin_campaign_upload   → crea la campaña como borrador + horarios
--   2. append_campaign_audience→ N lotes de ~25k filas (~0,7 s cada uno)
--   3. finalize_campaign_upload→ chequeos y estado final
--
-- El borrador se marca con status='draft' Y deleted_at=now(). Lo segundo lo
-- oculta de todas las funciones que ya filtran deleted_at (list_user_*,
-- list_all_*, get_campaign_*), sin tener que tocarlas. finalize limpia
-- deleted_at. Solo hubo que parchear las que no filtran nada (abajo).
--
-- CHEQUEOS REESCRITOS
-- Los tres chequeos de conflicto recibían el arreglo de ids y hacían
-- `= ANY(...)` contra él, con un costo proporcional al cohorte. Como en
-- finalize la audiencia YA está en la tabla, ahora se agregan primero sobre
-- las campañas existentes (pocas filas) y solo después se cruzan contra la
-- audiencia propia usando el índice (campaign_id, drv_id). El costo pasa a
-- depender de las campañas existentes, no del cohorte. Medido con 469k:
--
--   solape en riesgo ......  3.234 ms  ->     11 ms
--   conflicto de cohorte .. 17.430 ms  ->      3 ms
--
-- El chequeo de día bloqueado usa un CTE MATERIALIZED a propósito: sin él
-- el planificador arranca por la tabla grande y tarda ~10 s.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Parches: que los borradores no se filtren
-- ------------------------------------------------------------
-- get_analytics_aggregates usa una lista de exclusión, así que un estado
-- nuevo entra solo. check_cohort_conflicts no filtra estado en absoluto.
-- Se parchean con regexp sobre el cuerpo vivo (idioma ya usado en 00033-35):
-- es idempotente y falla ruidosamente si el patrón cambió.

-- Se resuelven las firmas desde el catálogo, no a mano: get_analytics_aggregates
-- es (text,text) y una firma escrita a ojo haría que el parche se saltara en
-- silencio, dejando los borradores visibles en Análisis.
DO $patch$
DECLARE
  r record;
  v_src text;
  v_new text;
  v_parchadas int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_analytics_aggregates', 'get_analytics_aggregates_pax')
      AND p.prokind = 'f'
  LOOP
    v_src := pg_get_functiondef(r.sig);

    IF position('''draft''' in v_src) > 0 THEN
      v_parchadas := v_parchadas + 1;
      CONTINUE;  -- ya parchada
    END IF;

    -- Tolera cualquier espaciado dentro de la lista de exclusión.
    v_new := regexp_replace(
      v_src,
      '(status\s+NOT\s+IN\s*\(\s*''rejected''\s*,\s*''cancelled'')(\s*\))',
      E'\\1, ''draft''\\2',
      'g'
    );

    IF v_new = v_src THEN
      RAISE EXCEPTION 'No se encontró el filtro de status en %. Revisar a mano.', r.sig;
    END IF;

    EXECUTE v_new;
    v_parchadas := v_parchadas + 1;
    RAISE NOTICE 'Parchada %', r.sig;
  END LOOP;

  IF v_parchadas < 2 THEN
    RAISE EXCEPTION 'Se esperaban 2 funciones de analítica, se parcharon %.', v_parchadas;
  END IF;
END
$patch$;

-- check_cohort_conflicts: añade la exclusión de borradores.
-- Se conserva el resto del comportamiento tal cual (incluido que cuenta
-- campañas rejected/cancelled, que es como estaba antes de esta migración).
DO $patch$
DECLARE
  r record;
  v_src text;
  v_new text;
  v_parchadas int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('check_cohort_conflicts', 'check_cohort_conflicts_pax')
      AND p.prokind = 'f'
  LOOP
    v_src := pg_get_functiondef(r.sig);

    IF position('''draft''' in v_src) > 0 THEN
      v_parchadas := v_parchadas + 1;
      CONTINUE;
    END IF;

    v_new := regexp_replace(
      v_src,
      '(AND c\.country = p_country)',
      E'\\1 AND c.status <> ''draft''',
      'g'
    );

    IF v_new = v_src THEN
      RAISE EXCEPTION 'No se encontró el predicado de país en %. Revisar a mano.', r.sig;
    END IF;

    EXECUTE v_new;
    v_parchadas := v_parchadas + 1;
    RAISE NOTICE 'Parchada %', r.sig;
  END LOOP;

  IF v_parchadas < 2 THEN
    RAISE EXCEPTION 'Se esperaban 2 funciones check_cohort_conflicts, se parcharon %.', v_parchadas;
  END IF;
END
$patch$;

-- ------------------------------------------------------------
-- 2. DRV — fase 1: abrir el borrador
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.begin_campaign_upload(
  p_name text, p_team text, p_sub_team text, p_types text[], p_action_keys text[],
  p_country text, p_city_codes text[], p_csv_file_name text,
  p_start_date date, p_end_date date, p_schedules jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'drv'
AS $function$
DECLARE
  v_campaign_id uuid;
  v_user_id uuid := auth.uid();
  v_sched record;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Si el navegador muere a mitad de la subida queda un borrador con
  -- audiencia parcial. Nadie lo ve (deleted_at), pero se purgan los propios
  -- que ya pasaron de 2 h para no acumularlos.
  DELETE FROM drv.campaigns
  WHERE creator_id = v_user_id
    AND status = 'draft'
    AND created_at < now() - interval '2 hours';

  INSERT INTO drv.campaigns (
    name, team, sub_team, types, action_keys, country, city_codes,
    csv_file_name, start_date, end_date, creator_id, status, deleted_at
  ) VALUES (
    p_name, p_team, p_sub_team, p_types, p_action_keys, p_country, p_city_codes,
    p_csv_file_name, p_start_date, p_end_date, v_user_id, 'draft', now()
  ) RETURNING id INTO v_campaign_id;

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
      (v_campaign_id, v_sched.action_key, v_sched.schedule_date,
       v_sched.time_slot, v_sched.image_url)
    ON CONFLICT (campaign_id, action_key, schedule_date) DO UPDATE SET
      time_slot = EXCLUDED.time_slot,
      image_url = EXCLUDED.image_url;
  END LOOP;

  RETURN v_campaign_id::text;
END;
$function$;

-- ------------------------------------------------------------
-- 3. DRV — fase 2: un lote de audiencia
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.append_campaign_audience(
  p_campaign_id uuid, p_audience jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'drv'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_ok boolean;
  v_n integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Solo el dueño y solo mientras sea borrador: impide inyectar audiencia
  -- en una campaña ya aprobada.
  SELECT EXISTS (
    SELECT 1 FROM drv.campaigns
    WHERE id = p_campaign_id AND creator_id = v_user_id AND status = 'draft'
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Borrador no encontrado o no pertenece al usuario';
  END IF;

  INSERT INTO drv.campaign_audience (campaign_id, drv_id, city_code)
  SELECT p_campaign_id,
         (a->>'drv_id')::text,
         NULLIF((a->>'city_code')::text, '')::text
  FROM jsonb_array_elements(COALESCE(p_audience, '[]'::jsonb)) AS a
  ON CONFLICT (campaign_id, drv_id, city_code) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

-- ------------------------------------------------------------
-- 4. DRV — fase 3: chequeos y estado final
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_campaign_upload(
  p_campaign_id uuid, p_status text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'drv'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  c record;
  v_has_push boolean;
  v_lock boolean;
  v_overlap boolean;
  v_conflicts boolean;
  v_status text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO c FROM drv.campaigns
  WHERE id = p_campaign_id AND creator_id = v_user_id AND status = 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Borrador no encontrado o no pertenece al usuario';
  END IF;

  v_has_push := (c.action_keys && ARRAY['Push in/out', 'Push in', 'Push out']);

  -- Chequeo 1 — día bloqueado (3+ push al mismo conductor).
  -- MATERIALIZED es obligatorio: agrega primero sobre las campañas
  -- existentes y sólo entonces cruza contra la audiencia propia. Sin él el
  -- planificador arranca por la tabla grande y pasa de ms a ~10 s.
  IF v_has_push THEN
    WITH ya_saturados AS MATERIALIZED (
      SELECT otro.drv_id, cs.schedule_date
      FROM drv.campaign_audience otro
      JOIN drv.campaign_schedules cs ON cs.campaign_id = otro.campaign_id
      JOIN drv.campaigns oc ON oc.id = otro.campaign_id
      WHERE oc.country = c.country
        AND oc.status IN ('approved', 'pending')
        AND oc.id <> p_campaign_id
        AND cs.action_key IN ('Push in/out', 'Push in', 'Push out')
        AND cs.schedule_date BETWEEN COALESCE(c.start_date, CURRENT_DATE)
                                 AND COALESCE(c.end_date, CURRENT_DATE)
      GROUP BY otro.drv_id, cs.schedule_date
      HAVING COUNT(*) >= 3
    )
    SELECT EXISTS (
      SELECT 1 FROM ya_saturados s
      JOIN drv.campaign_audience mia
        ON mia.campaign_id = p_campaign_id AND mia.drv_id = s.drv_id
    ) INTO v_lock;
  ELSE
    v_lock := false;
  END IF;

  -- Chequeo 2 — solape en riesgo (mismo canal, ±60 min o día completo).
  SELECT EXISTS (
    SELECT 1
    FROM drv.campaign_schedules cs
    JOIN drv.campaigns oc ON oc.id = cs.campaign_id
    WHERE oc.country = c.country
      AND oc.status IN ('approved', 'pending')
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
            AND ABS(
              public.time_slot_start_minutes(cs.time_slot) -
              public.time_slot_start_minutes(mis.time_slot)
            ) < 60
        )
      )
      AND EXISTS (
        SELECT 1
        FROM drv.campaign_audience otro
        JOIN drv.campaign_audience mia
          ON mia.campaign_id = p_campaign_id AND mia.drv_id = otro.drv_id
        WHERE otro.campaign_id = cs.campaign_id
      )
  ) INTO v_overlap;

  -- Chequeo 3 — conflicto de cohorte. Equivale a
  -- check_cohort_conflicts(...) WHERE conflicting_drv_count > 0, pero como
  -- sólo importa si existe alguno, se omite el COUNT(DISTINCT).
  SELECT EXISTS (
    SELECT 1
    FROM drv.campaign_audience otro
    JOIN drv.campaigns oc ON oc.id = otro.campaign_id
    JOIN drv.campaign_schedules cs ON cs.campaign_id = otro.campaign_id
    WHERE oc.country = c.country
      AND oc.id <> p_campaign_id
      AND oc.status <> 'draft'
      AND cs.schedule_date BETWEEN COALESCE(c.start_date, CURRENT_DATE)
                               AND COALESCE(c.end_date, CURRENT_DATE)
      AND EXISTS (
        SELECT 1 FROM drv.campaign_audience mia
        WHERE mia.campaign_id = p_campaign_id AND mia.drv_id = otro.drv_id
      )
  ) INTO v_conflicts;

  IF p_status IS NOT NULL THEN
    v_status := p_status;
  ELSIF v_lock THEN
    -- El borrador no debe sobrevivir a un día bloqueado.
    DELETE FROM drv.campaigns WHERE id = p_campaign_id;
    RAISE EXCEPTION 'No se puede crear la campaña: algunos conductores ya tienen 3+ comunicaciones push ese día. Día bloqueado.';
  ELSIF v_has_push THEN
    v_status := 'pending';
  ELSIF v_conflicts OR v_overlap THEN
    v_status := 'pending';
  ELSE
    v_status := 'approved';
  END IF;

  -- deleted_at vuelve a NULL: aquí la campaña se hace visible.
  UPDATE drv.campaigns
  SET status = v_status, deleted_at = NULL
  WHERE id = p_campaign_id;

  RETURN v_status;
END;
$function$;

-- ------------------------------------------------------------
-- 5. DRV — cancelar una subida a medias
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.abort_campaign_upload(p_campaign_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'drv'
AS $function$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  DELETE FROM drv.campaigns
  WHERE id = p_campaign_id AND creator_id = v_user_id AND status = 'draft';
END;
$function$;

-- ------------------------------------------------------------
-- 6. PAX — mismas tres fases sobre el esquema pax
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.begin_campaign_upload_pax(
  p_name text, p_team text, p_sub_team text, p_types text[], p_action_keys text[],
  p_country text, p_city_codes text[], p_csv_file_name text,
  p_start_date date, p_end_date date, p_schedules jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pax'
AS $function$
DECLARE
  v_campaign_id uuid;
  v_user_id uuid := auth.uid();
  v_sched record;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  DELETE FROM pax.campaigns
  WHERE creator_id = v_user_id
    AND status = 'draft'
    AND created_at < now() - interval '2 hours';

  INSERT INTO pax.campaigns (
    name, team, sub_team, types, action_keys, country, city_codes,
    csv_file_name, start_date, end_date, creator_id, status, deleted_at
  ) VALUES (
    p_name, p_team, p_sub_team, p_types, p_action_keys, p_country, p_city_codes,
    p_csv_file_name, p_start_date, p_end_date, v_user_id, 'draft', now()
  ) RETURNING id INTO v_campaign_id;

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
      (v_campaign_id, v_sched.action_key, v_sched.schedule_date,
       v_sched.time_slot, v_sched.image_url)
    ON CONFLICT (campaign_id, action_key, schedule_date) DO UPDATE SET
      time_slot = EXCLUDED.time_slot,
      image_url = EXCLUDED.image_url;
  END LOOP;

  RETURN v_campaign_id::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.append_campaign_audience_pax(
  p_campaign_id uuid, p_audience jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pax'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_ok boolean;
  v_n integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM pax.campaigns
    WHERE id = p_campaign_id AND creator_id = v_user_id AND status = 'draft'
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Borrador no encontrado o no pertenece al usuario';
  END IF;

  INSERT INTO pax.campaign_audience (campaign_id, pax_id, city_code)
  SELECT p_campaign_id,
         (a->>'pax_id')::text,
         NULLIF((a->>'city_code')::text, '')::text
  FROM jsonb_array_elements(COALESCE(p_audience, '[]'::jsonb)) AS a
  ON CONFLICT (campaign_id, pax_id, city_code) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_campaign_upload_pax(
  p_campaign_id uuid, p_status text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pax'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  c record;
  v_has_push boolean;
  v_lock boolean;
  v_overlap boolean;
  v_conflicts boolean;
  v_status text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO c FROM pax.campaigns
  WHERE id = p_campaign_id AND creator_id = v_user_id AND status = 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Borrador no encontrado o no pertenece al usuario';
  END IF;

  v_has_push := (c.action_keys && ARRAY['Push in/out', 'Push in', 'Push out']);

  IF v_has_push THEN
    WITH ya_saturados AS MATERIALIZED (
      SELECT otro.pax_id, cs.schedule_date
      FROM pax.campaign_audience otro
      JOIN pax.campaign_schedules cs ON cs.campaign_id = otro.campaign_id
      JOIN pax.campaigns oc ON oc.id = otro.campaign_id
      WHERE oc.country = c.country
        AND oc.status IN ('approved', 'pending')
        AND oc.id <> p_campaign_id
        AND cs.action_key IN ('Push in/out', 'Push in', 'Push out')
        AND cs.schedule_date BETWEEN COALESCE(c.start_date, CURRENT_DATE)
                                 AND COALESCE(c.end_date, CURRENT_DATE)
      GROUP BY otro.pax_id, cs.schedule_date
      HAVING COUNT(*) >= 3
    )
    SELECT EXISTS (
      SELECT 1 FROM ya_saturados s
      JOIN pax.campaign_audience mia
        ON mia.campaign_id = p_campaign_id AND mia.pax_id = s.pax_id
    ) INTO v_lock;
  ELSE
    v_lock := false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pax.campaign_schedules cs
    JOIN pax.campaigns oc ON oc.id = cs.campaign_id
    WHERE oc.country = c.country
      AND oc.status IN ('approved', 'pending')
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
            AND ABS(
              public.time_slot_start_minutes(cs.time_slot) -
              public.time_slot_start_minutes(mis.time_slot)
            ) < 60
        )
      )
      AND EXISTS (
        SELECT 1
        FROM pax.campaign_audience otro
        JOIN pax.campaign_audience mia
          ON mia.campaign_id = p_campaign_id AND mia.pax_id = otro.pax_id
        WHERE otro.campaign_id = cs.campaign_id
      )
  ) INTO v_overlap;

  SELECT EXISTS (
    SELECT 1
    FROM pax.campaign_audience otro
    JOIN pax.campaigns oc ON oc.id = otro.campaign_id
    JOIN pax.campaign_schedules cs ON cs.campaign_id = otro.campaign_id
    WHERE oc.country = c.country
      AND oc.id <> p_campaign_id
      AND oc.status <> 'draft'
      AND cs.schedule_date BETWEEN COALESCE(c.start_date, CURRENT_DATE)
                               AND COALESCE(c.end_date, CURRENT_DATE)
      AND EXISTS (
        SELECT 1 FROM pax.campaign_audience mia
        WHERE mia.campaign_id = p_campaign_id AND mia.pax_id = otro.pax_id
      )
  ) INTO v_conflicts;

  IF p_status IS NOT NULL THEN
    v_status := p_status;
  ELSIF v_lock THEN
    DELETE FROM pax.campaigns WHERE id = p_campaign_id;
    RAISE EXCEPTION 'No se puede crear la campaña: algunos usuarios ya tienen 3+ comunicaciones push ese día. Día bloqueado.';
  ELSIF v_has_push THEN
    v_status := 'pending';
  ELSIF v_conflicts OR v_overlap THEN
    v_status := 'pending';
  ELSE
    v_status := 'approved';
  END IF;

  UPDATE pax.campaigns
  SET status = v_status, deleted_at = NULL
  WHERE id = p_campaign_id;

  RETURN v_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.abort_campaign_upload_pax(p_campaign_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pax'
AS $function$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  DELETE FROM pax.campaigns
  WHERE id = p_campaign_id AND creator_id = v_user_id AND status = 'draft';
END;
$function$;

-- ------------------------------------------------------------
-- 7. Permisos
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.begin_campaign_upload(text,text,text,text[],text[],text,text[],text,date,date,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_campaign_audience(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_campaign_upload(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abort_campaign_upload(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.begin_campaign_upload_pax(text,text,text,text[],text[],text,text[],text,date,date,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_campaign_audience_pax(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_campaign_upload_pax(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abort_campaign_upload_pax(uuid) TO authenticated;
