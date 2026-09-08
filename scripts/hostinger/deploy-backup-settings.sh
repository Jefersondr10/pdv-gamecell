#!/bin/sh
# Uses an already completed scheduled backup; never initiates an off-site copy.
set -eu
release=${1:?Provide tested application tag}
previous=${2:?Provide expected live application tag}
commit=${3:?Provide exact tested full source revision}
case "$release:$previous" in *[!a-zA-Z0-9:._-]*) exit 2;; esac
test "${#commit}" = 40
case "$commit" in *[!a-f0-9]*) exit 2;; esac
cd /opt/atacadoapple/live
test "$(pwd -P)" = /opt/atacadoapple/live
test "$(docker inspect --format '{{.Config.Image}}' atacadoapple-app)" = "atacadoapple:$previous"
test "$(docker inspect --format '{{.State.Health.Status}}' atacadoapple-app)" = healthy
test "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' atacadoapple-app)" = /opt/atacadoapple/live/data
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "atacadoapple:$release")" = "$commit"
systemctl is-active --quiet atacadoapple-backup.timer
test "$(grep -c '^PDV_IMAGE=' .env)" = 1
test "$(sed -n 's/^PDV_IMAGE=//p' .env)" = "atacadoapple:$previous"
# Pause only the timer during the short container replacement. Never start a backup.
# A service already in progress is left alone, and this deployment aborts.
rollback_needed=0
cleanup() {
  status=$1
  trap - EXIT
  # Cleanup must reach timer restoration even if a rollback command fails.
  set +e
  if test "$status" -ne 0 && test "$rollback_needed" = 1; then
    restored=0
    if cp -p ".env.pre-$release" .env && docker compose -p atacadoapple --env-file .env up -d --no-deps app; then
      for attempt in $(seq 1 50); do
        if test "$(docker inspect --format '{{.State.Health.Status}}' atacadoapple-app)" = healthy && test "$(docker inspect --format '{{.Config.Image}}' atacadoapple-app)" = "atacadoapple:$previous"; then restored=1; break; fi
        sleep 1
      done
    fi
    if test "$restored" = 1; then
      echo 'Previous app healthy; additive settings table and current data retained.'
    else
      echo 'Rollback health requires attention. Current data retained.'
    fi
  fi
  systemctl start atacadoapple-backup.timer || { echo 'Backup timer requires attention.'; exit 1; }
  exit "$status"
}
trap 'cleanup "$?"' EXIT
systemctl stop atacadoapple-backup.timer
test "$(systemctl show atacadoapple-backup.service -p ActiveState --value)" = inactive
test "$(systemctl show atacadoapple-backup.service -p Result --value)" = success
docker exec atacadoapple-app node --input-type=module -e 'import fs from "node:fs"; const s=JSON.parse(fs.readFileSync("/data/backups/last-success.json")); const t=s.completedAt??s.capturedAt; if(!Number.isFinite(t)||t<=0||t>Date.now()+60000||Date.now()-t>=5400000)process.exit(1); console.log("Existing scheduled backup is recent. No backup initiated.");'
test ! -e ".env.pre-$release"
cp -p .env ".env.pre-$release"
# Makes only an on-server online SQLite safety copy before additive SQL.
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --mount type=bind,source=/opt/atacadoapple/live/data,target=/data --entrypoint node "atacadoapple:$release" scripts/hostinger/apply-client-identity-migration.mjs /data/pdv.sqlite
rollback_needed=1
sed -i "s/^PDV_IMAGE=.*/PDV_IMAGE=atacadoapple:$release/" .env
docker compose -p atacadoapple --env-file .env up -d --no-deps app
healthy=0
for attempt in $(seq 1 50); do
  if test "$(docker inspect --format '{{.State.Health.Status}}' atacadoapple-app)" = healthy; then healthy=1; break; fi
  sleep 1
done
test "$healthy" = 1
test "$(docker inspect --format '{{.Config.Image}}' atacadoapple-app)" = "atacadoapple:$release"
test "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' atacadoapple-app)" = /opt/atacadoapple/live/data
curl -fsS --max-time 15 https://atacadoapple.nucleodeoperacao.com.br/api/health
docker exec atacadoapple-app node -e 'fetch("http://receipt-engine:3001/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
echo 'Settings release healthy. OCR and scheduled backup configuration unchanged.'
