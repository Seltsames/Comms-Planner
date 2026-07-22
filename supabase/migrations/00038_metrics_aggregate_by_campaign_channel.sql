-- ============================================================
-- Migration 00038: aggregate metrics per campaign + channel
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- 1. One row per (campaign, channel). The governance report splits a
--    campaign across many step_id / template_id / date rows, but they
--    are the same campaign, so counters are summed and the rates
--    recomputed from the totals — a volume-weighted average. Averaging
--    the percentages instead would give a tiny send the same weight as
--    a 300k one.
-- 2. Rate formulas, verified against the synced production data:
--      push (IPUSH*, SMS, …) : CTR = Click/Request,  CTOR = Click/Show
--      WHATSAPP y MAIL       : CTR = Show/Request,   CTOR = Show/Arrive
--      Open Rate (todos)     : Show/Request
--    ("Received" en el reporte es la columna Request (UV); WhatsApp no
--    registra clics, por eso sus tasas se basan en Show.)
-- ============================================================

DROP FUNCTION IF EXISTS public.get_campaign_metrics(text);
CREATE OR REPLACE FUNCTION public.get_campaign_metrics(p_kind text)
RETURNS TABLE (
  external_campaign_id text,
  activity_name        text,
  channel              text,
  comm_platform        text,
  country_code         text,
  first_date           date,
  last_date            date,
  report_rows          int,
  request_uv           bigint,
  send_uv              bigint,
  deliver_uv           bigint,
  arrive_uv            bigint,
  show_uv              bigint,
  click_uv             bigint,
  open_rate            numeric,
  ctr                  numeric,
  ctor                 numeric,
  campaign_id          uuid,
  campaign_name        text,
  synced_at            timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, drv, pax
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_platform_admin(auth.uid(), p_kind) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  IF p_kind = 'drv' THEN
    RETURN QUERY
    WITH agg AS (
      SELECT m.external_campaign_id AS ext, m.channel AS ch, m.comm_platform AS plat,
             m.country_code AS cc,
             max(m.activity_name) AS act,
             min(m.start_date) AS d1, max(m.start_date) AS d2,
             count(*)::int AS n,
             sum(m.request_uv)::bigint AS req, sum(m.send_uv)::bigint AS snd,
             sum(m.deliver_uv)::bigint AS del, sum(m.arrive_uv)::bigint AS arr,
             sum(m.show_uv)::bigint AS shw, sum(m.click_uv)::bigint AS clk,
             max(m.synced_at) AS sync
      FROM public.campaign_metrics m
      WHERE m.kind = 'drv'
      GROUP BY m.external_campaign_id, m.channel, m.comm_platform, m.country_code
    )
    SELECT a.ext, a.act, a.ch, a.plat, a.cc, a.d1, a.d2, a.n,
           a.req, a.snd, a.del, a.arr, a.shw, a.clk,
           CASE WHEN a.req > 0 THEN round(a.shw::numeric / a.req * 100, 2) END,
           CASE WHEN upper(a.ch) IN ('WHATSAPP', 'MAIL')
                THEN CASE WHEN a.req > 0 THEN round(a.shw::numeric / a.req * 100, 2) END
                ELSE CASE WHEN a.req > 0 THEN round(a.clk::numeric / a.req * 100, 2) END
           END,
           CASE WHEN upper(a.ch) IN ('WHATSAPP', 'MAIL')
                THEN CASE WHEN a.arr > 0 THEN round(a.shw::numeric / a.arr * 100, 2) END
                ELSE CASE WHEN a.shw > 0 THEN round(a.clk::numeric / a.shw * 100, 2) END
           END,
           c.id, c.name, a.sync
    FROM agg a
    LEFT JOIN LATERAL (
      SELECT c2.id, c2.name FROM drv.campaigns c2
      WHERE c2.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(c2.event_ids, '[]'::jsonb)) e
                    WHERE trim(e->>'value') = a.ext)
      LIMIT 1
    ) c ON true;
  ELSE
    RETURN QUERY
    WITH agg AS (
      SELECT m.external_campaign_id AS ext, m.channel AS ch, m.comm_platform AS plat,
             m.country_code AS cc,
             max(m.activity_name) AS act,
             min(m.start_date) AS d1, max(m.start_date) AS d2,
             count(*)::int AS n,
             sum(m.request_uv)::bigint AS req, sum(m.send_uv)::bigint AS snd,
             sum(m.deliver_uv)::bigint AS del, sum(m.arrive_uv)::bigint AS arr,
             sum(m.show_uv)::bigint AS shw, sum(m.click_uv)::bigint AS clk,
             max(m.synced_at) AS sync
      FROM public.campaign_metrics m
      WHERE m.kind = 'pax'
      GROUP BY m.external_campaign_id, m.channel, m.comm_platform, m.country_code
    )
    SELECT a.ext, a.act, a.ch, a.plat, a.cc, a.d1, a.d2, a.n,
           a.req, a.snd, a.del, a.arr, a.shw, a.clk,
           CASE WHEN a.req > 0 THEN round(a.shw::numeric / a.req * 100, 2) END,
           CASE WHEN upper(a.ch) IN ('WHATSAPP', 'MAIL')
                THEN CASE WHEN a.req > 0 THEN round(a.shw::numeric / a.req * 100, 2) END
                ELSE CASE WHEN a.req > 0 THEN round(a.clk::numeric / a.req * 100, 2) END
           END,
           CASE WHEN upper(a.ch) IN ('WHATSAPP', 'MAIL')
                THEN CASE WHEN a.arr > 0 THEN round(a.shw::numeric / a.arr * 100, 2) END
                ELSE CASE WHEN a.shw > 0 THEN round(a.clk::numeric / a.shw * 100, 2) END
           END,
           c.id, c.name, a.sync
    FROM agg a
    LEFT JOIN LATERAL (
      SELECT c2.id, c2.name FROM pax.campaigns c2
      WHERE c2.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(c2.event_ids, '[]'::jsonb)) e
                    WHERE trim(e->>'value') = a.ext)
      LIMIT 1
    ) c ON true;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_campaign_metrics(text) TO authenticated;
