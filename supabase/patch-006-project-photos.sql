-- ============================================================
-- Patch 006 — photos for projects
-- Run once in Supabase → SQL Editor (after patch-005). Safe to run again.
-- ============================================================

alter table public.projects add column if not exists photos text[] not null default '{}';

-- A public folder for project photos. Each company uploads into its own sub-folder (named by its id).
-- Only the owner or a manager of that company can add or delete photos. Anyone with the link can view (they are brochure photos).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-photos', 'project-photos', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 8388608, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create or replace function public.photo_folder_org(p_name text) returns uuid
language plpgsql immutable as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end $$;

drop policy if exists project_photos_insert on storage.objects;
create policy project_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'project-photos' and public.is_manager(public.photo_folder_org(name)) and public.org_ok(public.photo_folder_org(name)));

drop policy if exists project_photos_delete on storage.objects;
create policy project_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'project-photos' and public.is_manager(public.photo_folder_org(name)));
