-- patch-018: unit inventory for each project (every flat with its size, floor rate, price and status),
-- plus payment plan, booking terms, rate card and Google Maps link on projects. Safe to run more than once.

alter table public.projects add column if not exists map_url text;
alter table public.projects add column if not exists payment_plan text;
alter table public.projects add column if not exists terms text;
alter table public.projects add column if not exists rate_card jsonb not null default '[]'::jsonb;  -- [{"floors":"1-3","rate":4700}, …] ₹ per sq ft

create table if not exists public.project_units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  tower text not null,
  floor int,
  unit_no text not null,
  bhk text,
  sba numeric,            -- super built-up area, sq ft
  carpet numeric,         -- carpet area, sq ft
  rate numeric,           -- ₹ per sq ft (on super built-up)
  status text not null default 'open' check (status in ('open', 'hold', 'booked', 'mortgage')),
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (project_id, unit_no)
);
create index if not exists project_units_project on public.project_units(project_id, status);
alter table public.project_units enable row level security;
drop policy if exists pu_select on public.project_units;
create policy pu_select on public.project_units for select using (public.can_use(org_id) and coalesce(public.my_role(org_id), '') <> 'partner');
drop policy if exists pu_write on public.project_units;
create policy pu_write on public.project_units for all
  using (public.can_use(org_id) and public.is_manager(org_id))
  with check (public.can_use(org_id) and public.is_manager(org_id)
              and exists (select 1 from public.projects p where p.id = project_id and p.org_id = project_units.org_id));
grant select, insert, update, delete on public.project_units to authenticated;

-- The project's price range, size range and number of homes follow the units: price = open units only (in lakh).
create or replace function public.refresh_project_from_units(p_project uuid) returns void
language sql security definer set search_path = public as $$
  update public.projects p set
    price_from = coalesce((select round(min(u.sba * u.rate) / 100000.0, 1) from public.project_units u where u.project_id = p_project and u.status = 'open' and u.sba > 0 and u.rate > 0), p.price_from),
    price_to   = coalesce((select round(max(u.sba * u.rate) / 100000.0, 1) from public.project_units u where u.project_id = p_project and u.status = 'open' and u.sba > 0 and u.rate > 0), p.price_to),
    size_from  = coalesce((select floor(min(u.sba))::int from public.project_units u where u.project_id = p_project and u.sba > 0), p.size_from),
    size_to    = coalesce((select ceil(max(u.sba))::int from public.project_units u where u.project_id = p_project and u.sba > 0), p.size_to),
    units      = coalesce((select count(*)::int from public.project_units u where u.project_id = p_project), p.units),
    status     = case when exists (select 1 from public.project_units u where u.project_id = p_project)
                       and not exists (select 1 from public.project_units u where u.project_id = p_project and u.status in ('open', 'hold'))
                      then 'Sold out' else p.status end
  where p.id = p_project
$$;
revoke all on function public.refresh_project_from_units(uuid) from public, anon, authenticated;

create or replace function public.project_units_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by);
    return new;
  end if;
  return null;
end $$;
drop trigger if exists project_units_stamp on public.project_units;
create trigger project_units_stamp before update on public.project_units for each row execute function public.project_units_changed();

create or replace function public.project_units_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct project_id from (select project_id from new_rows union all select project_id from old_rows) x loop
    perform public.refresh_project_from_units(r.project_id);
  end loop;
  return null;
end $$;
drop trigger if exists project_units_after_ins on public.project_units;
drop trigger if exists project_units_after_upd on public.project_units;
drop trigger if exists project_units_after_del on public.project_units;
create or replace function public.project_units_after_ins() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct project_id from new_rows loop perform public.refresh_project_from_units(r.project_id); end loop;
  return null;
end $$;
create or replace function public.project_units_after_del() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct project_id from old_rows loop perform public.refresh_project_from_units(r.project_id); end loop;
  return null;
end $$;
create trigger project_units_after_ins after insert on public.project_units referencing new table as new_rows for each statement execute function public.project_units_after_ins();
create trigger project_units_after_upd after update on public.project_units referencing new table as new_rows old table as old_rows for each statement execute function public.project_units_after();
create trigger project_units_after_del after delete on public.project_units referencing old table as old_rows for each statement execute function public.project_units_after_del();

-- Client page: show the payment plan and how many homes are still open (not the flat list).
create or replace function public.public_project_json(p public.projects) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'token', p.share_token, 'name', p.name, 'developer', p.developer, 'location', p.location, 'rera_no', p.rera_no,
    'type', p.type, 'configs', p.configs, 'price_from', p.price_from, 'price_to', p.price_to, 'status', p.status, 'possession', p.possession,
    'highlights', p.highlights, 'link', p.link, 'photos', p.photos, 'lat', p.lat, 'lng', p.lng,
    'floor_plans', p.floor_plans, 'size_from', p.size_from, 'size_to', p.size_to, 'towers', p.towers, 'units', p.units,
    'amenities', p.amenities, 'banks', p.banks, 'payment_plan', p.payment_plan,
    'open_units', (select count(*) from public.project_units u where u.project_id = p.id and u.status = 'open'))
$$;
revoke all on function public.public_project_json(public.projects) from public, anon, authenticated;

select 'patch-018 done';
