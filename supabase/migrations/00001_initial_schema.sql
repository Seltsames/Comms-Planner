-- ============================================================
-- Migration 00001: Initial Schema
-- DiDi Comms Planner v2 — Supabase Cloud
-- ============================================================

-- --- Types ----------------------------------------------------

CREATE TYPE public.app_role AS ENUM ('admin', 'normal');

-- --- Tables --------------------------------------------------

-- Profiles: auto-created by trigger on auth.users signup
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  email TEXT NOT NULL,
  full_name TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User roles (admin flag set manually in Supabase Studio)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- Campaigns: no drv_ids column — audience is in campaign_audience
CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  team TEXT NOT NULL DEFAULT 'Brand Connection',
  sub_team TEXT,
  types TEXT[] NOT NULL DEFAULT '{}',
  action_keys TEXT[] NOT NULL DEFAULT '{}',
  country TEXT NOT NULL DEFAULT 'MX',
  city_codes TEXT[] NOT NULL DEFAULT '{}',
  csv_file_name TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  creator_id UUID REFERENCES auth.users(id) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Campaign schedules: one row per (campaign, action_key, date)
CREATE TABLE public.campaign_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
  action_key TEXT NOT NULL,
  schedule_date DATE NOT NULL,
  time_slot TEXT NOT NULL,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, action_key, schedule_date)
);

-- Campaign audience: one row per driver (normalized — KEY FIX)
-- city_code = NULL means general cohort DRV (used by all selected cities without per-city override)
-- city_code = 'MTY' etc. means per-city override DRV (only for that city)
CREATE TABLE public.campaign_audience (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
  drv_id TEXT NOT NULL,
  city_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, drv_id, city_code)
);

-- --- Row Level Security ---------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_audience ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "Users read own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins read all profiles" ON public.profiles
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update all profiles" ON public.profiles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- User roles
CREATE POLICY "Users read own role" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins manage all roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Campaigns
CREATE POLICY "Authenticated read campaigns" ON public.campaigns
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users create campaigns" ON public.campaigns
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Creators update own pending campaigns" ON public.campaigns
  FOR UPDATE USING (auth.uid() = creator_id AND status = 'pending');
CREATE POLICY "Admins update any campaign" ON public.campaigns
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete campaigns" ON public.campaigns
  FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

-- Campaign schedules (follows campaign permissions)
CREATE POLICY "Authenticated read schedules" ON public.campaign_schedules
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage schedules via campaign" ON public.campaign_schedules
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.campaigns
      WHERE id = campaign_id
        AND (creator_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

-- Campaign audience (follows campaign permissions)
CREATE POLICY "Authenticated read audience" ON public.campaign_audience
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage audience via campaign" ON public.campaign_audience
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.campaigns
      WHERE id = campaign_id
        AND (creator_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

-- --- Helpers --------------------------------------------------

-- Security definer function: check if user has a specific role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

-- --- Triggers -------------------------------------------------

-- Auto-create profile when a user signs up via auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1)
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();