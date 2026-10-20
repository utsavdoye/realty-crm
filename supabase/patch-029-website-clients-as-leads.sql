-- patch-029: a client who signs in on the website (e.g. Surestone) becomes a lead in the CRM by itself,
-- and every home they save shows on that lead (timeline + "On your website").
--   * Sign in with a mobile (SMS): the lead is made at once.
--   * Sign in with email or Google: the website asks for the mobile number once (a lead needs a number);
--     if a lead with the same email already exists, the account is linked to it straight away.
--   * Everyone who signs in is also listed on the new "Website clients" page, number or not.
-- Run after patch-027. Safe to run more than once.

alter table public.website_clients add column if not exists lead_id uuid references public.leads(id) on delete set null;
alter table public.website_clients add column if not exists contact_phone text;   -- typed by the client (not SMS checked)
create index if not exists website_clients_lead on public.website_clients(lead_id);

-- Link a website account to a lead: same mobile or same email → that lead; else a new lead (needs a mobile).
create or replace function public.site_client_link(p_key text, p_client uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.website_clients%rowtype; v_phone text; v_lead uuid; r jsonb; v_saved text;
begin
  select * into c from public.website_clients where id = p_client;
  if not found then return null; end if;
  if c.lead_id is not null and exists (select 1 from public.leads where id = c.lead_id) then return c.lead_id; end if;
  v_phone := nullif(public.normalize_phone(coalesce(c.phone, c.contact_phone)), '');
  if v_phone is not null then
    select id into v_lead from public.leads where org_id = c.org_id and phone = v_phone;
  end if;
  if v_lead is null and c.email is not null then
    select id into v_lead from public.leads where org_id = c.org_id and lower(email) = lower(c.email) order by created_at desc limit 1;
  end if;
  if v_lead is null and v_phone is not null and public.valid_phone(v_phone) then
    r := public.ingest_lead_core(p_key, coalesce(nullif(trim(c.name), ''), split_part(coalesce(c.email, ''), '@', 1)), v_phone, c.email,
           null, null, null, null, null, null, 'Created an account on the website' || coalesce(' (' || c.email || ')', ''), null);
    v_lead := nullif(r ->> 'lead_id', '')::uuid;
  elsif v_lead is not null then
    update public.leads set email = coalesce(email, c.email), last_activity_at = now() where id = v_lead;
    insert into public.activities (org_id, lead_id, type, body, by_user)
      values (c.org_id, v_lead, 'enquiry', 'Signed in on the website' || coalesce(' with ' || c.email, ''), null);
  end if;
  if v_lead is null then return null; end if;
  update public.website_clients set lead_id = v_lead where id = c.id;
  -- homes saved before the lead existed
  select string_agg(p.name, ', ' order by s.created_at) into v_saved
    from public.website_saves s join public.projects p on p.id = s.project_id where s.client_id = c.id;
  if v_saved is not null then
    insert into public.activities (org_id, lead_id, type, body, by_user) values (c.org_id, v_lead, 'enquiry', 'Saved on the website: ' || v_saved, null);
  end if;
  return v_lead;
end $$;
revoke all on function public.site_client_link(text, uuid) from public, anon, authenticated;

-- Register / refresh a website account (now also takes the mobile the client typed).
-- Returns {ok, client_id, saves, lead:true|false, need_phone} or {conflict:'email'|'phone'}.
create or replace function public.site_client_upsert(p_key text, p_uid text, p_name text, p_email text, p_phone text, p_contact_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_id uuid; v_cp text := nullif(public.normalize_phone(p_contact_phone), ''); v_lead uuid;
begin
  r := public.site_client_upsert(p_key, p_uid, p_name, p_email, p_phone);
  if r is null or not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  v_id := (r ->> 'client_id')::uuid;
  if v_cp is not null and public.valid_phone(v_cp) then
    update public.website_clients set contact_phone = v_cp where id = v_id and phone is null;
  end if;
  v_lead := public.site_client_link(p_key, v_id);
  return r || jsonb_build_object('lead', v_lead is not null,
    'need_phone', v_lead is null and not exists (select 1 from public.website_clients where id = v_id and coalesce(phone, contact_phone) is not null));
end $$;

-- Save / un-save: also shows on the client's lead.
create or replace function public.site_client_save(p_key text, p_uid text, p_project uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.lead_sources%rowtype; c public.website_clients%rowtype; v_new boolean := false; v_name text;
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
  if c.lead_id is not null and exists (select 1 from public.leads where id = c.lead_id) then
    if p_on and v_new then
      insert into public.activities (org_id, lead_id, type, body, by_user) values (s.org_id, c.lead_id, 'enquiry', 'Saved ' || v_name || ' on the website', null);
      update public.leads set project_id = coalesce(project_id, p_project), last_activity_at = now() where id = c.lead_id;
    elsif not p_on then
      insert into public.activities (org_id, lead_id, type, body, by_user) values (s.org_id, c.lead_id, 'note', 'Removed ' || v_name || ' from saved homes on the website', null);
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.site_client_upsert(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.site_client_save(text, text, uuid, boolean) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.site_client_upsert(text, text, text, text, text, text) to service_role;
    grant execute on function public.site_client_save(text, text, uuid, boolean) to service_role;
  end if;
  -- the "Website clients" page updates live
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'website_clients') then
    alter publication supabase_realtime add table public.website_clients;
  end if;
end $$;

select 'patch-029 done';
