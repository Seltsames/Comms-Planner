# DiDi CommsPlanner

> Two apps sharing one codebase and one Supabase project: plan and review
> marketing communications for **drivers** (DRV) and **passengers** (PAX)
> across 8 LATAM countries for DiDi Labs. Push, WhatsApp, email, SMS,
> pop-ups, XPanel. Built as a React 18 + TypeScript SPA on top of Supabase
> with two Postgres schemas (`drv`, `pax`) holding entirely separate
> campaign data.

## What it does

`CommsPlanner` lets a marketing operator:

1. **Sign in** with a Google Workspace account in the `didi-labs.com` domain
   (server-side guard via a Supabase Auth hook).
2. **Pick a side** after login on the `/choose-platform` screen, limited to
   the platform(s) an admin granted in `profiles.platform_access` (users
   with a single grant skip the chooser; admins always have both). Users
   with both grants can also flip the navbar pill to switch mid-session.
   The choice persists in `localStorage`, and everything the user sees,
   creates and queries stays isolated to that platform (client route
   guards + a `BEFORE INSERT` trigger on `drv.campaigns` / `pax.campaigns`
   that rejects writes without the matching grant).
3. **Plan a campaign** in a 2-step Builder scoped to the current side:
   - Step 1: pick team (DRV has the legacy four-team hierarchy with
     sub-teams; PAX is the flat six-team list `Brand Field / Growth /
     Product / AR HUB + InEx / Premier / Índice`), country, cities, type
     (POPE / Ad Placement), date (single day or range up to 30 days) and
     **upload a CSV cohort** of IDs (15-digit strings starting with `6509`,
     same format for both audiences for now). A web worker parses and
     de-duplicates the file with progress reporting.
   - Step 2: pick channels and concrete time slots. `get_slot_availability_v2`
     (DRV) / `get_slot_availability_v2_pax` (PAX) returns a green / yellow /
     red severity per slot using per-ID daily limits (max 3 push/day, 2
     WhatsApp/day) and a ±1h buffer against approved / pending campaigns
     on the **same side only**.
4. **Save** via `save_campaign_v2` (DRV) or `save_campaign_pax` (PAX). The
   server decides the status:
   - push always goes to `pending` (manual approval),
   - any overlap conflict → `pending`,
   - otherwise `approved` (auto).
5. **Inspect** their own campaigns (`/{drv|pax}/my-campaigns`) with the
   option to cancel.
6. **Admins** (single shared admin role) get extra screens:
   - `/admin/campaigns?kind={drv|pax}` — approve, reject or hard-delete any
     campaign on either side.
   - `/admin/users` — enable / disable accounts, grant / revoke the `admin`
     role, and toggle per-user DRV / PAX platform access. Mutations go
     through the `admin-users` Edge Function (service-role, audit-logged).
   - Dashboard tab "Análisis" — server-side aggregates (`get_analytics_aggregates`
     / `get_analytics_aggregates_pax`) computed in Postgres so the client
     never downloads the raw `campaign_audience` table.
7. **Pending-approval screen** for users that authenticated successfully
   but have not been enabled by an admin yet.

The form state (Step 1, Step 2, slot selection, cohort) lives in a
`CampaignBuilderProvider` mounted above the route tree. There is **one
slice per audience kind**, so:

- Navigating Builder → Dashboard → My Campaigns keeps your DRV form intact.
- Switching DRV ↔ PAX keeps both forms intact; each side remembers its
  own team, city set, cohort, slots, etc.

Auth, RLS policies, audit log, slot-blocking rules, push-day limit and
analytics aggregates are all enforced in PostgreSQL (see
`supabase/migrations/`) so the client is intentionally thin.

## URL layout

```
/login
/auth/callback
/pending-approval
/choose-platform      → post-login platform picker (per-user access)

# Driver-side app
/drv                  → DRV builder (Index)
/drv/my-campaigns     → DRV my campaigns

# Passenger-side app
/pax                  → PAX builder (Index)
/pax/my-campaigns     → PAX my campaigns

# Shared admin (kind in ?kind=)
?kind=drv             → admin campaigns, DRV
/admin/users          → admin user management (shared)

# Legacy redirects
/                     → /drv
/my-campaigns         → /drv/my-campaigns
```

## Stack

| Layer       | Tech                                                                 |
|-------------|----------------------------------------------------------------------|
| UI          | React 18 + TypeScript (strict), Vite 5, TailwindCSS 3, lucide-react  |
| Routing     | react-router-dom 6                                                   |
| State       | React context: `AuthProvider` (identity + `audienceKind`) + `CampaignBuilderProvider` (form state) |
| Backend     | Supabase Postgres with **three schemas**: `public` (identity + helpers), `drv` (driver data), `pax` (passenger data) |
| Edge Funcs  | Deno — `admin-users` (service-role admin mutations + audit log)       |
| CSV parsing | Web Worker (`csvParser.worker.ts`) for non-blocking cohort uploads    |
| Hosting     | Netlify (`netlify.toml`) with SPA fallback to `index.html`           |

## Repository layout

```
.
├── index.html
├── netlify.toml                  # build, headers, SPA redirect
├── package.json / lock
├── tailwind.config.js
├── tsconfig.json (+ app / node)
├── vite.config.ts                # "@/" → "./src"
├── scripts/                      # standalone CSV/regex sanity scripts
├── src/
│   ├── main.tsx                  # BrowserRouter + AuthProvider root
│   ├── App.tsx                   # /drv/*, /pax/*, /admin/* routes + guards
│   ├── index.css                 # Tailwind layers + body baseline
│   ├── vite-env.d.ts             # VITE_SUPABASE_* env types
│   ├── components/               # Layout, Navbar (with kind switcher), TimeSlotPicker, DashboardView, …
│   ├── features/cohorts/         # CohortUploader, csvParser.worker, CohortConflictPreview
│   ├── hooks/useAutoRefresh.ts   # tiny polling hook (60s default)
│   ├── lib/
│   │   ├── auth.tsx              # OAuth + profile + role + isEnabled + audienceKind
│   │   ├── campaignBuilder.tsx   # per-kind form-state context (preserved across nav)
│   │   ├── supabase.ts           # typed client (uses publishable key)
│   │   ├── queries.ts            # RPC wrappers that dispatch by audienceKind
│   │   └── constants.ts          # DRV_TEAMS_HIERARCHY, PAX_TEAMS, channels, CSV_VALIDATORS
│   ├── pages/                    # Login, Index, MyCampaigns, Admin*, NotFound, PendingApproval
│   └── types/database.ts         # hand-maintained Database typings (public + drv + pax)
└── supabase/
    ├── migrations/00001 … 00030  # schema split, RLS, RPCs, platform access
    └── functions/admin-users/    # Edge Function (Deno) — enable/disable/grant/revoke admin
```

## Schema strategy: two Postgres schemas in one project

```
public:
  profiles (incl. platform_access), user_roles, admin_audit_log, app_role
  has_role(), has_platform_access(), enforce_platform_access() trigger fn,
  current_user_is_enabled(), custom_access_token_hook()
  handle_new_user() trigger, update_updated_at_column()
  save_campaign_v2, save_campaign_pax, cancel_*_pax, approve_*_pax,
  reject_*_pax, delete_*_pax, get_slot_availability_v2(_pax),
  check_cohort_conflicts(_pax), get_analytics_aggregates(_pax)

drv:
  campaigns, campaign_audience (drv_id), campaign_schedules

pax:
  campaigns, campaign_audience (pax_id), campaign_schedules
```

- **No cross-schema queries.** DRV and PAX are kept fully isolated; the
  client never joins between them and the SQL surface never exposes a
  "list all campaigns" query that spans both.
- **Per-side RLS policies** mirror each other. The same admin role
  (`public.has_role(uid, 'admin')`) can manage either side.
- **Direct table access** via PostgREST works for both schemas
  (`supabase.schema('drv').from('campaigns')` / `supabase.schema('pax')`).
- **RPCs are duplicated per side** (`save_campaign_v2` vs `save_campaign_pax`,
  `cancel_campaign` vs `cancel_campaign_pax`, etc.). All live in `public`
  so PostgREST auto-discovers them.
- PostgREST is configured to expose `public, drv, pax` via
  `ALTER ROLE authenticator SET pgrst.db_schemas = 'public, drv, pax'`.
- Migration `00028_schema_split_drv_pax.sql` does the whole split in one
  transaction: creates the schemas, moves the existing tables to `drv`,
  creates the `pax` mirrors with their own indexes and RLS, rebuilds
  every RPC to use schema-qualified table names, and creates the `_pax`
  counterparts.

If the two apps ever need to be deployed as independent Supabase
projects, dump the `pax` schema and ship it — no shared state to
reconcile.

## Local setup

```bash
npm install
```

Create `.env.local` (git-ignored):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # or legacy anon JWT
```

Apply migrations against your Supabase project (in numeric order) and deploy
the Edge Function:

```bash
supabase db push
supabase functions deploy admin-users --no-verify-jwt
```

Run the dev server:

```bash
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build → dist/
npm run preview
```

On Google Cloud Console, add
`http://localhost:5173/auth/callback` (and your prod URL) as authorized OAuth
redirect URIs and configure the Google provider inside Supabase Auth with
`hd=didi-labs.com`.

After applying migrations, complete the one **manual** Supabase Auth step
that cannot be done from SQL:

1. Open Supabase Studio → **Authentication → Hooks**.
2. Enable the **Custom Access Token Hook** and point it at
   `public.custom_access_token_hook`.
3. Verify everything by running (as any authenticated user):

   ```sql
   SELECT * FROM public.check_auth_hook_setup();
   ```

   The first three rows should report `OK`; the last row is the manual
   reminder and will always say `UNKNOWN` from SQL.

## Identified failures / status

> Original 16-item audit addressed in a single pass. Migration `00028` then
> introduced the DRV / PAX schema split.

| #  | Severity | Status   | Description |
|----|----------|----------|-------------|
| 1  | 🔴       | ✅ Fixed | `save_campaign_v2` signature drift — restored to 13 params + `RETURNS text` in migration `00024`; same shape maintained after the schema split in `00028`. |
| 2  | 🔴       | ✅ Fixed | Missing `00018` migration — added no-op placeholder. |
| 3  | 🔴       | ✅ Fixed | `saveCampaignRpc` return type mismatch — SQL now `RETURNS text`. |
| 4  | 🟠       | ✅ Fixed | `custom_access_token_hook` not registered — `check_auth_hook_setup()` helper added in `00027`. Manual Studio step documented in setup. |
| 5  | 🟠       | ✅ Fixed | `delete_campaign_hard` swallowed creator-not-found — fixed in `00025`. |
| 6  | 🟠       | ✅ Fixed | `analytics_aggregates` channel filter not cascading — `active_camps` now requires ≥1 schedule in the chosen channel in `00026`. |
| 7  | 🟠       | ✅ Fixed | Dead `filterCreator` state in `DashboardView` — removed. |
| 8  | 🟠       | ✅ Fixed | Dead exports — removed `getSlotAvailability`, `fetchDashboardStats`, `fetchAnalyticsAggregates`, `SlotAvailability` type. |
| 9  | 🟡       | ✅ Fixed | `@types/node ^25.9.3` → `^22.10.5`; `lucide-react ^1.17.0` → `^0.469.0`; `vite.config.ts` now uses `import.meta.url`. |
| 10 | 🟡       | ✅ Fixed | Dashboard `totalVolume` always 0 — removed the dead metric. |
| 11 | 🟡       | ✅ Fixed | Duplicate `CHANNEL_COLORS` — extracted to `src/lib/channelStyles.ts`. |
| 12 | 🟡       | ✅ Fixed | Dead `public/_redirects` — deleted (`netlify.toml` is canonical). |
| 13 | 🟡       | ✅ Fixed | Unused `url` in `signInWithGoogle` return type — dropped. |
| 14 | 🟡       | ✅ Fixed | "(mock)" label in `SaveSuccessModal` download button — removed. |
| 15 | 🟡       | ✅ Fixed | `extractUsername` permissive regex — simplified to "everything before the first `@`". |
| 16 | 🟢       | ✅ Fixed | Polish: `*.tsbuildinfo` added to `.gitignore`, `scripts/test-cohort.mjs` accepts a CSV path arg, shared formatters live in `src/lib/format.ts`. |

> The only **remaining manual step** is registering the custom access token
> hook in Supabase Studio (failure #4). Until that is done, the
> @didi-labs.com domain guard lives only on the client-side `hd` query
> parameter.

## Operational notes

- `dist/` is not committed. CI / Netlify runs `npm run build` which produces
  it.
- Production logs should be tail-watched via Supabase: `auth`, `postgres`,
  `edge-function` (the `admin-users` function).
- For first-time admin bootstrap: insert a row into `public.user_roles` with
  `role = 'admin'` for the desired user_id; then `is_enabled = true` from
  `/admin/users` once another admin exists.
- All RLS policies for DRV live on the `drv.*` tables (moved from `public.*`
  in `00028`); mirror policies live on `pax.*`. Both reference
  `public.has_role()` for admin gating.
- The audience kind for a new request is determined by the URL
  (`/drv/...` vs `/pax/...`), mirrored by an `audienceKind` value in the
  AuthProvider (persisted to `localStorage` under
  `commplanner.audience_kind`). The navbar switcher updates both.
- Per-side RPC names: `save_campaign_v2` → DRV, `save_campaign_pax` → PAX
  (same pattern for `cancel_*`, `approve_*`, `reject_*`, `delete_*`,
  `get_slot_availability_v2`, `check_cohort_conflicts`,
  `get_analytics_aggregates`). All live in `public` schema for PostgREST
  auto-discovery.
- Helper modules worth knowing:
  - `src/lib/format.ts` — `formatNumber`, `formatDateShort`,
    `formatDateWithWeekday`, `formatDateLong`, `formatBytes`.
  - `src/lib/channelStyles.ts` — `CHANNEL_COLORS` + `getChannelColor()`.
  - `src/lib/campaignBuilder.tsx` — `CampaignBuilderProvider` /
    `useCampaignBuilder`. One `BuilderState` per `audienceKind`; switching
    kinds swaps which slice is exposed without losing either.

---

_Last reviewed against commit on disk (Jun 2026). Please update this README
when migrations or RPC signatures change._
