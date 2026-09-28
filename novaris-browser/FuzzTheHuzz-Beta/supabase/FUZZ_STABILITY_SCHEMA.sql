-- FuzzTheHuzz v5.4 Stability Schema
-- Run this entire file in the Supabase SQL Editor as a project owner.
-- It is designed to be safe to run more than once.

begin;

create extension if not exists pgcrypto;

/* -------------------------------------------------------------------------- */
/* Core account data                                                          */
/* -------------------------------------------------------------------------- */

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  role text not null default 'user',
  banned boolean not null default false,
  suspended_until timestamptz,
  suspension_reason text,
  suspended_at timestamptz,
  suspended_by uuid,
  suspension_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles add column if not exists banned boolean not null default false;
alter table public.profiles add column if not exists suspended_until timestamptz;
alter table public.profiles add column if not exists suspension_reason text;
alter table public.profiles add column if not exists suspended_at timestamptz;
alter table public.profiles add column if not exists suspended_by uuid;
alter table public.profiles add column if not exists suspension_source text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Repair blank or duplicated legacy usernames before enforcing uniqueness.
update public.profiles
   set username = 'user_' || replace(substr(id::text, 1, 12), '-', '')
 where username is null or btrim(username) = '';

with ranked as (
  select id, username,
         row_number() over (partition by lower(username) order by created_at asc nulls last, id asc) as duplicate_number
    from public.profiles
)
update public.profiles p
   set username = left(coalesce(nullif(btrim(p.username), ''), 'user'), 10)
                  || '_' || replace(substr(p.id::text, 1, 8), '-', ''),
       updated_at = now()
  from ranked r
 where p.id = r.id and r.duplicate_number > 1;

alter table public.profiles alter column username set not null;
create unique index if not exists profiles_id_uidx on public.profiles(id);
create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username));
create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_suspended_until_idx on public.profiles(suspended_until);

-- Restore a server profile for any existing Supabase Auth user that does not
-- already have one. The generated username is deterministic and collision-safe.
insert into public.profiles (id, username, role, banned, created_at, updated_at)
select
  u.id,
  'user_' || replace(substr(u.id::text, 1, 12), '-', ''),
  'user',
  false,
  coalesce(u.created_at, now()),
  now()
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- If a project has users but no owner, promote the oldest profile. This only
-- runs when absolutely no owner exists and never demotes an existing owner.
do $$
begin
  if exists (select 1 from public.profiles)
     and not exists (select 1 from public.profiles where role = 'owner') then
    update public.profiles
       set role = 'owner', updated_at = now()
     where id = (
       select id from public.profiles order by created_at asc nulls last, id asc limit 1
     );
  end if;
end
$$;

create table if not exists public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  used boolean not null default false,
  used_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.invite_codes add column if not exists id uuid not null default gen_random_uuid();
alter table public.invite_codes add column if not exists code text;
create unique index if not exists invite_codes_id_uidx on public.invite_codes(id);
alter table public.invite_codes add column if not exists used boolean not null default false;
alter table public.invite_codes add column if not exists used_by uuid;
alter table public.invite_codes add column if not exists created_at timestamptz not null default now();
create unique index if not exists invite_codes_code_uidx on public.invite_codes(code);
create index if not exists invite_codes_used_idx on public.invite_codes(used, created_at desc);
create index if not exists invite_codes_used_by_idx on public.invite_codes(used_by);

/* -------------------------------------------------------------------------- */
/* AI conversations                                                           */
/* -------------------------------------------------------------------------- */

create table if not exists public.ai_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_chats add column if not exists id uuid not null default gen_random_uuid();
alter table public.ai_chats add column if not exists user_id uuid;
create unique index if not exists ai_chats_id_uidx on public.ai_chats(id);
alter table public.ai_chats add column if not exists title text not null default 'New chat';
alter table public.ai_chats add column if not exists created_at timestamptz not null default now();
alter table public.ai_chats add column if not exists updated_at timestamptz not null default now();
create index if not exists ai_chats_user_updated_idx on public.ai_chats(user_id, updated_at desc);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.ai_chats(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  content text not null default '',
  has_image boolean not null default false,
  image_name text,
  created_at timestamptz not null default now()
);

alter table public.ai_messages add column if not exists id uuid not null default gen_random_uuid();
alter table public.ai_messages add column if not exists chat_id uuid;
create unique index if not exists ai_messages_id_uidx on public.ai_messages(id);
alter table public.ai_messages add column if not exists user_id uuid;
alter table public.ai_messages add column if not exists role text;
alter table public.ai_messages add column if not exists content text not null default '';
alter table public.ai_messages add column if not exists has_image boolean not null default false;
alter table public.ai_messages add column if not exists image_name text;
alter table public.ai_messages add column if not exists created_at timestamptz not null default now();
create index if not exists ai_messages_chat_created_idx on public.ai_messages(chat_id, created_at asc);
create index if not exists ai_messages_user_created_idx on public.ai_messages(user_id, created_at desc);

/* -------------------------------------------------------------------------- */
/* Preferences, Apps and Bookmarks                                            */
/* -------------------------------------------------------------------------- */

create table if not exists public.account_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  announcements_enabled boolean not null default true,
  retain_proxy_history boolean not null default true,
  default_proxy_engine text not null default 'google',
  proxy_technology text not null default 'scramjet',
  ai_behavior text not null default 'balanced',
  reduced_motion boolean not null default false,
  appearance text not null default 'space',
  updated_at timestamptz not null default now()
);

alter table public.account_preferences add column if not exists user_id uuid;
create unique index if not exists account_preferences_user_uidx on public.account_preferences(user_id);
alter table public.account_preferences add column if not exists announcements_enabled boolean not null default true;
alter table public.account_preferences add column if not exists retain_proxy_history boolean not null default true;
alter table public.account_preferences add column if not exists default_proxy_engine text not null default 'google';
alter table public.account_preferences add column if not exists proxy_technology text not null default 'scramjet';
alter table public.account_preferences add column if not exists ai_behavior text not null default 'balanced';
alter table public.account_preferences add column if not exists reduced_motion boolean not null default false;
alter table public.account_preferences add column if not exists appearance text not null default 'space';
alter table public.account_preferences add column if not exists updated_at timestamptz not null default now();

create table if not exists public.account_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  favorites jsonb not null default '[]'::jsonb,
  recent jsonb not null default '[]'::jsonb,
  open_counts jsonb not null default '{}'::jsonb,
  custom_apps jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.account_app_state add column if not exists user_id uuid;
create unique index if not exists account_app_state_user_uidx on public.account_app_state(user_id);
alter table public.account_app_state add column if not exists favorites jsonb not null default '[]'::jsonb;
alter table public.account_app_state add column if not exists recent jsonb not null default '[]'::jsonb;
alter table public.account_app_state add column if not exists open_counts jsonb not null default '{}'::jsonb;
alter table public.account_app_state add column if not exists custom_apps jsonb not null default '[]'::jsonb;
alter table public.account_app_state add column if not exists updated_at timestamptz not null default now();

create table if not exists public.user_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  url text not null,
  engine text not null default 'scramjet',
  pinned boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_bookmarks add column if not exists id uuid not null default gen_random_uuid();
create unique index if not exists user_bookmarks_id_uidx on public.user_bookmarks(id);
alter table public.user_bookmarks add column if not exists user_id uuid;
alter table public.user_bookmarks add column if not exists title text;
alter table public.user_bookmarks add column if not exists url text;
alter table public.user_bookmarks add column if not exists engine text not null default 'scramjet';
alter table public.user_bookmarks add column if not exists pinned boolean not null default false;
alter table public.user_bookmarks add column if not exists position integer not null default 0;
alter table public.user_bookmarks add column if not exists created_at timestamptz not null default now();
alter table public.user_bookmarks add column if not exists updated_at timestamptz not null default now();
create unique index if not exists user_bookmarks_user_url_uidx on public.user_bookmarks(user_id, url);
create index if not exists user_bookmarks_user_order_idx on public.user_bookmarks(user_id, pinned desc, position asc, updated_at desc);

/* -------------------------------------------------------------------------- */
/* Platform controls and announcements                                        */
/* -------------------------------------------------------------------------- */

create table if not exists public.platform_settings (
  id integer primary key default 1,
  maintenance_enabled boolean not null default false,
  maintenance_message text not null default 'Fuzz is temporarily undergoing maintenance. Please check back soon.',
  maintenance_end_at timestamptz,
  allow_admin_bypass boolean not null default true,
  ai_enabled boolean not null default true,
  proxy_enabled boolean not null default true,
  apps_enabled boolean not null default true,
  games_enabled boolean not null default true,
  registrations_enabled boolean not null default true,
  image_uploads_enabled boolean not null default true,
  cloud_enabled boolean not null default true,
  cloud_owner_only boolean not null default true,
  cloud_name text not null default 'Gaming PC',
  cloud_base_url text not null default 'https://cloud.fuzzthehuzz-ebsfiygfhsvfbfesg.com',
  cloud_node_id text not null default 'xYI8iExEHKURSJLbwLqMCfIqrVVO4mIFWvJ82@K$w2jpCUac92kJtgFgoxFsHBo1',
  cloud_hide_ui boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.platform_settings add column if not exists id integer not null default 1;
create unique index if not exists platform_settings_id_uidx on public.platform_settings(id);
alter table public.platform_settings add column if not exists maintenance_enabled boolean not null default false;
alter table public.platform_settings add column if not exists maintenance_message text not null default 'Fuzz is temporarily undergoing maintenance. Please check back soon.';
alter table public.platform_settings add column if not exists maintenance_end_at timestamptz;
alter table public.platform_settings add column if not exists allow_admin_bypass boolean not null default true;
alter table public.platform_settings add column if not exists ai_enabled boolean not null default true;
alter table public.platform_settings add column if not exists proxy_enabled boolean not null default true;
alter table public.platform_settings add column if not exists apps_enabled boolean not null default true;
alter table public.platform_settings add column if not exists games_enabled boolean not null default true;
alter table public.platform_settings add column if not exists registrations_enabled boolean not null default true;
alter table public.platform_settings add column if not exists image_uploads_enabled boolean not null default true;
alter table public.platform_settings add column if not exists cloud_enabled boolean not null default true;
alter table public.platform_settings add column if not exists cloud_owner_only boolean not null default true;
alter table public.platform_settings add column if not exists cloud_name text not null default 'Gaming PC';
alter table public.platform_settings add column if not exists cloud_base_url text not null default 'https://cloud.fuzzthehuzz-ebsfiygfhsvfbfesg.com';
alter table public.platform_settings add column if not exists cloud_node_id text not null default 'xYI8iExEHKURSJLbwLqMCfIqrVVO4mIFWvJ82@K$w2jpCUac92kJtgFgoxFsHBo1';
alter table public.platform_settings add column if not exists cloud_hide_ui boolean not null default true;
alter table public.platform_settings add column if not exists updated_by uuid;
alter table public.platform_settings add column if not exists updated_at timestamptz not null default now();

insert into public.platform_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  style text not null default 'info',
  audience text not null default 'all',
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  dismissible boolean not null default true,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.announcements add column if not exists id uuid not null default gen_random_uuid();
create unique index if not exists announcements_id_uidx on public.announcements(id);
alter table public.announcements add column if not exists title text;
alter table public.announcements add column if not exists message text;
alter table public.announcements add column if not exists style text not null default 'info';
alter table public.announcements add column if not exists audience text not null default 'all';
alter table public.announcements add column if not exists starts_at timestamptz not null default now();
alter table public.announcements add column if not exists expires_at timestamptz;
alter table public.announcements add column if not exists dismissible boolean not null default true;
alter table public.announcements add column if not exists active boolean not null default true;
alter table public.announcements add column if not exists created_by uuid;
alter table public.announcements add column if not exists created_at timestamptz not null default now();
alter table public.announcements add column if not exists updated_at timestamptz not null default now();
create index if not exists announcements_active_schedule_idx on public.announcements(active, starts_at, expires_at);

/* -------------------------------------------------------------------------- */
/* Activity and security                                                      */
/* -------------------------------------------------------------------------- */

create table if not exists public.activity_logs (
  id bigint generated by default as identity primary key,
  user_id uuid,
  actor_user_id uuid,
  target_user_id uuid,
  category text,
  action text not null,
  status text,
  description text,
  resource_type text,
  resource_id text,
  request_method text,
  request_path text,
  response_status integer,
  duration_ms integer,
  ip_address text,
  user_agent text,
  browser text,
  operating_system text,
  device_type text,
  proxy_query text,
  proxy_target_url text,
  proxy_target_domain text,
  proxy_engine text,
  chat_id text,
  message_id text,
  ai_model text,
  message_role text,
  message_length integer,
  prompt_preview text,
  had_image boolean,
  image_name text,
  output_length integer,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  old_values jsonb,
  new_values jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.activity_logs add column if not exists id bigint generated by default as identity;
create unique index if not exists activity_logs_id_uidx on public.activity_logs(id);
alter table public.activity_logs add column if not exists user_id uuid;
alter table public.activity_logs add column if not exists actor_user_id uuid;
alter table public.activity_logs add column if not exists target_user_id uuid;
alter table public.activity_logs add column if not exists category text;
alter table public.activity_logs add column if not exists action text;
alter table public.activity_logs add column if not exists status text;
alter table public.activity_logs add column if not exists description text;
alter table public.activity_logs add column if not exists resource_type text;
alter table public.activity_logs add column if not exists resource_id text;
alter table public.activity_logs add column if not exists request_method text;
alter table public.activity_logs add column if not exists request_path text;
alter table public.activity_logs add column if not exists response_status integer;
alter table public.activity_logs add column if not exists duration_ms integer;
alter table public.activity_logs add column if not exists ip_address text;
alter table public.activity_logs add column if not exists user_agent text;
alter table public.activity_logs add column if not exists browser text;
alter table public.activity_logs add column if not exists operating_system text;
alter table public.activity_logs add column if not exists device_type text;
alter table public.activity_logs add column if not exists proxy_query text;
alter table public.activity_logs add column if not exists proxy_target_url text;
alter table public.activity_logs add column if not exists proxy_target_domain text;
alter table public.activity_logs add column if not exists proxy_engine text;
alter table public.activity_logs add column if not exists chat_id text;
alter table public.activity_logs add column if not exists message_id text;
alter table public.activity_logs add column if not exists ai_model text;
alter table public.activity_logs add column if not exists message_role text;
alter table public.activity_logs add column if not exists message_length integer;
alter table public.activity_logs add column if not exists prompt_preview text;
alter table public.activity_logs add column if not exists had_image boolean;
alter table public.activity_logs add column if not exists image_name text;
alter table public.activity_logs add column if not exists output_length integer;
alter table public.activity_logs add column if not exists input_tokens integer;
alter table public.activity_logs add column if not exists output_tokens integer;
alter table public.activity_logs add column if not exists total_tokens integer;
alter table public.activity_logs add column if not exists old_values jsonb;
alter table public.activity_logs add column if not exists new_values jsonb;
alter table public.activity_logs add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.activity_logs add column if not exists created_at timestamptz not null default now();
create index if not exists activity_logs_user_created_idx on public.activity_logs(user_id, created_at desc);
create index if not exists activity_logs_action_created_idx on public.activity_logs(action, created_at desc);
create index if not exists activity_logs_category_created_idx on public.activity_logs(category, created_at desc);
create index if not exists activity_logs_target_created_idx on public.activity_logs(target_user_id, created_at desc);

create table if not exists public.user_security_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_token_hash text not null unique,
  device_hash text,
  ip_address text,
  user_agent text,
  browser text,
  operating_system text,
  device_type text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.user_security_sessions add column if not exists id uuid not null default gen_random_uuid();
create unique index if not exists user_security_sessions_id_uidx on public.user_security_sessions(id);
alter table public.user_security_sessions add column if not exists user_id uuid;
alter table public.user_security_sessions add column if not exists session_token_hash text;
alter table public.user_security_sessions add column if not exists device_hash text;
alter table public.user_security_sessions add column if not exists ip_address text;
alter table public.user_security_sessions add column if not exists user_agent text;
alter table public.user_security_sessions add column if not exists browser text;
alter table public.user_security_sessions add column if not exists operating_system text;
alter table public.user_security_sessions add column if not exists device_type text;
alter table public.user_security_sessions add column if not exists first_seen_at timestamptz not null default now();
alter table public.user_security_sessions add column if not exists last_seen_at timestamptz not null default now();
alter table public.user_security_sessions add column if not exists expires_at timestamptz;
alter table public.user_security_sessions add column if not exists revoked_at timestamptz;
alter table public.user_security_sessions add column if not exists revoke_reason text;
alter table public.user_security_sessions add column if not exists metadata jsonb not null default '{}'::jsonb;
create unique index if not exists user_security_sessions_token_uidx on public.user_security_sessions(session_token_hash);
create index if not exists user_security_sessions_user_seen_idx on public.user_security_sessions(user_id, last_seen_at desc);
create index if not exists user_security_sessions_device_idx on public.user_security_sessions(user_id, device_hash);

create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null,
  severity text not null default 'info',
  title text not null,
  message text not null,
  target_user_id uuid,
  resource_type text,
  resource_id text,
  dedupe_key text,
  occurrence_count integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_occurred_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.admin_notifications add column if not exists id uuid not null default gen_random_uuid();
create unique index if not exists admin_notifications_id_uidx on public.admin_notifications(id);
alter table public.admin_notifications add column if not exists notification_type text;
alter table public.admin_notifications add column if not exists severity text not null default 'info';
alter table public.admin_notifications add column if not exists title text;
alter table public.admin_notifications add column if not exists message text;
alter table public.admin_notifications add column if not exists target_user_id uuid;
alter table public.admin_notifications add column if not exists resource_type text;
alter table public.admin_notifications add column if not exists resource_id text;
alter table public.admin_notifications add column if not exists dedupe_key text;
alter table public.admin_notifications add column if not exists occurrence_count integer not null default 1;
alter table public.admin_notifications add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.admin_notifications add column if not exists created_at timestamptz not null default now();
alter table public.admin_notifications add column if not exists last_occurred_at timestamptz not null default now();
alter table public.admin_notifications add column if not exists resolved_at timestamptz;
create index if not exists admin_notifications_open_idx on public.admin_notifications(resolved_at, last_occurred_at desc);
create index if not exists admin_notifications_dedupe_idx on public.admin_notifications(dedupe_key, last_occurred_at desc);

create table if not exists public.admin_notification_states (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.admin_notifications(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz,
  dismissed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(notification_id, admin_user_id)
);

alter table public.admin_notification_states add column if not exists id uuid not null default gen_random_uuid();
create unique index if not exists admin_notification_states_id_uidx on public.admin_notification_states(id);
alter table public.admin_notification_states add column if not exists notification_id uuid;
alter table public.admin_notification_states add column if not exists admin_user_id uuid;
alter table public.admin_notification_states add column if not exists read_at timestamptz;
alter table public.admin_notification_states add column if not exists dismissed_at timestamptz;
alter table public.admin_notification_states add column if not exists updated_at timestamptz not null default now();
create unique index if not exists admin_notification_states_pair_uidx on public.admin_notification_states(notification_id, admin_user_id);

/* -------------------------------------------------------------------------- */
/* Account deletion                                                           */
/* -------------------------------------------------------------------------- */

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  cancelled_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.account_deletion_requests add column if not exists id uuid not null default gen_random_uuid();
create unique index if not exists account_deletion_requests_id_uidx on public.account_deletion_requests(id);
alter table public.account_deletion_requests add column if not exists user_id uuid;
alter table public.account_deletion_requests add column if not exists reason text;
alter table public.account_deletion_requests add column if not exists status text not null default 'pending';
alter table public.account_deletion_requests add column if not exists requested_at timestamptz not null default now();
alter table public.account_deletion_requests add column if not exists cancelled_at timestamptz;
alter table public.account_deletion_requests add column if not exists reviewed_at timestamptz;
alter table public.account_deletion_requests add column if not exists reviewed_by uuid;
alter table public.account_deletion_requests add column if not exists updated_at timestamptz not null default now();
create index if not exists account_deletion_requests_user_idx on public.account_deletion_requests(user_id, requested_at desc);
create unique index if not exists account_deletion_requests_one_pending_uidx
  on public.account_deletion_requests(user_id)
  where status = 'pending';

/* -------------------------------------------------------------------------- */
/* Usage limits                                                               */
/* A value of 0 means unlimited.                                              */
/* -------------------------------------------------------------------------- */

create table if not exists public.usage_policies (
  role text primary key,
  ai_messages_daily integer not null default 0,
  ai_images_daily integer not null default 0,
  proxy_requests_minute integer not null default 0,
  proxy_requests_daily integer not null default 0,
  violation_window_minutes integer not null default 60,
  auto_suspend_after_violations integer not null default 0,
  auto_suspend_minutes integer not null default 60,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.usage_policies add column if not exists role text;
create unique index if not exists usage_policies_role_uidx on public.usage_policies(role);
alter table public.usage_policies add column if not exists ai_messages_daily integer not null default 0;
alter table public.usage_policies add column if not exists ai_images_daily integer not null default 0;
alter table public.usage_policies add column if not exists proxy_requests_minute integer not null default 0;
alter table public.usage_policies add column if not exists proxy_requests_daily integer not null default 0;
alter table public.usage_policies add column if not exists violation_window_minutes integer not null default 60;
alter table public.usage_policies add column if not exists auto_suspend_after_violations integer not null default 0;
alter table public.usage_policies add column if not exists auto_suspend_minutes integer not null default 60;
alter table public.usage_policies add column if not exists updated_by uuid;
alter table public.usage_policies add column if not exists updated_at timestamptz not null default now();

insert into public.usage_policies (role)
values ('user'), ('moderator'), ('admin'), ('owner')
on conflict (role) do nothing;

create table if not exists public.user_usage_overrides (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ai_messages_daily integer,
  ai_images_daily integer,
  proxy_requests_minute integer,
  proxy_requests_daily integer,
  auto_suspend_after_violations integer,
  auto_suspend_minutes integer,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.user_usage_overrides add column if not exists user_id uuid;
create unique index if not exists user_usage_overrides_user_uidx on public.user_usage_overrides(user_id);
alter table public.user_usage_overrides add column if not exists ai_messages_daily integer;
alter table public.user_usage_overrides add column if not exists ai_images_daily integer;
alter table public.user_usage_overrides add column if not exists proxy_requests_minute integer;
alter table public.user_usage_overrides add column if not exists proxy_requests_daily integer;
alter table public.user_usage_overrides add column if not exists auto_suspend_after_violations integer;
alter table public.user_usage_overrides add column if not exists auto_suspend_minutes integer;
alter table public.user_usage_overrides add column if not exists updated_by uuid;
alter table public.user_usage_overrides add column if not exists updated_at timestamptz not null default now();

create table if not exists public.usage_events (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_type text not null,
  amount integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.usage_events add column if not exists id bigint generated by default as identity;
create unique index if not exists usage_events_id_uidx on public.usage_events(id);
alter table public.usage_events add column if not exists user_id uuid;
alter table public.usage_events add column if not exists usage_type text;
alter table public.usage_events add column if not exists amount integer not null default 1;
alter table public.usage_events add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.usage_events add column if not exists created_at timestamptz not null default now();
create index if not exists usage_events_user_type_created_idx on public.usage_events(user_id, usage_type, created_at desc);

create or replace function public.fuzz_consume_usage(
  p_user_id uuid,
  p_role text,
  p_ai_messages integer default 0,
  p_ai_images integer default 0,
  p_proxy_requests integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_day_start timestamptz := (date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC');
  v_role text;
  v_policy public.usage_policies%rowtype;
  v_override public.user_usage_overrides%rowtype;
  v_ai_messages integer := greatest(coalesce(p_ai_messages, 0), 0);
  v_ai_images integer := greatest(coalesce(p_ai_images, 0), 0);
  v_proxy_requests integer := greatest(coalesce(p_proxy_requests, 0), 0);
  v_ai_messages_limit integer := 0;
  v_ai_images_limit integer := 0;
  v_proxy_minute_limit integer := 0;
  v_proxy_daily_limit integer := 0;
  v_violation_window integer := 60;
  v_suspend_after integer := 0;
  v_suspend_minutes integer := 60;
  v_ai_messages_used integer := 0;
  v_ai_images_used integer := 0;
  v_proxy_minute_used integer := 0;
  v_proxy_daily_used integer := 0;
  v_blocked_type text := null;
  v_limit integer := 0;
  v_used integer := 0;
  v_requested integer := 0;
  v_retry_after integer := null;
  v_violation_count integer := 0;
  v_auto_suspended boolean := false;
  v_suspended_until timestamptz := null;
  v_earliest timestamptz := null;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  -- Serialize usage decisions for the same user to prevent concurrent requests
  -- from racing past the configured limit.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  v_role := case lower(coalesce(p_role, 'user'))
    when 'owner' then 'owner'
    when 'admin' then 'admin'
    when 'moderator' then 'moderator'
    else 'user'
  end;

  select * into v_policy
    from public.usage_policies
   where role = v_role
   limit 1;

  if not found then
    select * into v_policy
      from public.usage_policies
     where role = 'user'
     limit 1;
  end if;

  select * into v_override
    from public.user_usage_overrides
   where user_id = p_user_id
   limit 1;

  v_ai_messages_limit := greatest(coalesce(v_override.ai_messages_daily, v_policy.ai_messages_daily, 0), 0);
  v_ai_images_limit := greatest(coalesce(v_override.ai_images_daily, v_policy.ai_images_daily, 0), 0);
  v_proxy_minute_limit := greatest(coalesce(v_override.proxy_requests_minute, v_policy.proxy_requests_minute, 0), 0);
  v_proxy_daily_limit := greatest(coalesce(v_override.proxy_requests_daily, v_policy.proxy_requests_daily, 0), 0);
  v_violation_window := greatest(coalesce(v_policy.violation_window_minutes, 60), 1);
  v_suspend_after := greatest(coalesce(v_override.auto_suspend_after_violations, v_policy.auto_suspend_after_violations, 0), 0);
  v_suspend_minutes := greatest(coalesce(v_override.auto_suspend_minutes, v_policy.auto_suspend_minutes, 60), 1);

  select coalesce(sum(amount), 0)::integer into v_ai_messages_used
    from public.usage_events
   where user_id = p_user_id
     and usage_type = 'ai_message'
     and created_at >= v_day_start;

  select coalesce(sum(amount), 0)::integer into v_ai_images_used
    from public.usage_events
   where user_id = p_user_id
     and usage_type = 'ai_image'
     and created_at >= v_day_start;

  select coalesce(sum(amount), 0)::integer into v_proxy_daily_used
    from public.usage_events
   where user_id = p_user_id
     and usage_type = 'proxy_request'
     and created_at >= v_day_start;

  select coalesce(sum(amount), 0)::integer into v_proxy_minute_used
    from public.usage_events
   where user_id = p_user_id
     and usage_type = 'proxy_request'
     and created_at >= v_now - interval '1 minute';

  if v_ai_messages > 0
     and v_ai_messages_limit > 0
     and v_ai_messages_used + v_ai_messages > v_ai_messages_limit then
    v_blocked_type := 'ai_messages_daily';
    v_limit := v_ai_messages_limit;
    v_used := v_ai_messages_used;
    v_requested := v_ai_messages;
  elsif v_ai_images > 0
     and v_ai_images_limit > 0
     and v_ai_images_used + v_ai_images > v_ai_images_limit then
    v_blocked_type := 'ai_images_daily';
    v_limit := v_ai_images_limit;
    v_used := v_ai_images_used;
    v_requested := v_ai_images;
  elsif v_proxy_requests > 0
     and v_proxy_minute_limit > 0
     and v_proxy_minute_used + v_proxy_requests > v_proxy_minute_limit then
    v_blocked_type := 'proxy_requests_minute';
    v_limit := v_proxy_minute_limit;
    v_used := v_proxy_minute_used;
    v_requested := v_proxy_requests;
  elsif v_proxy_requests > 0
     and v_proxy_daily_limit > 0
     and v_proxy_daily_used + v_proxy_requests > v_proxy_daily_limit then
    v_blocked_type := 'proxy_requests_daily';
    v_limit := v_proxy_daily_limit;
    v_used := v_proxy_daily_used;
    v_requested := v_proxy_requests;
  end if;

  if v_blocked_type is not null then
    insert into public.usage_events(user_id, usage_type, amount, metadata, created_at)
    values (
      p_user_id,
      'limit_violation',
      1,
      jsonb_build_object(
        'blockedType', v_blocked_type,
        'limit', v_limit,
        'used', v_used,
        'requested', v_requested,
        'role', v_role
      ),
      v_now
    );

    select count(*)::integer into v_violation_count
      from public.usage_events
     where user_id = p_user_id
       and usage_type = 'limit_violation'
       and created_at >= v_now - make_interval(mins => v_violation_window);

    if v_blocked_type = 'proxy_requests_minute' then
      select min(created_at) into v_earliest
        from public.usage_events
       where user_id = p_user_id
         and usage_type = 'proxy_request'
         and created_at >= v_now - interval '1 minute';

      if v_earliest is null then
        v_retry_after := 60;
      else
        v_retry_after := greatest(
          1,
          ceil(60 - extract(epoch from (v_now - v_earliest)))::integer
        );
      end if;
    else
      v_retry_after := greatest(
        1,
        ceil(extract(epoch from (
          ((date_trunc('day', v_now at time zone 'UTC') + interval '1 day') at time zone 'UTC') - v_now
        )))::integer
      );
    end if;

    if v_suspend_after > 0 and v_violation_count >= v_suspend_after then
      v_auto_suspended := true;
      v_suspended_until := v_now + make_interval(mins => v_suspend_minutes);

      update public.profiles
         set suspended_until = v_suspended_until,
             suspension_reason = 'Automatically suspended after repeated usage-limit violations.',
             suspended_at = v_now,
             suspended_by = null,
             suspension_source = 'automatic_usage_limit',
             updated_at = v_now
       where id = p_user_id;
    end if;

    return jsonb_build_object(
      'allowed', false,
      'blockedType', v_blocked_type,
      'limit', v_limit,
      'used', v_used,
      'remaining', greatest(v_limit - v_used, 0),
      'retryAfterSeconds', v_retry_after,
      'violationCount', v_violation_count,
      'autoSuspended', v_auto_suspended,
      'suspendedUntil', case when v_suspended_until is null then null else to_jsonb(v_suspended_until) end
    );
  end if;

  if v_ai_messages > 0 then
    insert into public.usage_events(user_id, usage_type, amount, metadata, created_at)
    values (p_user_id, 'ai_message', v_ai_messages, jsonb_build_object('role', v_role), v_now);
  end if;

  if v_ai_images > 0 then
    insert into public.usage_events(user_id, usage_type, amount, metadata, created_at)
    values (p_user_id, 'ai_image', v_ai_images, jsonb_build_object('role', v_role), v_now);
  end if;

  if v_proxy_requests > 0 then
    insert into public.usage_events(user_id, usage_type, amount, metadata, created_at)
    values (p_user_id, 'proxy_request', v_proxy_requests, jsonb_build_object('role', v_role), v_now);
  end if;

  return jsonb_build_object(
    'allowed', true,
    'role', v_role,
    'remaining', jsonb_build_object(
      'aiMessagesDaily', case when v_ai_messages_limit = 0 then null else greatest(v_ai_messages_limit - v_ai_messages_used - v_ai_messages, 0) end,
      'aiImagesDaily', case when v_ai_images_limit = 0 then null else greatest(v_ai_images_limit - v_ai_images_used - v_ai_images, 0) end,
      'proxyRequestsMinute', case when v_proxy_minute_limit = 0 then null else greatest(v_proxy_minute_limit - v_proxy_minute_used - v_proxy_requests, 0) end,
      'proxyRequestsDaily', case when v_proxy_daily_limit = 0 then null else greatest(v_proxy_daily_limit - v_proxy_daily_used - v_proxy_requests, 0) end
    )
  );
end;
$$;

/* -------------------------------------------------------------------------- */
/* Server-only access                                                         */
/* -------------------------------------------------------------------------- */

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles',
    'invite_codes',
    'ai_chats',
    'ai_messages',
    'account_preferences',
    'account_app_state',
    'user_bookmarks',
    'platform_settings',
    'announcements',
    'activity_logs',
    'user_security_sessions',
    'admin_notifications',
    'admin_notification_states',
    'account_deletion_requests',
    'usage_policies',
    'user_usage_overrides',
    'usage_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end
$$;

revoke all on function public.fuzz_consume_usage(uuid, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.fuzz_consume_usage(uuid, text, integer, integer, integer) to service_role;
grant usage on schema public to service_role;
grant all privileges on table
  public.profiles,
  public.invite_codes,
  public.ai_chats,
  public.ai_messages,
  public.account_preferences,
  public.account_app_state,
  public.user_bookmarks,
  public.platform_settings,
  public.announcements,
  public.activity_logs,
  public.user_security_sessions,
  public.admin_notifications,
  public.admin_notification_states,
  public.account_deletion_requests,
  public.usage_policies,
  public.user_usage_overrides,
  public.usage_events
to service_role;
grant usage, select on all sequences in schema public to service_role;

commit;

-- Optional: create a first unused invite code after the migration.
-- Replace the value before running this separate statement:
-- insert into public.invite_codes(code) values ('YOUR-PRIVATE-INVITE-CODE');
