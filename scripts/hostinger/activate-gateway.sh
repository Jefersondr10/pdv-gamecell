#!/bin/sh
set -eu
cd /docker/infra-gateway
test "$(sha256sum docker-compose.yml | cut -d ' ' -f 1)" = 40dbf7d467a0efcb6013dd8107895997d72e267641558563bf0693163249b1ae
test "$(sha256sum .env | cut -d ' ' -f 1)" = b3f3f6ab29b53922efebeb4ea33c929c85b75c78823c682ef78080d1485ac1be
test ! -e /opt/atacadoapple/gateway-before-activation
mkdir -m 700 /opt/atacadoapple/gateway-before-activation
cp docker-compose.yml .env /opt/atacadoapple/gateway-before-activation/
docker cp infra-gateway-caddy-1:/etc/caddy/Caddyfile /opt/atacadoapple/gateway-before-activation/Caddyfile
chmod 600 /opt/atacadoapple/gateway-pdv.Caddyfile /opt/atacadoapple/.env.gateway-pdv
docker cp /opt/atacadoapple/gateway-pdv.Caddyfile infra-gateway-caddy-1:/etc/caddy/Caddyfile.pdv
docker exec infra-gateway-caddy-1 caddy validate --config /etc/caddy/Caddyfile.pdv --adapter caddyfile
cp /opt/atacadoapple/gateway-compose-pdv.yaml docker-compose.yml
cp /opt/atacadoapple/.env.gateway-pdv .env
docker cp /opt/atacadoapple/gateway-pdv.Caddyfile infra-gateway-caddy-1:/etc/caddy/Caddyfile
docker exec infra-gateway-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
printf 'PDV routes added through graceful gateway reload. Existing routes preserved.\n'
