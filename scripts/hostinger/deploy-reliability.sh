#!/bin/sh
# Run only after both exact images have passed isolated tests. Never initializes data.
set -eu
release=${1:?Provide tested release tag}
previous=${2:?Provide expected live application tag}
source_dir=${3:?Provide absolute extracted release source directory}
commit=${4:?Provide full tested source commit}
case "$release:$previous" in *[!a-zA-Z0-9:._-]*) exit 2;; esac
test "${#commit}" = 40
case "$commit" in *[!a-f0-9]*) exit 2;; esac
test "$(realpath "$source_dir")" = "/opt/atacadoapple/release-$release"
cd /opt/atacadoapple/live
test "$(pwd -P)" = /opt/atacadoapple/live
test -f data/pdv.sqlite
test -f "$source_dir/deploy/hostinger/compose.yaml"
test "$(docker inspect --format='{{.Config.Image}}' atacadoapple-app)" = "atacadoapple:$previous"
test "$(docker inspect --format='{{.State.Health.Status}}' atacadoapple-app)" = healthy
test "$(docker inspect --format='{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' atacadoapple-app)" = /opt/atacadoapple/live/data
docker image inspect "atacadoapple:$release" >/dev/null
docker image inspect "atacadoapple-ocr:$release" >/dev/null
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "atacadoapple:$release")" = "$commit"
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "atacadoapple-ocr:$release")" = "$commit"
test ! -e ".env.pre-$release"
test ! -e "compose.yaml.pre-$release"
systemctl start atacadoapple-backup.service
test "$(systemctl show atacadoapple-backup.service -p Result --value)" = success
test "$(systemctl show atacadoapple-backup.service -p ExecMainStatus --value)" = 0
docker exec atacadoapple-app node --input-type=module -e 'import fs from "node:fs"; const s=JSON.parse(fs.readFileSync("/data/backups/last-success.json")); const t=s.completedAt??s.capturedAt; if(!Number.isFinite(t)||t<=0||t>Date.now()+60000||Date.now()-t>300000)process.exit(1);'
cp -p .env ".env.pre-$release"
cp -p compose.yaml "compose.yaml.pre-$release"
systemctl stop atacadoapple-backup.timer
config_started=0
rollback() {
  trap - EXIT
  cp -p ".env.pre-$release" .env
  cp -p "compose.yaml.pre-$release" compose.yaml
  docker compose -p atacadoapple --env-file .env up -d --no-deps app
  systemctl start atacadoapple-backup.timer
  restored=0
  for attempt in $(seq 1 50); do
    if test "$(docker inspect --format='{{.State.Health.Status}}' atacadoapple-app)" = healthy; then restored=1; break; fi
    sleep 1
  done
  test "$restored" = 1 || { echo 'Rollback health needs operator attention; data retained.'; exit 1; }
  echo 'Previous application healthy. Additive table, production records and files retained.'
  exit 1
}
trap 'status=$?; if test "$status" -ne 0 && test "$config_started" = 1; then rollback; fi; systemctl start atacadoapple-backup.timer' EXIT
# Online SQLite backup + additive migration; never replays historical seeds.
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --mount type=bind,source=/opt/atacadoapple/live/data,target=/data --entrypoint node "atacadoapple:$release" scripts/hostinger/apply-receipt-migration.mjs /data/pdv.sqlite
config_started=1
cp "$source_dir/deploy/hostinger/compose.yaml" compose.yaml
sed -i "s/^PDV_IMAGE=.*/PDV_IMAGE=atacadoapple:$release/" .env
if grep -q '^PDV_OCR_IMAGE=' .env; then
  sed -i "s/^PDV_OCR_IMAGE=.*/PDV_OCR_IMAGE=atacadoapple-ocr:$release/" .env
else
  printf '\nPDV_OCR_IMAGE=atacadoapple-ocr:%s\n' "$release" >> .env
fi
docker compose -p atacadoapple --env-file .env config --quiet || rollback
docker compose -p atacadoapple --env-file .env up -d receipt-engine || rollback
engine=$(docker compose -p atacadoapple --env-file .env ps -q receipt-engine)
healthy=0
for attempt in $(seq 1 40); do
  if test "$(docker inspect --format='{{.State.Health.Status}}' "$engine")" = healthy; then healthy=1; break; fi
  sleep 1
done
test "$healthy" = 1 || rollback
docker compose -p atacadoapple --env-file .env up -d --no-deps app || rollback
healthy=0
for attempt in $(seq 1 50); do
  if test "$(docker inspect --format='{{.State.Health.Status}}' atacadoapple-app)" = healthy && curl -fsS --max-time 3 http://127.0.0.1:3108/api/health >/dev/null; then healthy=1; break; fi
  sleep 1
done
test "$healthy" = 1 || rollback
test "$(docker inspect --format='{{.Config.Image}}' atacadoapple-app)" = "atacadoapple:$release" || rollback
test "$(docker inspect --format='{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' atacadoapple-app)" = /opt/atacadoapple/live/data || rollback
docker exec atacadoapple-app node -e 'fetch("http://receipt-engine:3001/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' || rollback
curl -fsS --max-time 15 https://atacadoapple.nucleodeoperacao.com.br/api/health || rollback
echo 'Application and isolated receipt engine healthy; existing data retained.'
