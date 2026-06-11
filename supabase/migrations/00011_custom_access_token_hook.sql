-- ============================================================
-- Migration 00011: Custom Access Token Hook (domain guard)
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================

-- Server-side domain guard: only @didi-labs.com users can get a JWT.
-- The hook is called by Supabase Auth on every token refresh and issuance.
-- If the email domain is not allowed, the hook raises an exception and
-- Supabase Auth rejects the session.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_claims jsonb;
  v_email text;
BEGIN
  v_claims := event->'claims';
  v_email := lower(coalesce(v_claims->>'email', ''));

  IF v_email NOT LIKE '%@didi-labs.com' THEN
    RAISE EXCEPTION 'Email domain not allowed: %', v_email
      USING ERRCODE = '42501';
  END IF;

  RETURN event;
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)
  TO supabase_auth_admin;

REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)
  FROM PUBLIC, anon, authenticated;
