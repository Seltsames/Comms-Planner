-- ============================================================
-- Migration 00045: los push vuelven a autoaprobarse por el sistema
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- Revierte la regla añadida en 00020 (y el flujo de Plan ID de 00031): un push
-- ya no fuerza 'pending' ni necesita aprobación del admin.
--
-- Se quita SOLO la rama `ELSIF v_has_push THEN <status> := 'pending'`. Se
-- conservan las otras dos puertas, que aplican a todos los canales por igual:
--   - día bloqueado (3+ push al mismo conductor)  -> bloqueo duro (RAISE)
--   - choque de horario con otra campaña          -> 'pending' (revisión)
-- Resultado: autoaprobado salvo choque real.
--
-- OJO: esto por sí solo no cambia nada visible. El cliente fijaba
-- status:"pending" al guardar, así que la cascada de la base nunca decidía
-- (sólo actúa con p_status = NULL). El cliente se cambió en el mismo PR para
-- dejar de mandar ese estado. Ambas cosas son necesarias.
--
-- Aplica a las cuatro funciones de guardado. Las finalize_* usan v_status; las
-- save_campaign_* (ruta vieja, ya no la llama el cliente) usan
-- v_effective_status — se parchean igual por consistencia.
-- ============================================================

DO $patch$
DECLARE
  r record; v_src text; v_new text; v_var text; v_parchadas int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN ('finalize_campaign_upload','finalize_campaign_upload_pax',
                        'save_campaign_v2','save_campaign_pax')
  LOOP
    v_var := CASE WHEN r.proname LIKE 'finalize%' THEN 'v_status' ELSE 'v_effective_status' END;
    v_src := pg_get_functiondef(r.sig);

    -- Idempotente: si ya no está la rama, se cuenta como hecha
    IF v_src !~ ('ELSIF v_has_push THEN\s*\n\s*' || v_var || ' := ''pending'';') THEN
      v_parchadas := v_parchadas + 1; CONTINUE;
    END IF;

    v_new := regexp_replace(v_src,
      'ELSIF v_has_push THEN\s*\n\s*' || v_var || ' := ''pending'';\s*\n\s*',
      '', 'g');

    IF v_new = v_src THEN
      RAISE EXCEPTION 'No se encontró la rama push->pending en %. Revisar a mano.', r.sig;
    END IF;

    EXECUTE v_new;
    v_parchadas := v_parchadas + 1;
    RAISE NOTICE 'Parchada %', r.sig;
  END LOOP;

  IF v_parchadas < 4 THEN
    RAISE EXCEPTION 'Se esperaban 4 funciones, se procesaron %.', v_parchadas;
  END IF;
END
$patch$;
