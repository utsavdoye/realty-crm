-- patch-013: no trial, team join link with approval, locked names, phone on profile, richer projects (floor plans, size, amenities, brochure PDF).
-- Safe to run more than once.

-- ---------- 1. No free trial: this is your own company's CRM ----------
alter table public.organizations alter column plan_status set default 'active';
update public.organizations set plan_status = 'active' where plan_status = 'trial';

-- New companies are closed. Only the people you approve can get in.
-- (To allow new companies again later: update public.app_settings set open_signup = true;)
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  open_signup boolean not null default false
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

create or replace function public.can_create_company() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select open_signup from public.app_settings where id = 1), false)
$$;
revoke all on function public.can_create_company() from public, anon;
grant execute on function public.can_create_company() to authenticated;

create or replace function public.create_organization(p_name text, p_city text, p_rera text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_phone text; v_email text;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if not public.can_create_company() then
    raise exception 'New companies cannot be created here. Ask your company admin for the team join link.';
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Enter your company name'; end if;
  if char_length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Enter your name'; end if;
  if (select count(*) from public.organizations where created_by = auth.uid()) >= 3 then
    raise exception 'You already created 3 companies. Contact support to add more.';
  end if;
  select public.normalize_phone(coalesce(u.raw_user_meta_data ->> 'phone', '+' || nullif(u.phone, ''))), u.email into v_phone, v_email
    from auth.users u where u.id = auth.uid();
  insert into public.organizations (name, city, rera_no, created_by)
    values (trim(p_name), nullif(trim(p_city), ''), nullif(trim(p_rera), ''), auth.uid())
    returning id into v_org;
  insert into public.members (org_id, user_id, role, full_name, phone, email)
    values (v_org, auth.uid(), 'owner', trim(p_full_name), v_phone, v_email);
  insert into public.templates (org_id, use_for, name, body) values
    (v_org, 'Welcome', 'Welcome + details form', E'Hi {{name}},\n\nThank you for your interest in {{project}}! I''m {{agent}} from {{company}}.\n\nTo share the best options for you, please reply with these details:\n\nName-\nContact no.-\nEmail-\nBudget-\nDate of birth-\nPurpose of buying (self use / investment)-\nBest time slot for a Google Meet or phone call-\n\nThank you!\n{{agent}}\n{{agent_phone}}'),
    (v_org, 'Follow-up', 'Gentle follow-up', 'Hi {{name}}, this is {{agent}} from {{company}}. I tried calling you about {{project}}. When is a good time to talk for 5 minutes today?'),
    (v_org, 'Visit reminder', 'Site visit reminder', E'Hi {{name}}, a reminder of your site visit to {{project}} on {{visit_time}}. Call me if anything changes: {{agent_phone}}\n– {{agent}}, {{company}}');
  return v_org;
end $$;
revoke all on function public.create_organization(text, text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text, text) to authenticated;

-- ---------- 2. Names are locked; only an admin can fix a name ----------
create or replace function public.update_my_name(p_org uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Your name can only be changed by your admin (Team page).';
end $$;

create or replace function public.set_member_name(p_org uuid, p_user uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role(p_org) is distinct from 'owner' then raise exception 'Only an admin can change names'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Enter the name'; end if;
  update public.members set full_name = left(trim(p_name), 80) where org_id = p_org and user_id = p_user;
  if not found then raise exception 'Person not found'; end if;
end $$;
revoke all on function public.set_member_name(uuid, uuid, text) from public, anon;
grant execute on function public.set_member_name(uuid, uuid, text) to authenticated;

-- ---------- 3. One team join link per company, every person approved first ----------
alter table public.organizations add column if not exists join_token text unique default replace(gen_random_uuid()::text, '-', '');
update public.organizations set join_token = replace(gen_random_uuid()::text, '-', '') where join_token is null;
alter table public.organizations add column if not exists join_open boolean not null default true;

create table if not exists public.join_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  org_name text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  wants text not null check (wants in ('agent', 'intern', 'manager')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists join_requests_org_idx on public.join_requests(org_id, status);
alter table public.join_requests enable row level security;
drop policy if exists jr_select on public.join_requests;
create policy jr_select on public.join_requests for select
  using (user_id = auth.uid() or public.is_manager(org_id));
revoke all on public.join_requests from anon;
revoke insert, update, delete on public.join_requests from authenticated;
grant select on public.join_requests to authenticated;

-- Public: which company a join link belongs to (name and city only).
create or replace function public.get_join_link(p_token text)
returns table (org_name text, city text) language sql stable security definer set search_path = public as $$
  select o.name, o.city from public.organizations o
  where o.join_token = p_token and o.join_open and public.org_ok(o.id)
$$;
revoke all on function public.get_join_link(text) from public;
grant execute on function public.get_join_link(text) to anon, authenticated;

-- Logged-in person asks to join. Admins (and managers, for employees/interns) get an alert.
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
  if exists (select 1 from auth.users u where u.id <> auth.uid() and (
               public.normalize_phone(u.raw_user_meta_data ->> 'phone') = v_phone or public.normalize_phone('+' || nullif(u.phone, '')) = v_phone))
     or exists (select 1 from public.members x where x.user_id <> auth.uid() and x.phone = v_phone)
     or exists (select 1 from public.join_requests j where j.user_id <> auth.uid() and j.phone = v_phone and j.status = 'pending') then
    raise exception 'This mobile number is already used by another account';
  end if;

  select * into m from public.members where org_id = o.id and user_id = auth.uid();
  if found and m.active then return 'member'; end if;
  if found and not m.active then raise exception 'Your access to % was removed. Ask the admin to give it back.', o.name; end if;

  select * into r from public.join_requests where org_id = o.id and user_id = auth.uid();
  if found and r.status = 'rejected' then raise exception 'Your request to join % was not accepted. Please talk to your admin.', o.name; end if;
  if found and r.status = 'pending' then return 'pending'; end if;

  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  insert into public.join_requests (org_id, org_name, user_id, full_name, phone, email, wants)
    values (o.id, o.name, auth.uid(), left(trim(p_name), 80), v_phone, v_email, p_wants);

  v_label := case p_wants when 'manager' then 'Manager' when 'intern' then 'Intern' else 'Employee' end;
  for a in select user_id from public.members
           where org_id = o.id and active and (role = 'owner' or (role = 'manager' and p_wants <> 'manager')) loop
    perform public.notify(o.id, a.user_id, 'join_request', trim(p_name) || ' wants to join as ' || v_label,
      'Check who it is, then approve or say no on the Team page.', '/team#requests');
  end loop;
  return 'pending';
end $$;
revoke all on function public.request_to_join(text, text, text, text) from public, anon;
grant execute on function public.request_to_join(text, text, text, text) to authenticated;

-- Approve or say no. Admin: anyone, as Employee / Intern / Manager. Manager: only Employees and Interns.
create or replace function public.decide_join(p_id uuid, p_approve boolean, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.join_requests%rowtype; v_me text;
begin
  select * into r from public.join_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  v_me := public.my_role(r.org_id);
  if v_me is null or v_me not in ('owner', 'manager') then raise exception 'Only an admin or a manager can do this'; end if;
  if r.status <> 'pending' then raise exception 'This request was already handled'; end if;
  if not p_approve then
    if v_me = 'manager' and r.wants = 'manager' then raise exception 'Only an admin can handle manager requests'; end if;
    update public.join_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now() where id = p_id;
    return;
  end if;
  if p_role not in ('agent', 'intern', 'manager') then raise exception 'Pick a role'; end if;
  if v_me = 'manager' and (r.wants = 'manager' or p_role = 'manager') then raise exception 'Only an admin can add managers'; end if;
  if not public.org_ok(r.org_id) then raise exception 'Your plan has ended'; end if;
  insert into public.members (org_id, user_id, role, is_intern, full_name, phone, email)
    values (r.org_id, r.user_id, case when p_role = 'intern' then 'agent' else p_role end, p_role = 'intern', r.full_name, r.phone, r.email)
    on conflict (org_id, user_id) do nothing;
  update public.join_requests set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = p_id;
  perform public.notify(r.org_id, r.user_id, 'joined', 'Welcome to ' || r.org_name || '!', 'Your request was approved. Leads given to you will show up here.', '/dashboard');
end $$;
revoke all on function public.decide_join(uuid, boolean, text) from public, anon;
grant execute on function public.decide_join(uuid, boolean, text) to authenticated;

-- Admin: turn the link off/on, or make a new one (the old one stops working).
create or replace function public.set_join_link(p_org uuid, p_open boolean, p_new boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role(p_org) is distinct from 'owner' then raise exception 'Only an admin can change the team link'; end if;
  update public.organizations set join_open = p_open,
    join_token = case when p_new then replace(gen_random_uuid()::text, '-', '') else join_token end
  where id = p_org;
end $$;
revoke all on function public.set_join_link(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_join_link(uuid, boolean, boolean) to authenticated;

-- ---------- 4. Projects: floor plans, size, towers, amenities, bank loans, brochure PDF ----------
alter table public.projects add column if not exists floor_plans jsonb not null default '[]'::jsonb;
alter table public.projects add column if not exists size_from int;
alter table public.projects add column if not exists size_to int;
alter table public.projects add column if not exists towers text;
alter table public.projects add column if not exists units int;
alter table public.projects add column if not exists amenities text;
alter table public.projects add column if not exists banks text;

-- The photo bucket also takes PDF brochures now (up to 20 MB).
update storage.buckets set file_size_limit = 20971520,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where id = 'project-photos';

create or replace function public.public_project_json(p public.projects) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'token', p.share_token, 'name', p.name, 'developer', p.developer, 'location', p.location, 'rera_no', p.rera_no,
    'type', p.type, 'configs', p.configs, 'price_from', p.price_from, 'price_to', p.price_to, 'status', p.status, 'possession', p.possession,
    'highlights', p.highlights, 'link', p.link, 'photos', p.photos, 'lat', p.lat, 'lng', p.lng,
    'floor_plans', p.floor_plans, 'size_from', p.size_from, 'size_to', p.size_to, 'towers', p.towers, 'units', p.units,
    'amenities', p.amenities, 'banks', p.banks)
$$;
revoke all on function public.public_project_json(public.projects) from public, anon, authenticated;

select 'patch-013 done';
