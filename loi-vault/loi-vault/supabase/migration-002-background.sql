-- Run this in the Supabase SQL Editor if you already ran migration.sql.
-- Adds the two columns the background extraction flow needs.
-- Safe to run more than once.

alter table loi_versions
  add column if not exists status text default 'ready',
  add column if not exists error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'loi_versions_status_chk'
  ) then
    alter table loi_versions
      add constraint loi_versions_status_chk
      check (status in ('processing','ready','failed'));
  end if;
end $$;

-- Any rows created before this migration are, by definition, finished.
update loi_versions set status = 'ready' where status is null;
