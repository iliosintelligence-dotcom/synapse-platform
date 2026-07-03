# Proximity Marketing — Plan (Gold-tier feature)

## The idea in one line
When a buyer whose Toju brief matches a verified listing physically walks near it, their phone shows a quiet,
useful alert — *"You're 400m from a verified 3-bed that fits your brief"* — and the agency gets a warm,
location-qualified lead.

This is not spray-and-pray push. Three conditions must ALL hold before an alert fires:
1. the buyer **opted in** to proximity alerts,
2. their **active Toju brief matches** the listing (budget, beds, persona fit),
3. they are **inside the geofence** of a Gold agency's verified listing.

## Why it wins in Lagos
House-hunting here is physical — people drive Lekki on Saturdays scouting streets. Proximity marketing turns
that existing behaviour into pipeline: the buyer discovers a verified option they'd have driven past, the agency
gets a lead standing on the doorstep. Nobody else in the market can do this because it requires all three of:
verified inventory + AI briefs + a consumer app people carry. Synapse has all three.

## Product surfaces
| Surface | What happens |
|---|---|
| Consumer app | Opt-in during onboarding ("Alert me when I'm near a match"); proximity-ripple Lottie on the alert card; one tap → trust report, second tap → book viewing or WhatsApp agent |
| Toju chat | Toju references the moment: "You walked past a match on Admiralty Way yesterday — want the report?" |
| Agency dashboard (Gold) | Marketing → Proximity: per-listing geofences (radius, schedule e.g. open-house Saturdays), matched-buyers-nearby count, alerts/walk-ins/leads funnel |
| CRM | Proximity leads arrive stage=New with source `proximity` and the walk-past context attached |

## How it works (already in the schema)
- `geofences` — one per listing (or open-house event): centre = property lat/lon (PostGIS), radius 300–1000m, active window.
- Consumer app reports coarse location **only while opted in** (significant-location-change, not continuous GPS).
- Edge function `proximity-check`: point-in-fence (PostGIS `ST_DWithin`) × brief-match score ≥ threshold × frequency caps → insert `proximity_events`, push notification.
- `proximity_alert_outcomes` — opened / dismissed / report-viewed / viewing-booked, feeding the dashboard funnel and the match-model.

## Guardrails (non-negotiable)
- **Consent first**: off by default; one-tap disable; plain-language explanation of what location is used for.
- **Frequency caps**: max 1 alert per listing per buyer per week; max 2 proximity alerts per buyer per day.
- **Match threshold**: only briefs scoring ≥70 fit — a ₦40M budget never gets pinged about a ₦400M penthouse.
- **Location minimization**: coarse checks, no location history sold or shared with agencies — agencies see counts and outcomes, never a buyer's trail.
- **Quiet hours**: no alerts 9 PM – 8 AM.
- NDPR (Nigeria Data Protection Regulation): location = personal data → explicit consent record, purpose limitation, deletion on opt-out.

## Business model — Gold exclusive
- Included in **Gold (₦250k/mo)**: up to 25 active geofences, open-house boosts, funnel analytics.
- Rationale: proximity leads are the highest-intent leads in the product (person + budget + location, standing there).
  Keeping it Gold-only makes Gold self-selling for premium agencies; it also caps alert volume, protecting the
  consumer experience.
- Later options: per-walk-in pricing (₦500–1,000 per verified walk-in) for non-Gold, event geofences for developers' launches.

## Success metrics
- Alert open rate ≥ 40% (it's relevant by construction)
- Alert → trust-report view ≥ 25%
- Alert → viewing booked ≥ 5%
- Zero-complaint bar: opt-out rate < 3%/month, or thresholds/caps tighten automatically.

## Rollout phases
1. **Now (demo)** — dashboard Proximity panel (done) + proximity-ripple alert card in the consumer prototype; simulated events.
2. **Pilot (Lekki corridor)** — 5 Gold agencies, ~50 opted-in buyers, manual review of every fired alert; tune match threshold + radius.
3. **GA Lagos** — self-serve geofences for Gold, open-house scheduling, funnel analytics; pricing experiments for walk-in billing.
4. **Beyond** — developer launch events, agent proximity ("your agent Funke is 5 min from the property — meet now?"), Abuja/PH expansion.
