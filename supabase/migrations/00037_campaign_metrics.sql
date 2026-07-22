-- ============================================================
-- Migration 00037: performance metrics (CTR / CTOR)
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- Metrics ingested from the "CEi Comms Governance" Google Sheet by its
-- Apps Script (see scripts/google-apps-script/SyncMetrics.gs) through the
-- `ingest-metrics` Edge Function.
--
-- Rows are keyed by the EXTERNAL POPE / Ad Placement `campaign_id`, which
-- is the code operators type into a campaign's Event ID — that is the
-- join back to a CommsPlanner campaign. Raw counters are stored next to
-- the Sheet's own rates so CTR/CTOR can be re-aggregated correctly.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.campaign_metrics (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                 text NOT NULL CHECK (kind IN ('drv', 'pax')),
  country_code         text NOT NULL,
  external_campaign_id text NOT NULL,
  step_id              text NOT NULL DEFAULT '',
  template_id          text NOT NULL DEFAULT '',
  channel              text NOT NULL,
  comm_platform        text NOT NULL DEFAULT '',   -- POPE | AD PLACEMENT
  activity_name        text,
  creator              text,
  start_date           date,
  start_week           int,
  cohort_size          bigint,
  request_uv           bigint,
  send_uv              bigint,
  deliver_uv           bigint,
  arrive_uv            bigint,
  show_uv              bigint,
  click_uv             bigint,
  open_rate            numeric(8,2),
  ctr                  numeric(8,2),
  ctor                 numeric(8,2),
  source               text NOT NULL DEFAULT 'google-sheets',
  synced_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, country_code, external_campaign_id, step_id, template_id, channel, start_date)
);

CREATE INDEX IF NOT EXISTS campaign_metrics_lookup
  ON public.campaign_metrics (kind, external_campaign_id);

-- Reads go through the RPC below only; writes only via service role.
ALTER TABLE public.campaign_metrics ENABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS public.get_campaign_metrics(text);
CREATE OR REPLACE FUNCTION public.get_campaign_metrics(p_kind text)
RETURNS TABLE (
  external_campaign_id text,
  activity_name        text,
  channel              text,
  comm_platform        text,
  country_code         text,
  start_date           date,
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
      SELECT m.external_campaign_id, m.activity_name, m.channel, m.comm_platform,
             m.country_code, m.start_date, m.request_uv, m.send_uv, m.deliver_uv,
             m.arrive_uv, m.show_uv, m.click_uv, m.open_rate, m.ctr, m.ctor,
             c.id, c.name, m.synced_at
      FROM public.campaign_metrics m
      LEFT JOIN LATERAL (
        SELECT c2.id, c2.name
        FROM drv.campaigns c2
        WHERE c2.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(c2.event_ids, '[]'::jsonb)) e
            WHERE trim(e->>'value') = m.external_campaign_id
          )
        LIMIT 1
      ) c ON true
      WHERE m.kind = 'drv';
  ELSE
    RETURN QUERY
      SELECT m.external_campaign_id, m.activity_name, m.channel, m.comm_platform,
             m.country_code, m.start_date, m.request_uv, m.send_uv, m.deliver_uv,
             m.arrive_uv, m.show_uv, m.click_uv, m.open_rate, m.ctr, m.ctor,
             c.id, c.name, m.synced_at
      FROM public.campaign_metrics m
      LEFT JOIN LATERAL (
        SELECT c2.id, c2.name
        FROM pax.campaigns c2
        WHERE c2.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(c2.event_ids, '[]'::jsonb)) e
            WHERE trim(e->>'value') = m.external_campaign_id
          )
        LIMIT 1
      ) c ON true
      WHERE m.kind = 'pax';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_campaign_metrics(text) TO authenticated;
