-- Greptile's second look at the auto-billing and feedback fixes (PR 21).
--
-- 1. The card guard compared against when a payment was CONFIRMED. A payment
--    started before the owner removed the card, then confirmed after, passed
--    the guard and put the card back. It now compares against when the payment
--    was STARTED: a card can only be restored, or replaced, by a payment begun
--    after the removal, and an older payment can never overwrite a newer one.
-- 2. toju_feedback.user_id was ON DELETE SET NULL. Deleting an account turned
--    that person's ratings into anonymous rows, which can collide with the
--    anonymous unique index and make the account deletion fail. A person's
--    ratings now go with the account (cascade), which is also the better
--    privacy answer.
-- 3. Anonymous votes on an existing reply and rating counted without limit.
--    A row now accepts a repeat vote at most twice a minute.

-- ── 1 ─────────────────────────────────────────────────────────────────────
create or replace function save_billing_authorization(
  p_reference text, p_authorization_code text, p_email text,
  p_brand text, p_last4 text, p_exp text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v subscription_payments%rowtype;
begin
  select * into v from subscription_payments
   where paystack_reference = p_reference and status = 'success' and kind = 'plan';
  if not found or p_authorization_code is null or coalesce(p_email, '') = '' then return false; end if;
  insert into billing_subscriptions
    (agency_id, authorization_code, customer_email, card_brand, card_last4, card_exp,
     plan_tier, period, card_saved_from)
  values (v.agency_id, p_authorization_code, p_email, p_brand, p_last4, p_exp, v.plan_tier,
          coalesce(v.period, 'monthly'), v.created_at)
  on conflict (agency_id) do update
     set authorization_code = excluded.authorization_code,
         customer_email = excluded.customer_email,
         card_brand = excluded.card_brand, card_last4 = excluded.card_last4, card_exp = excluded.card_exp,
         plan_tier = excluded.plan_tier, period = excluded.period,
         auto_renew = case when billing_subscriptions.removed_at is not null then true
                           else billing_subscriptions.auto_renew end,
         removed_at = null,
         card_saved_from = excluded.card_saved_from,
         failed_attempts = 0, last_error = null, updated_at = now()
   where (billing_subscriptions.removed_at is null or v.created_at > billing_subscriptions.removed_at)
     and (billing_subscriptions.card_saved_from is null
          or v.created_at >= billing_subscriptions.card_saved_from);
  return true;
end;
$$;
revoke all on function save_billing_authorization(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function save_billing_authorization(text, text, text, text, text, text) to service_role;

-- ── 2 ─────────────────────────────────────────────────────────────────────
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.toju_feedback'::regclass and contype = 'f'
     and conkey = array[(select attnum from pg_attribute
                          where attrelid = 'public.toju_feedback'::regclass and attname = 'user_id')];
  if c is not null then execute format('alter table toju_feedback drop constraint %I', c); end if;
  alter table toju_feedback
    add constraint toju_feedback_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade;
end $$;

-- ── 3 ─────────────────────────────────────────────────────────────────────
alter table toju_feedback add column if not exists last_vote_at timestamptz not null default now();

create or replace function record_toju_feedback(p_reply_id text, p_rating text, p_excerpt text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_rating not in ('up', 'down') or coalesce(char_length(p_reply_id), 0) not between 1 and 80 then
    return false;
  end if;
  if auth.uid() is not null then
    insert into toju_feedback (reply_id, rating, excerpt, user_id)
    values (p_reply_id, p_rating, left(p_excerpt, 300), auth.uid())
    on conflict (user_id, reply_id) where user_id is not null
    do update set rating = excluded.rating, created_at = now();
    return true;
  end if;
  if not exists (select 1 from toju_feedback
                  where user_id is null and reply_id = p_reply_id and rating = p_rating)
     and (select count(*) from toju_feedback
           where user_id is null and created_at > now() - interval '1 hour') >= 500 then
    return false;
  end if;
  insert into toju_feedback (reply_id, rating, excerpt)
  values (p_reply_id, p_rating, left(p_excerpt, 300))
  on conflict (reply_id, rating) where user_id is null
  do update set votes = toju_feedback.votes + 1, last_vote_at = now()
     where toju_feedback.last_vote_at < now() - interval '30 seconds';
  return true;
end;
$$;
revoke all on function record_toju_feedback(text, text, text) from public, anon, authenticated;
grant execute on function record_toju_feedback(text, text, text) to anon, authenticated;
