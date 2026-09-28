-- Apply before deploying the Cloud Gaming foundation. Safe to re-run.
-- Kept separate from profiles so existing profile-update policies cannot grant access.
begin;
create table if not exists public.cloud_gaming_permissions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.cloud_gaming_permissions enable row level security;
-- Only the trusted backend may read/write; end users cannot self-grant via Supabase.
revoke all on table public.cloud_gaming_permissions from public, anon, authenticated;
grant select, insert, update, delete on table public.cloud_gaming_permissions to service_role;
commit;
