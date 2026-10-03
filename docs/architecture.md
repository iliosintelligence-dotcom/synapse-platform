# Synapse — Architecture Overview (Layer 1)

Synapse is an AI-native real estate intelligence platform for Nigeria. Layer 1 is the
foundation every future feature (Toju AI, CRM, verification pipeline, proximity
marketing, analytics) sits on. Nothing here is throwaway.

## Monorepo

Turborepo + npm workspaces.

```
synapse/
  apps/
    mobile/      Expo + Expo Router — consumer AND agency mobile experience
    dashboard/   Next.js App Router — agency web dashboard
  packages/
    types/       Shared enums, entities, DTOs, permission matrix. Zero deps.
    database/    Supabase client factory. The ONLY place supabase-js is imported.
    api/         Typed data-access modules + TanStack Query hooks.
    auth/        Zustand session store, useAuth hook, role routing.
    ui/          Design tokens + primitive component library (React Native).
  supabase/
    migrations/  SQL — schema, triggers, RLS. Applied in order.
  docs/
```

### Why these boundaries

- **types has zero dependencies** so every other package can import it without
  cycles. If two packages need the same interface, it lives here. Period.
- **database wraps supabase-js** behind `initDatabase()/getDb()` so the client is
  configured exactly once per app (with platform storage injected — MMKV on
  mobile), and so a future move off Supabase touches one file.
- **api is the only data-access layer.** UI components never run raw queries.
  Every read is wrapped in TanStack Query (`packages/api/src/hooks.ts`) with
  centralised query keys; mutations invalidate those keys.
- **auth owns session state**, not the apps. Both apps consume the same
  Zustand store; persistence backends are injected per platform.
- **ui is React Native.** Mobile consumes it directly. The dashboard maps the
  same token VALUES through Tailwind (`apps/dashboard/tailwind.config.ts`).
  Documented trade-off: shipping RN-web into Next.js adds build complexity for
  little Layer-1 value; the dashboard needs different information density
  anyway. The tokens are the contract, not the components. If drift becomes a
  problem, generate the Tailwind theme from `packages/ui/src/tokens.ts`
  (TODO documented there).

## Data flow

```
Screen → @synapse/api hook (TanStack Query) → api module → getDb() → Supabase
                                              ↑ types from @synapse/types
Security: enforced by Postgres RLS, never by the client.
```

## Scale posture (100k+ listings, 10k+ agencies)

- Listing reads are index-backed (`city`, `verification_status`, `is_active`,
  `trust_score desc`, `created_at desc`) and paginated at the API layer.
- PostGIS is enabled now; `properties.location` (geography) is auto-maintained
  by trigger from lat/lng, with a GiST index. Proximity features are a query
  away, not a migration away.
- `verification_nodes` and `tco_breakdown` are `jsonb` so the verification
  pipeline can evolve without DDL.
- Soft deletes everywhere (`deleted_at`) preserve history for the future
  attribution/analytics layers.

## Product-direction conflicts (documented per instruction)

1. **Shared UI vs. web dashboard** — see above; tokens shared, components not.
2. **Agency creation ordering** — an agency row can only be created after the
   owner's first authenticated session (RLS requires `auth.uid()`), so the
   agency-signup flow collects agency details first, then creates the record
   immediately after OTP verification. Acceptable: the gap is milliseconds.
3. **Cloudinary unsigned uploads** — clients upload via an unsigned preset
   (no secret on device). Asset *deletion* needs the Admin API and therefore
   an Edge Function (documented TODO in `packages/api/src/media.ts`).
