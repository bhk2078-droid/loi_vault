-- Run this in the Supabase SQL Editor after migration-002.
-- Adds per-transaction row hiding, and lets the app clean up storage
-- when a transaction is deleted. Safe to run more than once.

-- Rows removed from a transaction's trail, shared across the team.
alter table deals
  add column if not exists hidden_rows jsonb default '[]'::jsonb;

-- Deleting a deal cascades to loi_versions already; the uploaded files in
-- Storage need their own delete policy or they'd be orphaned forever.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'loi_files_delete'
  ) then
    create policy "loi_files_delete" on storage.objects for delete
      using (
        bucket_id = 'loi-files'
        and auth.role() = 'authenticated'
        and split_part(name, '/', 1) = auth_email_domain()
      );
  end if;
end $$;
