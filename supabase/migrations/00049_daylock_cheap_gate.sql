-- ============================================================
-- Migration 00049: filtro barato antes del día-bloqueado
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- El chequeo de día-bloqueado agregaba TODA la audiencia push de otras campañas
-- (469k+ filas, ~5 s) sólo para casi siempre no bloquear nada: sólo bloquea si
-- un conductor tendría 3+ push el mismo día, lo que exige 3+ horarios push
-- solapados de otras campañas. Combinado con el resto, el guardado se pasaba de
-- los 8 s de statement_timeout con dos cohortes de 469k (medido: 6866 ms).
--
-- Ahora se cuenta primero, sobre campaign_schedules (tabla chica, ~15 ms), si
-- algún día siquiera llega a 3 horarios push de otras campañas. Si no, se salta
-- la agregación cara. El resultado es idéntico; sólo se evita el trabajo inútil.
-- Peor caso tras el filtro: 692 ms (antes 6866 ms).
--
-- Se parchea sobre el cuerpo vivo de las 4 funciones (finalize + update, DRV +
-- PAX) por regexp: idempotente y falla ruidosamente si el patrón cambió.
-- ============================================================

DO $patch$
DECLARE
  r record; v_src text; v_new text; v_schema text; v_gate text; v_count int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f'
      AND p.proname IN ('finalize_campaign_upload','finalize_campaign_upload_pax',
                        'update_campaign','update_campaign_pax')
  LOOP
    v_schema := CASE WHEN r.proname LIKE '%_pax' THEN 'pax' ELSE 'drv' END;
    v_src := pg_get_functiondef(r.sig);

    IF position('v_daylock_possible' in v_src) > 0 THEN
      v_count := v_count + 1; CONTINUE;
    END IF;

    v_new := replace(v_src, 'v_cohort_size bigint;',
                            'v_cohort_size bigint; v_daylock_possible boolean;');

    v_gate :=
      'IF v_has_push THEN' || E'\n' ||
      '    SELECT COALESCE(max(cnt),0) >= 3 INTO v_daylock_possible FROM (' || E'\n' ||
      '      SELECT gcs.schedule_date, count(*) cnt' || E'\n' ||
      '      FROM ' || v_schema || '.campaign_schedules gcs' ||
                 ' JOIN ' || v_schema || '.campaigns goc ON goc.id = gcs.campaign_id' || E'\n' ||
      '      WHERE goc.country = c.country AND goc.status IN (''approved'',''pending'')' ||
                 ' AND goc.id <> p_campaign_id' || E'\n' ||
      '        AND gcs.action_key IN (''Push in/out'',''Push in'',''Push out'')' || E'\n' ||
      '        AND gcs.schedule_date BETWEEN COALESCE(c.start_date, CURRENT_DATE)' ||
                 ' AND COALESCE(c.end_date, CURRENT_DATE)' || E'\n' ||
      '      GROUP BY gcs.schedule_date) g;' || E'\n' ||
      '  ELSE v_daylock_possible := false; END IF;' || E'\n\n' ||
      '  IF v_has_push AND v_daylock_possible THEN' || E'\n' ||
      '    WITH ya_saturados AS MATERIALIZED (';

    v_new := replace(v_new,
      'IF v_has_push THEN' || E'\n' || '    WITH ya_saturados AS MATERIALIZED (',
      v_gate);

    IF v_new = v_src THEN
      RAISE EXCEPTION 'No se encontro el patron de day-lock en %', r.proname;
    END IF;

    EXECUTE v_new;
    v_count := v_count + 1;
  END LOOP;

  IF v_count < 4 THEN RAISE EXCEPTION 'Se esperaban 4 funciones, se procesaron %', v_count; END IF;
END
$patch$;
