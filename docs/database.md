# Database Schema (Layer 1)

Migrations: `supabase/migrations/0001_extensions.sql` → `0002_schema.sql` → `0003_rls.sql`.
Every table: `id uuid pk`, `created_at`, `updated_at` (trigger-maintained), `deleted_at` (soft delete).
Extensions: `uuid-ossp`, `postgis`.

## Tables

### profiles (extends auth.users 1:1)
| column | type | notes |
|---|---|---|
| id | uuid pk → auth.users on delete cascade | |
| role | user_role | default `consumer`; changed only via service role |
| full_name | text | from signup metadata |
| phone, whatsapp, avatar_url | text nullable | |

Auto-created by `handle_new_user()` trigger on `auth.users` insert; reads
`role` and `full_name` from `raw_user_meta_data`.

### agencies
| column | type | notes |
|---|---|---|
| owner_id | uuid → profiles, on delete **restrict** | an agency can't lose its owner silently |
| name, city | text not null | |
| logo_url, cac_number, whatsapp_number, address | nullable | |
| verification_tier | verification_tier | `unverified → basic → verified → gold` |

Indexes: `city`, `owner_id`.

### agency_members
Unique `(agency_id, profile_id)`. `role` constrained to agent/agency_admin/agency_owner.
Cascade on both FKs. Indexes on `profile_id`, `agency_id`.
Helper functions for RLS (security definer, avoids recursive policy evaluation):
`is_agency_member(agency_id)`, `agency_role(agency_id)`.

### properties
Designed so AI, geospatial, and verification evolve **without DDL**:
- `verification_nodes jsonb` — the 7-node pipeline payload
- `tco_breakdown jsonb` — total cost of ownership
- `location geography(point,4326)` — auto-synced from lat/lng by trigger
- `trust_score smallint 0–100`, `yield_pct numeric`
- `amenities text[]`, `expires_at`, `service_charge`, `title_type` enum
- enums: `property_type`, `listing_type`, `price_period`, `property_status`,
  `verification_status`, `title_type`

FK `agency_id → agencies` on delete cascade.

Indexes: `city`, `verification_status`, `is_active`, `trust_score desc nulls last`,
`created_at desc`, `agency_id`, `(latitude, longitude)`, GiST on `location`.

### property_media
FK cascade to properties. `cloudinary_public_id` is the provider handle —
variants are derived, never stored. Index `(property_id, display_order)`.

### saved_properties
Unique `(consumer_id, property_id)`. Both FKs cascade. Index `consumer_id`.

### viewings
FKs cascade to properties/profiles/agencies. `status viewing_status`.
Indexes: `consumer_id`, `agency_id`, `property_id`, `created_at desc`.

## RLS (0003_rls.sql) — enabled on every table

| table | policy summary |
|---|---|
| profiles | select/update own row only; role changes blocked client-side (must equal current role) |
| agencies | public select; insert by owner; update by owner/admin via `agency_role()` |
| agency_members | select own membership or same-agency; manage by admin/owner; granting `agency_owner` blocked (service role only) |
| properties | public select only when `is_active ∧ verified ∧ live ∧ not deleted`; agency members full select/insert/update on own inventory; `verification_status`/`trust_score` immutable to agencies (pipeline-owned) |
| property_media | readable when parent property is publicly visible or caller is agency member; writable by agency members |
| saved_properties | all operations owner-only (`consumer_id = auth.uid()`) |
| viewings | select by booking consumer or listing agency; insert by consumer; update by either party |

**Platform admins** never bypass RLS from clients — service-role key lives in
Edge Functions only.
