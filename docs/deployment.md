# Deployment Preparation

## Supabase (production project)
- [ ] Separate prod project; never share dev keys.
- [ ] Apply migrations 0001→0003 via CI (`supabase db push` from a pipeline).
- [ ] Confirm RLS is enabled on every table (`select * from pg_tables` +
      `pg_policies` audit) — CI check recommended.
- [ ] Auth: production redirect URLs (mobile deep link `synapse://`,
      dashboard domain), Google + Apple OAuth credentials, OTP email template
      branded.
- [ ] Service-role key stored ONLY in Edge Function secrets. Grep CI guard:
      the string must never appear in `apps/` or `packages/`.
- [ ] Point-in-time recovery enabled; backups verified.

## Cloudinary
- [ ] Production cloud with the `synapse_unsigned` preset (folder-scoped,
      file-size limited at the preset level).
- [ ] Add `media-destroy` Edge Function (Admin API) before public launch so
      soft-deleted media is destroyed at the provider (TODO in api/media).

## Mobile (Expo / EAS)
- [ ] EAS project; `eas build` profiles for preview + production.
- [ ] Env via EAS secrets (`EXPO_PUBLIC_*`).
- [ ] iOS: bundle id `ng.synapse.app`, Apple Sign-In capability.
- [ ] Android: package `ng.synapse.app`, Play Console setup.
- [ ] OTA updates: `eas update` channel strategy (production/preview).

## Dashboard (Vercel or equivalent)
- [ ] `NEXT_PUBLIC_*` env vars in project settings.
- [ ] Custom domain + HTTPS.
- [ ] Build command `turbo run build --filter=dashboard`.

## Quality gates before go-live
- [ ] `npm run typecheck` green in CI on every PR.
- [ ] RLS test suite (pgTAP or supabase test) covering: consumer cannot read
      unverified listings; agency A cannot read agency B inventory; role
      escalation via profile update is rejected.
- [ ] Load-test listing pagination at 100k rows (indexes already in place).
