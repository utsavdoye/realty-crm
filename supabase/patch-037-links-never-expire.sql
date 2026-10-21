-- patch-037: team and invite links never expire.
--  * Personal invite links: no 7-day limit any more (they still work only once, and only for the invited email / mobile).
--  * The team join link never had a time limit; it only stops if an admin turns it off.
-- Run after patch-036. Safe to run more than once.

alter table public.invites alter column expires_at set default 'infinity';
update public.invites set expires_at = 'infinity' where accepted_at is null and expires_at <> 'infinity';

select 'patch-037 done';
