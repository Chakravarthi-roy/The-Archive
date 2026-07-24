-- ============================================================
-- The Archive — Supabase schema
-- Run this once in your Supabase project's SQL Editor
-- (Project → SQL Editor → New query → paste → Run)
-- ============================================================

-- 1. PEOPLE
create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  img text,
  created_at timestamptz default now()
);

-- 2. LINKS (belongs to a person)
create table if not exists links (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id) on delete cascade,
  badge text,          -- 'Video' | 'Post' | 'Article'
  title text not null,
  meta text,
  url text,
  created_at timestamptz default now()
);

-- 3. PDFS (belongs to a person; actual file lives in Storage, this just tracks metadata)
create table if not exists pdfs (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id) on delete cascade,
  name text not null,
  size text,
  storage_path text,   -- path inside the 'pdfs' storage bucket (for uploads)
  url text,            -- OR an external URL (e.g. seeded from data.json)
  created_at timestamptz default now()
);

-- 4. NOTES (markdown text entries, belongs to a person)
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz default now()
);

-- ============================================================
-- Row Level Security
-- This is a single-user personal app with no login system, so we
-- allow the public "anon" key full read/write access to these
-- tables. Anyone who has your anon key (visible in your site's
-- source code) could read/write this data — acceptable for a
-- personal project, but don't put anything sensitive in here.
-- ============================================================
alter table people enable row level security;
alter table links  enable row level security;
alter table pdfs   enable row level security;
alter table notes  enable row level security;

create policy "public full access" on people for all using (true) with check (true);
create policy "public full access" on links  for all using (true) with check (true);
create policy "public full access" on pdfs   for all using (true) with check (true);
create policy "public full access" on notes  for all using (true) with check (true);

-- ============================================================
-- Storage buckets (run these, or create via Dashboard → Storage → New bucket)
-- Both public so pdf.js / <img> tags can load files directly by URL.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('pdfs', 'pdfs', true)
on conflict (id) do nothing;

create policy "public read avatars" on storage.objects for select using (bucket_id = 'avatars');
create policy "public upload avatars" on storage.objects for insert with check (bucket_id = 'avatars');

create policy "public read pdfs" on storage.objects for select using (bucket_id = 'pdfs');
create policy "public upload pdfs" on storage.objects for insert with check (bucket_id = 'pdfs');