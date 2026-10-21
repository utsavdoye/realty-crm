-- patch-038: inventory from a live sheet link (Google Sheets / Excel link).
-- The CRM reads the sheet when someone presses "Sync now", when a project is saved, and by itself
-- when someone opens the CRM (at most once every few minutes per project).
-- Run after patch-037. Safe to run more than once.

alter table public.projects add column if not exists inventory_url text;
alter table public.projects add column if not exists inventory_synced_at timestamptz;
alter table public.projects add column if not exists inventory_sync_started_at timestamptz;
alter table public.projects add column if not exists inventory_sync_error text;

select 'patch-038 done';
