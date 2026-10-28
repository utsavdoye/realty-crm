-- patch-041: Hindi copy of each project's details (filled automatically by the CRM) for the website's हिंदी mode.
alter table public.projects add column if not exists hi jsonb;      -- { location, type, configs, status, possession, amenities, highlights, towers, developer }
alter table public.projects add column if not exists hi_src text;   -- fingerprint of the English text it was made from
select 'patch-041 done';
