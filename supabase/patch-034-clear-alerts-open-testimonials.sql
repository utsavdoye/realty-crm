-- patch-034:
--  1. Clearer alerts: the title says WHAT the client did ("Rahul opened the brochure of Sumeet Urban Nest",
--     "Rahul wants a call on 22 Oct", "Rahul wants a site visit", ...) instead of "enquired again".
--     A brand-new client's "New lead" alert says it too.
--  2. Testimonials: anyone can write one from the website ("Share your experience"); it waits for an admin to approve.
-- Run after patch-033. Safe to run more than once.

create or replace function public.alert_title(p_name text, p_project text, p_message text) returns text
language sql immutable set search_path = public as $$
  select coalesce(nullif(trim(p_name), ''), 'A client') || case
    when m ~* '^(opened|asked for) the brochure' then ' opened the brochure' || coalesce(' of ' || pr, '')
    when m ~* '^(opened|asked for) the floor plans' then ' opened the floor plans' || coalesce(' of ' || pr, '')
    when m ~* '^opened this home' then ' is looking at ' || coalesce(pr, 'a home')
    when m ~* 'reschedule' then ' wants to reschedule the site visit' || coalesce(' at ' || pr, '')
    when m ~* '^quick appointment' then ' wants a call' || coalesce(' on ' || substring(m from 'on ([0-9]{1,2} [A-Za-z]{3})'), '')
    when m ~* 'site visit' then ' wants a site visit' || coalesce(' at ' || pr, '')
    when m ~* '^liked' then ' liked ' || coalesce(pr, 'a home')
    when m ~* '^opened the homes link' then ' opened the homes link you sent'
    when m ~* '^logged in' then ' logged in on the website'
    when m ~* 'verified their mobile' then ' verified their mobile number'
    when m = '' then ' enquired again' || coalesce(' about ' || pr, '')
    else ' sent a message' || coalesce(' about ' || pr, '')
  end
  from (select coalesce(trim(p_message), '') m, nullif(trim(p_project), '') pr) x
$$;

create or replace function public.ingest_lead(
  p_key text, p_name text, p_phone text, p_email text, p_city text, p_location text,
  p_budget_min numeric, p_budget_max numeric, p_bhk text, p_project text, p_message text, p_raw jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; v_phone text := public.normalize_phone(p_phone); v_lead public.leads%rowtype; v_src text;
        v_sell boolean := coalesce(p_message, '') ilike 'wants to sell%'; v_new boolean; v_title text; v_body text; u uuid;
begin
  if not public.is_service() then
    if not public.hit_ok('src:' || left(coalesce(p_key, ''), 64), interval '1 hour', 300) then return jsonb_build_object('ok', false, 'error', 'too_many'); end if;
    if length(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g')) >= 10 then
      if not public.hit_ok('srcp2:' || left(coalesce(p_key, ''), 64) || ':' || v_phone, interval '10 minutes', 6) then return jsonb_build_object('ok', true); end if;
      if not public.hit_ok('srcp:' || left(coalesce(p_key, ''), 64) || ':' || v_phone || ':' || md5(coalesce(p_project, '') || '|' || coalesce(p_message, '')), interval '2 minutes', 1) then
        return jsonb_build_object('ok', true);
      end if;
    end if;
  end if;
  r := public.ingest_lead_core(p_key, left(p_name, 120), p_phone, left(p_email, 200), left(p_city, 120), left(p_location, 200),
         p_budget_min, p_budget_max, left(p_bhk, 30), left(p_project, 200), left(p_message, 2000), p_raw);

  if coalesce((r ->> 'ok')::boolean, false) and (r ->> 'lead_id') is not null then
    select * into v_lead from public.leads where id = (r ->> 'lead_id')::uuid;
    v_new := coalesce((r ->> 'is_new')::boolean, false);
    select name into v_src from public.lead_sources where key = p_key;
    if found and (v_sell or not v_new) then
      if v_sell then
        v_title := v_lead.name || ' wants to SELL a property';
        v_body := concat_ws(' · ', nullif(trim(coalesce(p_location, p_city, '')), ''), nullif(trim(regexp_replace(p_message, '^wants to sell a property\.?\s*', '', 'i')), ''),
                            case when v_new then 'New client' else 'Already in your CRM' end,
                            case when nullif(trim(p_name), '') is not null and lower(trim(p_name)) <> lower(v_lead.name) then 'filled the form as ' || left(trim(p_name), 60) end, v_src);
      else
        v_title := public.alert_title(v_lead.name, p_project, p_message);
        v_body := concat_ws(' · ', nullif(left(trim(p_message), 160), ''), 'Already in your CRM', v_src);
      end if;
      -- the person handling the lead
      if v_lead.assigned_to is not null then
        perform public.notify(v_lead.org_id, v_lead.assigned_to, case when v_sell then 'seller' else 'enquiry' end, v_title, v_body, '/leads/' || v_lead.id);
      end if;
      -- admins / managers: always for sellers, and for repeat enquiries nobody is handling
      if v_sell or v_lead.assigned_to is null then
        for u in select m.user_id from public.members m where m.org_id = v_lead.org_id and m.active and m.role in ('owner', 'manager')
                   and m.user_id is distinct from v_lead.assigned_to loop
          perform public.notify(v_lead.org_id, u, case when v_sell then 'seller' else 'enquiry' end, v_title, v_body, '/leads/' || v_lead.id);
        end loop;
      end if;
      -- (a new client's "New lead" alert says what they did, see below)
      -- back on today's call list
      if not v_new then
        update public.leads set next_follow_up = least(coalesce(next_follow_up, now()), now()) where id = v_lead.id;
      end if;
    end if;
  end if;

  -- New client: the "New lead" alert (made a moment ago) also says what they did on the website.
  if coalesce((r ->> 'ok')::boolean, false) and coalesce((r ->> 'is_new')::boolean, false) and (r ->> 'lead_id') is not null and not v_sell then
    update public.notifications set title = 'New lead: ' || public.alert_title(v_lead.name, p_project, p_message),
      body = concat_ws(' · ', body, nullif(left(trim(p_message), 160), ''))
    where link = '/leads/' || (r ->> 'lead_id') and type = 'lead_assigned' and created_at > now() - interval '1 minute';
  end if;
  if public.is_service() or not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  return jsonb_build_object('ok', true);  -- browser callers get no names or numbers back
end $$;
revoke all on function public.ingest_lead(text, text, text, text, text, text, numeric, numeric, text, text, text, jsonb) from public;
grant execute on function public.ingest_lead(text, text, text, text, text, text, numeric, numeric, text, text, text, jsonb) to anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ingest_lead(text, text, text, text, text, text, numeric, numeric, text, text, text, jsonb) to service_role;
  end if;
end $$;

-- Website: "Share your experience" (no link needed). Waits for approval.
create or replace function public.site_testimonial_open(p_key text, p_name text, p_phone text, p_place text, p_rating int, p_body text) returns boolean
language plpgsql security definer set search_path = public as $$
declare s public.lead_sources%rowtype; v_phone text := public.normalize_phone(p_phone); v_lead uuid;
begin
  select * into s from public.lead_sources where key = p_key and active;
  if not found or not public.org_ok(s.org_id) then return false; end if;
  if length(trim(coalesce(p_name, ''))) < 2 or length(trim(coalesce(p_body, ''))) < 10 or p_rating not between 1 and 5 then return false; end if;
  if not public.hit_ok('testi:' || p_key, interval '1 hour', 30) then return false; end if;
  if v_phone is not null and not public.hit_ok('testip:' || v_phone, interval '1 day', 3) then return false; end if;
  if v_phone is not null then select id into v_lead from public.leads where org_id = s.org_id and phone = v_phone; end if;
  insert into public.testimonials (org_id, lead_id, name, place, rating, body, status, submitted_at)
  values (s.org_id, v_lead, left(trim(p_name), 80), left(nullif(trim(p_place), ''), 80), p_rating, left(trim(p_body), 1200), 'pending', now());
  if v_lead is not null then
    insert into public.activities (org_id, lead_id, type, body, by_user) values (s.org_id, v_lead, 'note', 'Wrote a testimonial on the website (' || p_rating || '/5). Waiting for approval.', null);
  end if;
  perform public.notify_managers(s.org_id, 'testimonial', 'New testimonial from ' || left(trim(p_name), 60), p_rating || '/5 · ' || left(trim(p_body), 100), '/website-clients#testimonials');
  return true;
end $$;
revoke all on function public.site_testimonial_open(text, text, text, text, int, text) from public;
grant execute on function public.site_testimonial_open(text, text, text, text, int, text) to anon, authenticated;

select 'patch-034 done';
