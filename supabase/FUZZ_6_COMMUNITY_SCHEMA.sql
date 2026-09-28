-- FuzzTheHuzz 6.0 Community + Customization Schema
-- Run this AFTER FUZZ_STABILITY_SCHEMA.sql in Supabase SQL Editor.
-- Safe to run more than once.

begin;

create extension if not exists pgcrypto;

/* -------------------------------------------------------------------------- */
/* Personalization                                                            */
/* -------------------------------------------------------------------------- */

create table if not exists public.user_personalization (
  user_id uuid primary key references auth.users(id) on delete cascade,
  accent_color text not null default '#7c7cff',
  wallpaper_path text,
  wallpaper_external_url text,
  wallpaper_fit text not null default 'cover',
  wallpaper_position text not null default 'center',
  wallpaper_blur integer not null default 0,
  wallpaper_overlay numeric(4,3) not null default 0.420,
  surface_opacity numeric(4,3) not null default 0.780,
  border_radius integer not null default 18,
  font_scale numeric(4,3) not null default 1.000,
  sidebar_mode text not null default 'expanded',
  density text not null default 'comfortable',
  default_page text not null default '/',
  reduced_motion boolean not null default false,
  home_show_quick_links boolean not null default true,
  home_show_bookmarks boolean not null default true,
  home_show_recents boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_personalization add column if not exists accent_color text not null default '#7c7cff';
alter table public.user_personalization add column if not exists wallpaper_path text;
alter table public.user_personalization add column if not exists wallpaper_external_url text;
alter table public.user_personalization add column if not exists wallpaper_fit text not null default 'cover';
alter table public.user_personalization add column if not exists wallpaper_position text not null default 'center';
alter table public.user_personalization add column if not exists wallpaper_blur integer not null default 0;
alter table public.user_personalization add column if not exists wallpaper_overlay numeric(4,3) not null default 0.420;
alter table public.user_personalization add column if not exists surface_opacity numeric(4,3) not null default 0.780;
alter table public.user_personalization add column if not exists border_radius integer not null default 18;
alter table public.user_personalization add column if not exists font_scale numeric(4,3) not null default 1.000;
alter table public.user_personalization add column if not exists sidebar_mode text not null default 'expanded';
alter table public.user_personalization add column if not exists density text not null default 'comfortable';
alter table public.user_personalization add column if not exists default_page text not null default '/';
alter table public.user_personalization add column if not exists reduced_motion boolean not null default false;
alter table public.user_personalization add column if not exists home_show_quick_links boolean not null default true;
alter table public.user_personalization add column if not exists home_show_bookmarks boolean not null default true;
alter table public.user_personalization add column if not exists home_show_recents boolean not null default true;
alter table public.user_personalization add column if not exists created_at timestamptz not null default now();
alter table public.user_personalization add column if not exists updated_at timestamptz not null default now();

/* -------------------------------------------------------------------------- */
/* Community chat                                                             */
/* -------------------------------------------------------------------------- */

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('global', 'dm')),
  title text,
  dm_key text,
  created_by uuid references auth.users(id) on delete set null,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.chat_conversations add column if not exists type text;
alter table public.chat_conversations add column if not exists title text;
alter table public.chat_conversations add column if not exists dm_key text;
alter table public.chat_conversations add column if not exists created_by uuid;
alter table public.chat_conversations add column if not exists last_message_at timestamptz;
alter table public.chat_conversations add column if not exists created_at timestamptz not null default now();
alter table public.chat_conversations add column if not exists updated_at timestamptz not null default now();
create unique index if not exists chat_conversations_dm_key_uidx on public.chat_conversations(dm_key) where dm_key is not null;
create unique index if not exists chat_conversations_single_global_uidx on public.chat_conversations((type)) where type = 'global';
create index if not exists chat_conversations_last_message_idx on public.chat_conversations(last_message_at desc nulls last);

insert into public.chat_conversations(type, title)
select 'global', 'Everyone'
where not exists (select 1 from public.chat_conversations where type = 'global');

create table if not exists public.chat_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  muted boolean not null default false,
  archived boolean not null default false,
  primary key (conversation_id, user_id)
);

alter table public.chat_members add column if not exists joined_at timestamptz not null default now();
alter table public.chat_members add column if not exists last_read_at timestamptz;
alter table public.chat_members add column if not exists muted boolean not null default false;
alter table public.chat_members add column if not exists archived boolean not null default false;
create index if not exists chat_members_user_idx on public.chat_members(user_id, archived, joined_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '',
  reply_to uuid references public.chat_messages(id) on delete set null,
  attachment_path text,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.chat_messages add column if not exists conversation_id uuid;
alter table public.chat_messages add column if not exists sender_id uuid;
alter table public.chat_messages add column if not exists body text not null default '';
alter table public.chat_messages add column if not exists reply_to uuid;
alter table public.chat_messages add column if not exists attachment_path text;
alter table public.chat_messages add column if not exists edited_at timestamptz;
alter table public.chat_messages add column if not exists deleted_at timestamptz;
alter table public.chat_messages add column if not exists created_at timestamptz not null default now();
create index if not exists chat_messages_conversation_created_idx on public.chat_messages(conversation_id, created_at desc);
create index if not exists chat_messages_sender_created_idx on public.chat_messages(sender_id, created_at desc);

create table if not exists public.chat_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists chat_reactions_message_idx on public.chat_reactions(message_id);

create table if not exists public.chat_typing (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists chat_typing_updated_idx on public.chat_typing(conversation_id, updated_at desc);

create table if not exists public.chat_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
create index if not exists chat_presence_seen_idx on public.chat_presence(last_seen_at desc);

create table if not exists public.chat_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.chat_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  status text not null default 'open',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists chat_reports_status_idx on public.chat_reports(status, created_at desc);

/* -------------------------------------------------------------------------- */
/* Feedback and notifications                                                 */
/* -------------------------------------------------------------------------- */

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null default 'other',
  title text not null,
  description text not null,
  priority text not null default 'normal',
  status text not null default 'submitted',
  screenshot_path text,
  page_path text,
  browser text,
  operating_system text,
  user_agent text,
  assigned_to uuid references auth.users(id) on delete set null,
  internal_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.feedback add column if not exists category text not null default 'other';
alter table public.feedback add column if not exists title text;
alter table public.feedback add column if not exists description text;
alter table public.feedback add column if not exists priority text not null default 'normal';
alter table public.feedback add column if not exists status text not null default 'submitted';
alter table public.feedback add column if not exists screenshot_path text;
alter table public.feedback add column if not exists page_path text;
alter table public.feedback add column if not exists browser text;
alter table public.feedback add column if not exists operating_system text;
alter table public.feedback add column if not exists user_agent text;
alter table public.feedback add column if not exists assigned_to uuid;
alter table public.feedback add column if not exists internal_note text;
alter table public.feedback add column if not exists created_at timestamptz not null default now();
alter table public.feedback add column if not exists updated_at timestamptz not null default now();
create index if not exists feedback_user_updated_idx on public.feedback(user_id, updated_at desc);
create index if not exists feedback_status_updated_idx on public.feedback(status, updated_at desc);
create index if not exists feedback_category_idx on public.feedback(category, created_at desc);

create table if not exists public.feedback_comments (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  body text not null,
  is_staff boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists feedback_comments_feedback_idx on public.feedback_comments(feedback_id, created_at asc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_unread_idx on public.notifications(user_id, read_at, created_at desc);

/* -------------------------------------------------------------------------- */
/* Storage                                                                    */
/* -------------------------------------------------------------------------- */

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
  ('fuzz-wallpapers', 'fuzz-wallpapers', false, 5242880, array['image/png','image/jpeg','image/webp']),
  ('fuzz-chat', 'fuzz-chat', false, 8388608, array['image/png','image/jpeg','image/webp']),
  ('fuzz-feedback', 'fuzz-feedback', false, 8388608, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

/* -------------------------------------------------------------------------- */
/* Server-only access                                                         */
/* -------------------------------------------------------------------------- */

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'user_personalization',
    'chat_conversations',
    'chat_members',
    'chat_messages',
    'chat_reactions',
    'chat_typing',
    'chat_presence',
    'chat_blocks',
    'chat_reports',
    'feedback',
    'feedback_comments',
    'notifications'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end
$$;

grant usage on schema public to service_role;
grant all privileges on table
  public.user_personalization,
  public.chat_conversations,
  public.chat_members,
  public.chat_messages,
  public.chat_reactions,
  public.chat_typing,
  public.chat_presence,
  public.chat_blocks,
  public.chat_reports,
  public.feedback,
  public.feedback_comments,
  public.notifications
to service_role;
grant usage, select on all sequences in schema public to service_role;

commit;
