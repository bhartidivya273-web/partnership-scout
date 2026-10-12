-- The one table the app needs: a shared cache, the saved last real result and the refresh lock.
-- Row level security is on with no policies, so only the server's service key can read or write it.
create table if not exists public.scout_cache (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.scout_cache enable row level security;
revoke all on public.scout_cache from anon, authenticated;

create index if not exists scout_cache_expires_idx on public.scout_cache (expires_at);
