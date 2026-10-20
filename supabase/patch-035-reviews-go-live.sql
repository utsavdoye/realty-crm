-- patch-035: real reviews go on the website by themselves.
--   * From the "write a testimonial" link the team sends after a deal → shown at once.
--   * From "Share your experience" on the website, by a mobile number that is already a client in your CRM → shown at once.
--   * From an unknown number → waits for an admin (Website clients → Testimonials), so strangers cannot post.
-- An admin can still hide any testimonial. Run after patch-034. Safe to run more than once.

create or replace function public.site_testimonial_submit(p_token text, p_name text, p_place text, p_rating int, p_body text) returns boolean
language plpgsql security definer set search_path = public as $$
declare t public.testimonials%rowtype;
begin
  if p_token !~ '^[a-f0-9]{32}$' or length(trim(coalesce(p_body, ''))) < 10 or p_rating not between 1 and 5 then return false; end if;
  select * into t from public.testimonials where token = p_token and status = 'asked' and created_at > now() - interval '365 days';
  if not found then return false; end if;
  update public.testimonials set name = left(coalesce(nullif(trim(p_name), ''), name), 80), place = left(nullif(trim(p_place), ''), 80),
    rating = p_rating, body = left(trim(p_body), 1200), status = 'approved', submitted_at = now() where id = t.id;
  if t.lead_id is not null then
    insert into public.activities (org_id, lead_id, type, body, by_user) values (t.org_id, t.lead_id, 'note', 'Wrote a testimonial (' || p_rating || '/5). It is on the website now.', null);
  end if;
  perform public.notify_managers(t.org_id, 'testimonial', 'New testimonial on your website from ' || coalesce(nullif(trim(p_name), ''), t.name, 'a client'),
    p_rating || '/5 · ' || left(trim(p_body), 100), '/website-clients#testimonials');
  return true;
end $$;
revoke all on function public.site_testimonial_submit(text, text, text, int, text) from public;
grant execute on function public.site_testimonial_submit(text, text, text, int, text) to anon, authenticated;

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
  values (s.org_id, v_lead, left(trim(p_name), 80), left(nullif(trim(p_place), ''), 80), p_rating, left(trim(p_body), 1200), case when v_lead is not null then 'approved' else 'pending' end, now());
  if v_lead is not null then
    insert into public.activities (org_id, lead_id, type, body, by_user) values (s.org_id, v_lead, 'note', 'Wrote a testimonial on the website (' || p_rating || '/5). It is on the website now.', null);
  end if;
  perform public.notify_managers(s.org_id, 'testimonial', case when v_lead is not null then 'New testimonial on your website from ' else 'Testimonial waiting for you to check, from ' end || left(trim(p_name), 60), p_rating || '/5 · ' || left(trim(p_body), 100), '/website-clients#testimonials');
  return true;
end $$;
revoke all on function public.site_testimonial_open(text, text, text, text, int, text) from public;
grant execute on function public.site_testimonial_open(text, text, text, text, int, text) to anon, authenticated;

select 'patch-035 done';
