# Technical review and handover plan (2026-10-19)

Written after the Facebook-connection developer said the code is hard for a person to take over. He is right about the
main point. This records what is wrong, in numbers, and the order to fix it in. It is a plan and a measurement, not a claim
that anything has been migrated yet.

## What the numbers say

| Area | Measure | Problem |
|---|---|---|
| Agency portal `Synapse/app/agency.html` | **20,215 lines, 30 inline `<script>` blocks** | One file holds the whole agency product: CSS, markup and every feature's logic. Nobody can open it and find a feature. |
| Buyer pages (`property.html` 4,986, `toju.html` 2,409, `signin.html` 1,933, `synapse.html` 1,391, `browse.html` 1,345) | Page, style and logic in one file each | The same helper (escape, naira, brand colours, logo loading) is written again in each page. Fixes have to be made in several places. |
| Edge functions | `social-connect` 2,119, `toju-demo` 2,045, `social-publish` 1,666 lines | Single-file functions mixing prompts, data loading, rules and replies. |
| Tests | 1 Deno test file for 13.6k lines of functions; Playwright e2e exists but is not the safety net for the portal | Changes are checked by hand. |
| Migrations | 213 files | Fine for history, but there is no single "current schema" document. |
| Comments | Long dated notes ("Eden, 2026-10-19 ...") in code | Useful as history, noisy as documentation. Belongs in a changelog. |

What is good and should be kept: the database is the single source of truth, rules that matter (negotiation floor, pricing,
RLS, grants) live in code and SQL and not in prompts, and the edge functions are deployed by a workflow.

## Recommendation: migrate to Next.js in steps, not in one rewrite

A one-shot rewrite of ~48,000 lines of front end while the product is live and being tested by real agencies would stop all
feature work for weeks and re-introduce bugs already fixed (the date, phone, social, negotiation and viewing flows). Instead:

1. **Create the Next.js app (App Router, TypeScript) next to the current site** and serve both. Pages move one at a time; the
   old page is deleted only when its replacement passes the same e2e check. Use `output: 'export'` so the build is static and
   Capacitor can wrap it. All server logic already lives in Supabase, so nothing is lost by exporting statically.
2. **Shared code first** (a `lib/` and `components/` layer): Supabase client, auth, `esc`, `naira`, brand colours and logo,
   listing card, agency card, handover card, loaders. This removes the duplication that causes most of the "fix it in five
   places" bugs.
3. **Order of pages**, smallest and most used first: agency page, property page, browse, Tayo chat, sign-in, Dream Home.
   The 20k-line agency portal is split by feature (Overview, Listings, Pipeline, Social studio, Billing, Brand) into route
   segments and components; this is the longest step and is done last, one section per release.
4. **Edge functions**: split each large function into modules (`prompts.ts`, `data.ts`, `rules.ts`, `handler.ts`) and add
   tests for the rules (negotiation, CAC flag, agency facts, social delivery).
5. **Documentation**: a README with the architecture picture, a `CONTRIBUTING.md`, a generated schema snapshot, and a
   CHANGELOG replacing the dated comments.

## Capacitor (iOS and Android)

Agreed, after step 1 gives a static build. The order is: `npm i @capacitor/core` and `-D @capacitor/cli`, `npx cap init`,
point `webDir` at the Next static export, add `@capacitor/ios` and `@capacitor/android`, then per-screen mobile work (safe
areas, back button, push notifications, camera for listing photos, deep links for `/s/<token>` short links). Store
submission needs Apple Developer and Google Play accounts held by ILIOS Digital, privacy labels, and the account-deletion
flow Apple requires. None of that is started.

Two things to decide before the native build: Meta and TikTok sign-in flows that currently redirect in a browser tab must
use the in-app browser plugin, and Paystack must use its hosted page or the native SDK.

## Risks to manage

- Behaviour drift during migration: each moved page keeps a Playwright check that was passing before it moved.
- The live app must keep working throughout; Vercel serves the old pages until each new route replaces one.
- The developer should review step 1's structure (folders, naming, conventions) before the pages are moved, so the shape is
  what he would want to inherit.
