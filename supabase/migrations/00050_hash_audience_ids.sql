-- ============================================================
-- Migration 00050: la audiencia se guarda HASHEADA (HMAC-SHA256), no en crudo
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- Política de privacidad: los IDs de conductor/pasajero del CSV no deben
-- guardarse tal cual. Se hashean en la base con HMAC-SHA256 + un "pepper"
-- secreto. Es determinista (mismo id -> mismo hash), así que los choques y
-- solapes entre campañas SIGUEN funcionando (comparar hashes = comparar ids),
-- pero el hash es de una sola vía: sin el pepper no se puede revertir, ni por
-- fuerza bruta sobre el formato conocido de los ids (por eso HMAC-con-secreto y
-- no un SHA-256 a secas, que sí sería reversible).
--
-- El hasheo ocurre SÓLO en las funciones append_* (el único punto por donde
-- entra un id crudo desde 00041). El cliente NO cambia; las funciones de
-- conflicto/slots/métricas TAMPOCO (comparan lo que haya guardado, y ahora todo
-- está hasheado con el mismo pepper). Las funciones viejas de arreglo
-- (get_slot_availability_v2, check_cohort_conflicts) reciben ids crudos pero
-- están MUERTAS desde 00041 (el cliente usa las *_by_cohort); dejarlas es
-- inofensivo — no las llama nadie.
--
-- ⚠️ EL PEPPER ES CRÍTICO. Vive sólo en private.app_secrets (esquema NO expuesto
-- por PostgREST — pgrst.db_schemas = public, drv, pax — y sin permisos para
-- authenticated/anon). Si se pierde o se cambia, TODOS los hashes dejan de
-- cruzarse (los solapes se rompen en silencio) y no hay forma de saber qué id
-- era cada hash. Un backup de la base lo incluye; no borres ni cambies esa fila.
--
-- NOTA: la audiencia que existía con ids crudos se vació con TRUNCATE fuera de
-- esta migración (decisión "empezar limpio"), así no quedó PII crudo. Esta
-- migración no borra datos.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS private.app_secrets (
  name  text PRIMARY KEY,
  value text NOT NULL
);
REVOKE ALL ON private.app_secrets FROM PUBLIC;

-- Pepper: 32 bytes aleatorios generados EN la base. El valor real nunca aparece
-- en este archivo. ON CONFLICT DO NOTHING = idempotente: reaplicar no regenera.
INSERT INTO private.app_secrets (name, value)
VALUES ('audience_pepper', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.append_campaign_audience(p_campaign_id uuid, p_audience jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'drv'
AS $function$
DECLARE
  v_user_id uuid := auth.uid(); v_ok boolean; v_n integer; v_pepper text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM drv.campaigns
    WHERE id = p_campaign_id AND creator_id = v_user_id AND status = 'draft'
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Borrador no encontrado o no pertenece al usuario';
  END IF;

  SELECT value INTO v_pepper FROM private.app_secrets WHERE name = 'audience_pepper';
  IF v_pepper IS NULL THEN RAISE EXCEPTION 'audience_pepper no configurado'; END IF;

  -- drv_id se guarda como HMAC-SHA256 hex del id crudo (nunca el crudo).
  INSERT INTO drv.campaign_audience (campaign_id, drv_id, city_code)
  SELECT p_campaign_id,
         encode(extensions.hmac((a->>'drv_id')::text, v_pepper, 'sha256'), 'hex'),
         NULLIF((a->>'city_code')::text, '')::text
  FROM jsonb_array_elements(COALESCE(p_audience, '[]'::jsonb)) AS a
  ON CONFLICT (campaign_id, drv_id, city_code) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.append_campaign_audience_pax(p_campaign_id uuid, p_audience jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pax'
AS $function$
DECLARE
  v_user_id uuid := auth.uid(); v_ok boolean; v_n integer; v_pepper text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM pax.campaigns
    WHERE id = p_campaign_id AND creator_id = v_user_id AND status = 'draft'
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Borrador no encontrado o no pertenece al usuario';
  END IF;

  SELECT value INTO v_pepper FROM private.app_secrets WHERE name = 'audience_pepper';
  IF v_pepper IS NULL THEN RAISE EXCEPTION 'audience_pepper no configurado'; END IF;

  INSERT INTO pax.campaign_audience (campaign_id, pax_id, city_code)
  SELECT p_campaign_id,
         encode(extensions.hmac((a->>'pax_id')::text, v_pepper, 'sha256'), 'hex'),
         NULLIF((a->>'city_code')::text, '')::text
  FROM jsonb_array_elements(COALESCE(p_audience, '[]'::jsonb)) AS a
  ON CONFLICT (campaign_id, pax_id, city_code) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.append_campaign_audience(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_campaign_audience_pax(uuid,jsonb) TO authenticated;
