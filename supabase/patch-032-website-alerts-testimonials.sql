-- patch-032:
--  1. Fresh alerts for website activity:
--       * a new account on the website  → admins and managers
--       * a home saved on the website   → the person handling that client (admins / managers if nobody)
--  2. Testimonials: ask a client after the deal, they write it on the website, an admin approves it, it shows on the website.
--  3. Shortlist links on the website now need the client to sign in (checked by the CRM server), so the old
--     open-to-anyone website function is closed.
-- Run after patch-031. Safe to run more than once.

-- ---------- helpers ----------
create or replace function public.notify_managers(p_org uuid, p_type text, p_title text, p_body text, p_link text, p_except uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select m.user_id from public.members m where m.org_id = p_org and m.active and m.role in ('owner', 'manager') and m.user_id is distinct from p_except loop
    perform public.notify(p_org, u, p_type, p_title, p_body, p_link);
  end loop;
end $$;
revoke all on function public.notify_managers(uuid, text, text, text, text, uuid) from public, anon, authenticated;

-- ---------- 1a. New website account → alert ----------
create or replace function public.site_client_upsert(p_key text, p_uid text, p_name text, p_email text, p_phone text, p_contact_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_id uuid; v_cp text := nullif(public.normalize_phone(p_contact_phone), ''); v_lead uuid; v_org uuid; v_was boolean; c public.website_clients%rowtype;
begin
  select org_id into v_org from public.lead_sources where key = p_key and active;
  v_was := exists (select 1 from public.website_clients where org_id = v_org and uid = p_uid);
  r := public.site_client_upsert(p_key, p_uid, p_name, p_email, p_phone);
  if r is null or not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  v_id := (r ->> 'client_id')::uuid;
  if v_cp is not null and public.valid_phone(v_cp) then
    update public.website_clients set contact_phone = v_cp where id = v_id and phone is null;
  end if;
  v_lead := public.site_client_link(p_key, v_id);
  select * into c from public.website_clients where id = v_id;
  if not v_was then
    perform public.notify_managers(c.org_id, 'website_signup', 'New sign-up on the website: ' || coalesce(nullif(c.name, ''), split_part(coalesce(c.email, 'a client'), '@', 1)),
      concat_ws(' · ', public.normalize_phone(coalesce(c.phone, c.contact_phone)), c.email, case when v_lead is null then 'Mobile not given yet' end),
      coalesce('/leads/' || v_lead, '/website-clients'));
  end if;
  return r || jsonb_build_object('lead', v_lead is not null,
    'need_phone', v_lead is null and coalesce(c.phone, c.contact_phone) is null);
end $$;

-- ---------- 1b. Saved home → alert ----------
create or replace function public.site_client_save(p_key text, p_uid text, p_project uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.lead_sources%rowtype; c public.website_clients%rowtype; v_new boolean := false; v_name text; l public.leads%rowtype; v_who text;
begin
  select * into s from public.lead_sources where key = p_key and active;
  if not found or not public.org_ok(s.org_id) then return null; end if;
  select * into c from public.website_clients where org_id = s.org_id and uid = p_uid;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_registered'); end if;
  select name into v_name from public.projects where id = p_project and org_id = s.org_id;
  if v_name is null then return null; end if;
  if p_on then
    insert into public.website_saves (org_id, project_id, client_id) values (s.org_id, p_project, c.id) on conflict do nothing;
    v_new := found;
  else
    delete from public.website_saves where project_id = p_project and client_id = c.id;
  end if;
  update public.website_clients set last_seen_at = now() where id = c.id;
  if c.lead_id is not null then select * into l from public.leads where id = c.lead_id; end if;
  v_who := coalesce(nullif(l.name, ''), nullif(c.name, ''), split_part(coalesce(c.email, 'A client'), '@', 1));
  if l.id is not null then
    if p_on and v_new then
      insert into public.activities (org_id, lead_id, type, body, by_user) values (s.org_id, l.id, 'enquiry', 'Saved ' || v_name || ' on the website', null);
      update public.leads set project_id = coalesce(project_id, p_project), last_activity_at = now() where id = l.id;
    elsif not p_on then
      insert into public.activities (org_id, lead_id, type, body, by_user) values (s.org_id, l.id, 'note', 'Removed ' || v_name || ' from saved homes on the website', null);
    end if;
  end if;
  if p_on and v_new then
    if l.assigned_to is not null then
      perform public.notify(s.org_id, l.assigned_to, 'website_save', v_who || ' saved ' || v_name, 'On the website. Good time to call.', '/leads/' || l.id);
    else
      perform public.notify_managers(s.org_id, 'website_save', v_who || ' saved ' || v_name, 'On the website' || case when l.id is null then ' (mobile not given yet)' else '' end, coalesce('/leads/' || l.id, '/website-clients'));
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.site_client_upsert(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.site_client_save(text, text, uuid, boolean) from public, anon, authenticated;

-- ---------- 2. Testimonials ----------
create table if not exists public.testimonials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  name text, place text, rating int check (rating between 1 and 5), body text check (char_length(body) <= 1200),
  status text not null default 'asked' check (status in ('asked', 'pending', 'approved', 'hidden')),
  asked_by uuid, created_at timestamptz not null default now(), submitted_at timestamptz
);
create index if not exists testimonials_org on public.testimonials(org_id, status, submitted_at desc);
alter table public.testimonials enable row level security;
drop policy if exists t_select on public.testimonials;
create policy t_select on public.testimonials for select using (public.can_use(org_id));
drop policy if exists t_update on public.testimonials;
create policy t_update on public.testimonials for update using (public.can_use(org_id) and public.my_role(org_id) in ('owner', 'manager'));
revoke all on public.testimonials from anon;
grant select, update on public.testimonials to authenticated;

-- Team: make (or reuse) the request link for a client.
create or replace function public.ask_testimonial(p_lead uuid) returns text
language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype; v text;
begin
  select * into l from public.leads where id = p_lead;
  if not found or not public.can_use(l.org_id) then raise exception 'Lead not found.'; end if;
  select token into v from public.testimonials where lead_id = l.id and status = 'asked' order by created_at desc limit 1;
  if v is null then
    insert into public.testimonials (org_id, lead_id, project_id, name, asked_by) values (l.org_id, l.id, l.project_id, l.name, auth.uid()) returning token into v;
    insert into public.activities (org_id, lead_id, type, body, by_user) values (l.org_id, l.id, 'note', 'Asked the client for a testimonial', auth.uid());
  end if;
  return v;
end $$;
revoke all on function public.ask_testimonial(uuid) from public, anon;
grant execute on function public.ask_testimonial(uuid) to authenticated;

-- Website: open the request (name and project only).
create or replace function public.site_testimonial_get(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', split_part(coalesce(t.name, ''), ' ', 1), 'project', p.name, 'done', t.status <> 'asked')
  from public.testimonials t left join public.projects p on p.id = t.project_id
  where t.token = p_token and p_token ~ '^[a-f0-9]{32}$' and t.created_at > now() - interval '365 days'
$$;
revoke all on function public.site_testimonial_get(text) from public;
grant execute on function public.site_testimonial_get(text) to anon, authenticated;

-- Website: the client writes it. It waits for an admin to approve.
create or replace function public.site_testimonial_submit(p_token text, p_name text, p_place text, p_rating int, p_body text) returns boolean
language plpgsql security definer set search_path = public as $$
declare t public.testimonials%rowtype;
begin
  if p_token !~ '^[a-f0-9]{32}$' or length(trim(coalesce(p_body, ''))) < 10 or p_rating not between 1 and 5 then return false; end if;
  select * into t from public.testimonials where token = p_token and status = 'asked' and created_at > now() - interval '365 days';
  if not found then return false; end if;
  update public.testimonials set name = left(coalesce(nullif(trim(p_name), ''), name), 80), place = left(nullif(trim(p_place), ''), 80),
    rating = p_rating, body = left(trim(p_body), 1200), status = 'pending', submitted_at = now() where id = t.id;
  if t.lead_id is not null then
    insert into public.activities (org_id, lead_id, type, body, by_user) values (t.org_id, t.lead_id, 'note', 'Wrote a testimonial (' || p_rating || '/5). Waiting for approval.', null);
  end if;
  perform public.notify_managers(t.org_id, 'testimonial', 'New testimonial from ' || coalesce(nullif(trim(p_name), ''), t.name, 'a client'),
    p_rating || '/5 · ' || left(trim(p_body), 100), '/website-clients#testimonials');
  return true;
end $$;
revoke all on function public.site_testimonial_submit(text, text, text, int, text) from public;
grant execute on function public.site_testimonial_submit(text, text, text, int, text) to anon, authenticated;

-- Website: approved testimonials.
create or replace function public.site_testimonials(p_org uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'place', t.place, 'rating', t.rating, 'body', t.body, 'project', p.name) order by t.submitted_at desc), '[]'::jsonb)
  from (select * from public.testimonials where org_id = p_org and status = 'approved' order by submitted_at desc limit 24) t
  left join public.projects p on p.id = t.project_id
  where public.org_ok(p_org)
$$;
revoke all on function public.site_testimonials(uuid) from public;
grant execute on function public.site_testimonials(uuid) to anon, authenticated;

-- ---------- 3. Website shortlist: only through the CRM server (which checks who is signed in) ----------
revoke execute on function public.site_shortlist(text) from anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.site_shortlist(text) to service_role;
    grant execute on function public.shortlist_react(text, uuid, text, timestamptz) to service_role;
    grant execute on function public.shortlist_seen(text) to service_role;
    grant execute on function public.ingest_lead(text, text, text, text, text, text, numeric, numeric, text, text, text, jsonb) to service_role;
  end if;
end $$;

select 'patch-032 done';
