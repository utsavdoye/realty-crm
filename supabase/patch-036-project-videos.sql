-- patch-036: project videos (up to 5 per project, 10 MB in total) and videos on the client website.
-- Run after patch-035. Safe to run more than once.

-- 1. Where the videos are listed: [{ "url": "...", "size": 1234567, "name": "Walkthrough.mp4" }]
alter table public.projects add column if not exists videos jsonb not null default '[]'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'projects_videos_max') then
    alter table public.projects add constraint projects_videos_max check (jsonb_typeof(videos) = 'array' and jsonb_array_length(videos) <= 5);
  end if;
end $$;

-- 2. The file store takes videos too (each upload still at most 20 MB; the CRM keeps the total per project to 10 MB).
update storage.buckets set
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4', 'video/webm', 'video/quicktime']
where id = 'project-photos';

-- 3. The website gets the videos with each project.
create or replace function public.site_project_json(p public.projects) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'developer', p.developer, 'location', p.location, 'rera_no', p.rera_no,
    'type', p.type, 'configs', p.configs, 'price_from', p.price_from, 'status', p.status, 'possession', p.possession,
    'highlights', p.highlights, 'amenities', p.amenities, 'banks', p.banks,
    'size_from', p.size_from, 'size_to', p.size_to, 'lat', p.lat, 'lng', p.lng,
    'photos', coalesce(p.photos[1:20], '{}'), 'updated_at', p.updated_at, 'deal', p.deal,
    'videos', coalesce((select jsonb_agg(jsonb_build_object('url', v ->> 'url', 'name', v ->> 'name'))
                        from jsonb_array_elements(coalesce(p.videos, '[]'::jsonb)) v where v ->> 'url' like 'https://%'), '[]'::jsonb),
    'has_brochure', nullif(trim(coalesce(p.link, '')), '') is not null,
    'plan_count', jsonb_array_length(coalesce(p.floor_plans, '[]'::jsonb)),
    'votes', (select count(*) from public.project_votes v where v.project_id = p.id))
$$;
revoke all on function public.site_project_json(public.projects) from public, anon, authenticated;

select 'patch-036 done';
