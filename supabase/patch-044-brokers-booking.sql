-- patch-044: brokers / channel partners (no login needed), their commission on each booking, and broker-brought leads and visits.
-- Run after patch-043. Safe to run more than once.
create table if not exists public.brokers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  firm text check (char_length(firm) <= 120),
  phone text check (char_length(phone) <= 20),
  rera_no text check (char_length(rera_no) <= 60),
  default_pct numeric(5,2) check (default_pct is null or default_pct between 0 and 100),
  notes text check (char_length(notes) <= 1000),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists brokers_org on public.brokers(org_id, name);
alter table public.brokers enable row level security;
drop policy if exists br_select on public.brokers;
create policy br_select on public.brokers for select using (public.can_use(org_id));
drop policy if exists br_insert on public.brokers;
create policy br_insert on public.brokers for insert with check (public.can_use(org_id) and public.is_manager(org_id));
drop policy if exists br_update on public.brokers;
create policy br_update on public.brokers for update using (public.can_use(org_id) and public.is_manager(org_id)) with check (public.can_use(org_id));
drop policy if exists br_delete on public.brokers;
create policy br_delete on public.brokers for delete using (public.can_use(org_id) and public.my_role(org_id) = 'owner');
revoke all on public.brokers from anon;
grant select, insert, update, delete on public.brokers to authenticated;

alter table public.leads add column if not exists broker_id uuid references public.brokers(id) on delete set null;
alter table public.visits add column if not exists broker_id uuid references public.brokers(id) on delete set null;
alter table public.deals add column if not exists broker_id uuid references public.brokers(id) on delete set null;
alter table public.deals add column if not exists broker_pct numeric(5,2);
alter table public.deals add column if not exists broker_amount numeric(14,2) not null default 0;
alter table public.deals add column if not exists broker_paid numeric(14,2) not null default 0;
alter table public.deals add column if not exists incentive_paid numeric(14,2) not null default 0;
create index if not exists leads_broker on public.leads(org_id, broker_id) where broker_id is not null;
select 'patch-044 done';
