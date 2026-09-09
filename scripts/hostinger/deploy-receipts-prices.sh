#!/bin/sh
# Publish a tested app/OCR pair. Keep current data on rollback; no off-site copy.
set -eu
release=${1:?Provide tested release tag}
previous=${2:?Provide expected live app tag}
previous_ocr=${3:?Provide expected live OCR tag}
commit=${4:?Provide exact tested full source revision}
case "$release:$previous:$previous_ocr" in *[!a-zA-Z0-9:._-]*) exit 2;; esac
test "${#commit}" = 40
case "$commit" in *[!a-f0-9]*) exit 2;; esac
cd /opt/atacadoapple/live
test "$(pwd -P)" = /opt/atacadoapple/live
engine=$(docker compose -p atacadoapple --env-file .env ps -q receipt-engine)
test -n "$engine"
test "$(docker inspect --format '{{.Config.Image}}' atacadoapple-app)" = "atacadoapple:$previous"
test "$(docker inspect --format '{{.Config.Image}}' "$engine")" = "atacadoapple-ocr:$previous_ocr"
test "$(docker inspect --format '{{.State.Health.Status}}' atacadoapple-app)" = healthy
test "$(docker inspect --format '{{.State.Health.Status}}' "$engine")" = healthy
test "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' atacadoapple-app)" = /opt/atacadoapple/live/data
for image in "atacadoapple:$release" "atacadoapple-ocr:$release"; do
  test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" = "$commit"
done
test "$(grep -c '^PDV_IMAGE=' .env)" = 1
test "$(grep -c '^PDV_OCR_IMAGE=' .env)" = 1
test "$(sed -n 's/^PDV_IMAGE=//p' .env)" = "atacadoapple:$previous"
test "$(sed -n 's/^PDV_OCR_IMAGE=//p' .env)" = "atacadoapple-ocr:$previous_ocr"
systemctl is-active --quiet atacadoapple-backup.timer
test ! -e ".env.pre-$release"
rollback_needed=0
pair_healthy() {
  app_image=$1
  ocr_image=$2
  engine=$(docker compose -p atacadoapple --env-file .env ps -q receipt-engine)
  test -n "$engine" &&
    test "$(docker inspect --format '{{.State.Health.Status}}' atacadoapple-app)" = healthy &&
    test "$(docker inspect --format '{{.State.Health.Status}}' "$engine")" = healthy &&
    test "$(docker inspect --format '{{.Config.Image}}' atacadoapple-app)" = "$app_image" &&
    test "$(docker inspect --format '{{.Config.Image}}' "$engine")" = "$ocr_image"
}
cleanup() {
  status=$1
  trap - EXIT
  set +e
  if test "$status" -ne 0 && test "$rollback_needed" = 1; then
    restored=0
    if cp -p ".env.pre-$release" .env && docker compose -p atacadoapple --env-file .env up -d --no-deps receipt-engine app; then
      for attempt in $(seq 1 50); do
        if pair_healthy "atacadoapple:$previous" "atacadoapple-ocr:$previous_ocr"; then restored=1; break; fi
        sleep 1
      done
    fi
    if test "$restored" = 1; then
      echo 'Previous app and OCR healthy. Current data and additive table retained.'
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
cp -p .env ".env.pre-$release"
# First makes an on-server online SQLite safety copy, then additive migrations.
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --mount type=bind,source=/opt/atacadoapple/live/data,target=/data --entrypoint node "atacadoapple:$release" scripts/hostinger/apply-receipt-delete-migration.mjs /data/pdv.sqlite
rollback_needed=1
sed -i "s/^PDV_IMAGE=.*/PDV_IMAGE=atacadoapple:$release/; s/^PDV_OCR_IMAGE=.*/PDV_OCR_IMAGE=atacadoapple-ocr:$release/" .env
docker compose -p atacadoapple --env-file .env up -d --no-deps receipt-engine app
healthy=0
for attempt in $(seq 1 50); do
  if pair_healthy "atacadoapple:$release" "atacadoapple-ocr:$release"; then healthy=1; break; fi
  sleep 1
done
test "$healthy" = 1
test "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' atacadoapple-app)" = /opt/atacadoapple/live/data
curl -fsS --max-time 15 https://atacadoapple.nucleodeoperacao.com.br/api/health
docker exec atacadoapple-app node -e 'fetch("http://receipt-engine:3001/health", {signal:AbortSignal.timeout(10000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
echo 'App and OCR release healthy. Scheduled backup configuration preserved.'
