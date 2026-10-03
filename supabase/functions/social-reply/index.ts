/**
 * social-reply — answers an Instagram comment with the listing's link.
 *
 * Instagram captions never linkify, so every listing posted there ends at a
 * dead end: the reader sees the home, wants the price, and has nowhere to tap.
 * A PRIVATE REPLY is the one route Meta provides out of that — a single direct
 * message to somebody who commented, and it may carry a tappable link.
 *
 *     POST /{page-id}/messages
 *     {"recipient":{"comment_id":"..."},"message":{"text":"..."}}
 *
 * ── the rules this file is built around ─────────────────────────────────
 *
 * ONE REPLY PER COMMENT, EVER. Meta allows exactly one. A retry does not send
 * a second message — it is refused, and the single chance is already spent. So
 * a comment is CLAIMED in the database before any request is made, never
 * after, and a claimed comment is never picked up again by anything.
 *
 * SEVEN DAYS from the comment. Enforced in claim_comment_replies, not here:
 * a worker that filters after claiming has already taken rows it cannot use.
 *
 * ONE MESSAGE, NO SEQUENCE. Nothing in this file can send a follow-up, and
 * that is a design constraint rather than a missing feature. The consent for
 * this message is a person typing a keyword the caption asked them to type;
 * it does not extend to a second message they did not ask for.
 *
 * IT MUST READ AS AUTOMATED. The agency writes the template, and a template
 * that pretends to be a person talking is a consumer-protection problem, not
 * a matter of tone. The suffix below is appended when the agency's own words
 * do not already say it.
 *
 * ── what stops it messaging the wrong people ────────────────────────────
 *
 * Service role only. This is the one function in the project that sends
 * messages to members of the public who have never used Synapse, and the set
 * of callers that may start it is exactly one: pg_cron, through
 * drain_comment_replies.
 */

const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const FB_GRAPH = 'https://graph.facebook.com/v21.0';
/* The public origin short links are served from. Same default as the rest of
   the project so an unset variable does not silently produce a link to
   nowhere in a message we cannot unsend. */
const PUBLIC_URL = (Deno.env.get('PORTAL_URL') ?? 'https://www.synapsecore.dev')
  .replace(/\/+$/, '').replace(/\/app\/.*$/, '');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

interface Comment {
  id: string;
  agency_id: string;
  social_post_id: string;
  platform_comment_id: string;
  author_handle: string | null;
  body: string | null;
}

/* Said once, at the end, when the agency has not said it themselves. A person
   who believes they have reached an agent and has not been told otherwise has
   been misled, and no wording of ours further up the message fixes that. */
const AUTOMATED_SUFFIX = '\n\n(Automated reply — say anything here and a real person will see it.)';
const SAYS_IT_IS_AUTOMATED = /automat|bot\b|auto-?reply/i;

async function sb(path: string, init?: RequestInit): Promise<Response> {
  return await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

/** Records the outcome. Always runs: a claimed comment left claimed is a
 *  comment nothing will ever look at again, which is the worst of the
 *  available states because it is silent. */
async function settle(id: string, state: string, error?: string) {
  const patch: Record<string, unknown> = { reply_state: state, reply_error: error ?? null };
  if (state === 'sent') patch.replied_at = new Date().toISOString();
  const r = await sb(`social_comments?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    /* The message may already have gone. Losing the record of that is how a
       comment gets claimed again later and burns a reply Meta will refuse. */
    console.error('social-reply: could not settle ' + id + ' as ' + state + ': ' + r.status);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!SB_URL || !SERVICE_KEY) return json({ error: 'Server misconfigured' }, 500);

  /* SERVICE ROLE ONLY, checked against the key itself rather than by decoding
     a JWT. This function sends messages to the public; the list of callers
     allowed to start it is one, and it is a cron job. */
  const auth = req.headers.get('Authorization') ?? '';
  if (auth !== `Bearer ${SERVICE_KEY}`) return json({ error: 'Not permitted' }, 403);

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body?.limit) || 10, 1), 25);

  /* Claim and select in one statement, inside Postgres. Two workers reading
     the same comment do not send two messages -- the second is refused and
     the one reply Meta allows is already spent. */
  const claimRes = await sb('rpc/claim_comment_replies', {
    method: 'POST',
    body: JSON.stringify({ p_limit: limit }),
  });
  if (!claimRes.ok) {
    return json({ error: 'claim failed', status: claimRes.status,
                  detail: await claimRes.text().catch(() => '') }, 502);
  }
  const claimed = (await claimRes.json().catch(() => [])) as Comment[];
  if (!Array.isArray(claimed) || !claimed.length) return json({ claimed: 0, sent: 0 });

  let sent = 0;
  const results: unknown[] = [];

  /* Per agency, read once: the template and the Page that may send. */
  const settings = new Map<string, { message: string } | null>();
  const pages = new Map<string, { pageId: string; token: string } | null>();

  for (const c of claimed) {
    try {
      /* ── the agency's own words ─────────────────────────────────────── */
      if (!settings.has(c.agency_id)) {
        const r = await sb(`social_reply_settings?select=message,enabled&agency_id=eq.${c.agency_id}`);
        const rows = r.ok ? await r.json().catch(() => []) : [];
        const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
        settings.set(c.agency_id, row?.enabled ? { message: String(row.message ?? '') } : null);
      }
      const setting = settings.get(c.agency_id);
      if (!setting) {
        /* Switched off between the claim and here. Not a failure and not a
           thing to retry -- the agency has said no. */
        await settle(c.id, 'skipped', 'replies are switched off for this agency');
        results.push({ id: c.id, skipped: 'disabled' });
        continue;
      }

      /* ── the link, which is the entire point of the message ─────────── */
      const linkRes = await sb(
        `short_links?select=token&social_post_id=eq.${c.social_post_id}&limit=1`);
      const links = linkRes.ok ? await linkRes.json().catch(() => []) : [];
      const token = Array.isArray(links) && links[0] ? links[0].token : null;
      if (!token) {
        /* Sending "here is the link" with no link would be worse than saying
           nothing, and it would spend the one reply this comment gets. */
        await settle(c.id, 'skipped', 'that post has no short link to send');
        results.push({ id: c.id, skipped: 'no link' });
        continue;
      }
      const link = `${PUBLIC_URL}/s/${token}`;

      /* ── the Page that is allowed to send it ────────────────────────── */
      if (!pages.has(c.social_post_id)) {
        /* Which Instagram account carried the post, and which Page owns that
           account. parent_account_id is why this is a lookup and not a guess:
           an agency with two Pages has two possible senders and only one of
           them is the one whose post was commented on. */
        const postRes = await sb(
          `social_posts?select=social_account_id&id=eq.${c.social_post_id}&limit=1`);
        const posts = postRes.ok ? await postRes.json().catch(() => []) : [];
        const accountId = Array.isArray(posts) && posts[0] ? posts[0].social_account_id : null;

        let resolved: { pageId: string; token: string } | null = null;
        if (accountId) {
          const accRes = await sb(
            `social_accounts?select=id,parent_account_id&id=eq.${accountId}`
            + '&is_active=is.true&deleted_at=is.null&limit=1');
          const accs = accRes.ok ? await accRes.json().catch(() => []) : [];
          const acc = Array.isArray(accs) && accs[0] ? accs[0] : null;
          if (acc?.parent_account_id) {
            const tokRes = await sb('rpc/social_account_token', {
              method: 'POST',
              body: JSON.stringify({ p_account_id: acc.id }),
            });
            const tok = tokRes.ok ? await tokRes.json().catch(() => null) : null;
            if (typeof tok === 'string' && tok) {
              resolved = { pageId: String(acc.parent_account_id), token: tok };
            }
          }
        }
        pages.set(c.social_post_id, resolved);
      }
      const page = pages.get(c.social_post_id);
      if (!page) {
        /* Every reason lands here: a post with no account named, an account
           disconnected since, or one connected before parent_account_id
           existed. None of them are retryable by waiting, and leaving it
           'none' would put it back in the queue every five minutes for ever. */
        await settle(c.id, 'skipped',
          'no Page could be resolved to send from -- reconnect the account');
        results.push({ id: c.id, skipped: 'no page' });
        continue;
      }

      /* ── the message ────────────────────────────────────────────────── */
      let text = setting.message.replace(/\{\{\s*link\s*\}\}/g, link);
      /* The link is the reason this message exists. A template that dropped
         the token would send a friendly note that helps nobody. */
      if (!text.includes(link)) text = `${text.trim()}\n\n${link}`;
      if (!SAYS_IT_IS_AUTOMATED.test(text)) text += AUTOMATED_SUFFIX;

      const res = await fetch(
        `${FB_GRAPH}/${encodeURIComponent(page.pageId)}/messages`
        + `?access_token=${encodeURIComponent(page.token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { comment_id: c.platform_comment_id },
            message: { text },
          }),
        },
      );

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        /* FAILED, NOT RETRIED. Meta may well have delivered the message and
           failed afterwards, and a retry cannot tell the difference -- it can
           only spend a reply that no longer exists. A human reading this
           state can decide; this function may not. */
        console.error('social-reply: send failed for ' + c.id + ': ' + res.status + ' ' + detail.slice(0, 300));
        await settle(c.id, 'failed', 'Meta refused the reply (' + res.status + ')');
        results.push({ id: c.id, failed: res.status });
        continue;
      }

      await settle(c.id, 'sent');
      sent++;
      results.push({ id: c.id, sent: true, handle: c.author_handle });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('social-reply: threw on ' + c.id + ': ' + message);
      await settle(c.id, 'failed', message.slice(0, 300));
      results.push({ id: c.id, failed: message });
    }
  }

  return json({ claimed: claimed.length, sent, results });
});
