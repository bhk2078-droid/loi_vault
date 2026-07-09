-- LOI Vault — Supabase schema
-- Paste this entire file into the Supabase SQL Editor and click Run.
--
-- Hierarchy: buildings -> deals (transactions) -> loi_versions (rounds).
-- Every row is scoped to the email domain of the person who created it,
-- so the whole firm sees the same buildings and nobody else does.

-- ============================================================
-- Tables
-- ============================================================

create table if not exists buildings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  workspace_domain text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  building_id uuid references buildings(id) on delete cascade,
  name text not null,
  tenant text,
  landlord text,
  suite text,
  status text default 'Negotiating' check (status in ('Negotiating','Out for signature','Executed','Dead')),
  workspace_domain text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists loi_versions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id) on delete cascade,
  version_number int not null,
  -- Column header info for the trail, e.g. "LL Proposal"
  round_label text,
  party text,
  -- 'upload' = extracted from a document; 'manual' = a position we drafted
  -- (e.g. "LL Suggested Counter"), which has no file behind it.
  source text default 'upload' check (source in ('upload','manual')),
  -- Date printed in the column header — the date of the proposal itself,
  -- not the day someone got around to uploading it.
  document_date date,
  -- Free-text overrides keyed by trail row id, for composed rows like
  -- "Premises" and for hand-written cells in a suggested-counter column.
  cell_overrides jsonb default '{}'::jsonb,
  uploaded_by uuid references auth.users(id),
  uploaded_by_email text,
  uploaded_at timestamptz default now(),
  file_url text,
  file_name text,
  extracted_json jsonb not null,
  change_summary text
);

create index if not exists deals_building_idx on deals(building_id);
create index if not exists loi_versions_deal_idx on loi_versions(deal_id, version_number);
create unique index if not exists loi_versions_deal_version_uniq on loi_versions(deal_id, version_number);

-- ============================================================
-- Row Level Security — users only see rows in their email domain
-- ============================================================

alter table buildings enable row level security;
alter table deals enable row level security;
alter table loi_versions enable row level security;

create or replace function auth_email_domain() returns text
language sql stable as $$
  select split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 2)
$$;

create policy "buildings_select" on buildings for select
  using (workspace_domain = auth_email_domain());
create policy "buildings_insert" on buildings for insert
  with check (workspace_domain = auth_email_domain());
create policy "buildings_update" on buildings for update
  using (workspace_domain = auth_email_domain());
create policy "buildings_delete" on buildings for delete
  using (workspace_domain = auth_email_domain());

create policy "workspace_select" on deals for select
  using (workspace_domain = auth_email_domain());
create policy "workspace_insert" on deals for insert
  with check (workspace_domain = auth_email_domain());
create policy "workspace_update" on deals for update
  using (workspace_domain = auth_email_domain());
create policy "workspace_delete" on deals for delete
  using (workspace_domain = auth_email_domain());

create policy "versions_select" on loi_versions for select
  using (exists (select 1 from deals d where d.id = deal_id and d.workspace_domain = auth_email_domain()));
create policy "versions_insert" on loi_versions for insert
  with check (exists (select 1 from deals d where d.id = deal_id and d.workspace_domain = auth_email_domain()));
create policy "versions_update" on loi_versions for update
  using (exists (select 1 from deals d where d.id = deal_id and d.workspace_domain = auth_email_domain()));
create policy "versions_delete" on loi_versions for delete
  using (exists (select 1 from deals d where d.id = deal_id and d.workspace_domain = auth_email_domain()));

-- ============================================================
-- Storage bucket for uploaded LOI files (private)
-- Files stored as: <domain>/<building_id>/<deal_id>/<timestamp>-<filename>
-- The leading domain segment is what the policies below enforce.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('loi-files', 'loi-files', false)
on conflict (id) do nothing;

create policy "loi_files_insert" on storage.objects for insert
  with check (
    bucket_id = 'loi-files'
    and auth.role() = 'authenticated'
    and split_part(name, '/', 1) = auth_email_domain()
  );

create policy "loi_files_select" on storage.objects for select
  using (
    bucket_id = 'loi-files'
    and auth.role() = 'authenticated'
    and split_part(name, '/', 1) = auth_email_domain()
  );
