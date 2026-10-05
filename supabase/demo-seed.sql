-- ============================================================
-- DEMO DATA — fills the CRM with practice data so you can test every screen.
-- Run in Supabase → SQL Editor AFTER schema.sql and patches 002–008.
-- Running it again wipes the demo companies and builds them fresh (your real company is never touched).
-- To remove all demo data, run demo-remove.sql.
--
-- Logins (password for all: Demo@12345) — use the "Demo" tab on the login page:
--   Admin 1         owner@demo.estatedesk.test        Rajesh Doye   (sees everything incl. money)
--   Admin 2         sunita@demo.estatedesk.test       Sunita Doye   (sees everything incl. money)
--   Manager         manager@demo.estatedesk.test      Priya Nair    (everything except money)
--   Employees       amit@ sneha@ rahul@ kavya@ arjun@ fatima@ vikram@  (…@demo.estatedesk.test, own leads only)
--   Removed         deepak@demo.estatedesk.test       (should see "Your access was removed")
-- ============================================================

-- ---------- 0. Check the patches were run first ----------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organizations' and column_name = 'auto_assign') then
    raise exception 'STOP: run patch-003-lead-capture.sql first (then 004, 005, 006), then run this file again.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'call_attempts') then
    raise exception 'STOP: run patch-004-crm.sql first (then 005, 006), then run this file again.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'recycle_at') then
    raise exception 'STOP: run patch-005-alerts-import.sql first (then 006), then run this file again.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'photos') then
    raise exception 'STOP: run patch-006-project-photos.sql first (then 007), then run this file again.';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'money_entries') then
    raise exception 'STOP: run patch-007-admins-money-sharing-map.sql first, then run this file again.';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'project_matches') then
    raise exception 'STOP: run patch-008-project-matches.sql first, then run this file again.';
  end if;
end $$;

-- ---------- 1. Wipe old demo data ----------
delete from public.organizations where id in ('de000000-0000-4000-8000-000000000101', 'de000000-0000-4000-8000-000000000102');
delete from auth.identities where user_id::text like 'de000000-0000-4000-8000-0000000000%';
delete from auth.users where id::text like 'de000000-0000-4000-8000-0000000000%';

-- ---------- 2. Demo people (can log in with a password) ----------
drop table if exists pg_temp.demo_people;
create temp table demo_people (n int, id uuid, email text, full_name text, phone text);
insert into demo_people values
  (1,  'de000000-0000-4000-8000-000000000001', 'owner@demo.estatedesk.test',   'Rajesh Doye',    '9845012345'),
  (2,  'de000000-0000-4000-8000-000000000002', 'manager@demo.estatedesk.test', 'Priya Nair',     '9845023456'),
  (3,  'de000000-0000-4000-8000-000000000003', 'amit@demo.estatedesk.test',    'Amit Kumar',     '9886034567'),
  (4,  'de000000-0000-4000-8000-000000000004', 'sneha@demo.estatedesk.test',   'Sneha Reddy',    '9886045678'),
  (5,  'de000000-0000-4000-8000-000000000005', 'rahul@demo.estatedesk.test',   'Rahul Verma',    '9741056789'),
  (6,  'de000000-0000-4000-8000-000000000006', 'kavya@demo.estatedesk.test',   'Kavya Iyer',     '9741067890'),
  (7,  'de000000-0000-4000-8000-000000000007', 'arjun@demo.estatedesk.test',   'Arjun Mehta',    '9900078901'),
  (8,  'de000000-0000-4000-8000-000000000008', 'fatima@demo.estatedesk.test',  'Fatima Shaikh',  '9900089012'),
  (9,  'de000000-0000-4000-8000-000000000009', 'vikram@demo.estatedesk.test',  'Vikram Singh',   '8050090123'),
  (10, 'de000000-0000-4000-8000-000000000010', 'deepak@demo.estatedesk.test',  'Deepak Rao',     '8050001234'),
  (11, 'de000000-0000-4000-8000-000000000011', 'sunita@demo.estatedesk.test',  'Sunita Doye',    '9845034567');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
  extensions.crypt('Demo@12345', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', full_name),
  now() - interval '200 days', now(), '', '', '', ''
from demo_people;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now(), now()
from demo_people;

-- ---------- 3. Companies, team, projects, sources, templates, leads ----------
do $$
declare
  O1 constant uuid := 'de000000-0000-4000-8000-000000000101';
  O2 constant uuid := 'de000000-0000-4000-8000-000000000102';
  U constant uuid[] := array(select id from demo_people order by n);
  -- who gets leads: agents (weighted), manager and owner a little
  POOL constant int[] := array[3,3,3,4,4,4,5,5,5,6,6,6,7,7,8,8,8,2,2,1,10,10];
  FIRST constant text[] := array['Aarav','Vivaan','Aditya','Vihaan','Arjun','Sai','Reyansh','Krishna','Ishaan','Shaurya','Ananya','Diya','Aadhya','Saanvi','Myra','Pari','Anika','Navya','Kiara','Riya',
    'Rohan','Karthik','Manoj','Suresh','Ramesh','Lakshmi','Meera','Pooja','Neha','Divya','Harish','Naveen','Prakash','Girish','Venkatesh','Shalini','Swati','Nikhil','Varun','Gaurav',
    'Imran','Salman','Ayesha','Zoya','Joseph','Mary','Thomas','Sandeep','Manpreet','Gurpreet','Tanvi','Rakesh','Mohan','Sunita','Kiran','Ashwin','Deepika','Raghav','Nandini','Abhishek'];
  LAST constant text[] := array['Sharma','Verma','Reddy','Rao','Iyer','Nair','Menon','Pillai','Gowda','Shetty','Kulkarni','Deshpande','Joshi','Patil','Gupta','Agarwal','Jain','Mehta','Shah','Patel',
    'Khan','Shaikh','Fernandes','D''Souza','Thomas','Singh','Bhat','Hegde','Naidu','Chopra','Malhotra','Banerjee','Mukherjee','Das','Kapoor','Saxena','Mishra','Pandey','Yadav','Kumar'];
  AREAS constant text[] := array['Whitefield','Sarjapur Road','Hennur Road','Electronic City','HSR Layout','Koramangala','Yelahanka','Hebbal','Devanahalli','Kanakapura Road','Bannerghatta Road',
    'JP Nagar','Marathahalli','Bellandur','Thanisandra','Rajajinagar','Jayanagar','Indiranagar','KR Puram','Varthur','Mysore Road','Tumkur Road','Hoskote','Budigere Cross'];
  SRC constant text[] := array['99acres','99acres','99acres','MagicBricks','MagicBricks','Housing.com','Facebook','Facebook','Facebook','Instagram','Google Ads','Google Ads','Website','Website','Walk-in','Referral','Referral','Other'];
  REASONS constant text[] := array['Budget mismatch','Budget mismatch','Location not suitable','Bought elsewhere','Not responding','Not responding','Not responding','Just exploring','Just exploring','Loan not approved','Wrong number','Other'];
  BUDGETS constant numeric[][] := array[[30,45],[45,60],[50,70],[60,80],[70,90],[80,100],[90,120],[100,150],[120,180],[150,250],[250,500],[0,65],[0,90],[0,150],[75,0],[0,0]];
  SLOTS constant text[] := array['Weekday evening','Saturday morning','Sunday any time','After 7 PM','Lunch time','Call before visiting','Only WhatsApp first'];
  NOTES constant text[] := array[
    'Wants east-facing flat, near a school for kids.',
    'Husband works in Manyata Tech Park. Wants less than 30 min drive.',
    'Asked about home loan help. Shared SBI and HDFC contacts.',
    'Comparing with Prestige and Sobha. Price is the main issue.',
    'Will decide after Diwali. Father will also come for the visit.',
    'Wants ready-to-move only. Paying rent right now.',
    'NRI, based in Dubai. Brother will visit on his behalf.',
    'Asked for floor plan and price sheet on WhatsApp. Sent.',
    'Interested in 3 BHK but budget fits 2.5 BHK. Suggested the larger 2 BHK.',
    'Very price sensitive. Asked for best price twice.',
    'Investor. Wants rental yield numbers.',
    'Wife prefers villa, husband prefers apartment. Visit both.',
    'मुझे कॉल शाम 6 बजे के बाद करें। (Call after 6 PM, prefers Hindi)',
    'Needs vastu compliant main door — north or east.',
    'Already has a loan sanction letter for ₹75 L.',
    'Wants to see a sample flat before booking.',
    'Long call. Covered: price, payment plan, possession date, car parking, maintenance charges, clubhouse timing, school distance, metro plan, water supply (Cauvery + borewell), power backup, and whether pets are allowed. Will discuss with family over the weekend and get back on Monday. Asked us to keep the 7th-floor unit on hold if possible.',
    'Busy now, call next week.',
    'Not picking up. Sent WhatsApp.',
    'Asked for a discount on floor rise charges.'];
  PNAMES text[] := array['Skyline Heights','Green Meadows','Lakeview Villas','Urban Nest','Sunrise Enclave','TechPark One','Royal Palms','Metro Residency'];
  PKEYS text[] := array['skyline-heights','green-meadows','lakeview-villas','urban-nest','sunrise-enclave','techpark-one','royal-palms','metro-residency'];
  PSHOTS int[] := array[4,4,5,3,3,3,4,2];
  P uuid[] := '{}'; S uuid[] := '{}';
  i int; k int; n int; age numeric; t_created timestamptz; t_last timestamptz; st text; v_stage_idx int; agent uuid; v_src text; v_srcid uuid; v_proj uuid; pi int;
  v_name text; v_phone text; v_lead uuid; b int; calls int; fu timestamptz; v_score text; v_reason text; v_max int; t timestamptz; vis_at timestamptz; partner uuid;
  outcomes text[] := array['No answer','Busy / cut the call','Switched off','Asked to call back','Talked, interested'];
  r numeric;
begin
  perform setseed(0.42);

  -- Companies
  insert into public.organizations (id, name, city, rera_no, plan_status, trial_ends_at, created_by, created_at, auto_assign)
  values (O1, 'Doye Realty (Demo)', 'Bengaluru', 'PRM/KA/RERA/1251/309/AG/180523/001234', 'active', now() + interval '1 year', U[1], now() - interval '200 days', true);

  -- Team (Deepak is added active first so his old leads can be his; removed at the end)
  insert into public.members (org_id, user_id, role, full_name, phone, email, joined_at)
  select O1, p.id, case p.n when 1 then 'owner' when 11 then 'owner' when 2 then 'manager' else 'agent' end, p.full_name, p.phone, p.email,
         now() - make_interval(days => case p.n when 9 then 3 else 190 - p.n * 7 end)
  from demo_people p;

  -- Pending and expired invites
  insert into public.invites (org_id, role, full_name, phone, email, invited_by, expires_at, created_at) values
    (O1, 'agent', 'Nisha Thomas', '9008012345', null, U[1], now() + interval '5 days', now() - interval '2 days'),
    (O1, 'manager', 'Kiran Bhat', null, 'kiran.bhat@example.com', U[1], now() - interval '3 days', now() - interval '10 days'),
    (O1, 'agent', 'Ravi Shetty', '9611123456', null, U[2], now() + interval '6 days', now() - interval '1 day');

  -- Projects with photos
  for k in 1..8 loop
    P := P || gen_random_uuid();
    insert into public.projects (id, org_id, name, developer, location, rera_no, type, configs, price_from, price_to, status, possession, highlights, link, photos, created_at)
    values (P[k], O1, PNAMES[k],
      (array['Doye Developers','Brigade Group','Prestige Group','Doye Developers','Sunrise Estates','Embassy Office Parks','Royal Builders','Godrej Properties'])[k],
      (array['Whitefield','Sarjapur Road','Hennur Road','Electronic City','Devanahalli','Outer Ring Road','Kanakapura Road','Hebbal'])[k],
      case when k in (5, 8) then null else 'PRM/KA/RERA/1251/' || (300 + k) || '/PR/2024' || lpad(k::text, 4, '0') end,
      (array['Apartment','Apartment','Villa','Apartment','Plot','Commercial','Villa','Apartment'])[k],
      (array['2, 3 BHK','1, 2, 3 BHK','4 BHK villas','1, 2 BHK','1200–2400 sq ft plots','Office space 1,000–20,000 sq ft','3, 4 BHK villas','3 BHK'])[k],
      (array[85,62,320,38,45,150,210,140])[k], (array[165,110,480,72,96,1200,340,null])[k],
      (array['Under construction','Under construction','Ready to move','Ready to move','Pre-launch','Under construction','Ready to move','Sold out'])[k],
      (array['Dec 2027','Jun 2027',null,null,'Mar 2028','Sep 2027',null,'Handed over'])[k],
      (array['Clubhouse, pool, 2 km from ITPL metro','Lake view, 40+ amenities, near Wipro campus','Private garden, 10 min from airport road','Budget homes, near Infosys gate, metro 1 km','BIAAPA approved, near airport, gated layout','Grade A offices, on ORR','Gated community, 30% open area, temple nearby','Last 2 units resale only'])[k],
      case when k = 2 then 'www.example.com/green-meadows-brochure.pdf' when k = 1 then 'https://example.com/skyline' else null end,
      array(select '/demo/projects/' || PKEYS[k] || '-' || g || '.jpg' from generate_series(1, PSHOTS[k]) g),
      now() - make_interval(days => 180 - k * 10));
  end loop;
  insert into public.projects (org_id, name, location, type, configs, price_from, status, photos) values
    (O1, 'New Launch (details coming)', 'Yelahanka', 'Apartment', null, null, 'Pre-launch', '{}');  -- project with no photo / price
  -- Map positions and public links (TechPark One and Metro Residency stay private)
  update public.projects x set lat = v.lat, lng = v.lng, is_public = v.pub from (values
    ('Skyline Heights', 12.9792, 77.7318, true), ('Green Meadows', 12.9035, 77.6912, true), ('Lakeview Villas', 13.0612, 77.6488, true),
    ('Urban Nest', 12.8501, 77.6713, true), ('Sunrise Enclave', 13.2265, 77.6982, true), ('TechPark One', 12.9312, 77.6862, false),
    ('Royal Palms', 12.8722, 77.5562, true), ('Metro Residency', 13.0418, 77.5916, false)) v(n, lat, lng, pub)
  where x.org_id = O1 and x.name = v.n;

  -- Lead sources
  insert into public.lead_sources (org_id, name, kind, default_project_id, active, created_at) values
    (O1, '99acres – main account', '99acres', null, true, now() - interval '150 days'),
    (O1, 'MagicBricks', 'magicbricks', null, true, now() - interval '150 days'),
    (O1, 'Housing.com', 'housing', null, false, now() - interval '120 days'),
    (O1, 'Facebook – Skyline Heights ads', 'meta', P[1], true, now() - interval '90 days'),
    (O1, 'Google Ads – Lakeview Villas', 'google', P[3], true, now() - interval '60 days'),
    (O1, 'doyerealty.in contact form', 'website', null, true, now() - interval '140 days');
  update public.lead_sources set external_id = '104729384756201' where org_id = O1 and kind = 'meta';
  S := array(select id from public.lead_sources where org_id = O1 order by created_at, name);

  -- Message templates
  insert into public.templates (org_id, name, use_for, body) values
    (O1, 'First hello', 'Welcome', 'Hi {{name}}, this is {{agent}} from {{company}}. Thanks for your interest in {{project}}. When is a good time to talk? You can also reach me at {{agent_phone}}.'),
    (O1, 'Price sheet follow-up', 'Follow-up', 'Hi {{name}}, did you get a chance to see the price sheet for {{project}}? Happy to explain the payment plan on a quick call.'),
    (O1, 'Visit reminder', 'Visit reminder', 'Hi {{name}}, reminder for your site visit to {{project}} on {{visit_time}}. Location pin: https://maps.example.com/xyz. Call {{agent}} at {{agent_phone}} when you reach.'),
    (O1, 'Thanks for visiting', 'After visit', 'Thank you for visiting {{project}} today, {{name}}! Sharing the brochure and floor plans. Let me know which unit you liked.'),
    (O1, 'Birthday wish', 'Birthday', 'Happy birthday {{name}}! 🎂 Wishing you and your family a great year. — {{agent}}, {{company}}'),
    (O1, 'Diwali offer', 'Price / offer', 'Hi {{name}}, Diwali offer at {{project}}: no floor rise charges + free car park till 31 Oct. Only a few {{bhk}} units left in your budget ({{budget}}).'),
    (O1, 'Not reachable', 'Follow-up', 'Hi {{name}}, I tried calling you about your enquiry for a {{bhk}} near {{location}}. Please share a good time to call.'),
    (O1, 'Long template (edge case)', 'Other', repeat('This is a very long message to check how long templates look on small screens. ', 12));

  -- ---------- Leads ----------
  for i in 1..900 loop
    age := power(random(), 1.7) * 160;                        -- more recent leads than old ones
    t_created := now() - make_interval(secs => (age * 86400)::int);
    if i <= 14 then t_created := now() - make_interval(mins => (i * 9 + (random() * 6)::int)); age := 0; end if;  -- fresh leads, first call due

    -- stage by age
    r := random();
    if age < 0.2 then st := case when r < .8 then 'new' else 'contacted' end;
    elsif age < 3 then st := case when r < .35 then 'new' when r < .65 then 'contacted' when r < .85 then 'qualified' when r < .92 then 'visit' else 'lost' end;
    else st := case when r < .02 then 'new' when r < .20 then 'contacted' when r < .34 then 'qualified' when r < .41 then 'visit' when r < .50 then 'visited'
                    when r < .56 then 'negotiation' when r < .59 then 'token' when r < .67 then 'booked' else 'lost' end;
    end if;
    v_stage_idx := coalesce(public.stage_index(st), 0);

    -- owner of the lead
    agent := U[POOL[1 + floor(random() * array_length(POOL, 1))::int]];
    if agent = U[10] and st not in ('booked', 'lost') then agent := U[3]; end if;      -- the removed agent keeps only closed leads
    if age < 0.5 and random() < .25 then agent := U[9]; end if;                       -- new joiner gets a few fresh leads
    if random() < .05 and st in ('new', 'contacted') then agent := null; end if;       -- not assigned yet

    v_src := SRC[1 + floor(random() * array_length(SRC, 1))::int];
    partner := null;
    if random() < .035 then v_src := 'Channel partner'; end if;
    v_srcid := case v_src when '99acres' then S[1] when 'MagicBricks' then S[2] when 'Housing.com' then S[3] when 'Facebook' then S[4] when 'Google Ads' then S[5] when 'Website' then S[6] else null end;

    pi := case when v_src = 'Facebook' then 1 when v_src = 'Google Ads' then 3 when random() < .78 then 1 + floor(power(random(), 1.3) * 8)::int else null end;
    v_proj := case when pi is null then null else P[pi] end;

    v_name := FIRST[1 + floor(random() * array_length(FIRST, 1))::int] || ' ' || LAST[1 + floor(random() * array_length(LAST, 1))::int];
    v_phone := (array['9','8','7','6'])[1 + floor(random() * 4)::int] || lpad(((i * 104729 + 7919) % 1000000000)::text, 9, '0');

    b := 1 + floor(random() * 16)::int;
    v_score := case when v_stage_idx >= 5 then (array['hot','hot','warm'])[1 + floor(random() * 3)::int]
                    when st = 'lost' then (array['cold','cold','warm'])[1 + floor(random() * 3)::int]
                    else (array['hot','warm','warm','warm','cold'])[1 + floor(random() * 5)::int] end;

    calls := case when st = 'new' then (case when random() < .3 and age > 0.1 then 1 + floor(random() * 2)::int else 0 end)
                  else 1 + floor(random() * (2 + v_stage_idx * 1.5))::int end;
    if i <= 14 then calls := 0; end if;

    -- next follow-up: overdue, today, later, or none (edge cases on purpose)
    r := random();
    fu := case
      when st in ('booked', 'lost') then null
      when st = 'new' then t_created + interval '5 minutes'
      when r < .18 then now() - make_interval(hours => 2 + (random() * 200)::int)          -- overdue
      when r < .30 then now() - make_interval(mins => 10 + (random() * 100)::int)          -- overdue earlier today
      when r < .45 then now() + make_interval(mins => 20 + (random() * 360)::int)          -- later today
      when r < .80 then now() + make_interval(hours => 20 + (random() * 300)::int)         -- coming days
      else null end;                                                                       -- no next step
    v_reason := case when st = 'lost' then REASONS[1 + floor(random() * array_length(REASONS, 1))::int] end;
    v_max := case when st = 'lost' then floor(random() * 6)::int else v_stage_idx end;

    insert into public.leads (org_id, name, phone, email, dob, budget_min, budget_max, bhk, property_type, location, purpose, preferred_slot,
      source, source_id, project_id, stage, max_stage, lost_reason, score, assigned_to, partner_id, next_follow_up, call_attempts, created_at, updated_at)
    values (O1, v_name, v_phone,
      case when random() < .62 then lower(replace(replace(v_name, ' ', '.'), '''', '')) || (i % 97) || (array['@gmail.com','@yahoo.co.in','@outlook.com','@hotmail.com'])[1 + floor(random() * 4)::int] end,
      case when random() < .3 then (date '1965-01-01' + (random() * 12000)::int) end,
      nullif(BUDGETS[b][1], 0), nullif(BUDGETS[b][2], 0),
      case when pi in (3, 7) then '4 BHK' when pi = 5 then 'Plot' when pi = 6 then 'Shop / Office' when random() < .1 then null
           else (array['1 BHK','2 BHK','2 BHK','3 BHK','3 BHK','4 BHK'])[1 + floor(random() * 6)::int] end,
      case when pi in (3, 7) then 'Villa' when pi = 5 then 'Plot' when pi = 6 then 'Commercial' when random() < .2 then null else 'Apartment' end,
      case when random() < .85 then AREAS[1 + floor(random() * array_length(AREAS, 1))::int] end,
      case when random() < .55 then (array['Self use','Self use','Investment','Both'])[1 + floor(random() * 4)::int] end,
      case when random() < .35 then SLOTS[1 + floor(random() * array_length(SLOTS, 1))::int] end,
      v_src, v_srcid, v_proj, st, v_max, v_reason, v_score, agent, partner, fu, calls, t_created, t_created)
    returning id into v_lead;

    -- history
    insert into public.activities (org_id, lead_id, type, body, by_user, created_at) values (O1, v_lead, 'created',
      case when v_src in ('99acres','MagicBricks','Housing.com','Facebook','Google Ads','Website') then 'Came from ' || v_src || coalesce(' · ' || (select name from public.projects where id = v_proj), '') ||
             case when random() < .4 then E'\nMessage: Please share price details and floor plan.' else '' end
           else 'Added by hand (' || v_src || ')' end,
      case when v_src in ('Walk-in','Referral','Other') then coalesce(agent, U[2]) end, t_created);
    t_last := t_created;
    for k in 1..calls loop
      t := t_created + (now() - t_created) * (k::numeric / (calls + 1)) * random();
      if k = calls and st not in ('booked', 'lost') and random() < .8 then t := now() - make_interval(mins => (random() * 9 * 1440)::int); end if;  -- most open leads were called recently
      if t <= t_last then t := t_last + interval '7 minutes'; end if;
      exit when t > now();
      insert into public.activities (org_id, lead_id, type, body, by_user, created_at) values (O1, v_lead, 'call',
        'Call: ' || case when k = calls and st not in ('new', 'lost') then 'Talked, interested' else outcomes[1 + floor(random() * 5)::int] end ||
        case when random() < .35 then E'\n' || NOTES[1 + floor(random() * array_length(NOTES, 1))::int] else '' end, coalesce(agent, U[2]), t);
      t_last := t;
    end loop;
    if v_stage_idx >= 1 or st = 'lost' then
      insert into public.activities (org_id, lead_id, type, body, by_user, created_at)
      values (O1, v_lead, 'stage', 'Stage: New → ' || case when st = 'lost' then 'Lost' else 'Contacted' end, coalesce(agent, U[2]), least(now(), t_created + interval '1 hour'));
    end if;
    if random() < .3 then
      insert into public.activities (org_id, lead_id, type, body, by_user, created_at)
      values (O1, v_lead, 'whatsapp', 'WhatsApp sent: ' || (array['First hello','Price sheet follow-up','Not reachable','Diwali offer'])[1 + floor(random() * 4)::int], coalesce(agent, U[2]), least(now(), t_created + interval '2 hours'));
    end if;
    if random() < .25 then
      insert into public.activities (org_id, lead_id, type, body, by_user, created_at)
      values (O1, v_lead, 'note', NOTES[1 + floor(random() * array_length(NOTES, 1))::int], coalesce(agent, U[2]), least(now(), t_created + (now() - t_created) * random()));
    end if;
    if random() < .07 and age > 5 then   -- same person enquired again
      insert into public.activities (org_id, lead_id, type, body, by_user, created_at)
      values (O1, v_lead, 'enquiry', 'Enquired again. Came from ' || (array['99acres','MagicBricks','Facebook'])[1 + floor(random() * 3)::int] || E'\nMessage: Still looking, any new offers?', null, now() - make_interval(days => (random() * least(age, 20))::int));
    end if;
    if random() < .05 and agent is not null and v_stage_idx >= 1 then
      insert into public.activities (org_id, lead_id, type, body, by_user, created_at)
      values (O1, v_lead, 'assign', 'Assigned to ' || (select full_name from public.members where org_id = O1 and user_id = agent) || ' (was Deepak Rao)', U[2], least(now(), t_created + interval '2 days'));
    end if;
    if st = 'lost' then
      insert into public.activities (org_id, lead_id, type, body, by_user, created_at)
      values (O1, v_lead, 'stage', 'Marked lost: ' || v_reason, coalesce(agent, U[2]), least(now(), t_created + (now() - t_created) * .7));
    end if;

    -- site visits
    if v_stage_idx >= 3 or (st = 'lost' and v_max >= 4) then
      if st = 'visit' then
        r := random();
        vis_at := case when r < .3 then date_trunc('hour', now()) + make_interval(hours => 1 + (random() * 6)::int)       -- today
                       when r < .55 then date_trunc('day', now()) + interval '1 day 5 hours 30 minutes' + make_interval(hours => (random() * 7)::int)  -- tomorrow (IST daytime)
                       when r < .85 then date_trunc('day', now()) + make_interval(days => 2 + (random() * 9)::int) + interval '5 hours'
                       else now() - make_interval(days => 1 + (random() * 3)::int) end;          -- date passed, result not entered (edge case)
        insert into public.visits (org_id, lead_id, project_id, at, agent_id, status, created_at)
        values (O1, v_lead, coalesce(v_proj, P[1]), vis_at, coalesce(agent, U[3]), 'scheduled', least(now(), t_created + interval '1 day'));
        insert into public.activities (org_id, lead_id, type, body, by_user, created_at)
        values (O1, v_lead, 'visit', 'Site visit booked: ' || coalesce((select name from public.projects where id = v_proj), 'Skyline Heights') || ' on ' || to_char(vis_at at time zone 'Asia/Kolkata', 'Dy DD Mon, HH12:MI am'), coalesce(agent, U[3]), least(now(), t_created + interval '1 day'));
      else
        if random() < .2 then  -- did not come the first time
          vis_at := t_created + (now() - t_created) * .4;
          insert into public.visits (org_id, lead_id, project_id, at, agent_id, status, created_at)
          values (O1, v_lead, coalesce(v_proj, P[2]), vis_at, coalesce(agent, U[3]), 'noshow', vis_at - interval '2 days');
          insert into public.activities (org_id, lead_id, type, body, by_user, created_at)
          values (O1, v_lead, 'visit', 'Did not come to ' || coalesce((select name from public.projects where id = v_proj), 'Green Meadows'), coalesce(agent, U[3]), vis_at + interval '3 hours');
        end if;
        vis_at := t_created + (now() - t_created) * .6;
        insert into public.visits (org_id, lead_id, project_id, at, agent_id, status, interest, feedback, created_at)
        values (O1, v_lead, coalesce(v_proj, P[2]), vis_at, coalesce(agent, U[3]), 'done', v_score,
          (array['Liked the clubhouse. Wants a higher floor.','Felt the flat is small. Showing 3 BHK next.','Came with parents. Very positive.','Location too far from office.','Asked for best price, will revert.', null])[1 + floor(random() * 6)::int],
          vis_at - interval '2 days');
        insert into public.activities (org_id, lead_id, type, body, by_user, created_at)
        values (O1, v_lead, 'visit', 'Visited ' || coalesce((select name from public.projects where id = v_proj), 'Green Meadows'), coalesce(agent, U[3]), vis_at + interval '2 hours');
      end if;
    end if;

    if st = 'booked' then
      update public.leads set booked_at = least(now() - interval '1 hour', t_created + (now() - t_created) * (.7 + random() * .3)) where id = v_lead;
      insert into public.activities (org_id, lead_id, type, body, by_user, created_at)
      values (O1, v_lead, 'stage', 'Stage: Token paid → Booked', coalesce(agent, U[2]), least(now(), t_created + (now() - t_created) * .9));
    end if;
  end loop;

  -- ---------- Edge-case leads ----------
  insert into public.leads (org_id, name, phone, email, source, stage, score, assigned_to, next_follow_up, budget_max, location, created_at) values
    (O1, 'Venkata Subrahmanya Lakshmi Narasimha Swamy Raghavendra Prasad Chakravarthy Kodandarama Sastry Bhimavarapu', '+91 98450 99001', null, 'Walk-in', 'contacted', 'warm', U[3], now() + interval '2 hours', 95, 'Very long area name: Survey No. 123/4, Behind Govt School, Near Big Banyan Tree, Off Old Madras Road', now() - interval '3 days'),
    (O1, 'राहुल शर्मा', '09845099002', null, 'Referral', 'qualified', 'hot', U[4], now() - interval '1 day', 120, 'Hebbal', now() - interval '6 days'),
    (O1, 'ಅನಿಲ್ ಕುಮಾರ್', '919845099003', 'anil.kumar.kannada@example.com', 'Walk-in', 'new', 'warm', U[5], now(), null, null, now() - interval '40 minutes'),
    (O1, 'A', '9845099004', null, 'Other', 'contacted', 'cold', U[6], null, null, null, now() - interval '20 days'),
    (O1, 'MR. RAMESH  (BROKER?)', '98450-99005', 'RAMESH@EXAMPLE.COM', 'Other', 'contacted', 'cold', U[7], null, null, 'Koramangala', now() - interval '45 days'),
    (O1, 'Neha Kapoor 🙂', '9845099006', 'neha+crm@example.com', 'Instagram', 'negotiation', 'hot', U[8], now() + interval '30 minutes', 180, 'Indiranagar', now() - interval '25 days'),
    (O1, 'O''Brien Fernandes', '9845099007', null, 'Website', 'token', 'hot', U[2], now() + interval '1 day', 210, 'Whitefield', now() - interval '35 days'),
    (O1, 'No Budget No Area', '9845099008', null, null, 'new', 'warm', null, now() - interval '3 hours', null, null, now() - interval '3 hours');
  update public.leads set stage = 'lost', lost_reason = 'Other' where org_id = O1 and phone = '9845099005';
  update public.leads set project_id = P[6] where org_id = O1 and phone = '9845099006';

  -- ---------- Fix-ups that triggers can't know about (old dates) ----------
  update public.leads l set
    last_activity_at = (select max(a.created_at) from public.activities a where a.lead_id = l.id),
    assigned_at = case when l.assigned_to is null then null else l.created_at + interval '1 minute' end
  where l.org_id = O1;
  -- Some leads nobody touched for weeks (clean-up list)
  update public.leads set last_activity_at = now() - interval '25 days'
  where id in (select id from public.leads where org_id = O1 and stage in ('contacted', 'qualified') order by created_at limit 18);

  -- Second chance: lost leads. Lost 30+ days ago → most already handled, some due now.
  update public.leads l set recycle_at = null, recycle_step = 3 where org_id = O1 and stage = 'lost';
  update public.leads set recycle_at = now() - make_interval(days => (random() * 5)::int), recycle_step = 1
  where id in (select id from public.leads where org_id = O1 and stage = 'lost' and lost_reason not in ('Wrong number', 'Bought elsewhere') and created_at < now() - interval '35 days' order by random() limit 12);
  update public.leads set recycle_at = now() + make_interval(days => 3 + (random() * 25)::int), recycle_step = 1
  where org_id = O1 and stage = 'lost' and recycle_step = 3 and lost_reason not in ('Wrong number', 'Bought elsewhere') and created_at > now() - interval '30 days';

  -- Lead-source counts
  update public.lead_sources s set lead_count = (select count(*) from public.leads l where l.source_id = s.id),
    last_lead_at = (select max(created_at) from public.leads l where l.source_id = s.id)
  where s.org_id = O1;

  -- ---------- Money (only admins can see this) ----------
  declare
    d record; v_deal uuid; v_val numeric; v_pct numeric; v_com numeric; bd date; m int; md date; ag record; c int := 0;
  begin
    for d in
      select l.id, l.name, l.project_id, l.assigned_to, l.booked_at, l.budget_max, p.price_from, p.price_to
      from public.leads l left join public.projects p on p.id = l.project_id
      where l.org_id = O1 and l.stage = 'booked' order by l.booked_at
    loop
      c := c + 1;
      continue when d.booked_at > now() - interval '6 days' and c % 2 = 0;   -- a few recent bookings with no deal details yet
      v_val := round(coalesce(d.price_from + random() * (coalesce(d.price_to, d.price_from * 1.4) - d.price_from), d.budget_max, 80 + random() * 60) * 100000 / 10000) * 10000;
      v_pct := (array[2, 2, 2, 1.5, 2.5, 3])[1 + floor(random() * 6)::int];
      v_com := round(v_val * v_pct / 100);
      bd := d.booked_at::date;
      insert into public.deals (org_id, lead_id, project_id, buyer_name, unit_no, booked_on, agreement_value, commission_pct, commission_amount, agent_id, incentive_amount, status, notes, created_by, created_at)
      values (O1, d.id, d.project_id, d.name, (array['A','B','C','D'])[1 + floor(random() * 4)::int] || '-' || (1 + floor(random() * 18)::int) || lpad((1 + floor(random() * 8)::int)::text, 2, '0'),
              bd, v_val, v_pct, v_com, d.assigned_to, round(v_com * 0.1), case when c = 7 then 'cancelled' else 'active' end,
              case when c = 7 then 'Buyer cancelled after loan rejection. Token refunded.' when random() < .2 then 'Builder pays commission in 2 parts: 50% at agreement, 50% at registration.' end,
              U[1], d.booked_at)
      returning id into v_deal;
      insert into public.deal_installments (org_id, deal_id, label, amount, due_on, paid_amount, paid_on) values
        (O1, v_deal, 'Token / booking amount', round(v_val * .02), bd, round(v_val * .02), bd),
        (O1, v_deal, 'Agreement (8%)', round(v_val * .08), bd + 30, case when bd + 30 < current_date and random() < .85 then round(v_val * .08) else 0 end, case when bd + 30 < current_date then bd + 28 end),
        (O1, v_deal, 'Bank loan disbursal (80%)', round(v_val * .8), bd + 75, case when bd + 75 < current_date and random() < .6 then round(v_val * .8) else 0 end, case when bd + 75 < current_date then bd + 80 end),
        (O1, v_deal, 'On possession (10%)', round(v_val * .1), bd + 365, 0, null);
      update public.deal_installments set paid_on = null where deal_id = v_deal and paid_amount = 0;
      if c <> 7 and bd < current_date - 30 then
        if random() < .7 then
          insert into public.money_entries (org_id, entry_date, direction, category, amount, deal_id, mode, note, created_by)
          values (O1, least(current_date, bd + 30 + (random() * 15)::int), 'in', 'Commission', v_com, v_deal, 'Bank transfer', 'Commission from builder — ' || d.name, U[1]);
          if random() < .7 and d.assigned_to is not null then
            insert into public.money_entries (org_id, entry_date, direction, category, amount, deal_id, person_id, mode, note, created_by)
            values (O1, least(current_date, bd + 45), 'out', 'Incentive', round(v_com * 0.1), v_deal, d.assigned_to, 'Bank transfer', 'Incentive for ' || d.name || ' booking', U[11]);
          end if;
        elsif random() < .6 then
          insert into public.money_entries (org_id, entry_date, direction, category, amount, deal_id, mode, note, created_by)
          values (O1, least(current_date, bd + 35), 'in', 'Commission', round(v_com / 2), v_deal, 'Cheque', 'First half of commission — ' || d.name, U[1]);
        end if;
      end if;
    end loop;

    -- Monthly costs for the last 6 months (current month only up to today)
    for m in 0..5 loop
      md := (date_trunc('month', current_date) - make_interval(months => m))::date;
      insert into public.money_entries (org_id, entry_date, direction, category, amount, lead_source, mode, note, created_by)
      select O1, x.dt, 'out', x.cat, x.amt, x.src, x.mode, x.note, U[1] from (values
        (md + 1, 'Ads', 30000, '99acres', 'Card', '99acres monthly package'),
        (md + 2, 'Ads', 22000, 'MagicBricks', 'Card', 'MagicBricks listings'),
        (md + 3, 'Ads', case when m >= 4 then 15000 else 0 end, 'Housing.com', 'Card', 'Housing.com (stopped — few leads)'),
        (md + 5, 'Ads', round(35000 + random() * 25000), 'Facebook', 'Card', 'Facebook / Instagram ads'),
        (md + 6, 'Ads', round(40000 + random() * 15000), 'Google Ads', 'Card', 'Google search ads'),
        (md + 1, 'Rent', 55000, null, 'Bank transfer', 'Office rent'),
        (md + 10, 'Office', round(8000 + random() * 7000), null, 'UPI', 'Electricity, internet, tea, printing'),
        (md + 15, 'Site visit', round(6000 + random() * 8000), null, 'UPI', 'Cabs for client site visits'),
        (md + 20, 'Travel', round(3000 + random() * 5000), null, 'UPI', 'Petrol and travel'),
        (md + 18, 'Tax', case when extract(month from md)::int % 3 = 0 then 45000 else 0 end, null, 'Bank transfer', 'GST payment'),
        (md + 22, 'Other income', case when m = 2 then 25000 else 0 end, null, 'UPI', 'Rental brokerage (one-time)')
      ) x(dt, cat, amt, src, mode, note)
      where x.amt > 0 and x.dt <= current_date;
      update public.money_entries set direction = 'in' where org_id = O1 and category = 'Other income';
      -- salaries on the 1st
      for ag in select user_id, role, full_name from public.members where org_id = O1 and role in ('manager', 'agent') loop
        continue when ag.user_id = U[9] and m > 0;          -- Vikram joined this month
        continue when ag.user_id = U[10] and m = 0;         -- Deepak left last month
        insert into public.money_entries (org_id, entry_date, direction, category, amount, person_id, mode, note, created_by)
        values (O1, md + 1, 'out', 'Salary', case when ag.role = 'manager' then 65000 else 28000 + (abs(hashtext(ag.full_name)) % 6) * 2000 end, ag.user_id, 'Bank transfer', 'Salary — ' || ag.full_name, U[11]);
      end loop;
    end loop;
  end;

  -- ---------- Shortlists sent to clients ----------
  insert into public.shortlists (org_id, lead_id, project_ids, note, views, first_viewed_at, last_viewed_at, reactions, created_by, created_at)
  select O1, l.id, (array[P[1], P[2], P[4]])[1:2 + (row_number() over () % 2)::int],
         case when random() < .5 then 'Hi ' || split_part(l.name, ' ', 1) || ', these match your budget and area. Tap "Book a visit" on any one you like.' end,
         v.views, case when v.views > 0 then now() - interval '2 days' end, case when v.views > 0 then now() - make_interval(hours => (random() * 40)::int) end,
         case when v.views > 1 then jsonb_build_object(P[1]::text, 'like', P[2]::text, 'no') when v.views = 1 then jsonb_build_object(P[1]::text, 'visit') else '{}'::jsonb end,
         coalesce(l.assigned_to, U[2]), now() - interval '3 days'
  from (select * from public.leads where org_id = O1 and stage in ('qualified', 'visit') and assigned_to is not null order by created_at desc limit 15) l
  cross join lateral (select (floor(random() * 4))::int as views) v;
  update public.shortlists set project_ids = array[P[3], P[7]], reactions = jsonb_build_object(P[3]::text, 'like') where id in (select id from public.shortlists where org_id = O1 order by created_at limit 3);

  -- Now remove Deepak (he only has closed leads left)
  update public.members set active = false, deactivated_at = now() - interval '20 days' where org_id = O1 and user_id = U[10];

  -- ---------- Alerts ----------
  delete from public.notifications where org_id = O1;
  insert into public.notifications (org_id, user_id, type, title, body, link, read_at, created_at)
  select l.org_id, l.assigned_to, 'lead_assigned', 'New lead: ' || l.name, concat_ws(' · ', l.phone, l.source), '/leads/' || l.id,
         case when l.created_at < now() - interval '1 day' then l.created_at + interval '20 minutes' end, l.created_at
  from public.leads l where l.org_id = O1 and l.assigned_to is not null and l.created_at > now() - interval '10 days';
  insert into public.notifications (org_id, user_id, type, title, body, link, created_at)
  select O1, U[4], 'lead_taken', 'Lead moved: ' || l.name, 'It was not called within 15 minutes, so it went to the next agent.', null, now() - interval '50 minutes'
  from public.leads l where l.org_id = O1 and l.assigned_to = U[5] and l.stage = 'new' limit 1;

  -- ---------- A brand-new project that fits old leads (shows the "we had a lead who wanted this" alerts) ----------
  insert into public.projects (org_id, name, developer, location, type, configs, price_from, price_to, status, possession, highlights, photos, lat, lng, is_public, created_at)
  values (O1, 'Aster Greens (new launch)', 'Sobha-style Developers', 'Whitefield', 'Apartment', '2, 3 BHK', 70, 125, 'Pre-launch', 'Jun 2029',
          'Launch offer: no floor rise charges for the first 50 bookings', array['/demo/projects/urban-nest-1.jpg', '/demo/projects/skyline-heights-3.jpg'], 12.9725, 77.7445, true, now() - interval '2 hours');
  update public.project_matches set created_at = now() - interval '2 hours' where org_id = O1;
end $$;

drop table if exists pg_temp.demo_people;

-- Quick check: how much demo data was made
select o.name,
  (select count(*) from public.leads l where l.org_id = o.id) as leads,
  (select count(*) from public.activities a where a.org_id = o.id) as history,
  (select count(*) from public.visits v where v.org_id = o.id) as visits,
  (select count(*) from public.projects p where p.org_id = o.id) as projects,
  (select count(*) from public.members m where m.org_id = o.id) as people,
  (select count(*) from public.deals d where d.org_id = o.id) as deals,
  (select count(*) from public.money_entries e where e.org_id = o.id) as money_entries,
  (select count(*) from public.shortlists x where x.org_id = o.id) as shortlists
from public.organizations o where o.id = 'de000000-0000-4000-8000-000000000101';
