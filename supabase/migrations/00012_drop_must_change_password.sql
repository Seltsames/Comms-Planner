-- ============================================================
-- Migration 00012: Drop must_change_password
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================
-- Google OAuth means there are no passwords to change.
-- Removing the column.

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS must_change_password;
