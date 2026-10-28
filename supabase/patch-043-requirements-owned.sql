-- patch-043: fuller requirements on a lead (buy / rent / sell, furnishing, possession, size) and properties a client owns.
-- Run after patch-042. Safe to run more than once.
alter table public.leads add column if not exists want text;              -- Buy, Rent, Sell, Lease out
alter table public.leads add column if not exists furnishing text;        -- Unfurnished, Semi-furnished, Fully furnished
alter table public.leads add column if not exists possession_pref text;   -- Ready to move, Within 6 months, Within 1 year, 1–2 years, Any
alter table public.leads add column if not exists size_min int;           -- sq ft
alter table public.leads add column if not exists size_max int;

-- Properties the client already owns (to sell or rent out through us)
create table if not exists public.lead_owned (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),   -- e.g. 3 BHK flat, Avinash Capital Homes
  location text check (char_length(location) <= 200),
  size_sqft int,
  price_l numeric,                                                    -- expected price, in lakh
  for_what text not null default 'Sell' check (for_what in ('Sell', 'Rent out', 'Just owns')),
  notes text check (char_length(notes) <= 1000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists lead_owned_lead on public.lead_owned(lead_id);
alter table public.lead_owned enable row level security;
drop policy if exists lo_select on public.lead_owned;
create policy lo_select on public.lead_owned for select using (public.can_use(org_id) and exists (select 1 from public.leads l where l.id = lead_id));
drop policy if exists lo_insert on public.lead_owned;
create policy lo_insert on public.lead_owned for insert with check (public.can_use(org_id) and exists (select 1 from public.leads l where l.id = lead_id and l.org_id = lead_owned.org_id));
drop policy if exists lo_delete on public.lead_owned;
create policy lo_delete on public.lead_owned for delete using (public.can_use(org_id) and exists (select 1 from public.leads l where l.id = lead_id));
revoke all on public.lead_owned from anon;
grant select, insert, delete on public.lead_owned to authenticated;
select 'patch-043 done';
