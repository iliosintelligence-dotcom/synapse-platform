# Synapse — Layer 1 Platform Foundation

AI-native real estate intelligence platform for Nigeria. This repository is the
Layer 1 foundation: monorepo, shared types, database schema with RLS, typed API
layer, auth, design system, and navigation architecture for the Expo mobile app
and the Next.js agency dashboard.

**No AI, CRM, proximity, marketing, payments, or analytics yet — by design.**

## Quick start

See [docs/setup.md](docs/setup.md). TL;DR:

```bash
npm install
cp apps/mobile/.env.example apps/mobile/.env          # fill Supabase + Cloudinary
cp apps/dashboard/.env.example apps/dashboard/.env.local
npm run dev
```

## Docs

- [Architecture overview](docs/architecture.md)
- [Database schema + RLS](docs/database.md)
- [Role & permission matrix](docs/permissions.md)
- [Design system](docs/design-system.md)
- [Local setup](docs/setup.md)
- [Deployment preparation](docs/deployment.md)
