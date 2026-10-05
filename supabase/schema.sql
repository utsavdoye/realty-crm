-- ============================================================
-- EstateDesk database — Step 1 (companies, people, roles, leads)
-- Run this whole file once in Supabase → SQL Editor → New query → Run.
-- It is safe to run on a fresh project. Every table is locked by
-- row-level security: the database itself decides who sees what.
-- ============================================================

-- ---------- Tables ----------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  city text,
  rera_no text,
  plan_status text not null default 'trial' check (plan_status in ('trial','active','suspended')),
  trial_ends_at timestamptz not null default now() + interval '14 days',
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','manager','agent','partner')),
  full_name text not null default '',
  phone text,
  email text,
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  deactivated_at timestamptz,
  primary key (org_id, user_id)
);
create index if not exists members_user_idx on public.members(user_id);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  role text not null check (role in ('manager','agent','partner')),
  full_name text,
  phone text,
  email text,
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists invites_org_idx on public.invites(org_id);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  phone text not null,
  email text,
  dob date,
  budget_min numeric,
  budget_max numeric,
  bhk text,
  property_type text,
  location text,
  purpose text,
  preferred_slot text,
  source text,
  stage text not null default 'new' check (stage in ('new','contacted','qualified','visit','visited','negotiation','token','booked','lost')),
  max_stage int not null default 0,
  lost_reason text,
  score text not null default 'warm' check (score in ('hot','warm','cold')),
  assigned_to uuid references auth.users(id) on delete set null,
  partner_id uuid references auth.users(id) on delete set null,
  next_follow_up timestamptz,
  booked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, phone)
);
create index if not exists leads_org_assigned_idx on public.leads(org_id, assigned_to);
create index if not exists leads_org_followup_idx on public.leads(org_id, next_follow_up);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  type text not null check (type in ('created','note','call','whatsapp','stage','visit','enquiry','assign')),
  body text not null default '',
  by_user uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists activities_lead_idx on public.activities(lead_id, created_at desc);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  developer text, location text, rera_no text, type text, configs text,
  price_from numeric, price_to numeric, status text, possession text, highlights text, link text,
  created_at timestamptz not null default now()
);

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  at timestamptz not null,
  agent_id uuid references auth.users(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled','done','noshow','cancelled')),
  feedback text,
  created_at timestamptz not null default now()
);

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, use_for text not null default 'Other', body text not null,
  created_at timestamptz not null default now()
);

-- ---------- Helper functions (run with owner rights, read only) ----------
create or replace function public.normalize_phone(p text) returns text
language sql immutable as $$
  select case
    when p is null then null
    when length(regexp_replace(p, '\D', '', 'g')) > 10 and regexp_replace(p, '\D', '', 'g') like '91%'
      then right(regexp_replace(p, '\D', '', 'g'), 10)
    when length(regexp_replace(p, '\D', '', 'g')) = 11 and regexp_replace(p, '\D', '', 'g') like '0%'
      then right(regexp_replace(p, '\D', '', 'g'), 10)
    else regexp_replace(p, '\D', '', 'g')
  end
$$;

create or replace function public.my_role(p_org uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.role from public.members m
  where m.org_id = p_org and m.user_id = auth.uid() and m.active
$$;

create or replace function public.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where m.org_id = p_org and m.user_id = auth.uid() and m.active)
$$;

create or replace function public.is_manager(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where m.org_id = p_org and m.user_id = auth.uid() and m.active and m.role in ('owner','manager'))
$$;

-- Company is paid up or still inside its free trial
create or replace function public.org_ok(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organizations o where o.id = p_org
    and (o.plan_status = 'active' or (o.plan_status = 'trial' and o.trial_ends_at > now())))
$$;

create or replace function public.can_use(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_member(p_org) and public.org_ok(p_org)
$$;

-- ---------- Lead guard: fixes phone format and stops agents from reassigning ----------
create or replace function public.leads_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(new.org_id);
begin
  new.phone := public.normalize_phone(new.phone);
  if length(new.phone) < 10 then
    raise exception 'Enter a valid 10-digit mobile number';
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
    if auth.uid() is not null and coalesce(r, '') not in ('owner','manager') then
      if new.assigned_to is distinct from old.assigned_to
         or new.partner_id is distinct from old.partner_id
         or new.org_id <> old.org_id then
        raise exception 'Only the owner or a manager can reassign leads';
      end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists leads_guard_trg on public.leads;
create trigger leads_guard_trg before insert or update on public.leads
for each row execute function public.leads_guard();

-- ---------- Row-level security ----------
alter table public.organizations enable row level security;
alter table public.members      enable row level security;
alter table public.invites      enable row level security;
alter table public.leads        enable row level security;
alter table public.activities   enable row level security;
alter table public.projects     enable row level security;
alter table public.visits       enable row level security;
alter table public.templates    enable row level security;

-- Companies: you can see a company you belong to (even if removed, to show the message). Changes only via functions below.
drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations for select
  using (exists (select 1 from public.members m where m.org_id = organizations.id and m.user_id = auth.uid()));

-- Members: see your own row, and teammates while you are active. Changes only via functions below.
drop policy if exists members_select on public.members;
create policy members_select on public.members for select
  using (user_id = auth.uid() or public.is_member(org_id));

-- Invites: only owner/manager can see or cancel them.
drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites for select using (public.is_manager(org_id));
drop policy if exists invites_delete on public.invites;
create policy invites_delete on public.invites for delete using (public.is_manager(org_id) and accepted_at is null);

-- Leads: owner/manager see all; agent sees only leads assigned to them; channel partner sees only leads they brought.
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select using (
  public.can_use(org_id) and (public.is_manager(org_id) or assigned_to = auth.uid() or partner_id = auth.uid()));
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert with check (
  public.can_use(org_id) and (public.is_manager(org_id) or assigned_to = auth.uid() or partner_id = auth.uid()));
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update
  using (public.can_use(org_id) and (public.is_manager(org_id) or assigned_to = auth.uid()))
  with check (public.can_use(org_id) and (public.is_manager(org_id) or assigned_to = auth.uid()));
drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete using (public.can_use(org_id) and public.is_manager(org_id));

-- Activities follow the lead: if you can see the lead, you can see and add to its history. Nobody edits history.
drop policy if exists act_select on public.activities;
create policy act_select on public.activities for select
  using (exists (select 1 from public.leads l where l.id = lead_id));
drop policy if exists act_insert on public.activities;
create policy act_insert on public.activities for insert with check (
  by_user = auth.uid() and public.can_use(org_id)
  and exists (select 1 from public.leads l where l.id = lead_id and l.org_id = activities.org_id));

-- Projects and templates: everyone in the company reads; owner/manager change.
drop policy if exists proj_select on public.projects;
create policy proj_select on public.projects for select using (public.can_use(org_id));
drop policy if exists proj_write on public.projects;
create policy proj_write on public.projects for all
  using (public.can_use(org_id) and public.is_manager(org_id))
  with check (public.can_use(org_id) and public.is_manager(org_id));

drop policy if exists tpl_select on public.templates;
create policy tpl_select on public.templates for select using (public.can_use(org_id));
drop policy if exists tpl_write on public.templates;
create policy tpl_write on public.templates for all
  using (public.can_use(org_id) and public.is_manager(org_id))
  with check (public.can_use(org_id) and public.is_manager(org_id));

-- Visits follow the lead.
drop policy if exists visits_select on public.visits;
create policy visits_select on public.visits for select
  using (public.can_use(org_id) and exists (select 1 from public.leads l where l.id = lead_id));
drop policy if exists visits_insert on public.visits;
create policy visits_insert on public.visits for insert
  with check (public.can_use(org_id) and exists (select 1 from public.leads l where l.id = lead_id and l.org_id = visits.org_id));
drop policy if exists visits_update on public.visits;
create policy visits_update on public.visits for update
  using (public.can_use(org_id) and exists (select 1 from public.leads l where l.id = lead_id))
  with check (public.can_use(org_id));
drop policy if exists visits_delete on public.visits;
create policy visits_delete on public.visits for delete using (public.can_use(org_id) and public.is_manager(org_id));

-- ---------- Actions (each checks who is asking) ----------

-- Create a new company; the person creating it becomes the owner.
create or replace function public.create_organization(p_name text, p_city text, p_rera text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_phone text; v_email text;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Enter your company name'; end if;
  if char_length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Enter your name'; end if;
  if (select count(*) from public.organizations where created_by = auth.uid()) >= 3 then
    raise exception 'You already created 3 companies. Contact support to add more.';
  end if;
  select public.normalize_phone(u.phone), u.email into v_phone, v_email from auth.users u where u.id = auth.uid();
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

-- Owner or manager creates an invite link. Managers can invite agents and partners only.
create or replace function public.create_invite(p_org uuid, p_role text, p_full_name text, p_phone text, p_email text)
returns text language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(p_org); v_token text;
begin
  if r is null or r not in ('owner','manager') then raise exception 'Only the owner or a manager can invite people'; end if;
  if not public.org_ok(p_org) then raise exception 'Your plan has ended. Renew to add people.'; end if;
  if p_role not in ('manager','agent','partner') then raise exception 'Pick a role'; end if;
  if r = 'manager' and p_role = 'manager' then raise exception 'Only the owner can add managers'; end if;
  if coalesce(trim(p_phone), '') = '' and coalesce(trim(p_email), '') = '' then
    raise exception 'Add their mobile number or email, so only they can use the link';
  end if;
  if coalesce(trim(p_phone), '') <> '' and length(public.normalize_phone(p_phone)) <> 10 then
    raise exception 'Enter a valid 10-digit mobile number';
  end if;
  insert into public.invites (org_id, role, full_name, phone, email, invited_by)
    values (p_org, p_role, nullif(trim(p_full_name), ''), nullif(public.normalize_phone(p_phone), ''), nullif(lower(trim(p_email)), ''), auth.uid())
    returning token into v_token;
  return v_token;
end $$;

-- Anyone with the link can see who invited them (company name and role), nothing else.
create or replace function public.get_invite(p_token text)
returns table (org_name text, role text, full_name text, contact_hint text, status text)
language plpgsql stable security definer set search_path = public as $$
declare i record;
begin
  select inv.*, o.name as oname into i from public.invites inv join public.organizations o on o.id = inv.org_id where inv.token = p_token;
  if not found then
    return query select null::text, null::text, null::text, null::text, 'invalid'::text; return;
  end if;
  return query select i.oname, i.role, i.full_name,
    case when i.phone is not null then 'mobile ending ' || right(i.phone, 4)
         when i.email is not null then left(i.email, 2) || '•••@' || split_part(i.email, '@', 2) end,
    case when i.accepted_at is not null then 'used' when i.expires_at < now() then 'expired' else 'ok' end;
end $$;

-- Logged-in person accepts the invite. It must match the mobile or email it was sent to.
create or replace function public.accept_invite(p_token text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare i public.invites%rowtype; v_phone text; v_email text;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  select * into i from public.invites where token = p_token for update;
  if not found then raise exception 'This invite link is not valid'; end if;
  if i.accepted_at is not null then raise exception 'This invite link was already used'; end if;
  if i.expires_at < now() then raise exception 'This invite link has expired. Ask for a new one.'; end if;
  select public.normalize_phone(u.phone), lower(u.email) into v_phone, v_email from auth.users u where u.id = auth.uid();
  if not ((i.phone is not null and i.phone = v_phone) or (i.email is not null and i.email = v_email)) then
    raise exception 'This invite was sent to a different mobile number or email. Log in with that one.';
  end if;
  if char_length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Enter your name'; end if;
  insert into public.members (org_id, user_id, role, full_name, phone, email)
    values (i.org_id, auth.uid(), i.role, trim(p_full_name), coalesce(v_phone, i.phone), coalesce(v_email, i.email))
    on conflict (org_id, user_id) do update
      set role = case when public.members.role = 'owner' then 'owner' else excluded.role end,
          active = true, deactivated_at = null, full_name = excluded.full_name;
  update public.invites set accepted_by = auth.uid(), accepted_at = now() where id = i.id;
  return i.org_id;
end $$;

-- Owner changes someone's role.
create or replace function public.set_member_role(p_org uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role(p_org) is distinct from 'owner' then raise exception 'Only the owner can change roles'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own role'; end if;
  if p_role not in ('manager','agent','partner') then raise exception 'Pick a role'; end if;
  update public.members set role = p_role where org_id = p_org and user_id = p_user and role <> 'owner';
  if not found then raise exception 'Person not found'; end if;
end $$;

-- Remove someone's access at once and hand their open leads to someone else.
create or replace function public.deactivate_member(p_org uuid, p_user uuid, p_reassign_to uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(p_org); t text; n int := 0;
begin
  if r is null or r not in ('owner','manager') then raise exception 'Only the owner or a manager can remove people'; end if;
  if p_user = auth.uid() then raise exception 'You cannot remove yourself'; end if;
  select role into t from public.members where org_id = p_org and user_id = p_user;
  if t is null then raise exception 'Person not found'; end if;
  if t = 'owner' then raise exception 'The owner cannot be removed'; end if;
  if r = 'manager' and t = 'manager' then raise exception 'Only the owner can remove a manager'; end if;
  if p_reassign_to is not null and not exists (
    select 1 from public.members where org_id = p_org and user_id = p_reassign_to and active and user_id <> p_user and role in ('owner','manager','agent')
  ) then raise exception 'Pick an active team member to take over the leads'; end if;
  update public.members set active = false, deactivated_at = now() where org_id = p_org and user_id = p_user;
  update public.leads set assigned_to = p_reassign_to
    where org_id = p_org and assigned_to = p_user and stage not in ('booked','lost');
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.reactivate_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager(p_org) then raise exception 'Only the owner or a manager can do this'; end if;
  update public.members set active = true, deactivated_at = null where org_id = p_org and user_id = p_user;
end $$;

create or replace function public.update_my_name(p_org uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Enter your name'; end if;
  update public.members set full_name = trim(p_name) where org_id = p_org and user_id = auth.uid();
end $$;

create or replace function public.update_organization(p_org uuid, p_name text, p_city text, p_rera text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role(p_org) is distinct from 'owner' then raise exception 'Only the owner can change company details'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Enter your company name'; end if;
  update public.organizations set name = trim(p_name), city = nullif(trim(p_city), ''), rera_no = nullif(trim(p_rera), '') where id = p_org;
end $$;

-- ---------- Who may call what ----------
revoke all on function public.create_organization(text, text, text, text) from public, anon;
revoke all on function public.create_invite(uuid, text, text, text, text) from public, anon;
revoke all on function public.accept_invite(text, text) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.deactivate_member(uuid, uuid, uuid) from public, anon;
revoke all on function public.reactivate_member(uuid, uuid) from public, anon;
revoke all on function public.update_my_name(uuid, text) from public, anon;
revoke all on function public.update_organization(uuid, text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text, text) to authenticated;
grant execute on function public.create_invite(uuid, text, text, text, text) to authenticated;
grant execute on function public.accept_invite(text, text) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.deactivate_member(uuid, uuid, uuid) to authenticated;
grant execute on function public.reactivate_member(uuid, uuid) to authenticated;
grant execute on function public.update_my_name(uuid, text) to authenticated;
grant execute on function public.update_organization(uuid, text, text, text) to authenticated;
grant execute on function public.get_invite(text) to anon, authenticated;
