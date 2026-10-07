-- patch-015: safety fixes from a full check of the site. Safe to run more than once.
-- 1 spam limits on public forms · 2 public pages keep locked details locked · 3 admin can never be locked out
-- 4 removed people stay removed · 5 one mobile number = one person · 6 smaller fixes

-- ---------- 1. Spam limits ----------
create table if not exists public.public_hits (k text not null, at timestamptz not null default now());
create index if not exists public_hits_k_at on public.public_hits (k, at);
alter table public.public_hits enable row level security;
revoke all on public.public_hits from anon, authenticated;

-- true = allowed (and counted). Old rows are cleaned now and then.
create or replace function public.hit_ok(p_key text, p_window interval, p_max int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if random() < 0.02 then delete from public.public_hits where at < now() - interval '2 days'; end if;
  if (select count(*) from public.public_hits where k = p_key and at > now() - p_window) >= p_max then return false; end if;
  insert into public.public_hits (k) values (p_key);
  return true;
end $$;
revoke all on function public.hit_ok(text, interval, int) from public, anon, authenticated;

-- Project page enquiry: max 60 an hour per project, and 1 every 2 minutes per number.
create or replace function public.public_enquiry(p_token text, p_name text, p_phone text, p_message text, p_when timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare p public.projects%rowtype; v_phone text := public.normalize_phone(p_phone); v_lead public.leads%rowtype; v_to uuid; v_note text;
begin
  select * into p from public.projects where share_token = p_token and is_public;
  if not found or not public.org_ok(p.org_id) then return false; end if;
  if v_phone is null or not public.valid_phone(v_phone) or char_length(trim(coalesce(p_name, ''))) < 2 then return false; end if;
  if not public.hit_ok('enq:' || p.id, interval '1 hour', 60) then return false; end if;
  -- the same number again within 2 minutes: say yes, but do nothing twice
  if not public.hit_ok('enqp:' || p.org_id || ':' || v_phone, interval '2 minutes', 1) then return true; end if;
  v_note := concat_ws(E'\n', 'Enquiry from the project page: ' || p.name,
    case when p_when is not null then 'Wants a site visit on ' || to_char(p_when at time zone 'Asia/Kolkata', 'Dy DD Mon, HH12:MI am') end,
    nullif(left(trim(p_message), 500), ''));
  select * into v_lead from public.leads where org_id = p.org_id and phone = v_phone for update;
  if found then
    update public.leads set project_id = coalesce(project_id, p.id), next_follow_up = now(),
      stage = case when stage = 'lost' then 'new' else stage end where id = v_lead.id;
    insert into public.activities (org_id, lead_id, type, body, by_user) values (p.org_id, v_lead.id, 'enquiry', 'Enquired again. ' || v_note, null);
    perform public.notify(p.org_id, v_lead.assigned_to, 'enquiry', v_lead.name || ' enquired again', p.name, '/leads/' || v_lead.id);
  else
    if (select auto_assign from public.organizations where id = p.org_id) then v_to := public.next_assignee(p.org_id); end if;
    insert into public.leads (org_id, name, phone, source, project_id, assigned_to, next_follow_up, score)
      values (p.org_id, left(trim(p_name), 120), v_phone, 'Website', p.id, v_to, now(), case when p_when is not null then 'hot' else 'warm' end)
      returning * into v_lead;
    insert into public.activities (org_id, lead_id, type, body, by_user) values (p.org_id, v_lead.id, 'created', v_note, null);
  end if;
  return true;
end $$;
revoke all on function public.public_enquiry(text, text, text, text, timestamptz) from public;
grant execute on function public.public_enquiry(text, text, text, text, timestamptz) to anon, authenticated;

-- Client requirement form: limits, and an existing client's details are only ADDED to, never overwritten by a stranger.
create or replace function public.submit_requirement(
  p_form text, p_by uuid, p_name text, p_phone text, p_bhk text, p_ptype text,
  p_bmin numeric, p_bmax numeric, p_location text, p_purpose text, p_timeline text, p_loan text, p_slot text, p_note text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.organizations%rowtype; v_phone text := public.normalize_phone(p_phone); v_lead public.leads%rowtype;
        v_to uuid; v_note text; v_fits int; v_hot boolean; v_new boolean := false;
begin
  select * into o from public.organizations where form_token = p_form;
  if not found or not public.org_ok(o.id) then return jsonb_build_object('ok', false); end if;
  if v_phone is null or not public.valid_phone(v_phone) or char_length(coalesce(trim(p_name), '')) < 2 then return jsonb_build_object('ok', false); end if;
  if p_bmin is not null and p_bmax is not null and p_bmin > p_bmax then return jsonb_build_object('ok', false); end if;
  if p_bmin < 0 or p_bmax < 0 or p_bmin > 1000000 or p_bmax > 1000000 then return jsonb_build_object('ok', false); end if;
  if not public.hit_ok('req:' || o.id, interval '1 hour', 60) then return jsonb_build_object('ok', false, 'busy', true); end if;
  if not public.hit_ok('reqp:' || o.id || ':' || v_phone, interval '2 minutes', 1) then return jsonb_build_object('ok', true, 'fits', 0); end if;
  v_hot := p_timeline in ('Right away', 'Within 3 months');
  v_note := concat_ws(E'\n', 'Filled the requirement form',
    'Looking for: ' || nullif(concat_ws(' · ', nullif(trim(p_bhk), ''), nullif(trim(p_ptype), ''), nullif(left(trim(p_location), 200), ''),
      case when p_bmin is not null or p_bmax is not null then 'budget ' || coalesce(p_bmin::text, '?') || '–' || coalesce(p_bmax::text, '?') || ' L' end), ''),
    'Purpose: ' || nullif(trim(p_purpose), ''),
    'When buying: ' || nullif(trim(p_timeline), ''), 'Home loan: ' || nullif(trim(p_loan), ''),
    'Best time to call: ' || nullif(trim(p_slot), ''), nullif(left(trim(p_note), 500), ''));

  select * into v_lead from public.leads where org_id = o.id and phone = v_phone for update;
  if found then
    -- only fill what is empty; what they said now is kept in the timeline note
    update public.leads set
      bhk = coalesce(bhk, nullif(trim(p_bhk), '')), property_type = coalesce(property_type, nullif(trim(p_ptype), '')),
      budget_min = coalesce(budget_min, p_bmin), budget_max = coalesce(budget_max, p_bmax),
      location = coalesce(location, nullif(left(trim(p_location), 200), '')), purpose = coalesce(purpose, nullif(trim(p_purpose), '')),
      preferred_slot = coalesce(preferred_slot, nullif(trim(p_slot), '')), next_follow_up = now(),
      stage = case when stage = 'lost' then 'new' else stage end
    where id = v_lead.id;
    insert into public.activities (org_id, lead_id, type, body, by_user) values (o.id, v_lead.id, 'enquiry', 'Sent their requirement again. ' || v_note, null);
    perform public.notify(o.id, v_lead.assigned_to, 'enquiry', v_lead.name || ' sent their requirement', 'Open the lead to see what they want.', '/leads/' || v_lead.id);
  else
    v_new := true;
    select m.user_id into v_to from public.members m where m.org_id = o.id and m.user_id = p_by and m.active and m.role <> 'partner';
    if v_to is null and o.auto_assign then v_to := public.next_assignee(o.id); end if;
    insert into public.leads (org_id, name, phone, bhk, property_type, budget_min, budget_max, location, purpose, preferred_slot,
                              source, assigned_to, next_follow_up, score)
      values (o.id, left(trim(p_name), 120), v_phone, nullif(trim(p_bhk), ''), nullif(trim(p_ptype), ''), p_bmin, p_bmax,
              nullif(left(trim(p_location), 200), ''), nullif(trim(p_purpose), ''), nullif(trim(p_slot), ''),
              'Requirement form', v_to, now(), case when v_hot then 'hot' else 'warm' end)
      returning * into v_lead;
    insert into public.activities (org_id, lead_id, type, body, by_user) values (o.id, v_lead.id, 'created', v_note, null);
  end if;

  select count(*) into v_fits from public.projects p
  where p.org_id = o.id and coalesce(p.status, '') <> 'Sold out'
    and (coalesce(p_bmin, p_bmax) is null or p.price_from is null or (
         p.price_from <= coalesce(p_bmax, p_bmin * 1.3) * 1.1
         and coalesce(p.price_to, p.price_from * 1.3) >= coalesce(p_bmin, p_bmax * 0.6) * 0.9));
  -- the advisor's name is shown only for a new lead (so a stranger cannot test who is already a client)
  return jsonb_build_object('ok', true, 'fits', v_fits,
    'advisor', case when v_new then (select full_name from public.members where org_id = o.id and user_id = v_lead.assigned_to) end);
end $$;
revoke all on function public.submit_requirement(text, uuid, text, text, text, text, numeric, numeric, text, text, text, text, text, text) from public;
grant execute on function public.submit_requirement(text, uuid, text, text, text, text, numeric, numeric, text, text, text, text, text, text) to anon, authenticated;

-- Website / portal intake: limits per source, and a stranger calling it directly learns nothing about existing leads.
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'ingest_lead_core') then
    alter function public.ingest_lead(text, text, text, text, text, text, numeric, numeric, text, text, text, jsonb) rename to ingest_lead_core;
  end if;
end $$;
revoke all on function public.ingest_lead_core(text, text, text, text, text, text, numeric, numeric, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.is_service() returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', current_setting('request.jwt.claim.role', true), '') = 'service_role'
$$;

create or replace function public.ingest_lead(
  p_key text, p_name text, p_phone text, p_email text, p_city text, p_location text,
  p_budget_min numeric, p_budget_max numeric, p_bhk text, p_project text, p_message text, p_raw jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; v_phone text := public.normalize_phone(p_phone);
begin
  if not public.is_service() then
    if not public.hit_ok('src:' || left(coalesce(p_key, ''), 64), interval '1 hour', 300) then return jsonb_build_object('ok', false, 'error', 'too_many'); end if;
    if coalesce(v_phone, '') <> '' and not public.hit_ok('srcp:' || left(coalesce(p_key, ''), 64) || ':' || v_phone, interval '2 minutes', 1) then
      return jsonb_build_object('ok', true);
    end if;
  end if;
  r := public.ingest_lead_core(p_key, left(p_name, 120), p_phone, left(p_email, 200), left(p_city, 120), left(p_location, 200),
         p_budget_min, p_budget_max, left(p_bhk, 30), left(p_project, 200), left(p_message, 2000), p_raw);
  if public.is_service() or not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  return jsonb_build_object('ok', true);  -- anon/browser callers get no names or numbers back
end $$;
revoke all on function public.ingest_lead(text, text, text, text, text, text, numeric, numeric, text, text, text, jsonb) from public;
grant execute on function public.ingest_lead(text, text, text, text, text, text, numeric, numeric, text, text, text, jsonb) to anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ingest_lead(text, text, text, text, text, text, numeric, numeric, text, text, text, jsonb) to service_role;
  end if;
end $$;

-- Shortlist reactions: project name only from the same company; a "visit" request at most once an hour per project.
create or replace function public.shortlist_react(p_token text, p_project uuid, p_reaction text, p_when timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare s public.shortlists%rowtype; l public.leads%rowtype; v_name text; v_body text;
begin
  if p_reaction not in ('like','no','visit','details') then return false; end if;
  select * into s from public.shortlists where token = p_token;
  if not found or not (p_project = any(s.project_ids)) or not public.org_ok(s.org_id) then return false; end if;
  select name into v_name from public.projects where id = p_project and org_id = s.org_id;
  if v_name is null then return false; end if;
  select * into l from public.leads where id = s.lead_id;
  if not public.hit_ok('sl:' || s.id, interval '1 hour', 40) then return true; end if;
  if p_reaction = 'details' then
    if exists (select 1 from public.activities where lead_id = l.id and type = 'note'
               and body = 'Client opened the price list and all photos of ' || v_name and created_at > now() - interval '1 day') then
      return true;
    end if;
    insert into public.activities (org_id, lead_id, type, body, by_user)
      values (s.org_id, s.lead_id, 'note', 'Client opened the price list and all photos of ' || v_name, null);
    update public.leads set next_follow_up = least(coalesce(next_follow_up, now()), now()) where id = l.id;
    perform public.notify(s.org_id, l.assigned_to, 'shortlist_like', l.name || ' is checking prices of ' || v_name,
      'They just opened the price list. Good time to call.', '/leads/' || l.id);
    return true;
  end if;
  if s.reactions ->> p_project::text = p_reaction and p_reaction <> 'visit' then return true; end if;
  if p_reaction = 'visit' and not public.hit_ok('slv:' || s.id || ':' || p_project, interval '1 hour', 1) then return true; end if;
  update public.shortlists set reactions = reactions || jsonb_build_object(p_project::text, p_reaction) where id = s.id;
  v_body := case p_reaction
    when 'like' then 'Client liked ' || v_name || ' on the shortlist'
    when 'no' then 'Client said "not for me" to ' || v_name
    else 'Client asked for a site visit at ' || v_name ||
      coalesce(' on ' || to_char(p_when at time zone 'Asia/Kolkata', 'Dy DD Mon, HH12:MI am'), '') || '. Call to confirm.' end;
  insert into public.activities (org_id, lead_id, type, body, by_user) values (s.org_id, s.lead_id, 'note', v_body, null);
  if p_reaction <> 'no' then
    update public.leads set next_follow_up = now(), score = case when p_reaction = 'visit' then 'hot' else score end where id = l.id;
    perform public.notify(s.org_id, l.assigned_to, 'shortlist_' || p_reaction, l.name || ': ' || case when p_reaction = 'visit' then 'wants a site visit' else 'liked ' || v_name end, v_body, '/leads/' || l.id);
  end if;
  return true;
end $$;
revoke all on function public.shortlist_react(text, uuid, text, timestamptz) from public;
grant execute on function public.shortlist_react(text, uuid, text, timestamptz) to anon, authenticated;

-- ---------- 2. Project page: the locked details really stay locked ----------
-- Before unlocking, only the cover photo and counts leave the database.
create or replace function public.get_public_project(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.projects%rowtype; o public.organizations%rowtype; c record; j jsonb;
begin
  select * into p from public.projects where share_token = p_token and is_public;
  if not found then return null; end if;
  select * into o from public.organizations where id = p.org_id;
  if not public.org_ok(o.id) then return null; end if;
  select full_name, phone into c from public.members where org_id = o.id and active and role = 'owner' and phone is not null order by joined_at limit 1;
  j := public.public_project_json(p) - 'price_to' - 'link' - 'floor_plans' - 'photos';
  return j || jsonb_build_object(
    'photos', case when coalesce(array_length(p.photos, 1), 0) > 0 then jsonb_build_array(p.photos[1]) else '[]'::jsonb end,
    'photo_count', coalesce(array_length(p.photos, 1), 0), 'has_range', p.price_to is not null, 'has_brochure', p.link is not null,
    'plan_count', jsonb_array_length(coalesce(p.floor_plans, '[]'::jsonb)),
    'company', o.name, 'company_rera', o.rera_no, 'contact_name', c.full_name, 'contact_phone', c.phone);
end $$;
revoke all on function public.get_public_project(text) from public;
grant execute on function public.get_public_project(text) to anon, authenticated;

-- Leaving a name and number on the project page: saves the enquiry, then gives the full details.
create or replace function public.unlock_public_project(p_token text, p_name text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.projects%rowtype;
begin
  if not public.public_enquiry(p_token, p_name, p_phone, 'Asked for the price list, floor plans and all photos', null) then return null; end if;
  select * into p from public.projects where share_token = p_token and is_public;
  if not found then return null; end if;
  return jsonb_build_object('photos', to_jsonb(coalesce(p.photos, '{}')), 'price_to', p.price_to, 'link', p.link, 'floor_plans', coalesce(p.floor_plans, '[]'::jsonb));
end $$;
revoke all on function public.unlock_public_project(text, text, text) from public;
grant execute on function public.unlock_public_project(text, text, text) to anon, authenticated;

-- ---------- 3. The company always keeps an admin; the founder cannot be pushed out ----------
create or replace function public.members_keep_admin() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_founder uuid;
begin
  -- only checks changes made by people in the app (not company deletion or account clean-up by the system)
  if auth.uid() is not null and old.role = 'owner' and old.active and (tg_op = 'DELETE' or new.role <> 'owner' or not new.active) then
    perform 1 from public.organizations where id = old.org_id for update;  -- one change at a time per company
    if not found then return case when tg_op = 'DELETE' then old else new end; end if;
    select created_by into v_founder from public.organizations where id = old.org_id;
    if old.user_id = v_founder and v_founder is not null and auth.uid() is not null then
      raise exception 'The person who created the company stays an admin. Ask them to make this change.';
    end if;
    if not exists (select 1 from public.members where org_id = old.org_id and role = 'owner' and active and user_id <> old.user_id) then
      raise exception 'The company needs at least one admin. Make someone else an admin first.';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists members_keep_admin on public.members;
create trigger members_keep_admin before update or delete on public.members for each row execute function public.members_keep_admin();

-- ---------- 4. Removed people stay removed ----------
-- Giving access back: managers cannot bring back an admin or a manager.
create or replace function public.reactivate_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(p_org); t text;
begin
  if r is null or r not in ('owner', 'manager') then raise exception 'Only an admin or a manager can give access back'; end if;
  if not public.org_ok(p_org) then raise exception 'Your plan has ended'; end if;
  if p_user = auth.uid() then raise exception 'You cannot do this for yourself'; end if;
  select role into t from public.members where org_id = p_org and user_id = p_user;
  if t is null then raise exception 'Person not found'; end if;
  if r = 'manager' and t in ('owner', 'manager') then raise exception 'Only an admin can give access back to an admin or a manager'; end if;
  update public.members set active = true, deactivated_at = null where org_id = p_org and user_id = p_user;
end $$;
revoke all on function public.reactivate_member(uuid, uuid) from public, anon;
grant execute on function public.reactivate_member(uuid, uuid) to authenticated;

-- ---------- 5. One mobile number = one person (kept where only the app can write it) ----------
create table if not exists public.user_phones (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text not null unique
);
alter table public.user_phones enable row level security;
revoke all on public.user_phones from anon, authenticated;
-- bring over numbers already saved (members first, then the newest sign-in wins)
insert into public.user_phones (user_id, phone)
select distinct on (x.phone) x.user_id, x.phone from (
  select m.user_id, m.phone, 0 as pri, null::timestamptz as t from public.members m where m.phone is not null and m.phone <> ''
  union all
  select u.id, public.normalize_phone(u.raw_user_meta_data ->> 'phone'), 1, u.last_sign_in_at from auth.users u
  where coalesce(u.raw_user_meta_data ->> 'phone', '') <> ''
) x
where public.valid_phone(x.phone) and not exists (select 1 from public.user_phones up where up.user_id = x.user_id or up.phone = x.phone)
order by x.phone, x.pri, x.t desc nulls last
on conflict do nothing;

create or replace function public.phone_taken(p_phone text, p_user uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from public.user_phones where phone = p_phone and user_id <> p_user)
      or exists (select 1 from public.members where phone = p_phone and user_id <> p_user)
      or exists (select 1 from auth.users u where u.id <> p_user and public.normalize_phone('+' || nullif(u.phone, '')) = p_phone)
      or exists (select 1 from public.join_requests where phone = p_phone and user_id <> p_user and status = 'pending')
$$;
revoke all on function public.phone_taken(text, uuid) from public, anon, authenticated;

create or replace function public.set_my_phone(p_phone text) returns text
language plpgsql security definer set search_path = public, auth as $$
declare v text := public.normalize_phone(p_phone);
begin
  if auth.uid() is null then raise exception 'Please log in again'; end if;
  if not public.valid_phone(v) then raise exception 'Enter a valid mobile number: 10 digits for India, or + and country code'; end if;
  perform pg_advisory_xact_lock(hashtext('phone:' || v));
  if public.phone_taken(v, auth.uid()) then raise exception 'This mobile number is already used by another account'; end if;
  insert into public.user_phones (user_id, phone) values (auth.uid(), v) on conflict (user_id) do update set phone = excluded.phone;
  update public.members set phone = v where user_id = auth.uid();
  return v;
end $$;
revoke all on function public.set_my_phone(text) from public, anon;
grant execute on function public.set_my_phone(text) to authenticated;

-- Mobile + password login: only numbers saved through the app count (not anything a user typed into their own profile data).
create or replace function public.login_email_for_phone(p_phone text) returns text
language sql stable security definer set search_path = public, auth as $$
  with v as (select public.normalize_phone(p_phone) as p)
  select u.email from auth.users u, v
  where v.p <> '' and u.email is not null and (
        exists (select 1 from public.user_phones up where up.user_id = u.id and up.phone = v.p)
     or public.normalize_phone('+' || nullif(u.phone, '')) = v.p
     or exists (select 1 from public.members m where m.user_id = u.id and m.phone = v.p and m.active))
  order by (exists (select 1 from public.user_phones up where up.user_id = u.id and up.phone = v.p)) desc, u.last_sign_in_at desc nulls last
  limit 1
$$;
revoke all on function public.login_email_for_phone(text) from public, anon, authenticated;

-- Join link: also tells which company (so a member of another company can still ask to join this one).
drop function if exists public.get_join_link(text);
create function public.get_join_link(p_token text)
returns table (org_id uuid, org_name text, city text) language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.city from public.organizations o
  where o.join_token = p_token and o.join_open and public.org_ok(o.id)
$$;
revoke all on function public.get_join_link(text) from public;
grant execute on function public.get_join_link(text) to anon, authenticated;

create or replace function public.request_to_join(p_token text, p_name text, p_phone text, p_wants text)
returns text language plpgsql security definer set search_path = public, auth as $$
declare o public.organizations%rowtype; m public.members%rowtype; r public.join_requests%rowtype;
        v_phone text := public.normalize_phone(p_phone); v_email text; v_label text; a record;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  select * into o from public.organizations where join_token = p_token and join_open;
  if not found or not public.org_ok(o.id) then raise exception 'This team link is not working. Ask your admin for a new one.'; end if;
  if p_wants not in ('agent', 'intern', 'manager') then raise exception 'Pick what you will work as'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Enter your full name'; end if;
  if v_phone is null or not public.valid_phone(v_phone) then raise exception 'Enter a valid mobile number: 10 digits for India, or + and country code'; end if;

  select * into m from public.members where org_id = o.id and user_id = auth.uid();
  if found and m.active then return 'member'; end if;
  if found and not m.active then raise exception 'Your access to % was removed. Ask the admin to give it back.', o.name; end if;
  select * into r from public.join_requests where org_id = o.id and user_id = auth.uid();
  if found and r.status = 'rejected' then raise exception 'Your request to join % was not accepted. Please talk to your admin.', o.name; end if;
  if found and r.status = 'pending' then return 'pending'; end if;
  if found and r.status = 'approved' then delete from public.join_requests where id = r.id; end if;  -- approved earlier, removed and deleted since: ask again

  perform pg_advisory_xact_lock(hashtext('phone:' || v_phone));
  if public.phone_taken(v_phone, auth.uid()) then raise exception 'This mobile number is already used by another account'; end if;
  insert into public.user_phones (user_id, phone) values (auth.uid(), v_phone) on conflict (user_id) do update set phone = excluded.phone;

  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  insert into public.join_requests (org_id, org_name, user_id, full_name, phone, email, wants)
    values (o.id, o.name, auth.uid(), left(trim(p_name), 80), v_phone, v_email, p_wants);

  v_label := case p_wants when 'manager' then 'Manager' when 'intern' then 'Intern' else 'Employee' end;
  for a in select user_id from public.members
           where org_id = o.id and active and (role = 'owner' or (role = 'manager' and p_wants <> 'manager')) loop
    perform public.notify(o.id, a.user_id, 'join_request', left(trim(p_name), 80) || ' wants to join as ' || v_label,
      'Check who it is, then approve or say no on the Team page.', '/team#requests');
  end loop;
  return 'pending';
end $$;
revoke all on function public.request_to_join(text, text, text, text) from public, anon;
grant execute on function public.request_to_join(text, text, text, text) to authenticated;

-- Approve: someone who is already in the company (or was removed) is not silently "approved".
create or replace function public.decide_join(p_id uuid, p_approve boolean, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.join_requests%rowtype; v_me text; m public.members%rowtype;
begin
  select * into r from public.join_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  v_me := public.my_role(r.org_id);
  if v_me is null or v_me not in ('owner', 'manager') then raise exception 'Only an admin or a manager can do this'; end if;
  if r.status <> 'pending' then raise exception 'This request was already handled'; end if;
  if r.user_id = auth.uid() then raise exception 'You cannot decide your own request'; end if;
  if v_me = 'manager' and r.wants = 'manager' then raise exception 'Only an admin can handle manager requests'; end if;
  if not p_approve then
    update public.join_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now() where id = p_id;
    return;
  end if;
  if p_role not in ('agent', 'intern', 'manager') then raise exception 'Pick a role'; end if;
  if v_me = 'manager' and p_role = 'manager' then raise exception 'Only an admin can add managers'; end if;
  if not public.org_ok(r.org_id) then raise exception 'Your plan has ended'; end if;
  select * into m from public.members where org_id = r.org_id and user_id = r.user_id;
  if found and m.active then  -- already joined another way: just close the request
    update public.join_requests set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = p_id;
    return;
  end if;
  if found and not m.active then
    raise exception '% was removed earlier. Use "Give access back" on the Team page instead.', r.full_name;
  end if;
  insert into public.members (org_id, user_id, role, is_intern, full_name, phone, email)
    values (r.org_id, r.user_id, case when p_role = 'intern' then 'agent' else p_role end, p_role = 'intern', r.full_name,
            case when public.phone_taken(r.phone, r.user_id) then null else r.phone end, r.email);
  update public.join_requests set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = p_id;
  perform public.notify(r.org_id, r.user_id, 'joined', 'Welcome to ' || r.org_name || '!', 'Your request was approved. Leads given to you will show up here.', '/dashboard');
end $$;
revoke all on function public.decide_join(uuid, boolean, text) from public, anon;
grant execute on function public.decide_join(uuid, boolean, text) to authenticated;

-- Admin can let a turned-down person ask again.
create or replace function public.clear_join_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.join_requests%rowtype;
begin
  select * into r from public.join_requests where id = p_id;
  if not found then return; end if;
  if public.my_role(r.org_id) is distinct from 'owner' then raise exception 'Only an admin can do this'; end if;
  delete from public.join_requests where id = p_id and status = 'rejected';
end $$;
revoke all on function public.clear_join_request(uuid) from public, anon;
grant execute on function public.clear_join_request(uuid) to authenticated;

-- Personal invite: a removed person cannot use an invite to bring themselves back; names are kept short.
create or replace function public.accept_invite(p_token text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare i public.invites%rowtype; v_phone text; v_email text; m public.members%rowtype;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  select * into i from public.invites where token = p_token for update;
  if not found then raise exception 'This invite link is not valid'; end if;
  if i.accepted_at is not null then raise exception 'This invite link was already used'; end if;
  if i.expires_at < now() then raise exception 'This invite link has expired. Ask for a new one.'; end if;
  select public.normalize_phone('+' || nullif(u.phone, '')), lower(u.email) into v_phone, v_email from auth.users u where u.id = auth.uid();
  if not ((i.phone is not null and i.phone = v_phone) or (i.email is not null and i.email = v_email)) then
    raise exception 'This invite was sent to a different mobile number or email. Log in with that one.';
  end if;
  if char_length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Enter your name'; end if;
  select * into m from public.members where org_id = i.org_id and user_id = auth.uid();
  if found and not m.active then raise exception 'Your access to this company was removed. Ask the admin to give it back.'; end if;
  if found and m.active then
    update public.invites set accepted_by = auth.uid(), accepted_at = now() where id = i.id;
    return i.org_id;  -- already in: keep the role they have
  end if;
  insert into public.members (org_id, user_id, role, is_intern, full_name, phone, email)
    values (i.org_id, auth.uid(), i.role, i.is_intern, left(trim(p_full_name), 80),
            case when public.phone_taken(coalesce(v_phone, i.phone), auth.uid()) then null else coalesce(v_phone, i.phone) end,
            coalesce(v_email, i.email));
  update public.invites set accepted_by = auth.uid(), accepted_at = now() where id = i.id;
  update public.join_requests set status = 'approved', decided_by = auth.uid(), decided_at = now()
    where org_id = i.org_id and user_id = auth.uid() and status = 'pending';
  return i.org_id;
end $$;
revoke all on function public.accept_invite(text, text) from public, anon;
grant execute on function public.accept_invite(text, text) to authenticated;

-- ---------- 6. Smaller fixes ----------
-- Old leads with an odd saved number can still get notes, calls and be moved (number is checked only when it changes).
create or replace function public.leads_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(new.org_id);
begin
  if tg_op = 'INSERT' or new.phone is distinct from old.phone then
    new.phone := public.normalize_phone(new.phone);
    if not public.valid_phone(new.phone) then
      raise exception 'Enter a valid mobile number: 10 digits for India, or + and country code for other countries (e.g. +971 50 123 4567)';
    end if;
  end if;
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) and not exists (
    select 1 from public.members m where m.org_id = new.org_id and m.user_id = new.assigned_to and m.active and m.role in ('owner','manager','agent')
  ) then
    raise exception 'That person is not an active member of this company';
  end if;
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    if r = 'agent' then
      new.assigned_to := coalesce(new.assigned_to, auth.uid());
      if new.assigned_to <> auth.uid() then
        raise exception 'Agents can only add leads for themselves';
      end if;
      new.partner_id := null;
    elsif r = 'partner' then
      new.partner_id := auth.uid();
      new.assigned_to := null;
    end if;
  else
    if auth.uid() is not null and coalesce(current_setting('estatedesk.system', true), '') <> 'on'
       and coalesce(r, '') not in ('owner','manager') then
      if new.assigned_to is distinct from old.assigned_to
         or new.partner_id is distinct from old.partner_id
         or new.org_id <> old.org_id
         or new.created_by is distinct from old.created_by then
        raise exception 'Only the owner or a manager can reassign leads';
      end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

-- Removed people no longer read old alerts; outside partners do not see the staff list.
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select using (user_id = auth.uid() and public.is_member(org_id));
drop policy if exists members_select on public.members;
create policy members_select on public.members for select
  using (user_id = auth.uid() or (public.is_member(org_id) and coalesce(public.my_role(org_id), '') <> 'partner'));

-- Removing a photo or brochure really deletes the file (storage needs to "see" it to delete it).
drop policy if exists project_photos_select on storage.objects;
create policy project_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'project-photos' and public.is_manager(public.photo_folder_org(name)));

-- Names stay a sensible length when a company is created.
update public.members set full_name = left(full_name, 80) where char_length(full_name) > 80;

-- Free AI (Gemini) daily limit per person, so one account cannot use up the whole free quota.
create or replace function public.ai_ok(p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_kind not in ('voice', 'ask') then return false; end if;
  return public.hit_ok('ai:' || p_kind || ':' || auth.uid(), interval '1 day', case p_kind when 'voice' then 80 else 200 end);
end $$;
revoke all on function public.ai_ok(text) from public, anon;
grant execute on function public.ai_ok(text) to authenticated;

select 'patch-015 done';
