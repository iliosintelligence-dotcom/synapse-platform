# Facebook connect: what only Eden can do in Meta

Written 2026-10-02. It covers the two failures seen that day: "App not active"
on the phone, and "Facebook granted the permissions but shared no Page" on
desktop. Meta renames its dashboard often. Where this file isn't sure a label
still exists, it says so; trust what's on your screen over the wording here.

## What Facebook actually returned

From `social_connect_failures`, 27 Sep – 2 Oct (personal data stripped):

| When (WAT) | Outcome | What Facebook said |
|---|---|---|
| 2 Oct 06:32 | error | Granted every permission in the configuration, **but `/me/accounts` listed no Page.** |
| 27 Sep 23:14, 23:25 | cancelled | "Permissions error" (×2). Facebook usually sends this when the window is closed or Cancel is pressed. From now on the record also keeps Facebook's `error_reason`, which says which. |
| 27 Sep 22:09, 23:11 | error | Expired connection link (×2). Old; not related. |

The phone's "App not active" never shows up here. It's Facebook's own page and
it never sends anyone back to Synapse, so there's nothing to record.

What the 2 Oct grant contained: `pages_show_list`, `pages_manage_metadata`,
`pages_manage_posts`, `pages_read_engagement`, `pages_messaging`,
`instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`,
`read_insights`, `public_profile`. **`pages_read_user_content` is missing and
`read_insights` is extra** (see B3).

The most likely reading: Pages *were* listed before (the last Facebook or
Instagram account was connected on 27 Sep at 23:21; none is connected now). Since then the old Pages were deleted and new ones
created. Facebook remembers which Pages you gave Synapse, replays that choice
without showing its Page list again, and the remembered Pages no longer exist.
Section C resets that. Once PR `fix/facebook-connect-no-page` is live, the next
failure records how many Pages the grant names and whether they could be
opened, so this won't be guesswork again.

---

## A. "App not active" — App Mode and roles

**Why it appears:** while the app is in **Development** mode, Facebook only
lets in accounts that have a role on the app (Administrator, Developer or
Tester). Everyone else gets "App not active". Desktop got past the dialog, so
the desktop account has a role. The phone is almost certainly signed in as a
**different Facebook profile**.

1. **Check the profile on the phone.** Open the Facebook app → Menu (☰) → the
   name at the top is the profile in use. Tap the arrow next to it to see your
   other profiles.
   - If it shows a **Page** (you've "switched into" a Page), switch back to your
     personal profile. Under the New Pages Experience, a Page profile counts as
     a different account and has no role on the app.
   - If the connect window opens in the phone's **browser** instead of the app,
     the browser has its own facebook.com login. Open facebook.com in that same
     browser and check whose it is.
2. **Check the role.** App Dashboard → **App roles → Roles**. Make sure the
   profile from step 1 is listed as Administrator (or Developer/Tester). To add
   someone: **Add People**, choose the role, then they accept. Unaccepted
   invitations wait at `developers.facebook.com/requests`; I believe a tester may
   also need to register as a Meta developer first.
3. **Don't use Meta "test users"** for this. They can't run real Pages. Connect
   with your real account that holds the Admin role.
4. **Check for an app restriction.** If the right profile still gets "App not
   active", look for a red banner or "Required actions" on the App Dashboard
   home (for example an overdue Data Use Checkup). A restricted app shows the
   same message to everybody. I'm not sure what that item is called today.
5. **Going Live** is what opens the app to agencies without a role. The App Mode
   switch is either at the top of the App Dashboard ("App Mode: Development /
   Live") or, on newer dashboards, under **Publish** in the left menu. I don't
   know which one yours shows. Going Live without App Review isn't enough: the
   Page and Instagram permissions need **Advanced Access**, which only App
   Review grants (see `platform-review-pack.md`). Until then, add each person
   who has to connect as a Tester.

## B. Login for Business configuration `2272646810190199`

App Dashboard → **Facebook Login for Business → Configurations** → the one with
ID `2272646810190199` → edit. If Meta won't let you edit it, create a new one
with the settings below and send me the new ID. It's stored in
`platform_settings.meta_fb_config_id` and needs no code change.

1. **Login variation:** General.
2. **Access token:** **User access token.** Synapse is written for user tokens.
   A *System-user* token makes the dialog ask for a business portfolio and offer
   only the Pages inside it, and a new Page made from a personal profile isn't
   in one. (The next failure record shows `token_type`. `USER` is right.)
3. **Permissions:** exactly these nine:
   `pages_show_list`, `pages_manage_metadata`, `pages_manage_posts`,
   `pages_read_engagement`, `pages_read_user_content`, `instagram_basic`,
   `instagram_content_publish`, `instagram_manage_comments`, `pages_messaging`.
   - **Add `pages_read_user_content`** (missing on 2 Oct).
   - **Remove `read_insights`.** The review pack says it isn't requested, and a
     permission we can't justify is a reason to reject the review.
4. **Assets:** tick **Pages** and **Instagram accounts** (the wording may differ
   slightly). The asset list is separate from the permissions. If Pages aren't
   ticked, nobody is ever shown a Page to choose.
5. Save. A changed configuration doesn't change a grant someone already gave,
   so do section C afterwards.

## C. After deleting and recreating Pages: grant again

1. **Your role on each new Page:** make sure your personal profile has **full
   control** of it (Page → Settings → Page access; the exact path may vary).
2. **Instagram, if wanted:** the Instagram account has to be a professional
   account linked to that Page (Page settings → Linked accounts → Instagram).
3. **Remove the old grant.** On Facebook (desktop is easiest): **Settings &
   privacy → Settings → Business integrations** → find the app → **Remove**. If
   you can't see "Business integrations", search Settings for it. If the app is
   also listed under **Apps and websites**, remove it there too.
4. **Connect again** from the portal: Social studio → Add channel → Facebook →
   Continue to Facebook. In Facebook's window, **tick the new Pages and their
   Instagram accounts.** If it offers "all current and future Pages", choosing
   it stops this happening again when Pages change. The Synapse chooser still
   asks which Pages belong to the agency.
5. Back in the portal, tick the agency's Pages → **Connect**.

If it still fails, the portal now shows which case it is, with steps. To see
the record:

**Read the full record privately**, in the Supabase dashboard's SQL editor
(Project → SQL Editor), not through CI:

    select at, status, detail, facts
    from public.social_connect_failures
    order by at desc limit 5;

(Before migration `20261002090000` is applied there is no `facts` column;
drop it from the query -- the facts are at the end of `detail` until then.)

**Never print `detail` through the CI workflow.** This repo's CI logs are
public, and `detail` is free text that can carry Facebook's own error
description or an upstream error message. The only public-safe query is the
structured `facts` column -- permission names, counts and error codes, no
tokens, ids or names -- so it works only after that migration:

    gh workflow run migrate.yml --repo iliosintelligence-dotcom/synapse-platform \
      -f mode=query -f query="select at, status, facts from public.social_connect_failures order by at desc limit 5"

## D. App Review test calls in Graph API Explorer

Meta wants at least one successful call per permission in the last 30 days.
**Calls Synapse makes itself count as well**: a working connect covers
`pages_show_list`, `pages_manage_metadata` and `instagram_basic`. The Explorer
is only needed for whatever Synapse hasn't called yet. The counts appear under
**App Review → Permissions and Features** and can take up to a day to update.

**Get a token** (`developers.facebook.com/tools/explorer`, right-hand panel):

1. **Meta App:** choose the Synapse app.
2. **User or Page:** **User Token**. (Older layouts called this "Get Token →
   Get User Access Token".)
3. **Permissions:** use "Add a Permission" to add the nine from B3.
4. **Generate Access Token**, sign in as your admin profile, and tick the new
   Pages and Instagram accounts if asked.
5. Leave the method dropdown on the left on **GET**. GET only reads. Switching
   to POST or DELETE is what makes a call write.
6. Optional: the "i" next to the token opens the Access Token Debugger. Its
   *Granular Scopes* shows which Page IDs the token was granted. That's the same
   check Synapse now makes.

**Read-only calls (safe):** type the path after the version and press
**Submit**.

| Call (GET) | Exercises |
|---|---|
| `me/permissions` | which permissions this token has |
| `me/accounts?fields=id,name,tasks,instagram_business_account{id,username}` | `pages_show_list`, `pages_manage_metadata`, `instagram_basic` |
| `{page-id}?fields=name,instagram_business_account` | Page + linked Instagram |
| `{page-id}/feed?fields=id,message,created_time&limit=5` | `pages_read_engagement` (switch *User or Page* to the Page if it refuses) |
| `{post-id}/comments?fields=message,created_time` | `pages_read_user_content` |
| `{ig-user-id}?fields=username,media_count` | `instagram_basic` |
| `{ig-media-id}/comments?fields=text,timestamp` | `instagram_manage_comments` |
| `{page-id}/conversations` (Page token) | `pages_messaging`, I believe |

Don't paste the token or the responses anywhere. They identify you and your
Pages.

**These publish or send something. Don't run them on a live Page unless you've
chosen to:**

- `POST {page-id}/feed` or `POST {page-id}/photos`: publishes a post
  (`pages_manage_posts`). `published=false` makes an unpublished post that
  isn't shown on the Page, but it still creates one.
- `POST {ig-user-id}/media` creates a container that isn't public and expires.
  **`POST {ig-user-id}/media_publish` puts it on Instagram**
  (`instagram_content_publish`).
- `POST {comment-id}/private_replies` or `POST {page-id}/messages`: sends a
  real message to a real person (`pages_messaging`).
- `POST {comment-id}/comments` or `POST {ig-comment-id}/replies`: a public
  reply.
- Any `DELETE`.

`pages_manage_posts` and `instagram_content_publish` only register through a
publishing call. The cleanest way is the portal's own **Post now** to a test
Page you're happy to post on (see the table in `platform-review-pack.md`).
That's your decision to make; nothing in this PR posts anything.
