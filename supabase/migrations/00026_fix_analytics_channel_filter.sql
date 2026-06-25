-- ============================================================
-- Migration 00026: Cascade p_channel filter in get_analytics_aggregates
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- The version in 00023 applied p_channel only to filtered_schedules, so
-- drivers_by_country / drivers_by_city / campaigns_by_country /
-- campaigns_by_city still counted drivers and campaigns that had NO
-- schedule in the chosen channel. Picking "WhatsApp" therefore still
-- surfaced push-reached drivers.
--
-- Fix: a campaign is only "active" for this query if it has at least one
-- schedule in the requested channel. Because every downstream CTE joins
-- through active_camps, the filter now propagates everywhere.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_analytics_aggregates(text, text);

DROP FUNCTION IF EXISTS public.get_analytics_aggregates(text, text);

CREATE OR REPLACE FUNCTION public.get_analytics_aggregates(
  p_country text DEFAULT NULL,
  p_channel text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_result jsonb;
BEGIN
  -- Admin gate
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  WITH
  -- Active campaigns filtered by country AND (implicitly) by channel.
  active_camps AS (
    SELECT id, name, team, country, city_codes
    FROM public.campaigns c
    WHERE status NOT IN ('rejected', 'cancelled')
      AND (p_country IS NULL OR p_country = 'all' OR country = p_country)
      AND (
        p_channel IS NULL OR p_channel = 'all'
        OR EXISTS (
          SELECT 1 FROM public.campaign_schedules cs
          WHERE cs.campaign_id = c.id
            AND cs.action_key = p_channel
        )
      )
  ),
  filtered_schedules AS (
    SELECT cs.id, cs.campaign_id, cs.action_key, cs.schedule_date
    FROM public.campaign_schedules cs
    JOIN active_camps ac ON ac.id = cs.campaign_id
    WHERE (p_channel IS NULL OR p_channel = 'all' OR cs.action_key = p_channel)
  ),
  active_audience AS (
    SELECT ca.campaign_id, ca.drv_id, ca.city_code, ac.country AS camp_country
    FROM public.campaign_audience ca
    JOIN active_camps ac ON ac.id = ca.campaign_id
  ),
  per_camp_drivers AS (
    SELECT campaign_id, COUNT(DISTINCT drv_id) AS drivers
    FROM active_audience
    GROUP BY campaign_id
  ),
  per_camp_comms AS (
    SELECT campaign_id,
           COUNT(*) AS comms,
           COUNT(DISTINCT schedule_date) AS days
    FROM filtered_schedules
    GROUP BY campaign_id
  ),
  drivers_by_country AS (
    SELECT camp_country AS country,
           COUNT(DISTINCT drv_id) AS cnt
    FROM active_audience
    GROUP BY camp_country
    ORDER BY cnt DESC
  ),
  drivers_by_city AS (
    SELECT city_code, camp_country AS country, COUNT(DISTINCT drv_id) AS cnt
    FROM active_audience
    WHERE city_code IS NOT NULL
    GROUP BY city_code, camp_country
    ORDER BY cnt DESC
    LIMIT 50
  ),
  camps_by_country AS (
    SELECT ac.country,
           COUNT(DISTINCT ac.id) AS campaign_count,
           COUNT(DISTINCT fs.id) AS comm_count,
           COUNT(DISTINCT ca.drv_id) AS driver_count
    FROM active_camps ac
    LEFT JOIN filtered_schedules fs ON fs.campaign_id = ac.id
    LEFT JOIN active_audience ca ON ca.campaign_id = ac.id
    GROUP BY ac.country
    ORDER BY campaign_count DESC
  ),
  camps_by_city AS (
    SELECT
      unnested_city AS city_code,
      ac.country,
      COUNT(DISTINCT ac.id) AS campaign_count,
      COUNT(DISTINCT ca.drv_id) AS driver_count
    FROM active_camps ac
    CROSS JOIN LATERAL unnest(ac.city_codes) AS unnested_city
    LEFT JOIN active_audience ca ON ca.campaign_id = ac.id
    GROUP BY unnested_city, ac.country
    ORDER BY campaign_count DESC
    LIMIT 50
  ),
  driver_totals AS (
    SELECT
      ca.drv_id,
      COUNT(*) AS total_comms,
      array_agg(DISTINCT fs.action_key) FILTER (WHERE fs.action_key IS NOT NULL) AS channels,
      array_agg(DISTINCT ac.name) AS campaigns
    FROM active_audience ca
    JOIN active_camps ac ON ac.id = ca.campaign_id
    LEFT JOIN filtered_schedules fs ON fs.campaign_id = ca.campaign_id
    GROUP BY ca.drv_id
  ),
  top_drivers AS (
    SELECT drv_id, total_comms AS count, channels, campaigns
    FROM driver_totals
    ORDER BY total_comms DESC
    LIMIT 10
  ),
  per_camp_drv_list AS (
    SELECT campaign_id, drivers
    FROM per_camp_drivers
  )
  SELECT jsonb_build_object(
    'kpis', jsonb_build_object(
      'total_comms',     (SELECT COUNT(*) FROM filtered_schedules),
      'total_drivers',   (SELECT COUNT(DISTINCT drv_id) FROM active_audience),
      'total_campaigns', (SELECT COUNT(DISTINCT campaign_id) FROM filtered_schedules),
      'total_countries', (SELECT COUNT(DISTINCT country) FROM active_camps),
      'total_cities',    (
        SELECT COUNT(DISTINCT city)
        FROM (SELECT unnest(city_codes) AS city FROM active_camps) x
        WHERE city IS NOT NULL
      ),
      'total_days',      (SELECT COUNT(DISTINCT schedule_date) FROM filtered_schedules)
    ),
    'top_drivers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'drv_id', drv_id, 'count', count,
        'channels',  to_jsonb(COALESCE(channels, '{}'::text[])),
        'campaigns', to_jsonb(COALESCE(campaigns, '{}'::text[]))
      ) ORDER BY count DESC)
      FROM top_drivers
    ), '[]'::jsonb),
    'drivers_by_country', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('country', country, 'count', cnt))
      FROM drivers_by_country
    ), '[]'::jsonb),
    'drivers_by_city', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('city', city_code, 'country', country, 'count', cnt))
      FROM drivers_by_city
    ), '[]'::jsonb),
    'campaigns_by_country', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'country', country, 'campaigns', campaign_count,
        'comms', comm_count, 'drivers', driver_count
      ))
      FROM camps_by_country
    ), '[]'::jsonb),
    'campaigns_by_city', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'city', city_code, 'country', country,
        'campaigns', campaign_count, 'drivers', driver_count
      ))
      FROM camps_by_city
    ), '[]'::jsonb),
    'per_campaign_drivers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('campaign_id', campaign_id, 'drivers', drivers))
      FROM per_camp_drv_list
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_analytics_aggregates(text, text) TO authenticated;
