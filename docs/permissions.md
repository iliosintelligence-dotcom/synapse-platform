# Role & Permission Matrix

Five roles (`packages/types/src/enums.ts`). Client-side checks
(`hasPermission()` in `packages/types/src/permissions.ts`) drive UI
affordances ONLY. The security boundary is Postgres RLS — never trust
client role claims.

| Capability | CONSUMER | AGENT | AGENCY_ADMIN | AGENCY_OWNER | PLATFORM_ADMIN |
|---|---|---|---|---|---|
| Read verified/active/live listings | ✅ | ✅ | ✅ | ✅ | ✅ |
| Read own agency's full inventory | — | ✅ | ✅ | ✅ | ✅* |
| Create/edit agency listings | — | assigned† | ✅ | ✅ | ✅* |
| Set verification status / trust score | — | — | — | — | ✅* (pipeline) |
| Manage agency profile | — | — | ✅ | ✅ | ✅* |
| Agency billing & verification | — | — | — | ✅ | ✅* |
| Invite/remove agency members | — | — | ✅ (not owners) | ✅ (not owners) | ✅* |
| Save properties | ✅ | — | — | — | — |
| Book viewings | ✅ | — | — | — | — |
| Manage viewings for agency listings | — | ✅ | ✅ | ✅ | ✅* |
| Read/update own profile | ✅ | ✅ | ✅ | ✅ | ✅ |
| Change own role | — | — | — | — | service role only |

\* Platform admin acts through Edge Functions holding the service-role key —
there is intentionally no client-side admin path.

† Layer 1 grants agents write access to their agency's listings via
membership. Per-listing assignment (AGENT writes only *assigned* listings)
requires a `property_assignments` table — documented TODO for the layer that
introduces agent management; RLS hook point is `properties_update_agency`.

## Enforcement layers

1. **Postgres RLS** — authoritative. Policies in `0003_rls.sql`.
2. **Database triggers** — profile auto-creation; `updated_at`; geography sync.
3. **API layer** — shapes queries, never widens access (RLS still applies).
4. **UI (`can()`)** — affordances only: hide buttons users can't use.
