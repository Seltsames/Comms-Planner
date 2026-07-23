-- ============================================================
-- Migration 00042: la analítica no puede agregar sobre todo el cohorte
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- Con una campaña de 469.325 conductores, get_analytics_aggregates fallaba con
--
--   ERROR: could not write to file "base/pgsql_tmp/...": No space left on device
--
-- y el dashboard mostraba ceros y campos vacíos.
--
-- El bloque de totales agrupaba por conductor sobre TODA la audiencia y
-- construía dos array_agg por cada uno — 470.000 grupos con arreglos — sólo
-- para quedarse con los 10 primeros. Eso desbordaba a archivos temporales.
--
-- Ahora se cuenta, se recorta a 10, y los arreglos se construyen únicamente
-- para esos diez. El resultado es idéntico.
--
-- Ojo: PAX nombra sus CTE passenger_totals/top_passengers, no
-- driver_totals/top_drivers. Un parche con nombres fijos falla en PAX.
--
-- NOTA: esta migración por sí sola NO devolvió el dashboard. El muro era el
-- disco, no la forma de la consulta (ver 00043 y la nota sobre el WAL en
-- HANDOFF.md).
-- ============================================================

DO $patch$
DECLARE
  r record; v_src text; v_new text;
  v_id text; v_tot text; v_top text; v_parchadas int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN ('get_analytics_aggregates', 'get_analytics_aggregates_pax')
  LOOP
    IF r.proname LIKE '%_pax' THEN
      v_id := 'pax_id'; v_tot := 'passenger_totals'; v_top := 'top_passengers';
    ELSE
      v_id := 'drv_id'; v_tot := 'driver_totals';    v_top := 'top_drivers';
    END IF;

    v_src := pg_get_functiondef(r.sig);

    IF position('_counts AS (' in v_src) > 0 THEN
      v_parchadas := v_parchadas + 1; CONTINUE;  -- ya parchada
    END IF;

    v_new := regexp_replace(v_src,
      v_tot || ' AS \(.*?per_camp_drv_list',
      'top_counts AS (' || E'\n' ||
      '    SELECT ca.' || v_id || ' AS mid, COUNT(*) AS total_comms' || E'\n' ||
      '    FROM active_audience ca' || E'\n' ||
      '    LEFT JOIN filtered_schedules fs ON fs.campaign_id = ca.campaign_id' || E'\n' ||
      '    GROUP BY ca.' || v_id || E'\n' ||
      '    ORDER BY total_comms DESC LIMIT 10' || E'\n' ||
      '  ),' || E'\n' ||
      '  ' || v_top || ' AS (' || E'\n' ||
      '    SELECT tc.mid AS ' || v_id || ', tc.total_comms AS count,' || E'\n' ||
      '      (SELECT array_agg(DISTINCT fs2.action_key)' || E'\n' ||
      '         FROM active_audience ca2' || E'\n' ||
      '         JOIN filtered_schedules fs2 ON fs2.campaign_id = ca2.campaign_id' || E'\n' ||
      '        WHERE ca2.' || v_id || ' = tc.mid) AS channels,' || E'\n' ||
      '      (SELECT array_agg(DISTINCT ac2.name)' || E'\n' ||
      '         FROM active_audience ca2' || E'\n' ||
      '         JOIN active_camps ac2 ON ac2.id = ca2.campaign_id' || E'\n' ||
      '        WHERE ca2.' || v_id || ' = tc.mid) AS campaigns' || E'\n' ||
      '    FROM top_counts tc' || E'\n' ||
      '  ),' || E'\n' ||
      '  per_camp_drv_list');

    IF v_new = v_src THEN
      RAISE EXCEPTION 'No se encontró el bloque % en %. Revisar a mano.', v_tot, r.sig;
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
