-- ============================================================
-- Migration 00033: robust time_slot parsing for HH:MM-HH:MM ranges
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- Ad Placement channels now store free ranges ("10:00-16:00") in
-- campaign_schedules.time_slot. The overlap/buffer checks in the save
-- and slot-availability functions parsed time_slot with
-- split_part(time_slot, ':', 2)::integer, which crashes on ranges
-- ("00-16" is not an integer). Symptom: the SECOND campaign on the
-- same channel/date failed with `invalid input syntax for type
-- integer`, and slot availability crashed for every channel once any
-- range schedule existed.
--
-- This migration:
--   1. Adds public.time_slot_start_minutes(text): minutes-from-midnight
--      of the slot START for both "HH:MM" and "HH:MM-HH:MM"; NULL for
--      non-time strings (e.g. FULL_DAY), so comparisons simply skip them.
--   2. Surgically rewrites the 4 affected functions in place
--      (save_campaign_v2, save_campaign_pax, get_slot_availability_v2,
--      get_slot_availability_v2_pax), replacing the fragile expressions
--      with the helper. Two spelling variants are handled: the spaced
--      one written in migration 00028 (fresh databases) and the compact
--      one live in production (Studio hotfix). Idempotent: functions
--      already containing the helper are skipped; if neither variant is
--      found the migration fails loudly instead of silently keeping the
--      bug.
--
-- Applied to production via Supabase MCP on 2026-07-13 and verified:
-- overlapping range campaigns save as `pending`, availability returns
-- normally with stored ranges present.
-- ============================================================

CREATE OR REPLACE FUNCTION public.time_slot_start_minutes(p_slot text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
STRICT
AS $fn$
  SELECT CASE
    WHEN p_slot ~ '^\d{1,2}:\d{2}'
    THEN split_part(split_part(p_slot, '-', 1), ':', 1)::integer * 60
       + split_part(split_part(p_slot, '-', 1), ':', 2)::integer
    ELSE NULL
  END;
$fn$;

GRANT EXECUTE ON FUNCTION public.time_slot_start_minutes(text) TO authenticated, anon;

DO $mig$
DECLARE
  fn    record;
  v_def text;
  v_new text;
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('save_campaign_v2','save_campaign_pax',
                        'get_slot_availability_v2','get_slot_availability_v2_pax')
  LOOP
    v_def := pg_get_functiondef(fn.oid);
    IF position('time_slot_start_minutes' IN v_def) > 0 THEN
      CONTINUE; -- already patched
    END IF;

    v_new := v_def;
    -- spaced variant (as written in migration 00028)
    v_new := replace(v_new,
      $p$(split_part(cs.time_slot, ':', 1)::integer * 60 + split_part(cs.time_slot, ':', 2)::integer)$p$,
      'public.time_slot_start_minutes(cs.time_slot)');
    v_new := replace(v_new,
      $p$(split_part((s->>'time_slot')::text, ':', 1)::integer * 60 + split_part((s->>'time_slot')::text, ':', 2)::integer)$p$,
      $r$public.time_slot_start_minutes((s->>'time_slot')::text)$r$);
    v_new := replace(v_new,
      $p$(split_part(cs2.time_slot, ':', 1)::integer * 60 + split_part(cs2.time_slot, ':', 2)::integer)$p$,
      'public.time_slot_start_minutes(cs2.time_slot)');
    -- compact variant (live hotfix in production)
    v_new := replace(v_new,
      $p$(split_part(cs.time_slot,':',1)::integer*60 + split_part(cs.time_slot,':',2)::integer)$p$,
      'public.time_slot_start_minutes(cs.time_slot)');
    v_new := replace(v_new,
      $p$(split_part((s->>'time_slot')::text,':',1)::integer*60 + split_part((s->>'time_slot')::text,':',2)::integer)$p$,
      $r$public.time_slot_start_minutes((s->>'time_slot')::text)$r$);
    v_new := replace(v_new,
      $p$(split_part(cs2.time_slot,':',1)::integer*60 + split_part(cs2.time_slot,':',2)::integer)$p$,
      'public.time_slot_start_minutes(cs2.time_slot)');

    IF v_new = v_def THEN
      RAISE EXCEPTION 'time_slot range fix: expected pattern not found in %', fn.proname;
    END IF;

    EXECUTE v_new;
  END LOOP;
END;
$mig$;
