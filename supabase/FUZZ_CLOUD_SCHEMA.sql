-- Fuzz Cloud v1 database update
-- Run this once in the Supabase SQL Editor before changing Cloud settings in Fuzz Control.

alter table public.platform_settings
  add column if not exists cloud_enabled boolean not null default true;

alter table public.platform_settings
  add column if not exists cloud_owner_only boolean not null default true;

alter table public.platform_settings
  add column if not exists cloud_name text not null default 'Gaming PC';

alter table public.platform_settings
  add column if not exists cloud_base_url text not null
  default 'https://cloud.fuzzthehuzz-ebsfiygfhsvfbfesg.com';

alter table public.platform_settings
  add column if not exists cloud_node_id text not null
  default 'xYI8iExEHKURSJLbwLqMCfIqrVVO4mIFWvJ82@K$w2jpCUac92kJtgFgoxFsHBo1';

alter table public.platform_settings
  add column if not exists cloud_hide_ui boolean not null default true;

insert into public.platform_settings (id)
values (1)
on conflict (id) do nothing;

update public.platform_settings
set
  cloud_enabled = true,
  cloud_owner_only = true,
  cloud_name = coalesce(nullif(cloud_name, ''), 'Gaming PC'),
  cloud_base_url = coalesce(
    nullif(cloud_base_url, ''),
    'https://cloud.fuzzthehuzz-ebsfiygfhsvfbfesg.com'
  ),
  cloud_node_id = coalesce(
    nullif(cloud_node_id, ''),
    'xYI8iExEHKURSJLbwLqMCfIqrVVO4mIFWvJ82@K$w2jpCUac92kJtgFgoxFsHBo1'
  ),
  cloud_hide_ui = true,
  updated_at = now()
where id = 1;
