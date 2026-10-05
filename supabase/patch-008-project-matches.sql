-- ============================================================
-- Patch 008 — "We had a lead who wanted this!"
-- When a project is added or its price / homes / area changes, the CRM looks through
-- old and current leads (including lost ones) and flags everyone whose requirement fits.
-- Run once in Supabase → SQL Editor (after patch-007). Safe to run again.
-- ============================================================

create table if not exists public.project_matches (
  project_id uuid not null references public.projects(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  strength int not null,                 -- how many of budget / home type / area fit (2 or 3; budget always)
  reasons text[] not null default '{}',
  created_at timestamptz not null default now(),
  dismissed_at timestamptz,
  primary key (project_id, lead_id)
);
create index if not exists project_matches_lead_idx on public.project_matches(lead_id) where dismissed_at is null;
create index if not exists project_matches_org_idx on public.project_matches(org_id, created_at desc);
alter table public.project_matches enable row level security;
-- You see a match only if you can see the lead (employees: their own leads).
drop policy if exists pm_select on public.project_matches;
create policy pm_select on public.project_matches for select using (public.can_use(org_id) and exists (select 1 from public.leads l where l.id = lead_id));
drop policy if exists pm_update on public.project_matches;
create policy pm_update on public.project_matches for update using (public.can_use(org_id) and exists (select 1 from public.leads l where l.id = lead_id)) with check (public.can_use(org_id));
revoke all on public.project_matches from anon;
grant select on public.project_matches to authenticated;
grant update (dismissed_at) on public.project_matches to authenticated;   -- people can only hide a match, nothing else

-- Finds leads that fit one project. Returns how many NEW matches were found, and sends alerts for them.
create or replace function public.match_leads_for_project(p_project uuid, p_notify boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare pr public.projects%rowtype; n int; r record;
begin
  select * into pr from public.projects where id = p_project;
  if not found or coalesce(pr.status, '') = 'Sold out' then return 0; end if;

  with cand as (
    select l.id, l.org_id, l.assigned_to, l.stage, l.lost_reason,
      -- 1. budget: their range overlaps the project price range (10% give)
      case when (l.budget_min is null and l.budget_max is null) or pr.price_from is null then null
           else pr.price_from <= coalesce(l.budget_max, l.budget_min * 1.3) * 1.1
            and coalesce(pr.price_to, pr.price_from * 1.3) >= coalesce(l.budget_min, l.budget_max * 0.6) * 0.9 end as b_ok,
      -- 2. kind of home: BHK / plot / villa / office
      case when l.bhk is null and l.property_type is null then null
           when pr.type = 'Plot' then (l.bhk = 'Plot' or l.property_type = 'Plot')
           when pr.type = 'Commercial' then (l.bhk = 'Shop / Office' or l.property_type = 'Commercial')
           when l.bhk in ('Plot', 'Shop / Office') or l.property_type in ('Plot', 'Commercial') then false
           when l.property_type is not null and pr.type is not null and l.property_type <> pr.type then false
           when l.bhk ~ '^\d' then pr.configs is null or position(left(l.bhk, 1) in pr.configs) > 0
           when l.bhk = 'Villa' then pr.type = 'Villa'
           else true end as k_ok,
      -- 3. area: same locality name
      case when coalesce(trim(l.location), '') = '' or coalesce(trim(pr.location), '') = '' then null
           else pr.location ilike '%' || trim(split_part(l.location, ',', 1)) || '%' or l.location ilike '%' || trim(pr.location) || '%' end as a_ok
    from public.leads l
    where l.org_id = pr.org_id and l.stage <> 'booked'
      and (l.stage <> 'lost' or coalesce(l.lost_reason, '') not in ('Wrong number', 'Bought elsewhere'))
  ), good as (
    select c.*, (coalesce(b_ok, false)::int + coalesce(k_ok, false)::int + coalesce(a_ok, false)::int) as strength
    from cand c
    where b_ok is not false and k_ok is not false
      and (c.lost_reason is distinct from 'Location not suitable' or a_ok)      -- they said no because of area: only if area fits now
      and (c.lost_reason is distinct from 'Budget mismatch' or b_ok)            -- they said no because of price: only if price fits now
  ), ins as (
    insert into public.project_matches (project_id, lead_id, org_id, strength, reasons)
    select pr.id, g.id, g.org_id, g.strength,
      array_remove(array[case when g.b_ok then 'budget' end, case when g.k_ok then 'home type' end, case when g.a_ok then 'area' end], null)
    from good g
    where g.b_ok and g.strength >= 2                        -- budget must fit, plus home type or area
      and (g.stage <> 'lost' or g.strength = 3)             -- lost leads: only when everything fits
    on conflict (project_id, lead_id) do nothing
    returning lead_id
  )
  select count(*) into n from ins;

  if n > 0 and p_notify then
    -- each employee: one alert with how many of THEIR leads fit
    for r in
      select l.assigned_to as uid, count(*) as c from public.project_matches m join public.leads l on l.id = m.lead_id
      where m.project_id = pr.id and m.created_at > now() - interval '1 minute' and l.assigned_to is not null group by l.assigned_to
    loop
      perform public.notify(pr.org_id, r.uid, 'project_match', pr.name || ' fits ' || r.c || ' of your leads',
        'They wanted something like this before. Send it to them.', '/leads?match=' || pr.id);
    end loop;
    -- admins and managers: one alert with the total
    for r in select user_id from public.members where org_id = pr.org_id and active and role in ('owner', 'manager') loop
      perform public.notify(pr.org_id, r.user_id, 'project_match', pr.name || ' fits ' || n || ' old leads',
        'Leads who asked for this budget, home type or area. Share the project with them.', '/leads?match=' || pr.id);
    end loop;
  end if;
  return n;
end $$;
revoke all on function public.match_leads_for_project(uuid, boolean) from public, anon, authenticated;

-- Runs by itself whenever a project is added or its price / homes / area / status changes.
create or replace function public.projects_match_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT'
     or new.price_from is distinct from old.price_from or new.price_to is distinct from old.price_to
     or new.configs is distinct from old.configs or new.type is distinct from old.type
     or new.location is distinct from old.location or new.status is distinct from old.status then
    perform public.match_leads_for_project(new.id, true);
  end if;
  return null;
end $$;
drop trigger if exists projects_match on public.projects;
create trigger projects_match after insert or update on public.projects
for each row execute function public.projects_match_trg();

-- "Find matching leads" button for admins and managers (for projects that were added before this patch).
create or replace function public.rematch_project(p_project uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.projects where id = p_project;
  if v_org is null or not public.is_manager(v_org) then raise exception 'Only an admin or a manager can do this'; end if;
  return public.match_leads_for_project(p_project, true);
end $$;
revoke all on function public.rematch_project(uuid) from public, anon;
grant execute on function public.rematch_project(uuid) to authenticated;
