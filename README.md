# DiDi Comms Planner — v2

Rebuild of the DiDi Comms Planner prototype, scoped to a minimal Vite + React + Tailwind app that's ready to ship to Netlify while the real backend is rebuilt.

## Stack

- Vite 5 + React 18 + TypeScript
- Tailwind CSS 3 (custom `brand-*` orange palette)
- React Router 6
- Mock auth persisted in `localStorage` (will swap to Supabase Auth later)

No other dependencies on purpose — every library we add now is one more thing to remove later.

## Scripts

```sh
npm install
npm run dev      # local dev on http://localhost:5173
npm run build    # typecheck + production build to ./dist
npm run preview  # serve the production build locally
```

## Deploy to Netlify

This repo already includes `netlify.toml` and `public/_redirects`, so a straight "deploy from Git" will work out of the box:

- Build command: `npm run build`
- Publish directory: `dist`
- Node version: 20 (set in `netlify.toml`)

Or one-shot from the CLI:

```sh
npm i -g netlify-cli
netlify deploy --prod
```

## Project layout

```
src/
  App.tsx              # route table + auth guards
  main.tsx             # bootstrap (BrowserRouter + AuthProvider)
  index.css            # Tailwind layers + globals
  lib/
    auth.tsx           # mock AuthContext (localStorage-backed)
    constants.ts       # teams, comm types, action keys, countries
  components/
    Layout.tsx         # page shell
    Navbar.tsx         # top nav with role badge + sign out
    Ui.tsx             # PageHeader, Card, Placeholder, KpiTile primitives
  pages/
    Login.tsx
    ChangePassword.tsx
    Index.tsx          # Builder + Dashboard tabs (placeholder state)
    MyCampaigns.tsx
    AdminUsers.tsx
    NotFound.tsx
```

## Mock auth

The current `useAuth` accepts any valid email + 6+ char password. Emails starting with `admin` get the admin role. State is persisted in `localStorage` under `didi-comms-planner.auth` so refreshes don't kick you out.

Swap this for real auth by replacing `src/lib/auth.tsx` with a Supabase Auth hook — the rest of the app talks only to `useAuth()`.

## What's intentionally NOT here yet

- shadcn / Radix / Recharts / xlsx / date-fns — we'll add them per-feature when the new backend lands
- Supabase client — coming when the self-hosted stack is up
- Server-side validation, conflict engine, XLSX export, image pipeline — all per the perf-fixes plan

See `../performance-fixes.txt` for the rollout order.
