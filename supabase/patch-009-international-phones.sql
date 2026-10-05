-- ============================================================
-- Patch 009 — mobile numbers from any country
-- Indian numbers are still saved as 10 digits (98450 12345) so nothing old changes.
-- Other countries are saved with + and country code (+971501234567).
-- Run once in Supabase → SQL Editor (after patch-008). Safe to run again.
-- ============================================================

create or replace function public.normalize_phone(p text) returns text
language sql immutable as $$
  select case
    when p is null then null
    when x.d = '' then ''
    when x.plus and x.d like '91%' and length(x.d) = 12 then right(x.d, 10)          -- +91 98450 12345
    when x.plus then '+' || x.d                                                      -- +971 50 123 4567
    when x.d like '0091%' and length(x.d) = 14 then right(x.d, 10)                   -- 0091 98450 12345
    when x.d like '00%' and length(x.d) between 10 and 17 then '+' || substr(x.d, 3) -- 00971 50 123 4567
    when length(x.d) = 12 and x.d like '91%' then right(x.d, 10)                     -- 91 98450 12345
    when length(x.d) = 11 and x.d like '0%' then right(x.d, 10)                      -- 098450 12345
    else x.d
  end
  from (select regexp_replace(p, '\D', '', 'g') as d, ltrim(p) like '+%' as plus) x
$$;

-- India: 10 digits starting 6-9.  Anywhere else: + then 8 to 15 digits.
create or replace function public.valid_phone(p text) returns boolean
language sql immutable as $$
  select coalesce(p ~ '^[6-9][0-9]{9}$' or p ~ '^\+[1-9][0-9]{7,14}$', false)
$$;
grant execute on function public.valid_phone(text) to anon, authenticated;

create or replace function public.leads_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(new.org_id);
begin
  new.phone := public.normalize_phone(new.phone);
  if not public.valid_phone(new.phone) then
    raise exception 'Enter a valid mobile number: 10 digits for India, or + and country code for other countries (e.g. +971 50 123 4567)';
  end if;
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) and not exists (
    select 1 from public.members m where m.org_id = new.org_id and m.user_id = new.assigned_to and m.active and m.role in ('owner','manager','agent')
  ) then
    raise exception 'That person is not an active member of this company';
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    if r = 'agent' then
      new.assigned_to := coalesce(new.assigned_to, auth.uid());
      if new.assigned_to <> auth.uid() then
        raise exception 'Agents can only add leads for themselves';
      end if;
      new.partner_id := null;
    elsif r = 'partner' then
      new.partner_id := auth.uid();
      new.assigned_to := null;
    end if;
  else
    if auth.uid() is not null and coalesce(current_setting('estatedesk.system', true), '') <> 'on'
       and coalesce(r, '') not in ('owner','manager') then
      if new.assigned_to is distinct from old.assigned_to
         or new.partner_id is distinct from old.partner_id
         or new.org_id <> old.org_id then
        raise exception 'Only the owner or a manager can reassign leads';
      end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

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
  if v_phone is null or not public.valid_phone(v_phone) then return jsonb_build_object('ok', false, 'error', 'bad_phone'); end if;

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

create or replace function public.import_leads(p_org uuid, p_rows jsonb, p_source text, p_assign text, p_project uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_phone text; v_id uuid; v_to uuid; added int := 0; updated int := 0; skipped int := 0;
begin
  if not public.is_manager(p_org) then raise exception 'Only the owner or a manager can import leads'; end if;
  if not public.org_ok(p_org) then raise exception 'Your plan has ended'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'Send at most 1000 rows at a time'; end if;
  if p_project is not null and not exists (select 1 from public.projects where id = p_project and org_id = p_org) then p_project := null; end if;
  if p_assign not in ('', 'auto') and not exists (
    select 1 from public.members where org_id = p_org and user_id = p_assign::uuid and active and role <> 'partner') then
    raise exception 'Pick an active team member';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_phone := public.normalize_phone(r->>'phone');
    if v_phone is null or not public.valid_phone(v_phone) or coalesce(trim(r->>'name'), '') = '' then skipped := skipped + 1; continue; end if;
    select id into v_id from public.leads where org_id = p_org and phone = v_phone;
    if found then
      insert into public.activities (org_id, lead_id, type, body, by_user)
        values (p_org, v_id, 'enquiry', 'Came again in an imported list' || coalesce(' (' || nullif(coalesce(r->>'source', p_source), '') || ')', '') || coalesce(': ' || nullif(r->>'note', ''), ''), auth.uid());
      updated := updated + 1;
      continue;
    end if;
    v_to := case when p_assign = 'auto' then public.next_assignee(p_org) when p_assign = '' then null else p_assign::uuid end;
    insert into public.leads (org_id, name, phone, email, location, budget_min, budget_max, bhk, source, project_id, assigned_to, next_follow_up)
      values (p_org, left(trim(r->>'name'), 120), v_phone, nullif(trim(r->>'email'), ''), nullif(trim(r->>'location'), ''),
              nullif(r->>'budget_min', '')::numeric, nullif(r->>'budget_max', '')::numeric, nullif(trim(r->>'bhk'), ''),
              coalesce(nullif(trim(r->>'source'), ''), nullif(p_source, ''), 'Other'), p_project, v_to, now())
      returning id into v_id;
    insert into public.activities (org_id, lead_id, type, body, by_user)
      values (p_org, v_id, 'created', 'Imported from a list' || coalesce(E'\n' || nullif(r->>'note', ''), ''), auth.uid());
    added := added + 1;
  end loop;
  return jsonb_build_object('added', added, 'updated', updated, 'skipped', skipped);
end $$;

create or replace function public.public_enquiry(p_token text, p_name text, p_phone text, p_message text, p_when timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare p public.projects%rowtype; v_phone text := public.normalize_phone(p_phone); v_lead public.leads%rowtype; v_to uuid; v_note text;
begin
  select * into p from public.projects where share_token = p_token and is_public;
  if not found or not public.org_ok(p.org_id) then return false; end if;
  if v_phone is null or not public.valid_phone(v_phone) or coalesce(trim(p_name), '') = '' then return false; end if;
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
  if coalesce(trim(p_phone), '') <> '' and not public.valid_phone(public.normalize_phone(p_phone)) then
    raise exception 'Enter a valid mobile number: 10 digits for India, or + and country code';
  end if;
  insert into public.invites (org_id, role, full_name, phone, email, invited_by)
    values (p_org, p_role, nullif(trim(p_full_name), ''), nullif(public.normalize_phone(p_phone), ''), nullif(lower(trim(p_email)), ''), auth.uid())
    returning token into v_token;
  return v_token;
end $$;

-- Login phones are stored by Supabase without '+', so add it before comparing with the invite.
create or replace function public.accept_invite(p_token text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare i public.invites%rowtype; v_phone text; v_email text;
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  select * into i from public.invites where token = p_token for update;
  if not found then raise exception 'This invite link is not valid'; end if;
  if i.accepted_at is not null then raise exception 'This invite link was already used'; end if;
  if i.expires_at < now() then raise exception 'This invite link has expired. Ask for a new one.'; end if;
  select public.normalize_phone('+' || nullif(u.phone, '')), lower(u.email) into v_phone, v_email from auth.users u where u.id = auth.uid();
  if not ((i.phone is not null and i.phone = v_phone) or (i.email is not null and i.email = v_email)) then
    raise exception 'This invite was sent to a different mobile number or email. Log in with that one.';
  end if;
  if char_length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Enter your name'; end if;
  insert into public.members (org_id, user_id, role, full_name, phone, email)
    values (i.org_id, auth.uid(), i.role, trim(p_full_name), coalesce(v_phone, i.phone), coalesce(v_email, i.email))
    on conflict (org_id, user_id) do update
      set role = case when public.members.role = 'owner' then 'owner' else excluded.role end,
          active = true, deactivated_at = null, full_name = excluded.full_name;
  update public.invites set accepted_by = auth.uid(), accepted_at = now() where id = i.id;
  return i.org_id;
end $$;
