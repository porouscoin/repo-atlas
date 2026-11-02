-- Repo Atlas cache: one row per cached map, history, tour or file summary.
create table if not exists atlas_cache (
  key text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table atlas_cache enable row level security;
-- No policies: only the service role key (used by the backend) can read or write.
