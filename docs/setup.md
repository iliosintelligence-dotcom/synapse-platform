# Local Development Setup

## Prerequisites
- Node 20+, npm 10+
- Supabase account (or `supabase` CLI for a local stack)
- Cloudinary account (free tier fine)
- Expo Go on a device, or Android Studio / Xcode simulators

## 1. Install
```bash
cd synapse-platform
npm install
```

## 2. Supabase
1. Create a project at supabase.com (or `supabase init && supabase start`).
2. Apply migrations **in order** via SQL editor or CLI:
   - `supabase/migrations/0001_extensions.sql`
   - `supabase/migrations/0002_schema.sql`
   - `supabase/migrations/0003_rls.sql`
   (CLI: `supabase db push` after `supabase link`.)
3. Auth → Providers: enable **Email (OTP)**; add **Google** and **Apple**
   credentials when ready (the code paths already exist).
4. Copy the project URL + anon key.

## 3. Cloudinary
1. Create an **unsigned upload preset** named `synapse_unsigned`,
   scoped to the `synapse/` folder.
2. Note your cloud name.

## 4. Environment
```bash
cp apps/mobile/.env.example apps/mobile/.env
cp apps/dashboard/.env.example apps/dashboard/.env.local
# fill in Supabase URL/anon key + Cloudinary cloud/preset
```

## 5. Run
```bash
# Everything
npm run dev

# Or individually
npm run dev --workspace mobile      # Expo (press a/i/w)
npm run dev --workspace dashboard   # Next.js on :3100
```

## 6. Verify
```bash
npm run typecheck   # all packages, strict TS
npm run lint
```

## First accounts
- Mobile → "Find a home" → consumer OTP signup → lands on consumer tabs.
- Mobile → "List with Synapse" → agency signup → creates agency → agency tabs.
- Dashboard → /login → OTP with the agency owner email.
