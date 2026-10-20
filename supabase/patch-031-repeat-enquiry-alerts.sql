-- patch-031: an enquiry from someone who is ALREADY a lead now gives a fresh (unread) alert, instead of only a line in the timeline.
--   * "Wants to SELL" (website "Tell us a little about you" → sell): alert to the person handling the lead AND to every admin / manager,
--     whether the client is new or old. Title: "<name> wants to SELL a property".
--   * Any other repeat enquiry (website, portals, forms): "<name> enquired again" to the person handling the lead
--     (to admins / managers if nobody has the lead).
--   * The lead comes back on today's call list.
-- Run after patch-020. Safe to run more than once.

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
        v_title := v_lead.name || ' enquired again';
        v_body := concat_ws(' · ', nullif(trim(p_project), ''), nullif(left(trim(p_message), 140), ''), v_src);
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
      -- back on today's call list
      if not v_new then
        update public.leads set next_follow_up = least(coalesce(next_follow_up, now()), now()) where id = v_lead.id;
      end if;
    end if;
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

-- Lets the CRM's "System check" (Lead sources page) see which updates are in place. Server only.
create or replace function public.setup_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'realtime', coalesce((select jsonb_agg(tablename) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'), '[]'::jsonb),
    'repeat_alerts', exists (select 1 from pg_proc where proname = 'ingest_lead' and prosrc like '%wants to sell%'))
$$;
revoke all on function public.setup_status() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.setup_status() to service_role; end if;
end $$;

select 'patch-031 done';
