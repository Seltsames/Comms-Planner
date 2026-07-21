-- ============================================================
-- Migration 00035: saving a campaign always creates a new row
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- save_campaign_v2 / save_campaign_pax upserted by (creator_id, name):
-- a second campaign with the same name silently OVERWROTE the first
-- (UPDATE + delete its schedules/audience), so previously-saved
-- campaigns "disappeared" from the dashboard when the user saved
-- another one with a matching name. The campaign name is not a unique
-- key; every save from the Builder must INSERT a brand-new campaign.
--
-- This strips the name lookup and the UPDATE/DELETE branch from both
-- functions, keeping only the INSERT. Done via regexp_replace over
-- pg_get_functiondef so the large bodies are edited surgically in
-- place. Idempotent (skips functions already fixed); fails loudly if
-- the expected shape is not found.
--
-- Applied to production via Supabase MCP and verified live (rolled
-- back): two campaigns saved with the same name now yield two separate
-- rows, each keeping its own schedules and audience.
-- ============================================================
DO $mig$
DECLARE
  fn     record;
  v_def  text;
  v_new  text;
  v_side text;
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('save_campaign_v2', 'save_campaign_pax')
  LOOP
    v_def := pg_get_functiondef(fn.oid);
    IF position('name = p_name' IN v_def) = 0 THEN
      CONTINUE; -- already fixed
    END IF;
    v_side := CASE WHEN fn.proname = 'save_campaign_pax' THEN 'pax' ELSE 'drv' END;

    v_new := regexp_replace(
      v_def,
      format(
        'SELECT id INTO v_campaign_id\s+FROM %1$s\.campaigns\s+WHERE creator_id = v_user_id AND name = p_name LIMIT 1;\s+IF v_campaign_id IS NULL THEN\s+(INSERT INTO %1$s\.campaigns[\s\S]*?RETURNING id INTO v_campaign_id;)\s+ELSE[\s\S]*?END IF;',
        v_side
      ),
      '\1',
      'g'
    );

    IF v_new = v_def
       OR position('name = p_name' IN v_new) > 0
       OR position('RETURNING id INTO v_campaign_id;' IN v_new) = 0 THEN
      RAISE EXCEPTION 'always-insert fix: unexpected shape in %', fn.proname;
    END IF;

    EXECUTE v_new;
  END LOOP;
END;
$mig$;
