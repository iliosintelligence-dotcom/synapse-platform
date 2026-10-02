#!/usr/bin/env python3
"""
Generate seed SQL from the synthetic Nigeria listings CSV into the Synapse schema.

Maps nigeria_real_estate_listings.csv -> neighbourhoods + a synthesized agency
chain + properties + property_enrichment. The dataset already carries the AI
text (ai_recommendation_summary, pros/cons, best_for, warning_flags, match_tags),
so the enrichment layer is populated with NO LLM calls.

Emits three idempotent SQL files (fixed uuid5 ids, ON CONFLICT DO NOTHING):
  seed_part1.sql  agency owner (auth.users) + agencies + neighbourhoods
  seed_part2.sql  properties
  seed_part3.sql  property_enrichment

Run:  python generate_seed.py    (writes the .sql files next to this script)
"""
import csv, uuid, os, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(HERE, 'nigeria_real_estate_listings.csv')
NS = uuid.uuid5(uuid.NAMESPACE_URL, 'synapse-seed')

OWNER_ID = 'd0000000-0000-4000-8000-000000000001'

CITY_COORDS = {
    'Awka': (6.2109, 7.0741), 'Onitsha': (6.1667, 6.7833), 'Calabar': (4.9757, 8.3417),
    'Asaba': (6.1980, 6.7290), 'Warri': (5.5167, 5.7500), 'Benin City': (6.3350, 5.6037),
    'Ado-Ekiti': (7.6211, 5.2214), 'Enugu': (6.4584, 7.5464), 'Abuja': (9.0765, 7.3986),
    'Kaduna': (10.5222, 7.4383), 'Kano': (12.0022, 8.5920), 'Ilorin': (8.4966, 4.5421),
    'Lagos': (6.5244, 3.3792), 'Abeokuta': (7.1557, 3.3451), 'Mowe-Ofada': (6.8167, 3.4333),
    'Ota': (6.6800, 3.2350), 'Osogbo': (7.7669, 4.5560), 'Ibadan': (7.3776, 3.9470),
    'Jos': (9.8965, 8.8583), 'Port Harcourt': (4.8156, 7.0498),
}

PROP_TYPE = {
    'Serviced Apartment': 'apartment', 'Apartment / Flat': 'apartment', 'Penthouse': 'penthouse',
    'Detached Duplex': 'detached', 'Semi-detached Duplex': 'duplex', 'Terrace House': 'terrace',
    'Townhouse': 'terrace', 'Bungalow': 'bungalow', 'Uncompleted Shell': 'house',
    'Mixed-use Residential': 'commercial',
}
TITLE = {
    'C of O': 'c_of_o', "Governor's Consent": 'governors_consent', 'Gazette': 'gazette',
    'Registered Deed': 'registered_deed', 'Excision in Process': 'excision',
    'Family Receipt Only': 'allocation',
}
CONDITION = {
    'Excellent': 'excellent', 'Fair': 'fair', 'Good': 'good',
    'Needs Renovation': 'needs_work', 'Newly Built': 'brand_new',
}

AGENCIES = [
    ('a6e10000-0000-4000-8000-000000000001', 'Lagos Prime Realty', 'Lagos', 'gold', '+2348030000101'),
    ('a6e10000-0000-4000-8000-000000000002', 'Abuja Property Hub', 'Abuja', 'verified', '+2348030000102'),
    ('a6e10000-0000-4000-8000-000000000003', 'Coastal Homes PH', 'Port Harcourt', 'verified', '+2348030000103'),
    ('a6e10000-0000-4000-8000-000000000004', 'Heartland Estates', 'Enugu', 'basic', '+2348030000104'),
    ('a6e10000-0000-4000-8000-000000000005', 'Sahel Realty', 'Kaduna', 'verified', '+2348030000105'),
    ('a6e10000-0000-4000-8000-000000000006', 'Southwest Homes', 'Ibadan', 'verified', '+2348030000106'),
]

def q(v):
    if v is None or v == '':
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"

def num(v):
    try:
        f = float(v)
        return str(int(f)) if f == int(f) else str(f)
    except (TypeError, ValueError):
        return 'NULL'

def arr(items):
    items = [i.strip() for i in items if i and i.strip()]
    if not items:
        return "'{}'::text[]"
    return 'array[' + ','.join(q(i) for i in items) + ']::text[]'

def jitter(seed, scale=0.02):
    h = int(hashlib.md5(seed.encode()).hexdigest(), 16)
    return ((h % 1000) / 1000 - 0.5) * 2 * scale

def clamp(n, lo, hi):
    return max(lo, min(hi, n))

rows = list(csv.DictReader(open(CSV, encoding='utf-8')))

# ---- neighbourhoods from distinct (city, area) ----
nbh = {}
for r in rows:
    key = (r['city'], r['area'])
    if key not in nbh:
        name = f"{r['area']} ({r['city']})"
        nid = str(uuid.uuid5(NS, 'nbh:' + name))
        base = CITY_COORDS.get(r['city'], CITY_COORDS['Lagos'])
        lat = round(base[0] + jitter(name + 'a'), 5)
        lon = round(base[1] + jitter(name + 'o'), 5)
        nbh[key] = (nid, name, r['state'], lat, lon)

def agency_for(i):
    return AGENCIES[i % len(AGENCIES)][0]

# ---- part 1: owner + agencies + neighbourhoods ----
p1 = []
p1.append(f"""insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000','{OWNER_ID}','authenticated','authenticated','seed-owner@synapse.test',crypt('Synapse!Seed1', gen_salt('bf')),now(),'{{"provider":"email","providers":["email"]}}','{{"role":"agency_owner","full_name":"Synapse Seed Holdings"}}',now(),now())
on conflict (id) do nothing;""")
for aid, name, city, tier, wa in AGENCIES:
    p1.append(f"insert into agencies (id, owner_id, name, city, verification_tier, whatsapp_number, address) values ('{aid}','{OWNER_ID}',{q(name)},{q(city)},'{tier}',{q(wa)},{q(city + ', Nigeria')}) on conflict (id) do nothing;")
nb_vals = []
for (nid, name, state, lat, lon) in nbh.values():
    nb_vals.append(f"('{nid}',{q(name)},{q(state)},{lat},{lon})")
p1.append("insert into neighbourhoods (id, name, area_zone, lat, lon) values\n" + ",\n".join(nb_vals) + "\non conflict (id) do nothing;")

# ---- part 2: properties ----
prop_vals = []
enr_vals = []
for i, r in enumerate(rows):
    pid = str(uuid.uuid5(NS, 'prop:' + r['listing_id']))
    nid = nbh[(r['city'], r['area'])][0]
    base = CITY_COORDS.get(r['city'], CITY_COORDS['Lagos'])
    lat = round(base[0] + jitter(r['listing_id'] + 'a'), 5)
    lon = round(base[1] + jitter(r['listing_id'] + 'o'), 5)
    ptype = PROP_TYPE.get(r['property_type'], 'apartment')
    title_t = TITLE.get(r['title_tenure'])
    cond = CONDITION.get(r['condition'], 'good')
    try:
        risk = float(r['risk_score'])
    except ValueError:
        risk = 50
    trust = int(clamp(round(100 - risk), 30, 98))
    title_pass = 'pass' if r['title_risk'].strip().lower() == 'clean' else 'pending'
    flood_pass = 'pass' if r['flood_risk'].strip().lower() == 'low' else 'pending'
    nodes = ('[' +
             f'{{"name":"Title","status":"{title_pass}"}},' +
             '{"name":"Survey","status":"pass"},' +
             '{"name":"Structure","status":"pass"},' +
             f'{{"name":"Flood","status":"{flood_pass}"}},' +
             '{"name":"Legal","status":"pass"},' +
             '{"name":"Area","status":"pass"},' +
             '{"name":"Financial","status":"pass"}]')
    title = f"{r['bedrooms']}-Bed {r['property_type']}, {r['area']}"
    prop_vals.append(
        "(" + ",".join([
            f"'{pid}'", f"'{agency_for(i)}'", f"'{nid}'",
            q(title), q(r['property_type']), f"'{ptype}'", "'sale'",
            num(r['listing_price_naira']), "'total'",
            num(r['bedrooms']), num(r['bathrooms']), num(r['parking_spaces']),
            num(r['built_area_sqm']), q(r['address']), q(r['city']), q(r['state']),
            str(lat), str(lon),
            num(r['year_built']), (f"'{cond}'" if cond else 'NULL'),
            (f"'{title_t}'" if title_t else 'NULL'), num(r['service_charge_naira']),
            "'verified'", "'live'", 'true', str(trust),
            f"'{nodes}'::jsonb",
        ]) + ")"
    )
    # enrichment
    tags = [t.strip() for t in r['match_tags'].split(';') if t.strip()]
    yield_pct = None
    try:
        yield_pct = round(float(r['gross_yield']) * 100, 2)
    except ValueError:
        pass
    try:
        tco = int(float(r['service_charge_naira'] or 0) + float(r['annual_maintenance_naira'] or 0) + float(r['est_insurance_ground_rent_naira'] or 0))
    except ValueError:
        tco = None
    embed = f"{title}. {r['area']}, {r['city']}. {r['ai_recommendation_summary']} Tags: {r['match_tags']}"
    enr_vals.append(
        "(" + ",".join([
            f"'{pid}'",
            num(r['investor_fit_score']), num(r['family_fit_score']), num(r['renter_lifestyle_score']),
            num(r['school_access_score']),
            (str(yield_pct) if yield_pct is not None else 'NULL'),
            (str(tco) if tco is not None else 'NULL'),
            q(r['ai_recommendation_summary']), q(r['pros']), q(r['best_for']), q(r['warning_flags']),
            arr(tags), arr([r['best_for']]), arr(tags),
            q(embed),
        ]) + ")"
    )

PROP_HEAD = "insert into properties (id, agency_id, neighbourhood_id, title, description, property_type, listing_type, price, price_period, bedrooms, bathrooms, parking_spaces, area_sqm, address, city, state, latitude, longitude, year_built, property_condition, title_type, service_charge, verification_status, status, is_active, trust_score, verification_nodes) values"
ENR_HEAD = "insert into property_enrichment (property_id, investment_score, family_score, young_professional_score, student_score, rental_yield_estimate_pct, total_cost_of_ownership_yearly, toju_summary, investment_thesis, who_this_suits, what_to_watch, lifestyle_tags, buyer_personas, search_keywords, embedding_text) values"

def write_chunks(prefix, head, vals, conflict, size=30):
    files = []
    for n, i in enumerate(range(0, len(vals), size), start=1):
        fn = f"{prefix}_{n:02d}.sql"
        sql = head + "\n" + ",\n".join(vals[i:i + size]) + f"\non conflict ({conflict}) do nothing;\n"
        open(os.path.join(HERE, fn), 'w', encoding='utf-8').write(sql)
        files.append(fn)
    return files

open(os.path.join(HERE, 'seed_part1.sql'), 'w', encoding='utf-8').write("\n".join(p1) + "\n")
pf = write_chunks('seed_props', PROP_HEAD, prop_vals, 'id')
ef = write_chunks('seed_enr', ENR_HEAD, enr_vals, 'property_id')
print(f"neighbourhoods={len(nbh)} agencies={len(AGENCIES)} properties={len(rows)} enrichment={len(rows)}")
print("part1: seed_part1.sql")
print("properties:", ", ".join(pf))
print("enrichment:", ", ".join(ef))
