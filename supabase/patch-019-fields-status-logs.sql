-- patch-019: new lead fields (category, city, pincode, occupation, funding, primary/secondary),
-- interest Junk / Maybe later, status "No response", a log of deleted leads (admin can bring them back),
-- partners as site-visit people, secondary lead sources, overdue payments in the morning message.
-- Safe to run more than once.

-- ---------- 1. New lead fields ----------
alter table public.leads add column if not exists category text;
alter table public.leads add column if not exists city text;
alter table public.leads add column if not exists pincode text;
alter table public.leads add column if not exists occupation text;
alter table public.leads add column if not exists funding text;
alter table public.leads add column if not exists project_other text;
alter table public.leads add column if not exists segment text not null default 'primary';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_segment_ok') then
    alter table public.leads add constraint leads_segment_ok check (segment in ('primary','secondary'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_pincode_ok') then
    alter table public.leads add constraint leads_pincode_ok check (pincode is null or pincode ~ '^[1-9][0-9]{5}$');
  end if;
end $$;
create index if not exists leads_segment_idx on public.leads(org_id, segment, created_at desc);

-- Interest: Hot, Warm, Cold, Junk, Maybe later
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.leads'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%score%' loop
    execute format('alter table public.leads drop constraint %I', c);
  end loop;
  alter table public.leads add constraint leads_score_ok check (score in ('hot','warm','cold','junk','later'));
end $$;

-- Status: "No response" = we called, nobody picked up (sits at the same level as New)
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.leads'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%stage%' and pg_get_constraintdef(oid) ilike '%negotiation%' loop
    execute format('alter table public.leads drop constraint %I', c);
  end loop;
  alter table public.leads add constraint leads_stage_ok
    check (stage in ('new','noresponse','contacted','qualified','visit','visited','negotiation','token','booked','lost'));
end $$;
create or replace function public.stage_index(s text) returns int
language sql immutable as $$
  select case when s = 'noresponse' then 0
    else array_position(array['new','contacted','qualified','visit','visited','negotiation','token','booked'], s) - 1 end
$$;

-- Category follows the property type when nobody picked one (voice, portals, client form, Excel import)
create or replace function public.leads_category() returns trigger
language plpgsql as $$
begin
  if new.category is null or new.category = '' then
    new.category := case
      when new.property_type in ('Office','Retail') then 'Commercial'
      when new.property_type = 'Plot' then 'Plot'
      when new.property_type = 'Farm land' then 'Farm land'
      when new.property_type in ('Apartment','Villa','Independent house') then 'Residential'
      when new.bhk ~ 'BHK|Studio|Penthouse' then 'Residential'
      else null end;
  end if;
  if new.category = 'Commercial' and new.bhk ~ 'BHK|Studio|Penthouse' then new.bhk := null; end if;  -- no BHK for shops and offices
  if new.pincode = '' then new.pincode := null; end if;
  return new;
end $$;
drop trigger if exists leads_category on public.leads;
create trigger leads_category before insert or update of category, property_type, bhk, pincode on public.leads
  for each row execute function public.leads_category();

-- Old values move to the new fields: "Plot", "Villa", "Shop / Office" were in the BHK list; "Commercial" was a property type
update public.leads set property_type = coalesce(nullif(property_type, ''), 'Plot'), bhk = null where bhk = 'Plot';
update public.leads set property_type = coalesce(nullif(property_type, ''), 'Villa'), bhk = null where bhk = 'Villa';
update public.leads set category = 'Commercial', bhk = null where bhk = 'Shop / Office';
update public.leads set category = 'Commercial', property_type = null where property_type = 'Commercial';
update public.leads set category = null where category is null;  -- fills category from the rule above

-- A lead source can be marked "secondary" (resale listings): its leads go to the Secondary list
alter table public.lead_sources add column if not exists segment text not null default 'primary';
create or replace function public.leads_segment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source_id is not null and exists (select 1 from public.lead_sources s where s.id = new.source_id and s.segment = 'secondary') then
    new.segment := 'secondary';
  end if;
  return new;
end $$;
drop trigger if exists leads_segment on public.leads;
create trigger leads_segment before insert on public.leads for each row execute function public.leads_segment();

-- ---------- 2. Deleted leads: a copy is kept so the admin can see who deleted what, and bring it back ----------
create table if not exists public.deleted_leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null,
  name text, phone text,
  data jsonb not null,
  deleted_by uuid,
  deleted_at timestamptz not null default now(),
  restored_at timestamptz,
  restored_by uuid
);
create index if not exists deleted_leads_org on public.deleted_leads(org_id, deleted_at desc);
alter table public.deleted_leads enable row level security;
drop policy if exists dl_select on public.deleted_leads;
create policy dl_select on public.deleted_leads for select using (public.can_use(org_id) and public.my_role(org_id) = 'owner');
grant select on public.deleted_leads to authenticated;

create or replace function public.leads_keep_copy() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.deleted_leads (org_id, lead_id, name, phone, data, deleted_by)
  values (old.org_id, old.id, old.name, old.phone, jsonb_build_object(
    'lead', to_jsonb(old),
    'activities', coalesce((select jsonb_agg(to_jsonb(a)) from public.activities a where a.lead_id = old.id), '[]'::jsonb),
    'visits', coalesce((select jsonb_agg(to_jsonb(v)) from public.visits v where v.lead_id = old.id), '[]'::jsonb),
    'steps', coalesce((select jsonb_agg(to_jsonb(s)) from public.lead_steps s where s.lead_id = old.id), '[]'::jsonb),
    'reason', nullif(current_setting('estatedesk.delete_reason', true), '')
  ), auth.uid());
  return old;
end $$;
drop trigger if exists leads_keep_copy on public.leads;
create trigger leads_keep_copy before delete on public.leads for each row execute function public.leads_keep_copy();

-- Delete with a reason. Runs as the person deleting, so the usual rules still decide (admin and manager only).
create or replace function public.delete_lead(p_id uuid, p_reason text) returns boolean
language plpgsql security invoker set search_path = public as $$
begin
  perform set_config('estatedesk.delete_reason', left(coalesce(p_reason, ''), 200), true);
  delete from public.leads where id = p_id;
  return found;
end $$;
revoke all on function public.delete_lead(uuid, text) from public, anon;
grant execute on function public.delete_lead(uuid, text) to authenticated;

-- Admin only: put a deleted lead back with its history.
create or replace function public.restore_lead(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d public.deleted_leads; v_id uuid;
begin
  select * into d from public.deleted_leads where id = p_id;
  if d.id is null or public.my_role(d.org_id) is distinct from 'owner' then raise exception 'Only an admin can bring back a lead'; end if;
  if d.restored_at is not null then raise exception 'This lead was already brought back'; end if;
  if exists (select 1 from public.leads where id = d.lead_id) then raise exception 'This lead is already in the CRM'; end if;
  if exists (select 1 from public.leads where org_id = d.org_id and phone = d.phone) then
    raise exception 'A lead with this mobile number was added again after the delete. Open that lead instead.';
  end if;
  perform set_config('estatedesk.system', 'on', true);
  perform set_config('estatedesk.handoff', 'on', true);
  perform set_config('estatedesk.bulk', 'on', true);
  insert into public.leads select * from jsonb_populate_record(null::public.leads, d.data->'lead') returning id into v_id;
  insert into public.visits select * from jsonb_populate_recordset(null::public.visits, d.data->'visits');
  -- the inserts above add their own "lead received" / "visit" rows; the saved history replaces them
  delete from public.activities where lead_id = v_id;
  delete from public.lead_steps where lead_id = v_id;
  insert into public.activities select * from jsonb_populate_recordset(null::public.activities, d.data->'activities');
  insert into public.lead_steps select * from jsonb_populate_recordset(null::public.lead_steps, d.data->'steps');
  insert into public.activities (org_id, lead_id, type, body, by_user)
    values (d.org_id, v_id, 'note', 'Brought back after it was deleted', auth.uid());
  perform set_config('estatedesk.system', 'off', true);
  perform set_config('estatedesk.handoff', 'off', true);
  perform set_config('estatedesk.bulk', 'off', true);
  update public.deleted_leads set restored_at = now(), restored_by = auth.uid() where id = p_id;
  return v_id;
end $$;
revoke all on function public.restore_lead(uuid) from public, anon;
grant execute on function public.restore_lead(uuid) to authenticated;

-- ---------- 3. A channel partner can be the site-visit person and then sees that client ----------
create or replace function public.lead_visible(p_org uuid, p_assigned uuid, p_partner uuid, p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(case public.my_role(p_org)
    when 'owner' then true
    when 'manager' then
      not exists (select 1 from public.members t where t.org_id = p_org and t.manager_id = auth.uid() and t.active)
      or p_assigned = auth.uid()
      or exists (select 1 from public.members t where t.org_id = p_org and t.manager_id = auth.uid() and t.user_id = p_assigned)
      or exists (select 1 from public.lead_people lp join public.members t on t.org_id = p_org and t.user_id = lp.user_id
                 where lp.lead_id = p_lead and (lp.user_id = auth.uid() or t.manager_id = auth.uid()))
    when 'agent' then p_assigned = auth.uid()
    when 'partner' then p_partner = auth.uid()
      or exists (select 1 from public.visits v where v.lead_id = p_lead and v.agent_id = auth.uid())
    else false end, false)
$$;

-- ---------- 4. Morning message: the admin also hears about overdue buyer payments ----------
create or replace function public.morning_digest() returns int
language plpgsql security definer set search_path = public as $$
declare m record; v_calls int; v_over int; v_vis int; v_new int; v_pay int; n int := 0;
  v_end timestamptz := ((now() at time zone 'Asia/Kolkata')::date + 1)::timestamp at time zone 'Asia/Kolkata';
  v_start timestamptz := ((now() at time zone 'Asia/Kolkata')::date)::timestamp at time zone 'Asia/Kolkata';
begin
  for m in
    select mm.org_id, mm.user_id, mm.full_name, mm.role from public.members mm
    where mm.active and mm.role <> 'partner' and public.org_ok(mm.org_id)
  loop
    select count(*) filter (where l.next_follow_up < now()), count(*) filter (where l.next_follow_up < v_end),
           count(*) filter (where l.call_attempts = 0)
      into v_over, v_calls, v_new
    from public.leads l
    where l.org_id = m.org_id and l.stage not in ('booked','lost')
      and (m.role = 'owner' or l.assigned_to = m.user_id
           or (m.role = 'manager' and l.assigned_to in (select t.user_id from public.members t where t.org_id = m.org_id and t.manager_id = m.user_id)));
    select count(*) into v_vis from public.visits v
    where v.org_id = m.org_id and v.status = 'scheduled' and v.at >= v_start and v.at < v_end
      and (m.role = 'owner' or v.agent_id = m.user_id
           or (m.role = 'manager' and v.agent_id in (select t.user_id from public.members t where t.org_id = m.org_id and t.manager_id = m.user_id)));
    v_pay := 0;
    if m.role = 'owner' then
      select count(*) into v_pay from public.deal_installments i join public.deals d on d.id = i.deal_id
      where i.org_id = m.org_id and i.due_on < (now() at time zone 'Asia/Kolkata')::date and i.paid_amount < i.amount
        and coalesce(d.status, '') <> 'cancelled';
    end if;
    if v_calls + v_vis + v_new + v_pay = 0 then continue; end if;
    if exists (select 1 from public.notifications where user_id = m.user_id and org_id = m.org_id and type = 'morning' and created_at >= v_start) then continue; end if;
    perform public.notify(m.org_id, m.user_id, 'morning',
      'Good morning ' || split_part(coalesce(m.full_name, ''), ' ', 1) || '! Today: ' ||
        v_calls || ' call' || case when v_calls = 1 then '' else 's' end ||
        case when v_over > 0 then ' (' || v_over || ' overdue)' else '' end ||
        case when v_vis > 0 then ', ' || v_vis || ' site visit' || case when v_vis = 1 then '' else 's' end else '' end,
      case when v_new > 0 then v_new || ' new client' || case when v_new = 1 then '' else 's' end || ' not called yet. ' else '' end ||
        case when v_pay > 0 then v_pay || ' buyer payment' || case when v_pay = 1 then '' else 's' end || ' overdue. ' else '' end ||
        case when m.role = 'owner' then 'For the whole company.' when m.role = 'manager' then 'You and your team.' else 'Open "Do now" to start.' end,
      case when v_pay > 0 and v_calls + v_vis + v_new = 0 then '/money' else '/dashboard' end);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.morning_digest() from public, anon, authenticated;

select 'patch-019 done';
