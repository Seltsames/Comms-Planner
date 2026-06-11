-- ============================================================
-- Migration 00002: Performance Indexes
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================

-- campaign_audience: GIN index on drv_id for O(1) per-driver overlap detection
-- Used by check_cohort_conflicts: WHERE drv_id = ANY($1)
CREATE INDEX idx_audience_drv_id ON public.campaign_audience(drv_id);

-- campaign_audience: lookup by campaign_id (for deletion, updates, joins)
CREATE INDEX idx_audience_campaign_id ON public.campaign_audience(campaign_id);

-- campaign_audience: per-city filtering (for general vs per-city override resolution)
CREATE INDEX idx_audience_city_code ON public.campaign_audience(city_code);

-- campaign_schedules: date-range scans (for slot availability, conflict detection)
CREATE INDEX idx_schedules_campaign_date
  ON public.campaign_schedules(campaign_id, schedule_date);

CREATE INDEX idx_schedules_date
  ON public.campaign_schedules(schedule_date);

-- campaigns: creator lookups (My Campaigns page, permission checks)
CREATE INDEX idx_campaigns_creator ON public.campaigns(creator_id);

-- campaigns: country filter (dashboard, conflict queries)
CREATE INDEX idx_campaigns_country ON public.campaigns(country);

-- campaigns: recent-first ordering (index page, admin list)
CREATE INDEX idx_campaigns_created_at ON public.campaigns(created_at DESC);

-- campaigns: (country, creator) composite for conflict queries
CREATE INDEX idx_campaigns_country_creator ON public.campaigns(country, creator_id);

-- campaigns: status filtering (pending vs approved vs rejected)
CREATE INDEX idx_campaigns_status ON public.campaigns(status);