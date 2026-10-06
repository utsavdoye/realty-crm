-- ============================================================
-- Patch 011: client requirement form, Intern role, "Find matching leads" fix,
-- and locked details on client links (price list / photos / floor plans).
-- Run once in Supabase → SQL Editor (after patch-010). Safe to run again.
-- ============================================================

-- ---------- 1. Interns ----------
-- An intern works exactly like an employee (only their own leads), with no delete rights.
alter table public.members add column if not exists is_intern boolean not null default false;
alter table public.invites add column if not exists is_intern boolean not null default false;

create or replace function public.is_intern(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_intern from public.members where org_id = p_org and user_id = auth.uid() and active), false)
$$;
grant execute on function public.is_intern(uuid) to authenticated;

-- Interns cannot delete client links.
drop policy if exists shortlists_delete on public.shortlists;
create policy shortlists_delete on public.shortlists for delete
  using (public.can_use(org_id) and not public.is_intern(org_id) and (public.is_manager(org_id) or created_by = auth.uid()));

create or replace function public.create_invite(p_org uuid, p_role text, p_full_name text, p_phone text, p_email text)
returns text language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(p_org); v_token text; v_intern boolean := p_role = 'intern';
begin
  if r is null or r not in ('owner','manager') then raise exception 'Only an admin or a manager can invite people'; end if;
  if not public.org_ok(p_org) then raise exception 'Your plan has ended. Renew to add people.'; end if;
  if p_role not in ('owner','manager','agent','intern','partner') then raise exception 'Pick a role'; end if;
  if r = 'manager' and p_role in ('owner','manager') then raise exception 'Only an admin can add admins or managers'; end if;
  if coalesce(trim(p_phone), '') = '' and coalesce(trim(p_email), '') = '' then
    raise exception 'Add their mobile number or email, so only they can use the link';
  end if;
  if coalesce(trim(p_phone), '') <> '' and not public.valid_phone(public.normalize_phone(p_phone)) then
    raise exception 'Enter a valid mobile number: 10 digits for India, or + and country code';
  end if;
  insert into public.invites (org_id, role, is_intern, full_name, phone, email, invited_by)
    values (p_org, case when v_intern then 'agent' else p_role end, v_intern, nullif(trim(p_full_name), ''),
            nullif(public.normalize_phone(p_phone), ''), nullif(lower(trim(p_email)), ''), auth.uid())
    returning token into v_token;
  return v_token;
end $$;

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
  insert into public.members (org_id, user_id, role, is_intern, full_name, phone, email)
    values (i.org_id, auth.uid(), i.role, i.is_intern, trim(p_full_name), coalesce(v_phone, i.phone), coalesce(v_email, i.email))
    on conflict (org_id, user_id) do update
      set role = case when public.members.role = 'owner' then 'owner' else excluded.role end,
          is_intern = case when public.members.role = 'owner' then false else excluded.is_intern end,
          active = true, deactivated_at = null, full_name = excluded.full_name;
  update public.invites set accepted_by = auth.uid(), accepted_at = now() where id = i.id;
  return i.org_id;
end $$;

create or replace function public.set_member_role(p_org uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role(p_org) is distinct from 'owner' then raise exception 'Only an admin can change roles'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own role'; end if;
  if p_role not in ('owner','manager','agent','intern','partner') then raise exception 'Pick a role'; end if;
  update public.members set role = case when p_role = 'intern' then 'agent' else p_role end, is_intern = (p_role = 'intern')
    where org_id = p_org and user_id = p_user;
  if not found then raise exception 'Person not found'; end if;
end $$;

-- ---------- 2. "Find matching leads" ----------
-- Look again through all leads, bring back matches that were hidden earlier, and return how many fit now.
create or replace function public.rematch_project(p_project uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_org uuid; n int;
begin
  select org_id into v_org from public.projects where id = p_project;
  if v_org is null or not public.is_manager(v_org) then raise exception 'Only an admin or a manager can do this'; end if;
  update public.project_matches set dismissed_at = null where project_id = p_project and dismissed_at is not null;
  perform public.match_leads_for_project(p_project, true);
  select count(*) into n from public.project_matches where project_id = p_project and dismissed_at is null;
  return n;
end $$;
revoke all on function public.rematch_project(uuid) from public, anon;
grant execute on function public.rematch_project(uuid) to authenticated;

-- ---------- 3. Client requirement form ----------
-- Each company gets one private form link. Staff share it with ?by=<their id>, so the lead comes to them.
alter table public.organizations add column if not exists form_token text unique default replace(gen_random_uuid()::text, '-', '');
update public.organizations set form_token = replace(gen_random_uuid()::text, '-', '') where form_token is null;

-- Public: company name + the person who shared it (for the form heading). Nothing else.
create or replace function public.get_requirement_form(p_form text, p_by uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'company', o.name, 'city', o.city,
    'advisor', (select m.full_name from public.members m where m.org_id = o.id and m.user_id = p_by and m.active and m.role <> 'partner'),
    'areas', coalesce((select jsonb_agg(distinct trim(split_part(p.location, ',', 1))) from public.projects p
                        where p.org_id = o.id and coalesce(p.status, '') <> 'Sold out' and coalesce(trim(p.location), '') <> ''), '[]'::jsonb))
  from public.organizations o where o.form_token = p_form and public.org_ok(o.id)
$$;
revoke all on function public.get_requirement_form(text, uuid) from public;
grant execute on function public.get_requirement_form(text, uuid) to anon, authenticated;

-- Public: client sends their requirement → new lead (or the old lead is updated). Returns how many of our projects fit.
create or replace function public.submit_requirement(
  p_form text, p_by uuid, p_name text, p_phone text, p_bhk text, p_ptype text,
  p_bmin numeric, p_bmax numeric, p_location text, p_purpose text, p_timeline text, p_loan text, p_slot text, p_note text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.organizations%rowtype; v_phone text := public.normalize_phone(p_phone); v_lead public.leads%rowtype;
        v_to uuid; v_note text; v_fits int; v_hot boolean;
begin
  select * into o from public.organizations where form_token = p_form;
  if not found or not public.org_ok(o.id) then return jsonb_build_object('ok', false); end if;
  if v_phone is null or not public.valid_phone(v_phone) or char_length(coalesce(trim(p_name), '')) < 2 then return jsonb_build_object('ok', false); end if;
  if p_bmin is not null and p_bmax is not null and p_bmin > p_bmax then return jsonb_build_object('ok', false); end if;
  v_hot := p_timeline in ('Right away', 'Within 3 months');
  v_note := concat_ws(E'\n', 'Filled the requirement form',
    'When buying: ' || nullif(trim(p_timeline), ''), 'Home loan: ' || nullif(trim(p_loan), ''),
    'Best time to call: ' || nullif(trim(p_slot), ''), nullif(left(trim(p_note), 500), ''));

  select * into v_lead from public.leads where org_id = o.id and phone = v_phone for update;
  if found then
    update public.leads set
      bhk = coalesce(nullif(trim(p_bhk), ''), bhk), property_type = coalesce(nullif(trim(p_ptype), ''), property_type),
      budget_min = coalesce(p_bmin, budget_min), budget_max = coalesce(p_bmax, budget_max),
      location = coalesce(nullif(left(trim(p_location), 200), ''), location), purpose = coalesce(nullif(trim(p_purpose), ''), purpose),
      preferred_slot = coalesce(nullif(trim(p_slot), ''), preferred_slot), next_follow_up = now(),
      score = case when v_hot then 'hot' else score end,
      stage = case when stage = 'lost' then 'new' else stage end
    where id = v_lead.id;
    insert into public.activities (org_id, lead_id, type, body, by_user) values (o.id, v_lead.id, 'enquiry', 'Sent their requirement again. ' || v_note, null);
    perform public.notify(o.id, v_lead.assigned_to, 'enquiry', v_lead.name || ' sent their requirement', 'Open the lead to see what they want.', '/leads/' || v_lead.id);
  else
    select m.user_id into v_to from public.members m where m.org_id = o.id and m.user_id = p_by and m.active and m.role <> 'partner';
    if v_to is null and o.auto_assign then v_to := public.next_assignee(o.id); end if;
    insert into public.leads (org_id, name, phone, bhk, property_type, budget_min, budget_max, location, purpose, preferred_slot,
                              source, assigned_to, next_follow_up, score)
      values (o.id, left(trim(p_name), 120), v_phone, nullif(trim(p_bhk), ''), nullif(trim(p_ptype), ''), p_bmin, p_bmax,
              nullif(left(trim(p_location), 200), ''), nullif(trim(p_purpose), ''), nullif(trim(p_slot), ''),
              'Requirement form', v_to, now(), case when v_hot then 'hot' else 'warm' end)
      returning * into v_lead;
    insert into public.activities (org_id, lead_id, type, body, by_user) values (o.id, v_lead.id, 'created', v_note, null);
  end if;

  -- how many of our live projects fit their budget (10% give either side)
  select count(*) into v_fits from public.projects p
  where p.org_id = o.id and coalesce(p.status, '') <> 'Sold out'
    and (coalesce(p_bmin, p_bmax) is null or p.price_from is null or (
         p.price_from <= coalesce(p_bmax, p_bmin * 1.3) * 1.1
         and coalesce(p.price_to, p.price_from * 1.3) >= coalesce(p_bmin, p_bmax * 0.6) * 0.9));
  return jsonb_build_object('ok', true, 'fits', v_fits,
    'advisor', (select full_name from public.members where org_id = o.id and user_id = v_lead.assigned_to));
end $$;
revoke all on function public.submit_requirement(text, uuid, text, text, text, text, numeric, numeric, text, text, text, text, text, text) from public;
grant execute on function public.submit_requirement(text, uuid, text, text, text, text, numeric, numeric, text, text, text, text, text, text) to anon, authenticated;

-- ---------- 4. Client links: locked details ----------
-- How many people asked about a public project in the last 30 days (real number, shown only when 3 or more).
create or replace function public.public_project_buzz(p_token text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.leads l join public.projects p on p.id = l.project_id
  where p.share_token = p_token and p.is_public and l.created_at > now() - interval '30 days'
$$;
revoke all on function public.public_project_buzz(text) from public;
grant execute on function public.public_project_buzz(text) to anon, authenticated;

-- Shortlist: new reaction "details" = client unlocked the price list / photos. Tells their advisor at once.
create or replace function public.shortlist_react(p_token text, p_project uuid, p_reaction text, p_when timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare s public.shortlists%rowtype; l public.leads%rowtype; v_name text; v_body text;
begin
  if p_reaction not in ('like','no','visit','details') then return false; end if;
  select * into s from public.shortlists where token = p_token;
  if not found or not (p_project = any(s.project_ids)) or not public.org_ok(s.org_id) then return false; end if;
  select name into v_name from public.projects where id = p_project;
  select * into l from public.leads where id = s.lead_id;
  if p_reaction = 'details' then
    if exists (select 1 from public.activities where lead_id = l.id and type = 'note'
               and body = 'Client opened the price list and all photos of ' || v_name and created_at > now() - interval '1 day') then
      return true;
    end if;
    insert into public.activities (org_id, lead_id, type, body, by_user)
      values (s.org_id, s.lead_id, 'note', 'Client opened the price list and all photos of ' || v_name, null);
    update public.leads set next_follow_up = least(coalesce(next_follow_up, now()), now()) where id = l.id;
    perform public.notify(s.org_id, l.assigned_to, 'shortlist_like', l.name || ' is checking prices of ' || v_name,
      'They just opened the price list. Good time to call.', '/leads/' || l.id);
    return true;
  end if;
  if s.reactions ->> p_project::text = p_reaction and p_reaction <> 'visit' then return true; end if;
  update public.shortlists set reactions = reactions || jsonb_build_object(p_project::text, p_reaction) where id = s.id;
  v_body := case p_reaction
    when 'like' then 'Client liked ' || v_name || ' on the shortlist'
    when 'no' then 'Client said "not for me" to ' || v_name
    else 'Client asked for a site visit at ' || v_name ||
      coalesce(' on ' || to_char(p_when at time zone 'Asia/Kolkata', 'Dy DD Mon, HH12:MI am'), '') || '. Call to confirm.' end;
  insert into public.activities (org_id, lead_id, type, body, by_user) values (s.org_id, s.lead_id, 'note', v_body, null);
  if p_reaction <> 'no' then
    update public.leads set next_follow_up = now(), score = case when p_reaction = 'visit' then 'hot' else score end where id = l.id;
    perform public.notify(s.org_id, l.assigned_to, 'shortlist_' || p_reaction, l.name || ': ' || case when p_reaction = 'visit' then 'wants a site visit' else 'liked ' || v_name end, v_body, '/leads/' || l.id);
  end if;
  return true;
end $$;
revoke all on function public.shortlist_react(text, uuid, text, timestamptz) from public;
grant execute on function public.shortlist_react(text, uuid, text, timestamptz) to anon, authenticated;

select 'patch-011 done' as result;
