-- Fuzz Cloud: migrate the built-in Guacamole URL to noVNC.
-- Safe to run more than once. Custom Cloud hosts are left unchanged.

update public.platform_settings
set
  cloud_base_url = 'https://vnc.fuzzthehuzz-ebsfiygfhsvfbfesg.com',
  cloud_hide_ui = true
where id = 1
  and (
    cloud_base_url is null
    or cloud_base_url = ''
    or cloud_base_url like 'https://guac.fuzzthehuzz-ebsfiygfhsvfbfesg.com%'
    or cloud_base_url like 'https://cloud.fuzzthehuzz-ebsfiygfhsvfbfesg.com%'
  );
