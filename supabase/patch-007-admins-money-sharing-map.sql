-- ============================================================
-- Patch 007 — two admins, money (admins only), client links, map
-- Run once in Supabase → SQL Editor (after patch-006). Safe to run again.
-- Roles from now on:
--   owner   = Admin     → everything, including money
--   manager = Manager   → everything except money
--   agent   = Employee  → only their own leads
-- ============================================================

-- ---------- 1. More than one admin ----------
create or replace function public.is_owner(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where m.org_id = p_org and m.user_id = auth.uid() and m.active and m.role = 'owner')
$$;
revoke all on function public.is_owner(uuid) from public, anon;
grant execute on function public.is_owner(uuid) to authenticated;

alter table public.invites drop constraint if exists invites_role_check;
alter table public.invites add constraint invites_role_check check (role in ('owner','manager','agent','partner'));

create or replace function public.create_invite(p_org uuid, p_role text, p_full_name text, p_phone text, p_email text)
returns text language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(p_org); v_token text;
begin
  if r is null or r not in ('owner','manager') then raise exception 'Only an admin or a manager can invite people'; end if;
  if not public.org_ok(p_org) then raise exception 'Your plan has ended. Renew to add people.'; end if;
  if p_role not in ('owner','manager','agent','partner') then raise exception 'Pick a role'; end if;
  if r = 'manager' and p_role in ('owner','manager') then raise exception 'Only an admin can add admins or managers'; end if;
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

create or replace function public.set_member_role(p_org uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role(p_org) is distinct from 'owner' then raise exception 'Only an admin can change roles'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own role'; end if;
  if p_role not in ('owner','manager','agent','partner') then raise exception 'Pick a role'; end if;
  update public.members set role = p_role where org_id = p_org and user_id = p_user;
  if not found then raise exception 'Person not found'; end if;
end $$;

create or replace function public.deactivate_member(p_org uuid, p_user uuid, p_reassign_to uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(p_org); t text; n int := 0;
begin
  if r is null or r not in ('owner','manager') then raise exception 'Only an admin or a manager can remove people'; end if;
  if p_user = auth.uid() then raise exception 'You cannot remove yourself'; end if;
  select role into t from public.members where org_id = p_org and user_id = p_user;
  if t is null then raise exception 'Person not found'; end if;
  if r = 'manager' and t in ('owner','manager') then raise exception 'Only an admin can remove an admin or a manager'; end if;
  if p_reassign_to is not null and not exists (
    select 1 from public.members where org_id = p_org and user_id = p_reassign_to and active and user_id <> p_user and role in ('owner','manager','agent')
  ) then raise exception 'Pick an active team member to take over the leads'; end if;
  update public.members set active = false, deactivated_at = now() where org_id = p_org and user_id = p_user;
  update public.leads set assigned_to = p_reassign_to
    where org_id = p_org and assigned_to = p_user and stage not in ('booked','lost');
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- 2. Money (admins only) ----------
create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  buyer_name text not null check (char_length(buyer_name) between 1 and 120),
  unit_no text,
  booked_on date not null default current_date,
  agreement_value numeric(14,2) not null default 0 check (agreement_value >= 0),
  commission_pct numeric(5,2) check (commission_pct is null or commission_pct between 0 and 100),
  commission_amount numeric(14,2) not null default 0 check (commission_amount >= 0),
  agent_id uuid references auth.users(id) on delete set null,
  incentive_amount numeric(14,2) not null default 0 check (incentive_amount >= 0),
  status text not null default 'active' check (status in ('active','cancelled')),
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists deals_org_idx on public.deals(org_id, booked_on desc);
create unique index if not exists deals_lead_uq on public.deals(lead_id) where lead_id is not null and status = 'active';

-- What the buyer has to pay and when (token, agreement, loan, possession…)
create table if not exists public.deal_installments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  label text not null,
  amount numeric(14,2) not null check (amount >= 0),
  due_on date,
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  paid_on date,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists deal_inst_idx on public.deal_installments(deal_id, due_on);

-- Company money in and out
create table if not exists public.money_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entry_date date not null default current_date,
  direction text not null check (direction in ('in','out')),
  category text not null check (category in ('Commission','Other income','Ads','Salary','Incentive','Rent','Site visit','Office','Travel','Tax','Other')),
  amount numeric(14,2) not null check (amount > 0),
  deal_id uuid references public.deals(id) on delete set null,
  person_id uuid references auth.users(id) on delete set null,
  lead_source text,
  mode text,
  note text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists money_org_idx on public.money_entries(org_id, entry_date desc);

alter table public.deals enable row level security;
alter table public.deal_installments enable row level security;
alter table public.money_entries enable row level security;
do $$
declare t text;
begin
  foreach t in array array['deals','deal_installments','money_entries'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all using (public.is_owner(org_id) and public.org_ok(org_id)) with check (public.is_owner(org_id) and public.org_ok(org_id))', t || '_admin', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------- 3. Projects: location and public link ----------
alter table public.projects add column if not exists lat double precision check (lat is null or lat between -90 and 90);
alter table public.projects add column if not exists lng double precision check (lng is null or lng between -180 and 180);
alter table public.projects add column if not exists is_public boolean not null default false;
alter table public.projects add column if not exists share_token text;
update public.projects set share_token = replace(gen_random_uuid()::text, '-', '') where share_token is null;
alter table public.projects alter column share_token set default replace(gen_random_uuid()::text, '-', '');
alter table public.projects alter column share_token set not null;
create unique index if not exists projects_share_token_uq on public.projects(share_token);

-- Public view of one project (only when the admin/manager switched "public link" on)
create or replace function public.public_project_json(p public.projects) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'token', p.share_token, 'name', p.name, 'developer', p.developer, 'location', p.location, 'rera_no', p.rera_no,
    'type', p.type, 'configs', p.configs, 'price_from', p.price_from, 'price_to', p.price_to, 'status', p.status, 'possession', p.possession,
    'highlights', p.highlights, 'link', p.link, 'photos', p.photos, 'lat', p.lat, 'lng', p.lng)
$$;
revoke all on function public.public_project_json(public.projects) from public, anon, authenticated;

create or replace function public.get_public_project(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.projects%rowtype; o public.organizations%rowtype; c record;
begin
  select * into p from public.projects where share_token = p_token and is_public;
  if not found then return null; end if;
  select * into o from public.organizations where id = p.org_id;
  if not public.org_ok(o.id) then return null; end if;
  select full_name, phone into c from public.members where org_id = o.id and active and role = 'owner' and phone is not null order by joined_at limit 1;
  return public.public_project_json(p) || jsonb_build_object('company', o.name, 'company_rera', o.rera_no, 'contact_name', c.full_name, 'contact_phone', c.phone);
end $$;
revoke all on function public.get_public_project(text) from public;
grant execute on function public.get_public_project(text) to anon, authenticated;

-- ---------- 4. Personal shortlists sent to a client ----------
create table if not exists public.shortlists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  project_ids uuid[] not null check (cardinality(project_ids) between 1 and 8),
  note text,
  reactions jsonb not null default '{}'::jsonb,
  views int not null default 0,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists shortlists_lead_idx on public.shortlists(lead_id, created_at desc);
alter table public.shortlists enable row level security;
-- You can see/make a shortlist only for a lead you can see (leads rules apply inside).
drop policy if exists shortlists_select on public.shortlists;
create policy shortlists_select on public.shortlists for select using (public.can_use(org_id) and exists (select 1 from public.leads l where l.id = lead_id));
drop policy if exists shortlists_insert on public.shortlists;
create policy shortlists_insert on public.shortlists for insert with check (public.can_use(org_id) and exists (select 1 from public.leads l where l.id = lead_id and l.org_id = shortlists.org_id) and created_by = auth.uid());
drop policy if exists shortlists_delete on public.shortlists;
create policy shortlists_delete on public.shortlists for delete using (public.can_use(org_id) and (public.is_manager(org_id) or created_by = auth.uid()));
revoke all on public.shortlists from anon;
grant select, insert, delete on public.shortlists to authenticated;

create or replace function public.get_shortlist(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.shortlists%rowtype; l public.leads%rowtype; a record; v_projects jsonb;
begin
  select * into s from public.shortlists where token = p_token;
  if not found or s.created_at < now() - interval '180 days' then return null; end if;
  if not public.org_ok(s.org_id) then return null; end if;
  select * into l from public.leads where id = s.lead_id;
  select m.full_name, m.phone into a from public.members m where m.org_id = s.org_id and m.user_id = coalesce(l.assigned_to, s.created_by) and m.active;
  if a.full_name is null then
    select m.full_name, m.phone into a from public.members m where m.org_id = s.org_id and m.active and m.role = 'owner' order by joined_at limit 1;
  end if;
  select coalesce(jsonb_agg(public.public_project_json(p) order by array_position(s.project_ids, p.id)), '[]'::jsonb) into v_projects
    from public.projects p where p.id = any(s.project_ids) and p.org_id = s.org_id;
  return jsonb_build_object('client', split_part(l.name, ' ', 1), 'note', s.note, 'reactions', s.reactions,
    'agent_name', a.full_name, 'agent_phone', a.phone, 'company', (select name from public.organizations where id = s.org_id), 'projects', v_projects);
end $$;
revoke all on function public.get_shortlist(text) from public;
grant execute on function public.get_shortlist(text) to anon, authenticated;


-- Called by the page after it really opened in a browser (link previews in WhatsApp do not count)
create or replace function public.shortlist_seen(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.shortlists%rowtype; l public.leads%rowtype;
begin
  select * into s from public.shortlists where token = p_token;
  if not found or not public.org_ok(s.org_id) then return; end if;
  select * into l from public.leads where id = s.lead_id;
  -- tell the agent the first time, and again if the client comes back after 6 hours
  if s.last_viewed_at is null or s.last_viewed_at < now() - interval '6 hours' then
    insert into public.activities (org_id, lead_id, type, body, by_user)
      values (s.org_id, s.lead_id, 'note', case when s.views = 0 then 'Client opened the shortlist you sent' else 'Client opened the shortlist again' end, null);
    perform public.notify(s.org_id, l.assigned_to, 'shortlist_opened', l.name || ' opened your shortlist', 'Good time to call.', '/leads/' || l.id);
  end if;
  update public.shortlists set views = views + 1, first_viewed_at = coalesce(first_viewed_at, now()), last_viewed_at = now() where id = s.id;
end $$;
revoke all on function public.shortlist_seen(text) from public;
grant execute on function public.shortlist_seen(text) to anon, authenticated;

-- Client taps Like / Not for me / Book a visit on the shortlist page
create or replace function public.shortlist_react(p_token text, p_project uuid, p_reaction text, p_when timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare s public.shortlists%rowtype; l public.leads%rowtype; v_name text; v_body text;
begin
  if p_reaction not in ('like','no','visit') then return false; end if;
  select * into s from public.shortlists where token = p_token;
  if not found or not (p_project = any(s.project_ids)) or not public.org_ok(s.org_id) then return false; end if;
  if s.reactions ->> p_project::text = p_reaction and p_reaction <> 'visit' then return true; end if;
  select name into v_name from public.projects where id = p_project;
  select * into l from public.leads where id = s.lead_id;
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

-- Someone fills "Call me / Book a visit" on a public project page → lead in the CRM
create or replace function public.public_enquiry(p_token text, p_name text, p_phone text, p_message text, p_when timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare p public.projects%rowtype; v_phone text := public.normalize_phone(p_phone); v_lead public.leads%rowtype; v_to uuid; v_note text;
begin
  select * into p from public.projects where share_token = p_token and is_public;
  if not found or not public.org_ok(p.org_id) then return false; end if;
  if v_phone is null or length(v_phone) <> 10 or coalesce(trim(p_name), '') = '' then return false; end if;
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

-- ---------- 5. Helpful index for filters ----------
create index if not exists leads_org_created_idx on public.leads(org_id, created_at desc);
