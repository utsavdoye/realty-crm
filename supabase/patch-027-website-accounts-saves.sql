-- patch-027: client accounts on the website (e.g. Surestone) and the homes they save, visible in the CRM.
--   * One account per email and per mobile number for each company (no duplicates).
--   * Only a verified email (link clicked) or a verified mobile (SMS) can register.
--   * "Save home" on the website shows in the CRM: count on each project, who saved it, and on the client's lead.
--   Visitors who are not signed in are counted too (no name), one per browser.
-- Safe to run more than once.

create table if not exists public.website_clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  uid text not null,                       -- Firebase user id
  name text,
  email text,
  phone text,                              -- 10 digits for India (normalize_phone)
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (org_id, uid)
);
create unique index if not exists website_clients_email_uq on public.website_clients(org_id, lower(email)) where email is not null;
create unique index if not exists website_clients_phone_uq on public.website_clients(org_id, phone) where phone is not null;
alter table public.website_clients enable row level security;
drop policy if exists wc_select on public.website_clients;
create policy wc_select on public.website_clients for select using (public.can_use(org_id));
revoke all on public.website_clients from anon;
grant select on public.website_clients to authenticated;

create table if not exists public.website_saves (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  client_id uuid references public.website_clients(id) on delete cascade,
  voter text check (voter is null or voter ~ '^[a-f0-9]{32,64}$'),
  created_at timestamptz not null default now(),
  check ((client_id is null) <> (voter is null))
);
create unique index if not exists website_saves_client_uq on public.website_saves(project_id, client_id) where client_id is not null;
create unique index if not exists website_saves_voter_uq on public.website_saves(project_id, voter) where voter is not null;
create index if not exists website_saves_org on public.website_saves(org_id, project_id);
alter table public.website_saves enable row level security;
drop policy if exists ws_select on public.website_saves;
create policy ws_select on public.website_saves for select using (public.can_use(org_id));
revoke all on public.website_saves from anon;
grant select on public.website_saves to authenticated;

-- ---------- Called only by the CRM server, after it has checked the Firebase sign-in ----------
-- Register / refresh a website account. Returns {ok, client_id, saves:[project ids]} or {conflict:'email'|'phone'}.
create or replace function public.site_client_upsert(p_key text, p_uid text, p_name text, p_email text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.lead_sources%rowtype; v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
        v_phone text := nullif(public.normalize_phone(p_phone), ''); c public.website_clients%rowtype;
begin
  select * into s from public.lead_sources where key = p_key and active;
  if not found or not public.org_ok(s.org_id) or coalesce(p_uid, '') = '' then return null; end if;
  if v_email is not null and exists (select 1 from public.website_clients where org_id = s.org_id and lower(email) = v_email and uid <> p_uid) then
    return jsonb_build_object('ok', false, 'conflict', 'email');
  end if;
  if v_phone is not null and exists (select 1 from public.website_clients where org_id = s.org_id and phone = v_phone and uid <> p_uid) then
    return jsonb_build_object('ok', false, 'conflict', 'phone');
  end if;
  insert into public.website_clients (org_id, uid, name, email, phone)
  values (s.org_id, p_uid, left(nullif(trim(p_name), ''), 120), v_email, v_phone)
  on conflict (org_id, uid) do update set
    name = coalesce(excluded.name, website_clients.name),
    email = coalesce(excluded.email, website_clients.email),
    phone = coalesce(excluded.phone, website_clients.phone),
    last_seen_at = now()
  returning * into c;
  return jsonb_build_object('ok', true, 'client_id', c.id,
    'saves', coalesce((select jsonb_agg(project_id) from public.website_saves where client_id = c.id), '[]'::jsonb));
end $$;

create or replace function public.site_client_save(p_key text, p_uid text, p_project uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.lead_sources%rowtype; c public.website_clients%rowtype;
begin
  select * into s from public.lead_sources where key = p_key and active;
  if not found or not public.org_ok(s.org_id) then return null; end if;
  select * into c from public.website_clients where org_id = s.org_id and uid = p_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_registered'); end if;
  if not exists (select 1 from public.projects where id = p_project and org_id = s.org_id) then return null; end if;
  if p_on then
    insert into public.website_saves (org_id, project_id, client_id) values (s.org_id, p_project, c.id) on conflict do nothing;
  else
    delete from public.website_saves where project_id = p_project and client_id = c.id;
  end if;
  update public.website_clients set last_seen_at = now() where id = c.id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.site_client_upsert(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.site_client_save(text, text, uuid, boolean) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.site_client_upsert(text, text, text, text, text) to service_role;
    grant execute on function public.site_client_save(text, text, uuid, boolean) to service_role;
  end if;
end $$;

-- ---------- Visitors who are not signed in (counted, no name). One per browser. ----------
create or replace function public.site_save_anon(p_org uuid, p_project uuid, p_voter text, p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_voter is null or p_voter !~ '^[a-f0-9]{32,64}$' then return false; end if;
  if not exists (select 1 from public.projects where id = p_project and org_id = p_org) or not public.org_ok(p_org) then return false; end if;
  if not public.hit_ok('save:' || p_voter, interval '1 hour', 120) then return false; end if;
  if p_on then
    insert into public.website_saves (org_id, project_id, voter) values (p_org, p_project, p_voter) on conflict do nothing;
  else
    delete from public.website_saves where project_id = p_project and voter = p_voter;
  end if;
  return true;
end $$;
revoke all on function public.site_save_anon(uuid, uuid, text, boolean) from public;
grant execute on function public.site_save_anon(uuid, uuid, text, boolean) to anon, authenticated;

select 'patch-027 done';
