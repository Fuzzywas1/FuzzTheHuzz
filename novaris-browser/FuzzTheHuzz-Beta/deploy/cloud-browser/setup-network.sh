#!/usr/bin/env bash
# Run as root on the dedicated Linux Docker host. No changes to other bridges.
set -euo pipefail
test "$(id -u)" = 0 || { echo 'Run with sudo.' >&2; exit 1; }
command -v docker >/dev/null
command -v iptables >/dev/null
iptables -nL DOCKER-USER >/dev/null 2>&1 || {
  echo 'Docker must use its iptables firewall backend with a DOCKER-USER chain.' >&2
  exit 1
}
if ! docker network inspect novaris-browsers >/dev/null 2>&1; then
  docker network create --driver bridge --subnet 172.30.88.0/24 \
    --opt com.docker.network.bridge.name=novaris-br \
    --opt com.docker.network.bridge.enable_icc=false novaris-browsers
fi
bridge=$(docker network inspect --format '{{index .Options "com.docker.network.bridge.name"}}' novaris-browsers)
test "$bridge" = novaris-br || { echo 'Unexpected browser bridge configuration.' >&2; exit 1; }

# Install DROP first so rebuilding our chain never opens browser egress.
iptables -I DOCKER-USER 1 -i novaris-br -m comment --comment novaris-setup-lock -j DROP
iptables -N NOVARIS-BROWSER 2>/dev/null || true
iptables -F NOVARIS-BROWSER
# Browser sessions may reach the public internet, but not peers, the host, LAN,
# link-local metadata endpoints, multicast, or other non-public IPv4 ranges.
for cidr in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 \
  172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.168.0.0/16 198.18.0.0/15 \
  198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do
  iptables -A NOVARIS-BROWSER -d "$cidr" -j REJECT
done
iptables -A NOVARIS-BROWSER -j RETURN
iptables -C DOCKER-USER -i novaris-br -j NOVARIS-BROWSER 2>/dev/null || \
  iptables -A DOCKER-USER -i novaris-br -j NOVARIS-BROWSER
# Move our filter before Docker's usual final RETURN rule.
iptables -D DOCKER-USER -i novaris-br -j NOVARIS-BROWSER
iptables -I DOCKER-USER 2 -i novaris-br -j NOVARIS-BROWSER
# Replies to host-initiated reverse-proxy requests are allowed; new sessions
# initiated from a browser container toward any host interface are denied.
iptables -C INPUT -i novaris-br -j DROP 2>/dev/null || iptables -I INPUT 1 -i novaris-br -j DROP
iptables -C INPUT -i novaris-br -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || \
  iptables -I INPUT 1 -i novaris-br -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -D DOCKER-USER -i novaris-br -m comment --comment novaris-setup-lock -j DROP
echo 'Novaris browser network rules installed. Keep these rules active whenever browsers run.'
