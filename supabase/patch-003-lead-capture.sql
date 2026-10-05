-- ============================================================
-- Patch 003 — automatic lead capture (portals, ads, website form)
-- Run once in Supabase → SQL Editor (after schema.sql and patch-002).
-- ============================================================

-- One secret link per lead source, per company.
create table if not exists public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  kind text not null default 'generic' check (kind in ('generic','99acres','magicbricks','housing','website','meta','google')),
  key text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  default_project_id uuid references public.projects(id) on delete set null,
  external_id text,  -- Facebook page id for Meta lead ads
  active boolean not null default true,
  lead_count int not null default 0,
  last_lead_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists lead_sources_org_idx on public.lead_sources(org_id);

alter table public.leads add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.leads add column if not exists source_id uuid references public.lead_sources(id) on delete set null;

-- Company setting: who gets new leads automatically
alter table public.organizations add column if not exists auto_assign boolean not null default true;

alter table public.lead_sources enable row level security;
drop policy if exists src_select on public.lead_sources;
create policy src_select on public.lead_sources for select using (public.is_manager(org_id));
drop policy if exists src_insert on public.lead_sources;
create policy src_insert on public.lead_sources for insert with check (public.can_use(org_id) and public.is_manager(org_id));
drop policy if exists src_update on public.lead_sources;
create policy src_update on public.lead_sources for update using (public.is_manager(org_id)) with check (public.is_manager(org_id));
drop policy if exists src_delete on public.lead_sources;
create policy src_delete on public.lead_sources for delete using (public.is_manager(org_id));
grant select, insert, update, delete on public.lead_sources to authenticated;

-- Picks the active agent (or manager/owner if no agents) with the fewest open leads.
create or replace function public.next_assignee(p_org uuid) returns uuid
language sql stable security definer set search_path = public as $$
  with pool as (
    select m.user_id, m.role from public.members m
    where m.org_id = p_org and m.active and m.role in ('agent','manager','owner')
  ), pick as (
    select * from pool where role = 'agent'
    union all
    select * from pool where not exists (select 1 from pool where role = 'agent')
  )
  select p.user_id from pick p
  left join public.leads l on l.org_id = p_org and l.assigned_to = p.user_id and l.stage not in ('booked','lost')
  group by p.user_id
  order by count(l.id), min(p.user_id::text)
  limit 1
$$;

-- Called by the website when a portal, ad or form sends a lead.
-- Only works with a valid secret key. Repeat numbers are added to the existing lead, never duplicated.
create or replace function public.ingest_lead(
  p_key text, p_name text, p_phone text, p_email text, p_city text, p_location text,
  p_budget_min numeric, p_budget_max numeric, p_bhk text, p_project text, p_message text, p_raw jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.lead_sources%rowtype;
  v_phone text := public.normalize_phone(p_phone);
  v_lead public.leads%rowtype;
  v_project uuid;
  v_assignee uuid;
  v_is_new boolean := false;
  v_note text;
begin
  select * into s from public.lead_sources where key = p_key and active;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_key'); end if;
  if not public.org_ok(s.org_id) then return jsonb_build_object('ok', false, 'error', 'plan_ended'); end if;
  if v_phone is null or length(v_phone) <> 10 then return jsonb_build_object('ok', false, 'error', 'bad_phone'); end if;

  v_project := s.default_project_id;
  if v_project is null and coalesce(trim(p_project), '') <> '' then
    select id into v_project from public.projects
      where org_id = s.org_id and lower(name) = lower(trim(p_project)) limit 1;
    if v_project is null then
      select id into v_project from public.projects
        where org_id = s.org_id and position(lower(name) in lower(p_project)) > 0 limit 1;
    end if;
  end if;

  v_note := concat_ws(E'\n',
    'New enquiry from ' || s.name,
    nullif(trim(p_project), '') ,
    nullif(trim(p_message), ''));

  select * into v_lead from public.leads where org_id = s.org_id and phone = v_phone for update;
  if found then
    update public.leads set
      email = coalesce(email, nullif(trim(p_email), '')),
      location = coalesce(location, nullif(trim(coalesce(p_location, p_city)), '')),
      budget_min = coalesce(budget_min, p_budget_min),
      budget_max = coalesce(budget_max, p_budget_max),
      bhk = coalesce(bhk, nullif(trim(p_bhk), '')),
      project_id = coalesce(project_id, v_project),
      score = case when score = 'cold' then 'warm' else score end,
      stage = case when stage = 'lost' then 'new' else stage end,
      next_follow_up = coalesce(next_follow_up, now())
    where id = v_lead.id
    returning * into v_lead;
    insert into public.activities (org_id, lead_id, type, body, by_user)
      values (s.org_id, v_lead.id, 'enquiry', 'Enquired again. ' || v_note, null);
  else
    v_is_new := true;
    if (select auto_assign from public.organizations where id = s.org_id) then
      v_assignee := public.next_assignee(s.org_id);
    end if;
    insert into public.leads (org_id, name, phone, email, location, budget_min, budget_max, bhk, source, source_id, project_id, assigned_to, next_follow_up)
      values (s.org_id, coalesce(nullif(trim(p_name), ''), 'Enquiry ' || right(v_phone, 4)), v_phone, nullif(trim(p_email), ''),
              nullif(trim(coalesce(p_location, p_city)), ''), p_budget_min, p_budget_max, nullif(trim(p_bhk), ''),
              s.name, s.id, v_project, v_assignee, now())
      returning * into v_lead;
    insert into public.activities (org_id, lead_id, type, body, by_user)
      values (s.org_id, v_lead.id, 'created', v_note, null);
  end if;

  update public.lead_sources set lead_count = lead_count + 1, last_lead_at = now() where id = s.id;

  return jsonb_build_object(
    'ok', true, 'lead_id', v_lead.id, 'is_new', v_is_new, 'name', v_lead.name, 'phone', v_lead.phone,
    'source', s.name,
    'agent_name', (select full_name from public.members where org_id = s.org_id and user_id = v_lead.assigned_to),
    'agent_phone', (select phone from public.members where org_id = s.org_id and user_id = v_lead.assigned_to and active)
  );
end $$;

-- Private: Facebook page tokens. No access rules = only the server (service role) can read or write.
create table if not exists public.lead_source_secrets (
  source_id uuid primary key references public.lead_sources(id) on delete cascade,
  page_token text not null,
  updated_at timestamptz not null default now()
);
alter table public.lead_source_secrets enable row level security;
revoke all on public.lead_source_secrets from anon, authenticated;
create unique index if not exists lead_sources_meta_page_idx on public.lead_sources(external_id) where kind = 'meta' and external_id is not null;

revoke all on function public.ingest_lead(text, text, text, text, text, text, numeric, numeric, text, text, text, jsonb) from public;
grant execute on function public.ingest_lead(text, text, text, text, text, text, numeric, numeric, text, text, text, jsonb) to anon, authenticated;
revoke all on function public.next_assignee(uuid) from public, anon, authenticated;

-- Owner switches automatic sharing of new leads on or off.
create or replace function public.set_auto_assign(p_org uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role(p_org) is distinct from 'owner' then raise exception 'Only the owner can change this'; end if;
  update public.organizations set auto_assign = p_on where id = p_org;
end $$;
revoke all on function public.set_auto_assign(uuid, boolean) from public, anon;
grant execute on function public.set_auto_assign(uuid, boolean) to authenticated;
