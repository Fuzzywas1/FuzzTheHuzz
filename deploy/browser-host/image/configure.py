"""Keep the upstream browser restrictions while enabling durable per-user profiles."""
import json
from pathlib import Path

policy_file = Path('/etc/chromium/policies/managed/policies.json')
policy = json.loads(policy_file.read_text())
policy.update({
    'DefaultCookiesSetting': 1,
    'EditBookmarksEnabled': True,
    'BookmarkBarEnabled': True,
    'SavingBrowserHistoryDisabled': False,
    'ClearBrowsingDataOnExitList': [],
    'URLAllowlist': [],
    'URLBlocklist': ['file://*', 'chrome://policy', 'chrome://extensions', 'chrome://flags', 'chrome://net-export'],
    'ProxySettings': {'ProxyMode': 'fixed_servers', 'ProxyServer': 'http://127.0.0.1:8888', 'ProxyBypassList': '<-loopback>'},
    'QuicAllowed': False,
    'WebRtcIPHandling': 'disable_non_proxied_udp',
})
policy_file.write_text(json.dumps(policy, indent=2))
preferences_file = Path('/home/neko/.config/chromium/Default/Preferences')
preferences = json.loads(preferences_file.read_text())
preferences['profile']['default_content_setting_values']['cookies'] = 1
preferences['custom_links'] = {'initialized': False, 'list': []}
preferences_file.write_text(json.dumps(preferences))
supervisor = Path('/etc/neko/supervisord/chromium.conf')
supervisor.write_text(supervisor.read_text().replace(' --bwsi', ''))
