-- Fuzz Cloud: Guacamole-only migration
alter table public.platform_settings
  add column if not exists cloud_base_url text not null
  default 'https://guac.fuzzthehuzz-ebsfiygfhsvfbfesg.com';

alter table public.platform_settings
  add column if not exists cloud_hide_ui boolean not null default true;

update public.platform_settings
set
  cloud_base_url = 'https://guac.fuzzthehuzz-ebsfiygfhsvfbfesg.com',
  cloud_hide_ui = true
where id = 1
  and (
    cloud_base_url is null
    or cloud_base_url = ''
    or cloud_base_url like '%cloud.fuzzthehuzz-ebsfiygfhsvfbfesg.com%'
    or cloud_base_url like '%mesh%'
  );
