-- ═══════════════════════════════════════════════════════════════════════════
-- Synapse digital-twin seed, part 2: consumers with full life profiles
-- + realistic activity (views / saves / searches) consistent with each profile.
-- Deterministic + idempotent. Requires twin_seed.sql (seed_rand) applied first.
-- ═══════════════════════════════════════════════════════════════════════════

create temp table _personas on commit drop as
select md5('synapse-consumer:'||v.nm)::uuid uid, v.* from (values
-- nm, age, occ, income, marital, kids, archetype, looking, bmin, bmax, beds, work, goal, tags
('Tobi Alade',29,'Product designer (remote, US client)',2800000,'single',0,'young_professional','buy',35e6,90e6,1,'remote','first home then rent it out','{coffee shops,fast internet,gym,quiet}'::text[]),
('Amara Obi',36,'Doctor married to a bank ops manager',4500000,'married',2,'family','buy',90e6,200e6,3,'hybrid','forever home near good schools','{schools,green space,security,church}'),
('Musa Garba',52,'Trader / importer',9000000,'married',4,'investor','buy',100e6,400e6,0,'office','rental income portfolio','{yield,commercial,land}'),
('Kemi Lawal',24,'NYSC corps member planning a masters',350000,'single',0,'student','rent',800000,2500000,1,'office','affordable base near campus','{campus,transport,budget}'),
('Bunmi Adewale',44,'Nurse in London (diaspora)',6000000,'married',3,'diaspora','buy',60e6,180e6,4,'remote','retirement home back in Nigeria','{trust,verified title,family visits}'),
('Chinedu Eze',31,'Fintech engineer',3500000,'engaged',0,'young_professional','buy',50e6,130e6,2,'hybrid','growing family soon','{commute,internet,occasional nightlife}'),
('Folake Odukoya',61,'Retired school principal',1200000,'widowed',0,'retiree','buy',25e6,70e6,2,'office','quiet downsize near a hospital','{hospital,quiet,park,church}'),
('Ibrahim Sani',33,'Civil servant, wife is a tailor',1100000,'married',2,'family','buy',20e6,55e6,3,'office','first family home','{budget,schools,mosque,safety}'),
('Ada Nwosu',27,'Content creator',1800000,'single',0,'young_professional','rent',2000000,6000000,1,'remote','short-let arbitrage business','{aesthetics,power,short-let}'),
('Peter Akpan',41,'Oil services engineer in PH',5500000,'married',3,'family','buy',80e6,250e6,4,'office','family base near work and school run','{commute,schools,reliable power}'),
('Yusuf Dantata',38,'Agro-commodities trader',7000000,'married',3,'investor','buy',60e6,300e6,0,'office','land banking and generational wealth','{land,title,appreciation}'),
('Simisola Bankole',34,'Lawyer, single mum',3200000,'single',1,'single_parent','buy',45e6,110e6,2,'hybrid','safe base for me and my daughter','{security,schools,estate living}'),
('Efe Egharevba',30,'Tech couple, twin income',4000000,'married',0,'young_professional','buy',70e6,160e6,3,'remote','space for two home offices','{internet,power,workspace,pets}'),
('Ngozi Umeh',55,'University professor',2200000,'married',2,'retiree','buy',40e6,100e6,3,'office','retire near campus, host grandkids','{quiet,garden,university}'),
('Bola Shittu',26,'Ride-hailing fleet owner',1500000,'single',0,'hustler','rent',1500000,4000000,2,'office','cheap base, cash goes into the fleet','{parking,budget,mainland}'),
('Obi Okonkwo',35,'Diaspora investor duo (Canada)',8000000,'single',0,'diaspora','buy',150e6,500e6,0,'remote','premium buy-to-let, zero wahala','{verified,managed,prime}'),
('Fatima Bello',32,'NGO programme lead',2500000,'married',1,'family','buy',45e6,120e6,3,'hybrid','balance school run and airport trips','{airport,schools,safety}'),
('Tunji Coker',47,'Consultant surgeon',6500000,'married',3,'luxury','buy',250e6,700e6,4,'office','statement family home in a prime area','{prestige,space,security,club}'),
('Grace Etim',28,'Remote data analyst',2000000,'single',0,'young_professional','buy',30e6,75e6,1,'remote','own something early, beat rent','{budget,internet,safety}'),
('Abdullahi Kura',45,'School proprietor',3000000,'married',5,'family','buy',40e6,120e6,5,'office','large compound for a big family','{space,mosque,schools}'),
('Tonye Briggs',39,'Marine logistics manager',4800000,'divorced',2,'family','buy',70e6,180e6,3,'office','weekend-dad home near the kids','{waterside,parking,restaurants}'),
('Chiazor Madu',29,'Creative studio founders',2600000,'married',0,'young_professional','rent',3000000,8000000,2,'remote','live-work loft feel','{character,cafes,light}'),
('Ronke Ajayi',50,'Poultry business owner',2800000,'married',4,'investor','buy',30e6,90e6,0,'office','steady rental income for school fees','{yield,students,low maintenance}'),
('Sam Iwuchukwu',23,'Final-year student and intern',250000,'single',0,'student','rent',500000,1800000,1,'hybrid','shared flat near campus and bus stop','{campus,budget,transport}')
) v(nm, age, occ, income, marital, kids, archetype, looking, bmin, bmax, beds, work, goal, tags);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
       lower(replace(nm,' ','.'))||'@synapse-demo.test', crypt('Synapse!Demo1', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', jsonb_build_object('role','consumer','full_name',nm), now(), now()
from _personas on conflict (id) do nothing;

insert into profiles (id, role, full_name, phone)
select uid, 'consumer', nm, '+234901'||lpad(seed_rand(nm||'ph',9999999)::text,7,'0')
from _personas on conflict (id) do nothing;

insert into consumer_profiles (consumer_id, archetype, age, occupation, monthly_income, marital_status,
  children_count, future_children, elderly_dependents, pets, looking_for, budget_min, budget_max,
  preferred_neighbourhoods, min_bedrooms, move_in_timeline, work_arrangement, work_location,
  max_commute_minutes, vehicle_count, uses_ride_hailing, school_budget_yearly, preferred_school_curriculum,
  healthcare_priority, power_reliability_priority, security_priority, lifestyle_tags, nightlife_interest,
  green_space_importance, long_term_goal, embedding_text)
select uid, archetype, age, occ, income, marital, kids,
  (kids = 0 and age < 36 and marital in ('married','engaged')),
  case when goal like '%elderly%' then 1 else 0 end,
  'pets' = any(tags), looking, bmin, bmax,
  (select coalesce(array_agg(name),'{}') from (select name from neighbourhoods order by md5(name||nm) limit 3) x),
  greatest(beds,1),
  (array['asap','1-3 months','3-6 months','6-12 months'])[1+seed_rand(nm||'ti',4)],
  work, case when work='remote' then 'n/a' else 'city centre' end,
  seed_rand(nm||'cm',50,20), seed_rand(nm||'vc',3), seed_rand(nm||'rh',10) > 4,
  case when kids > 0 then (5+seed_rand(nm||'sb',30)) * 100000 end,
  case when kids > 0 then (array['Nigerian','British','Montessori'])[1+seed_rand(nm||'cu',3)] end,
  case when 'hospital' = any(tags) then seed_rand(nm||'hp',2,4) else seed_rand(nm||'hp',3,1) end,
  seed_rand(nm||'pp',3,3), seed_rand(nm||'sp',3,3), tags,
  ('occasional nightlife' = any(tags)) or (archetype = 'young_professional' and seed_rand(nm||'nl',2) = 1),
  seed_rand(nm||'gs',4,2), goal,
  nm||', '||age||', '||occ||'. '||marital||', '||kids||' children. Wants to '||looking||
  ', budget ₦'||round(bmin/1e6)||'M-₦'||round(bmax/1e6)||'M, '||beds||'+ beds. Works '||work||
  '. Goal: '||goal||'. Cares about: '||array_to_string(tags,', ')||'.'
from _personas on conflict (consumer_id) do nothing;

-- ── activity: views (budget-aware), saves, searches ──
insert into property_views (id, consumer_id, property_id, source, session_duration_seconds, scroll_depth_pct, viewed_at)
select md5('synapse-view:'||pe.uid||p.id)::uuid, pe.uid, p.id,
  (array['toju_chat','browse','search','instagram','recommendation'])[1+seed_rand(pe.uid::text||p.id::text||'s',5)],
  seed_rand(pe.uid::text||p.id::text||'t',500,15), seed_rand(pe.uid::text||p.id::text||'sc',70,30),
  now() - (seed_rand(pe.uid::text||p.id::text||'d',180)||' days')::interval
         - (seed_rand(pe.uid::text||p.id::text||'m',1400)||' minutes')::interval
from _personas pe
join lateral (
  select pr.id from properties pr
  where pr.status = 'live'
    and case when pe.looking = 'buy'
         then pr.price between pe.bmin*0.7 and pe.bmax*1.3 and (pe.beds = 0 or pr.bedrooms >= pe.beds)
         else pr.price <= 60e6 end
  order by md5(pr.id::text||pe.uid::text) limit 16
) p on true
on conflict (id) do nothing;

insert into saved_properties (id, consumer_id, property_id)
select md5('synapse-save:'||v.consumer_id||v.property_id)::uuid, v.consumer_id, v.property_id
from property_views v join _personas pe on pe.uid = v.consumer_id
where seed_rand(v.consumer_id::text||v.property_id::text||'sv',10) > 6
on conflict (id) do nothing;

insert into property_searches (id, consumer_id, query, filters, results_count, searched_at)
select md5('synapse-srch:'||pe.uid||s.q)::uuid, pe.uid, s.q,
  jsonb_build_object('budget_max', pe.bmax, 'min_bedrooms', pe.beds),
  seed_rand(pe.uid::text||s.q||'rc',9,1),
  now() - (seed_rand(pe.uid::text||s.q||'d',170)||' days')::interval
from _personas pe
join lateral (
  select unnest(case pe.archetype
    when 'family' then array[pe.beds||'-bed near good schools','safe estate with steady power','family home under ₦'||round(pe.bmax/1e6)||'M']
    when 'young_professional' then array['1-2 bed with fast internet','first home under ₦'||round(pe.bmax/1e6)||'M','areas with cafes and gyms']
    when 'investor' then array['high yield areas','titled land with C of O','best rental demand under budget']
    when 'student' then array['cheap room near campus','shared flat with transport links']
    when 'diaspora' then array['verified title only','managed property for diaspora buyer']
    when 'retiree' then array['quiet bungalow near hospital','downsizing options']
    when 'luxury' then array['premium detached in prime area','homes with club access']
    when 'single_parent' then array['secure estate near schools','2-bed with good security']
    else array['cheap 2-bed with parking'] end) q
) s on true
on conflict (id) do nothing;
