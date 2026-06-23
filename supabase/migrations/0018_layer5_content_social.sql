-- Layer 5 · Systems 1 + 2 — content generation & social syndication
-- Upload once, distribute everywhere. Generated content is drafted by AI
-- (Layer 3 gateway) and awaits agency approval. Social tokens live in
-- Supabase Vault — never in these tables. Reuses set_updated_at().

create type content_type as enum (
  'instagram_post','instagram_reel','tiktok_script','facebook_post',
  'linkedin_post','whatsapp_message','brochure_copy','email_body'
);
create type narrative_angle as enum (
  'luxury','investment','rental','family','commercial','shortlet'
);
create type content_status as enum ('draft','approved','scheduled','published','archived');
create type content_variant_type as enum ('headline','body','cta','hashtags');
create type social_platform as enum ('instagram','facebook','tiktok','linkedin','x');
create type social_post_status as enum ('draft','scheduled','publishing','published','failed');

-- ──────────────── generated_content ────────────────
create table generated_content (
  id                        uuid primary key default uuid_generate_v4(),
  property_id               uuid not null references properties (id) on delete cascade,
  agency_id                 uuid not null references agencies (id) on delete cascade,
  content_type              content_type not null,
  narrative_angle           narrative_angle not null,
  generated_text            text not null default '',
  status                    content_status not null default 'draft',
  generated_by              text not null default '',
  generation_prompt_version text not null default '',
  approved_by               uuid references profiles (id) on delete set null,
  approved_at               timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz
);
create trigger generated_content_updated_at before update on generated_content
  for each row execute function set_updated_at();
create index idx_generated_content_property on generated_content (property_id);
create index idx_generated_content_agency on generated_content (agency_id, status);

-- ──────────────── content_variants ────────────────
create table content_variants (
  id           uuid primary key default uuid_generate_v4(),
  content_id   uuid not null references generated_content (id) on delete cascade,
  variant_type content_variant_type not null,
  variant_text text not null,
  created_at   timestamptz not null default now()
);
create index idx_content_variants on content_variants (content_id, variant_type);

-- ──────────────── campaign_suggestions (AI-surfaced) ────────────────
create table campaign_suggestions (
  id              uuid primary key default uuid_generate_v4(),
  agency_id       uuid not null references agencies (id) on delete cascade,
  suggestion_text text not null,
  campaign_type   text not null,
  property_ids    uuid[] not null default '{}',
  is_dismissed    boolean not null default false,
  acted_on        boolean not null default false,
  created_at      timestamptz not null default now()
);
create index idx_campaign_suggestions on campaign_suggestions (agency_id) where not is_dismissed;

-- ──────────────── social_accounts ────────────────
-- access_token is intentionally ABSENT — it lives in Supabase Vault, keyed by
-- this row's id, and is read only by Edge Functions via the service role.
create table social_accounts (
  id                  uuid primary key default uuid_generate_v4(),
  agency_id           uuid not null references agencies (id) on delete cascade,
  platform            social_platform not null,
  platform_account_id text not null,
  platform_username   text not null,
  token_expires_at    timestamptz,
  is_active           boolean not null default true,
  connected_at        timestamptz not null default now(),
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  unique (agency_id, platform)
);
create trigger social_accounts_updated_at before update on social_accounts
  for each row execute function set_updated_at();

-- ──────────────── social_posts ────────────────
create table social_posts (
  id              uuid primary key default uuid_generate_v4(),
  property_id     uuid not null references properties (id) on delete cascade,
  content_id      uuid not null references generated_content (id) on delete cascade,
  agency_id       uuid not null references agencies (id) on delete cascade,
  platform        social_platform not null,
  platform_post_id text,
  status          social_post_status not null default 'draft',
  scheduled_at    timestamptz,
  published_at    timestamptz,
  failure_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create trigger social_posts_updated_at before update on social_posts
  for each row execute function set_updated_at();
create index idx_social_posts_agency on social_posts (agency_id, status);
create index idx_social_posts_schedule on social_posts (scheduled_at) where status = 'scheduled';
create index idx_social_posts_property on social_posts (property_id);

-- ──────────────── social_post_metrics (time series) ────────────────
create table social_post_metrics (
  id             uuid primary key default uuid_generate_v4(),
  social_post_id uuid not null references social_posts (id) on delete cascade,
  platform       social_platform not null,
  impressions    integer not null default 0,
  reach          integer not null default 0,
  likes          integer not null default 0,
  comments       integer not null default 0,
  shares         integer not null default 0,
  saves          integer not null default 0,
  link_clicks    integer not null default 0,
  profile_visits integer not null default 0,
  fetched_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index idx_social_metrics_post on social_post_metrics (social_post_id, fetched_at desc);
