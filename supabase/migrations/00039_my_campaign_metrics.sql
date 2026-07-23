-- ============================================================
-- Migration 00039: métricas de las campañas propias ("Mis campañas")
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- Hermana de get_campaign_metrics (00038), con dos diferencias:
--   1. NO exige rol admin. "Mis campañas" la usa cualquier usuario
--      habilitado, y solo devuelve filas de campañas cuyo creator_id
--      es el propio usuario — el filtro es el dueño, no el rol.
--   2. Agrupa por (campaign_id, channel) en vez de por Event ID, para
--      que el frontend pinte las tarjetas dentro de cada campaña.
--
-- La unión con el reporte es por Event ID: cada valor de
-- campaigns.event_ids se cruza contra campaign_metrics.external_campaign_id.
-- Una campaña sin Event ID cargado no devuelve métricas (no es un bug).
--
-- Fórmulas idénticas a 00038 (verificadas contra los datos reales):
--   push (IPUSH*, SMS, …) : CTR = Click/Request,  CTOR = Click/Show
--   WHATSAPP y MAIL       : CTR = Show/Request,   CTOR = Show/Arrive
-- ("Received" en el reporte es la columna Request (UV); WhatsApp no
--  registra clics, por eso sus tasas se basan en Show.)
--
-- Los contadores se suman antes de calcular las tasas: promedio
-- ponderado por volumen, no promedio de porcentajes.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_my_campaign_metrics(text);
CREATE OR REPLACE FUNCTION public.get_my_campaign_metrics(p_kind text)
RETURNS TABLE (
  campaign_id uuid,
  channel     text,
  request_uv  bigint,
  arrive_uv   bigint,
  show_uv     bigint,
  click_uv    bigint,
  ctr         numeric,
  ctor        numeric,
  report_rows integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'drv', 'pax'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_kind = 'drv' THEN
    RETURN QUERY
    WITH mine AS (
      SELECT c.id AS cid, trim(e->>'value') AS ext
      FROM drv.campaigns c,
           LATERAL jsonb_array_elements(COALESCE(c.event_ids, '[]'::jsonb)) e
      WHERE c.creator_id = auth.uid()
        AND c.deleted_at IS NULL
        AND COALESCE(trim(e->>'value'), '') <> ''
    ),
    agg AS (
      SELECT mi.cid, m.channel AS ch,
             sum(m.request_uv)::bigint AS req, sum(m.arrive_uv)::bigint AS arr,
             sum(m.show_uv)::bigint AS shw, sum(m.click_uv)::bigint AS clk,
             count(*)::int AS n
      FROM mine mi
      JOIN public.campaign_metrics m
        ON m.kind = 'drv' AND m.external_campaign_id = mi.ext
      GROUP BY mi.cid, m.channel
    )
    SELECT a.cid, a.ch, a.req, a.arr, a.shw, a.clk,
           CASE WHEN upper(a.ch) IN ('WHATSAPP', 'MAIL')
                THEN CASE WHEN a.req > 0 THEN round(a.shw::numeric / a.req * 100, 2) END
                ELSE CASE WHEN a.req > 0 THEN round(a.clk::numeric / a.req * 100, 2) END
           END,
           CASE WHEN upper(a.ch) IN ('WHATSAPP', 'MAIL')
                THEN CASE WHEN a.arr > 0 THEN round(a.shw::numeric / a.arr * 100, 2) END
                ELSE CASE WHEN a.shw > 0 THEN round(a.clk::numeric / a.shw * 100, 2) END
           END,
           a.n
    FROM agg a;
  ELSE
    RETURN QUERY
    WITH mine AS (
      SELECT c.id AS cid, trim(e->>'value') AS ext
      FROM pax.campaigns c,
           LATERAL jsonb_array_elements(COALESCE(c.event_ids, '[]'::jsonb)) e
      WHERE c.creator_id = auth.uid()
        AND c.deleted_at IS NULL
        AND COALESCE(trim(e->>'value'), '') <> ''
    ),
    agg AS (
      SELECT mi.cid, m.channel AS ch,
             sum(m.request_uv)::bigint AS req, sum(m.arrive_uv)::bigint AS arr,
             sum(m.show_uv)::bigint AS shw, sum(m.click_uv)::bigint AS clk,
             count(*)::int AS n
      FROM mine mi
      JOIN public.campaign_metrics m
        ON m.kind = 'pax' AND m.external_campaign_id = mi.ext
      GROUP BY mi.cid, m.channel
    )
    SELECT a.cid, a.ch, a.req, a.arr, a.shw, a.clk,
           CASE WHEN upper(a.ch) IN ('WHATSAPP', 'MAIL')
                THEN CASE WHEN a.req > 0 THEN round(a.shw::numeric / a.req * 100, 2) END
                ELSE CASE WHEN a.req > 0 THEN round(a.clk::numeric / a.req * 100, 2) END
           END,
           CASE WHEN upper(a.ch) IN ('WHATSAPP', 'MAIL')
                THEN CASE WHEN a.arr > 0 THEN round(a.shw::numeric / a.arr * 100, 2) END
                ELSE CASE WHEN a.shw > 0 THEN round(a.clk::numeric / a.shw * 100, 2) END
           END,
           a.n
    FROM agg a;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_campaign_metrics(text) TO authenticated;
