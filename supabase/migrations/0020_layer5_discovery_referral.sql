-- Layer 5 · Systems 5 + 6 — discovery feeds & referral infrastructure
-- Discovery surfaces the right property without searching. Referrals track
-- consumer/agency chains with full attribution; reward logic runs in Edge
-- Functions (service role), never client-side.

create type discovery_feed_type as enum (
  'recommended','nearby','trending','new_listings','investment_picks','recently_reduced'
);
create type referral_type as enum (
  'property_share','agency_referral','consumer_referral','agent_referral'
);
create type referrer_type as enum ('consumer','agency','agent');
create type referral_channel as enum ('whatsapp_share','copy_link','direct_invite','social_share');
create type referral_status as enum ('pending','signed_up','activated','transacted');
create type reward_type as enum ('credit','fee_reduction','cash_equivalent');

-- ──────────────── discovery_feed_records ────────────────
-- One row per user per property per feed type per day.
create table discovery_feed_records (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references profiles (id) on delete cascade,
  feed_type        discovery_feed_type not null,
  property_id      uuid not null references properties (id) on delete cascade,
  position_in_feed integer not null default 0,
  match_score      numeric(5,2),
  reason_text      text not null default '',
  was_impressed    boolean not null default false,
  was_tapped       boolean not null default false,
  was_saved        boolean not null default false,
  led_to_contact   boolean not null default false,
  feed_date        date not null,
  created_at       timestamptz not null default now(),
  unique (user_id, property_id, feed_type, feed_date)
);
create index idx_discovery_user on discovery_feed_records (user_id, feed_type, feed_date desc);

-- ──────────────── referral_reward_config ────────────────
create table referral_reward_config (
  id            uuid primary key default uuid_generate_v4(),
  referrer_type referrer_type not null,
  reward_type   reward_type not null,
  reward_amount numeric(16,2) not null,
  currency      text not null default 'NGN',
  is_active     boolean not null default true,
  unique (referrer_type)
);

-- ──────────────── referrals ────────────────
create table referrals (
  id               uuid primary key default uuid_generate_v4(),
  referrer_id      uuid not null references profiles (id) on delete cascade,
  referrer_type    referrer_type not null,
  invitee_id       uuid references profiles (id) on delete set null,
  referral_code    text not null unique,
  referral_channel referral_channel not null,
  property_id      uuid references properties (id) on delete set null,
  status           referral_status not null default 'pending',
  signed_up_at     timestamptz,
  activated_at     timestamptz,
  transacted_at    timestamptz,
  reward_issued    boolean not null default false,
  created_at       timestamptz not null default now()
);
create index idx_referrals_referrer on referrals (referrer_id, status);
create index idx_referrals_code on referrals (referral_code);
create index idx_referrals_invitee on referrals (invitee_id);

-- ──────────────── referral_rewards ────────────────
create table referral_rewards (
  id            uuid primary key default uuid_generate_v4(),
  referral_id   uuid not null references referrals (id) on delete cascade,
  reward_type   reward_type not null,
  reward_amount numeric(16,2) not null,
  currency      text not null default 'NGN',
  issued_at     timestamptz,
  expires_at    timestamptz,
  redeemed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index idx_referral_rewards on referral_rewards (referral_id);
