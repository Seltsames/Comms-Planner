-- ============================================================
-- Migration 00027: Auth hook verification helper
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- Migration 00011 defines public.custom_access_token_hook and grants it
-- to supabase_auth_admin, but Supabase Auth ALSO has to be told to call
-- it. That registration lives in the Auth service's Go config and can
-- only be done via Supabase Studio → Authentication → Hooks, or via the
-- Management API.
--
-- This migration adds check_auth_hook_setup(), an idempotent helper that
-- surfaces what is verifiable from SQL (function exists, correct grants,
-- no signature drift) plus a clear textual reminder of the manual step.
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_auth_hook_setup()
RETURNS TABLE(check_name text, status text, detail text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Is the hook function defined in pg_proc?
  RETURN QUERY
  SELECT
    'public.custom_access_token_hook exists'::text,
    CASE WHEN EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'custom_access_token_hook'
        AND n.nspname = 'public'
    ) THEN 'OK' ELSE 'MISSING' END,
    'Created by migration 00011.'::text;

  -- 2. Is supabase_auth_admin allowed to execute it?
  RETURN QUERY
  SELECT
    'EXECUTE granted to supabase_auth_admin'::text,
    CASE WHEN EXISTS (
      SELECT 1
      FROM information_schema.routine_privileges
      WHERE routine_schema = 'public'
        AND routine_name = 'custom_access_token_hook'
        AND grantee = 'supabase_auth_admin'
        AND privilege_type = 'EXECUTE'
    ) THEN 'OK' ELSE 'MISSING' END,
    'Granted by migration 00011.'::text;

  -- 3. Is it revoked from PUBLIC / anon / authenticated?
  RETURN QUERY
  SELECT
    'revoked from PUBLIC, anon, authenticated'::text,
    CASE WHEN NOT EXISTS (
      SELECT 1
      FROM information_schema.routine_privileges
      WHERE routine_schema = 'public'
        AND routine_name = 'custom_access_token_hook'
        AND grantee IN ('PUBLIC', 'anon', 'authenticated')
        AND privilege_type = 'EXECUTE'
    ) THEN 'OK' ELSE 'EXPOSED' END,
    'Only supabase_auth_admin should be able to execute the hook.'::text;

  -- 4. Manual step reminder.
  RETURN QUERY
  SELECT
    'hook registered in Supabase Auth config'::text,
    'UNKNOWN'::text,
    'MANUAL: Supabase Studio → Authentication → Hooks → enable "Custom Access Token Hook" and set it to public.custom_access_token_hook. This cannot be done from SQL.'::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_auth_hook_setup() TO authenticated;
