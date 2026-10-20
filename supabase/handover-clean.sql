-- HANDOVER CLEAN-UP — removes all test / working data from the CRM before handing it over.
--
-- KEEPS:  the company and its settings, the CRM logins (Team page), projects with photos, floor plans,
--         brochures and flats/prices, lead sources (website + portals keep working), message templates.
-- DELETES: every lead and everything about leads (calls, notes, journey steps, visits, alerts, shortlists),
--          deals, payments and money entries, website accounts / saved homes / likes, testimonials,
--          project matches, the deleted-leads log, pending invites, and lead counters.
--
-- THIS CANNOT BE UNDONE. Take a backup first: Supabase → Database → Backups (or Table editor → export).
--
-- HOW TO RUN (Supabase → SQL Editor):
--   1. Run STEP 1 alone and read the numbers.
--   2. Run STEP 2 (the whole block from "begin;" to "commit;").
--   3. Run STEP 1 again: every count should be 0 except the "kept" rows.

-- ===================== STEP 1: look first (changes nothing) =====================
select 'KEPT  logins (Team page)' as what, count(*)::text as how_many from public.members where active
union all select 'KEPT  projects', count(*)::text from public.projects
union all select 'KEPT  flats / prices', count(*)::text from public.project_units
union all select 'KEPT  lead sources', count(*)::text from public.lead_sources
union all select 'DELETE leads', count(*)::text from public.leads
union all select 'DELETE calls / notes / history', count(*)::text from public.activities
union all select 'DELETE visits', count(*)::text from public.visits
union all select 'DELETE alerts', count(*)::text from public.notifications
union all select 'DELETE shortlists', count(*)::text from public.shortlists
union all select 'DELETE deals', count(*)::text from public.deals
union all select 'DELETE money entries', count(*)::text from public.money_entries
union all select 'DELETE website accounts', count(*)::text from public.website_clients
union all select 'DELETE saved homes', count(*)::text from public.website_saves
union all select 'DELETE likes', count(*)::text from public.project_votes
union all select 'DELETE testimonials', count(*)::text from public.testimonials
union all select 'DELETE deleted-leads log', count(*)::text from public.deleted_leads;
-- who stays (check these are the right people):
select m.full_name, m.role, m.phone from public.members m where m.active order by m.role, m.full_name;


-- ===================== STEP 2: clean (run this whole block) =====================
begin;

-- leads and everything hanging off them
delete from public.website_saves;
delete from public.website_clients;
delete from public.testimonials;
delete from public.shortlists;
delete from public.project_matches;
delete from public.dup_ignored;
delete from public.deal_installments;
delete from public.money_entries;
delete from public.deals;
delete from public.visits;
delete from public.lead_steps;
delete from public.lead_people;
delete from public.activities;
delete from public.leads;
delete from public.deleted_leads;          -- the "bring back" log (filled by the line above)

-- website activity
delete from public.project_votes;

-- alerts, rate-limit counters, old invites and join requests
delete from public.notifications;
delete from public.public_hits;
delete from public.invites;
delete from public.join_requests;

-- counters back to zero
update public.lead_sources set lead_count = 0, last_lead_at = null;

commit;
