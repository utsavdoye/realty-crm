-- patch-045: daily attendance (login, breaks, logout), cold-calling lists, and documents on a lead.
-- Run after patch-044. Safe to run more than once.

-- ---------- 1. Attendance ----------
alter table public.organizations add column if not exists work_start time not null default '10:00';
alter table public.organizations add column if not exists work_hours numeric(4,2) not null default 9;

create table if not exists public.work_days (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,                                  -- India date
  login_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  logout_at timestamptz,
  reopened int not null default 0,
  unique (org_id, user_id, day)
);
create table if not exists public.work_breaks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  day_id uuid not null references public.work_days(id) on delete cascade,
  start_at timestamptz not null default now(),
  end_at timestamptz,
  reason text check (char_length(reason) <= 80)
);
create index if not exists work_days_org_day on public.work_days(org_id, day);
create index if not exists work_breaks_day on public.work_breaks(day_id);

alter table public.work_days enable row level security;
alter table public.work_breaks enable row level security;
-- Everyone sees their own day; admins and managers see the whole team. Writes go through the functions below.
drop policy if exists wd_select on public.work_days;
create policy wd_select on public.work_days for select using (public.can_use(org_id) and (user_id = auth.uid() or public.is_manager(org_id)));
drop policy if exists wb_select on public.work_breaks;
create policy wb_select on public.work_breaks for select using (public.can_use(org_id) and exists (select 1 from public.work_days d where d.id = day_id and (d.user_id = auth.uid() or public.is_manager(d.org_id))));
revoke all on public.work_days, public.work_breaks from anon;
revoke insert, update, delete on public.work_days, public.work_breaks from authenticated;
grant select on public.work_days, public.work_breaks to authenticated;

-- One call does everything: 'ping' (I am working), 'break', 'back', 'logout'.
create or replace function public.work_event(p_org uuid, p_event text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_day date := (now() at time zone 'Asia/Kolkata')::date; v public.work_days; v_open uuid;
begin
  if auth.uid() is null or not public.can_use(p_org) then raise exception 'Not allowed'; end if;
  if p_event not in ('ping', 'break', 'back', 'logout') then raise exception 'Unknown event'; end if;
  insert into public.work_days (org_id, user_id, day) values (p_org, auth.uid(), v_day)
    on conflict (org_id, user_id, day) do nothing;
  select * into v from public.work_days where org_id = p_org and user_id = auth.uid() and day = v_day;
  select id into v_open from public.work_breaks where day_id = v.id and end_at is null order by start_at desc limit 1;
  if p_event = 'ping' then
    if v.logout_at is not null then  -- came back after logging out: the day is open again
      update public.work_days set logout_at = null, reopened = reopened + 1, last_seen_at = now() where id = v.id;
    else
      update public.work_days set last_seen_at = now() where id = v.id;
    end if;
  elsif p_event = 'break' then
    if v_open is null then insert into public.work_breaks (org_id, day_id, reason) values (p_org, v.id, left(p_reason, 80)); end if;
    update public.work_days set last_seen_at = now() where id = v.id;
  elsif p_event = 'back' then
    update public.work_breaks set end_at = now() where id = v_open;
    update public.work_days set last_seen_at = now() where id = v.id;
  elsif p_event = 'logout' then
    update public.work_breaks set end_at = now() where id = v_open;
    update public.work_days set logout_at = now(), last_seen_at = now() where id = v.id;
  end if;
  return jsonb_build_object('ok', true, 'on_break', p_event = 'break' or (v_open is not null and p_event = 'ping'));
end $$;
revoke all on function public.work_event(uuid, text, text) from public, anon;
grant execute on function public.work_event(uuid, text, text) to authenticated;

create or replace function public.set_work_hours(p_org uuid, p_start time, p_hours numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role(p_org) is distinct from 'owner' then raise exception 'Only an admin can change this.'; end if;
  update public.organizations set work_start = p_start, work_hours = greatest(1, least(16, p_hours)) where id = p_org;
end $$;
revoke all on function public.set_work_hours(uuid, time, numeric) from public, anon;
grant execute on function public.set_work_hours(uuid, time, numeric) to authenticated;

-- ---------- 2. Cold calling lists ----------
create table if not exists public.cold_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  list_name text not null default 'Cold data' check (char_length(list_name) <= 80),
  name text check (char_length(name) <= 120),
  phone text not null,
  area text check (char_length(area) <= 120),
  note text check (char_length(note) <= 500),
  assigned_to uuid references auth.users(id) on delete set null,
  status text not null default 'new' check (status in ('new', 'noanswer', 'callback', 'interested', 'notint', 'wrong')),
  attempts int not null default 0,
  called_at timestamptz,
  callback_at timestamptz,
  lead_id uuid references public.leads(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, phone)
);
create index if not exists cold_org_status on public.cold_contacts(org_id, status, assigned_to);
alter table public.cold_contacts enable row level security;
drop policy if exists cc_select on public.cold_contacts;
create policy cc_select on public.cold_contacts for select using (public.can_use(org_id) and (public.is_manager(org_id) or assigned_to = auth.uid()));
drop policy if exists cc_insert on public.cold_contacts;
create policy cc_insert on public.cold_contacts for insert with check (public.can_use(org_id) and public.is_manager(org_id));
drop policy if exists cc_update on public.cold_contacts;
create policy cc_update on public.cold_contacts for update using (public.can_use(org_id) and (public.is_manager(org_id) or assigned_to = auth.uid())) with check (public.can_use(org_id));
drop policy if exists cc_delete on public.cold_contacts;
create policy cc_delete on public.cold_contacts for delete using (public.can_use(org_id) and public.is_manager(org_id));
revoke all on public.cold_contacts from anon;
grant select, insert, update, delete on public.cold_contacts to authenticated;

-- ---------- 3. Documents on a lead (private files) ----------
create table if not exists public.lead_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null default 'Other' check (char_length(kind) <= 40),   -- PAN, Aadhaar, Agreement, Cheque, Photo, Other
  name text not null check (char_length(name) <= 160),
  path text not null,                                                  -- <org>/<lead>/<file> in the private "lead-docs" bucket
  size_bytes int,
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists lead_docs_lead on public.lead_documents(lead_id, created_at desc);
alter table public.lead_documents enable row level security;
drop policy if exists ld_select on public.lead_documents;
create policy ld_select on public.lead_documents for select using (public.can_use(org_id) and exists (select 1 from public.leads l where l.id = lead_id));
drop policy if exists ld_insert on public.lead_documents;
create policy ld_insert on public.lead_documents for insert with check (public.can_use(org_id) and exists (select 1 from public.leads l where l.id = lead_id and l.org_id = lead_documents.org_id));
drop policy if exists ld_delete on public.lead_documents;
create policy ld_delete on public.lead_documents for delete using (public.can_use(org_id) and (public.is_manager(org_id) or uploaded_by = auth.uid()));
revoke all on public.lead_documents from anon;
grant select, insert, delete on public.lead_documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lead-docs', 'lead-docs', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;

-- File path: <org id>/<lead id>/<file>. Only people who can see that lead can upload or open its files.
create or replace function public.lead_doc_ok(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_lead uuid;
begin
  v_org := split_part(p_name, '/', 1)::uuid; v_lead := split_part(p_name, '/', 2)::uuid;
  return public.can_use(v_org) and exists (
    select 1 from public.leads l where l.id = v_lead and l.org_id = v_org
      and (public.is_manager(v_org) or l.assigned_to = auth.uid() or l.partner_id = auth.uid()));
exception when others then return false;
end $$;
revoke all on function public.lead_doc_ok(text) from public, anon;
grant execute on function public.lead_doc_ok(text) to authenticated;

drop policy if exists lead_docs_read on storage.objects;
create policy lead_docs_read on storage.objects for select to authenticated using (bucket_id = 'lead-docs' and public.lead_doc_ok(name));
drop policy if exists lead_docs_insert on storage.objects;
create policy lead_docs_insert on storage.objects for insert to authenticated with check (bucket_id = 'lead-docs' and public.lead_doc_ok(name));
drop policy if exists lead_docs_delete on storage.objects;
create policy lead_docs_delete on storage.objects for delete to authenticated using (bucket_id = 'lead-docs' and public.lead_doc_ok(name));

select 'patch-045 done';
