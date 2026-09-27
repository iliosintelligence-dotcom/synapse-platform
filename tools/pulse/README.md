# Synapse Pulse

The founder's usage and performance dashboard. It runs on your own computer and reads the live database.

## What it shows

For today, 7, 30 or 90 days — each figure against the period before it:

- **Growth:** new accounts (by role), active users, new agencies, new listings.
- **Engagement:** Tayo conversations and messages, listing visits, link clicks (people, not preview bots), searches.
- **Outcomes:** leads, inspections booked, posts published (and failed), arrivals and registrations.
- **Day by day** chart, a rough **visit → Tayo → account → lead** funnel, **where people came from** by channel, the **listings people looked at**, the **activity log** (the latest 80 events, filterable), and **behind the scenes** — failing background jobs and failed posts.

Everything comes from one database function, `public.pulse_report(days)` (migration `20260927220000`). Emails are masked, lead names and phone numbers are never read, and a Tayo conversation shows only its first line.

## Run it

1. Copy `.env.example` to `.env` in this folder.
2. Supabase dashboard → **Project Settings → API Keys** → copy the **secret** key (or the legacy **service_role** key). Paste it after `SUPABASE_SERVICE_ROLE_KEY=` in `.env`.
   The key can read everything, so it lives only in this file on this computer. `.env` is gitignored. Never paste it into chat.
3. From the `synapse-platform` folder:

   ```
   node tools/pulse/server.mjs
   ```

4. Open **http://localhost:4317**. It refreshes itself every minute.

Needs Node 18 or newer, and nothing else — no install step. The server only listens on this computer (127.0.0.1).
