-- ============================================================
-- Migration 00013: Fix mutable search_path on auth hook
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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
