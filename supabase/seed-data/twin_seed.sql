-- ═══════════════════════════════════════════════════════════════════════════
-- Synapse digital-twin seed — the living ecosystem around the 120 listings.
-- Deterministic (md5-derived) and idempotent (ON CONFLICT DO NOTHING / UPDATE).
-- Order mirrors the marketplace: agencies → agents → neighbourhood intelligence
-- → local amenities → consumers (life profiles) → user activity.
-- ═══════════════════════════════════════════════════════════════════════════

-- helper: deterministic pseudo-random int in [lo, lo+span) from a text seed
create or replace function seed_rand(seed text, span int, lo int default 0)
returns int language sql immutable as
$$ select lo + mod(abs(('x'||substr(md5(seed),1,8))::bit(32)::int), span) $$;

-- ─────────────────────────── section 1: agencies ───────────────────────────
update agencies a set
  description = a.name || ' is a ' || a.city || '-based brokerage. Every listing is submitted for Synapse verification before it reaches a client.',
  brand_color = (array['#C2552B','#1F4E5F','#7A3E9D','#B8860B','#2E7D4F','#8B2635'])[1+seed_rand(a.name||'c',6)],
  founded_year = 2003 + seed_rand(a.name||'y',18),
  specialties = case a.name
    when 'Lagos Prime Realty' then array['luxury waterfront','Ikoyi','Victoria Island','Lekki']
    when 'Abuja Property Hub' then array['family estates','diplomatic lettings','FCT']
    when 'Coastal Homes PH' then array['executive rentals','GRA family homes']
    when 'Heartland Estates' then array['affordable first homes','land banking']
    when 'Sahel Realty' then array['budget family housing','student lets']
    when 'Southwest Homes' then array['retirement bungalows','university-town investments']
    else array['verified listings'] end,
  avg_response_minutes = seed_rand(a.name||'r',110,10),
  rating = round(3.6 + seed_rand(a.name||'g',14)/10.0, 2),
  closed_deals = seed_rand(a.name||'d',480,40),
  business_hours = 'Mon-Sat 9:00-18:00',
  cac_number = coalesce(a.cac_number, 'RC'||seed_rand(a.name||'cac',900000,100000)),
  social = jsonb_build_object('instagram','@'||lower(replace(a.name,' ','')),
                              'website','https://'||lower(replace(a.name,' ',''))||'.ng')
where a.id::text like 'a6e10000%';

insert into agencies (id, owner_id, name, city, verification_tier, whatsapp_number, address,
                      description, brand_color, founded_year, specialties, avg_response_minutes,
                      rating, closed_deals, business_hours, cac_number, social)
select md5('synapse-agency:'||v.name)::uuid, 'd0000000-0000-4000-8000-000000000001', v.name, v.city,
       v.tier::verification_tier, '+234803'||lpad(seed_rand(v.name||'wa',9999999)::text,7,'0'), v.city||', Nigeria',
       v.name||': '||v.descr||'.',
       (array['#C2552B','#1F4E5F','#7A3E9D','#B8860B','#2E7D4F','#8B2635','#264653','#6D4C41'])[1+seed_rand(v.name||'c',8)],
       2005 + seed_rand(v.name||'y',17), string_to_array(v.specs,','), seed_rand(v.name||'r',160,8),
       round(3.3 + seed_rand(v.name||'g',17)/10.0,2), seed_rand(v.name||'d',350,12), 'Mon-Sat 9:00-18:00',
       'RC'||seed_rand(v.name||'cac',900000,100000),
       jsonb_build_object('instagram','@'||lower(replace(v.name,' ','')))
from (values
  ('Eko Skyline Properties','Lagos','gold','penthouse and short-let specialists on the Island','short-let,penthouse,serviced'),
  ('Lekki Growth Partners','Lagos','verified','buy-to-let investment advisory along the Lekki corridor','investment,off-plan'),
  ('Mainland Nest','Lagos','verified','affordable 1-3 bed flats for young professionals in Yaba and Surulere','affordable,first-home'),
  ('Unilag Student Living','Lagos','basic','verified student hostels and shared flats around Akoka and Yaba','student,shared'),
  ('Garki Gate Realty','Abuja','verified','mid-market family homes in Garki, Apo and Lugbe','family,affordable'),
  ('Maitama Crown Estates','Abuja','gold','diplomatic and executive luxury in Maitama and Asokoro','luxury,executive'),
  ('Savannah Land Co','Abuja','basic','titled land and estate plots on the Abuja outskirts','land,off-plan'),
  ('Rivers Delta Homes','Port Harcourt','verified','waterfront and expatriate compounds in old GRA','executive,compound'),
  ('Enugu Rising','Enugu','basic','diaspora build-and-hold projects in Independence Layout','diaspora,land'),
  ('Kano City Shelter','Kano','verified','large-family compounds and commercial frontage in Kano','family,commercial'),
  ('Jos Plateau Living','Jos','basic','cool-climate retirement homes in Rayfield','retirement,bungalow'),
  ('Calabar Coast Realty','Calabar','verified','quiet estates and short-lets near the Marina','short-let,family'),
  ('Ibadan Heritage Homes','Ibadan','verified','GRA character homes in Jericho and Oluyole','family,character'),
  ('Ogun Gateway Properties','Abeokuta','basic','commuter-belt starter homes in Laderin and Mowe','first-home,commuter'),
  ('Benin Royal Estates','Benin City','verified','student housing near Uniben and GRA family homes','student,family'),
  ('Kwara Crescent Homes','Ilorin','basic','budget flats and yield-focused portfolios in GRA Ilorin','investment,budget'),
  ('Delta Marina Brokers','Asaba','verified','serviced apartments for cross-Niger commuters','serviced,commercial'),
  ('Osun Grove Realty','Osogbo','basic','heritage bungalows and mixed-use frontage in Osogbo','bungalow,commercial')
) v(name, city, tier, descr, specs)
on conflict (id) do nothing;

-- ─────────────────────────── section 2: agents ───────────────────────────
-- 36 agents distributed round-robin across all agencies.
create temp table _agents on commit drop as
with firsts as (select f, row_number() over () i from unnest(array[
  'Adaeze','Emeka','Yusuf','Funke','Tunde','Ngozi','Ibrahim','Chiamaka','Segun','Amina',
  'Kelechi','Bisi','Musa','Efe','Halima','Obinna','Ronke','Danladi','Ifeoma','Wale',
  'Zainab','Chuka','Simi','Nnamdi','Hauwa','Femi','Adanna','Sani','Tola','Uche',
  'Aisha','Dapo','Chidera','Bello','Morayo','Ikenna']) f),
lasts as (select array['Okafor','Adeyemi','Abubakar','Balogun','Eze','Mohammed','Okonkwo','Adesina','Bello','Nwachukwu',
  'Ojo','Suleiman','Igwe','Falana','Danjuma','Umeh','Ogunleye','Yakubu','Anyanwu','Salami'] l),
ag as (select id, name, city, row_number() over (order by created_at, name) rn, count(*) over () cnt from agencies)
select md5('synapse-agent:'||fi.i)::uuid as uid,
       fi.f||' '||(select l[1+seed_rand(fi.f||fi.i||'ln',20)] from lasts) as full_name,
       lower(fi.f)||fi.i||'@synapse-agents.test' as email,
       ag.id as agency_id, ag.name as agency_name, ag.city as agency_city,
       1 + seed_rand(fi.f||fi.i||'y',15) as yrs
from firsts fi join ag on ag.rn = 1 + mod(fi.i-1, ag.cnt);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', email,
       crypt('Synapse!Agent1', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}',
       jsonb_build_object('role','agent','full_name',full_name), now(), now()
from _agents on conflict (id) do nothing;

-- handle_new_user() fires on the auth.users insert above and has already
-- created this row, so `on conflict (id) do nothing` silently threw the phone
-- away -- every seeded profile had a null number. The trigger owns id/role/
-- full_name; this statement owns the columns the trigger knows nothing about.
insert into profiles (id, role, full_name, phone)
select uid, 'agent', full_name, '+234810'||lpad(seed_rand(full_name||'ph',9999999)::text,7,'0')
from _agents
on conflict (id) do update
  set role = excluded.role,
      full_name = excluded.full_name,
      phone = coalesce(profiles.phone, excluded.phone);

insert into agency_members (agency_id, profile_id, role)
select agency_id, uid, 'agent' from _agents
on conflict do nothing;

insert into agent_profiles (profile_id, bio, years_experience, languages, specializations,
                            areas_covered, response_rate_pct, closed_deals, avg_rating, certifications)
select uid,
  full_name||' has spent '||yrs||' years helping clients close verified deals around '||agency_city||
  '. Known for straight answers on title status and never overselling a flood-prone plot.',
  yrs,
  case seed_rand(full_name||'lg',8)
    when 0 then array['English','Yoruba'] when 1 then array['English','Igbo']
    when 2 then array['English','Hausa'] when 3 then array['English','Pidgin']
    when 4 then array['English','Yoruba','Pidgin'] when 5 then array['English','Hausa','Fulfulde']
    when 6 then array['English','Igbo','Pidgin'] else array['English','French'] end,
  array[(array['family homes','luxury','short-lets','land','student housing','off-plan','commercial'])[1+seed_rand(full_name||'s1',7)]],
  coalesce((select array_agg(split_part(n.name,' (',1)) from (select name from neighbourhoods
      where name like '%('||agency_city||')%' limit 3) n), array['Central '||agency_city]),
  seed_rand(full_name||'rr',30,70), seed_rand(full_name||'cd',120,5),
  round(3.5 + seed_rand(full_name||'ar',15)/10.0,2),
  array[(array['NIESV Associate','ESVARBON Registered','Lagos REDAN Member','Certified Property Negotiator'])[1+seed_rand(full_name||'ct',4)]]
from _agents on conflict (profile_id) do nothing;

-- ─────────────── section 3: neighbourhood intelligence (all 40) ───────────────
with cls as (
  select id, name, split_part(name,' (',1) as area,
    split_part(name,' (',1) = any(array['Ikoyi','Victoria Island','Ikeja GRA','Asokoro','Wuse 2','Maitama','Jabi','Magodo']) as prime,
    split_part(name,' (',1) = any(array['Ugbowo','Yaba','Tarauni','Ajilosun','Sango Ota','Aroma']) as student,
    split_part(name,' (',1) = any(array['Ajah','Sangotedo','Epe','Victoria Island','Lugbe','Mowe','Trans Amadi']) as floody,
    name like any(array['%(Lagos)%','%(Abuja)%']) as metro
  from neighbourhoods
), sc as (
  select *,
    least(95, (case when prime then 78 else 58 end) + seed_rand(name||'sf',14) - (case when student then 6 else 0 end)) safety,
    least(96, (case when prime then 82 else 62 end) + seed_rand(name||'fm',12) - (case when student then 10 else 0 end)) family,
    least(95, (case when student then 75 else 45 end) + seed_rand(name||'st',18)) stud,
    least(94, (case when prime then 55 else 60 end) + seed_rand(name||'iv',25)) invest,
    least(92, (case when area in ('Yaba','Victoria Island','Wuse 2','Trans Amadi') then 70 else 35 end) + seed_rand(name||'nl',20)) night,
    least(97, (case when prime then 80 else 30 end) + seed_rand(name||'lx',16)) lux,
    least(90, (case when prime then 65 else 38 end) + seed_rand(name||'gr',22)) green,
    least(96, (case when prime then 74 else 52 end) + seed_rand(name||'pw',20)) power,
    least(97, (case when metro then 80 else 58 end) + seed_rand(name||'nt',15)) net,
    least(93, (case when prime then 72 else 50 end) + seed_rand(name||'rd',20)) road,
    least(85, (case when floody then 55 else 12 end) + seed_rand(name||'fl',18)) flood,
    ((case when prime then 2.4 when metro then 0.6 else 0.35 end) * 1e6 * (1 + seed_rand(name||'r1',40)/100.0))::numeric r1,
    round(4.2 + seed_rand(name||'yl',55)/10.0, 1) yld
  from cls
)
update neighbourhoods n set
  vibe = array_remove(array[case when s.prime then 'prestige' end, case when s.student then 'campus energy' end,
         case when 70 - s.safety/2 + seed_rand(s.name||'nz',20) - (case when s.prime then 15 else 0 end) < 30 then 'quiet streets' else 'busy' end,
         case when s.green > 60 then 'green' end], null),
  best_for = array_remove(array[case when s.prime then 'executives' end, case when s.student then 'students' end,
         case when s.family > 72 then 'young families' end, case when s.invest > 72 then 'investors' end,
         case when not s.prime then 'first-time buyers' end], null),
  not_ideal_for = coalesce(nullif(array_remove(array[case when s.prime then 'tight budgets' end,
         case when s.flood > 50 then 'flood-averse buyers' end, case when s.night < 45 then 'nightlife seekers' end], null), '{}'), array['none in particular']),
  safety_score = s.safety, family_score = s.family, student_score = s.stud, investment_score = s.invest,
  walkability_score = 40 + seed_rand(s.name||'wk',35) + case when s.student then 10 else 0 end,
  nightlife_score = s.night, luxury_score = s.lux,
  noise_score = greatest(8, 70 - s.safety/2 + seed_rand(s.name||'nz',20) - case when s.prime then 15 else 0 end),
  green_space_score = s.green, power_reliability = s.power,
  water_reliability = least(95, s.power - 6 + seed_rand(s.name||'wt',12)),
  internet_quality = s.net, road_quality = s.road, flood_risk = s.flood,
  avg_rent_1bed = round(s.r1), avg_rent_2bed = round(s.r1*1.7), avg_rent_3bed = round(s.r1*2.6),
  avg_sale_price_sqm = round(s.r1/2.2),
  rental_demand = least(95, 50 + seed_rand(s.name||'dm',40) + case when s.student or s.prime then 10 else 0 end),
  price_trend = (case when s.invest > 72 then 'rising' when s.flood > 55 and not s.prime then 'softening' else 'stable' end)::price_trend_kind,
  investment_yield_pct = s.yld,
  toju_summary = s.area||' scores '||s.safety||' on safety and '||s.family||' for family life. '
    || case when s.prime then 'Prime address with strong liquidity; ' else '' end
    || case when s.flood > 50 then 'flood diligence is essential (risk '||s.flood||'/100); ' else '' end
    || 'power reliability '||s.power||'/100 and internet '||s.net||'/100. Typical 1-bed rent about ₦'
    || round(s.r1/1e6,1)||'M/yr; prices '
    || case when s.invest > 72 then 'rising' when s.flood > 55 and not s.prime then 'softening' else 'stable' end || '.',
  investment_thesis = 'Gross yields around '||s.yld||'% with '
    || case when s.invest > 72 then 'rising' when s.flood > 55 and not s.prime then 'softening' else 'stable' end || ' prices. '
    || case when s.prime then 'Blue-chip capital preservation play.'
            when s.invest > 72 then 'Growth-corridor value play - buy ahead of infrastructure.'
            else 'Steady cashflow area; buy on yield, not speculation.' end
from sc s where n.id = s.id;

-- ───────────── section 4: local ecosystem (amenities per neighbourhood) ─────────────
insert into amenity_places (id, neighbourhood_id, name, type, lat, lon, rating, price_tier,
                            school_type, school_curriculum, school_annual_fee,
                            opening_hours, parking, family_friendly, walk_from_centre_minutes)
select md5('synapse-amen:'||n.id||k.kind)::uuid, n.id,
  case k.kind
    when 'school' then split_part(n.name,' (',1)||' '||(array['British International School','Greenfield Academy','Montessori Place','Community Grammar School'])[1+seed_rand(n.id::text||'sn',4)]
    when 'hospital' then (array['General Hospital','St. Raphael Hospital','Lifeline Specialist Hospital'])[1+seed_rand(n.id::text||'hn',3)]||' '||split_part(n.name,' (',1)
    when 'clinic' then split_part(n.name,' (',1)||' Family Clinic'
    when 'pharmacy' then 'HealthPoint Pharmacy '||split_part(n.name,' (',1)
    when 'bank' then (array['Unity Bank Plaza','Crescent Bank Branch','Sterling Corner Branch'])[1+seed_rand(n.id::text||'bn',3)]||' '||split_part(n.name,' (',1)
    when 'restaurant' then (array['Mama Ronke Kitchen','The Grill House','Suya Spot','Bukka Republic'])[1+seed_rand(n.id::text||'rn',4)]||' '||split_part(n.name,' (',1)
    when 'cafe' then 'Roast & Toast '||split_part(n.name,' (',1)
    when 'supermarket' then 'FreshMart '||split_part(n.name,' (',1)
    when 'mall' then split_part(n.name,' (',1)||' City Mall'
    when 'coworking' then split_part(n.name,' (',1)||' WorkLoft'
    when 'park' then split_part(n.name,' (',1)||' Green Park'
    when 'gym' then 'FitZone '||split_part(n.name,' (',1)
    when 'fuel_station' then 'Mega Fuel Station '||split_part(n.name,' (',1)
    when 'church' then 'Grace Cathedral '||split_part(n.name,' (',1)
    else 'An-Nur Mosque '||split_part(n.name,' (',1) end,
  k.kind::amenity_kind,
  round((n.lat + (seed_rand(n.id::text||k.kind||'la',400)-200)/10000.0)::numeric,5),
  round((n.lon + (seed_rand(n.id::text||k.kind||'lo',400)-200)/10000.0)::numeric,5),
  round(3.0 + seed_rand(n.id::text||k.kind||'r',20)/10.0,1),
  (array['budget','mid','premium'])[1+seed_rand(n.id::text||k.kind||'t',3)]::price_tier_kind,
  case when k.kind='school' then (array['private','public'])[1+seed_rand(n.id::text||'st2',2)] end,
  case when k.kind='school' then (array['Nigerian','British','American','Montessori'])[1+seed_rand(n.id::text||'cu',4)] end,
  case when k.kind='school' then (3+seed_rand(n.id::text||'f',45)) * 100000 *
       (case (array['budget','mid','premium'])[1+seed_rand(n.id::text||k.kind||'t',3)] when 'premium' then 8 when 'mid' then 3 else 1 end) end,
  (array['Mon-Sat 8:00-20:00','Daily 7:00-22:00','Mon-Fri 9:00-17:00','24 hours'])[1+seed_rand(n.id::text||k.kind||'h',4)],
  seed_rand(n.id::text||k.kind||'p',10) > 3,
  seed_rand(n.id::text||k.kind||'ff',10) > 2,
  3 + seed_rand(n.id::text||k.kind||'w',24)
from neighbourhoods n
cross join unnest(array['school','hospital','clinic','pharmacy','bank','restaurant','cafe','supermarket',
                        'mall','coworking','park','gym','fuel_station','church','mosque']) k(kind)
where k.kind in ('school','hospital') or seed_rand(n.id::text||k.kind||'keep',10) >= 4
on conflict (id) do nothing;
