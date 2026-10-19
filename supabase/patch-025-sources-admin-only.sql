-- patch-025: Lead sources (portal links, website settings, form keys) are for admins only, not managers.
-- Safe to run more than once.
drop policy if exists src_select on public.lead_sources;
create policy src_select on public.lead_sources for select using (public.is_owner(org_id));
drop policy if exists src_insert on public.lead_sources;
create policy src_insert on public.lead_sources for insert with check (public.can_use(org_id) and public.is_owner(org_id));
drop policy if exists src_update on public.lead_sources;
create policy src_update on public.lead_sources for update using (public.is_owner(org_id)) with check (public.is_owner(org_id));
drop policy if exists src_delete on public.lead_sources;
create policy src_delete on public.lead_sources for delete using (public.is_owner(org_id));
select 'patch-025 done';
