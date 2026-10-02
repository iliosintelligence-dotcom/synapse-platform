-- NOBODY TYPES A TOKEN.
--
-- 0107 gave Instagram and TikTok captions this tail:
--
--     Link in bio — or open synapsecore.dev/s/2VYusY
--
-- The first half is right. The second half asks a reader on a phone to leave
-- Instagram, open a browser, and hand-type a six-character CASE-SENSITIVE
-- token -- getting 2VYusY right, not 2vyusy or 2VYUSY -- for a listing they
-- can already reach by tapping the bio link. Neither platform linkifies a
-- caption, so it was never tappable; it was only ever an instruction, and not
-- one anybody follows. What it did do reliably was make every caption end in a
-- string of random characters, which is what promotional spam looks like.
--
-- Dropping it costs nothing, because the attribution it was carrying is not
-- lost. /go/<handle> lists that account's posts newest-first and links each
-- card through its OWN /s/<token>, so the reader who taps the bio link lands
-- on the post they just saw and the click is still recorded against that exact
-- post. That is the whole reason the bio page exists; the token in the caption
-- was a second, worse copy of a route that already worked.
--
-- Facebook and X are untouched: both linkify, so a full URL there is a real
-- tappable link and stays exactly as it is.

create or replace function public.caption_link_tail(p_platform text, p_url text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when p_url is null or btrim(p_url) = '' then ''
    -- Neither platform makes a caption tappable, so the only honest
    -- instruction is the one the reader can actually act on.
    when lower(coalesce(p_platform, '')) in ('instagram', 'tiktok')
      then 'Link in bio 👆'
    else p_url
  end;
$function$;

comment on function public.caption_link_tail(text, text) is
  'Caption tail per platform. Instagram and TikTok get "Link in bio" only -- '
  'neither linkifies captions, and a hand-typed case-sensitive token is not a '
  'route anybody takes. Their attribution comes from /go/<handle>, which links '
  'each post through its own short link. Platforms that DO linkify get the URL.';
