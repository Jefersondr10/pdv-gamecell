#!/bin/sh
# App-only release: optional additive report migration, no off-site backup or OCR restart.
set -eu
release=${1:?Provide tested application tag}
previous=${2:?Provide expected live application tag}
commit=${3:?Provide exact tested full source revision}
migration=${4:-none}
case "$migration" in none|public-reports) ;; *) exit 2;; esac
case "$release:$previous" in *[!a-zA-Z0-9:._-]*) exit 2;; esac
test "$release" != "$previous"
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
test ! -e ".env.pre-$release"
rollback_needed=0
cleanup() {
  status=$1
  trap - EXIT
  set +e
  if test "$status" -ne 0 && test "$rollback_needed" = 1; then
    restored=0
    if cp -p ".env.pre-$release" .env && docker compose -p atacadoapple --env-file .env up -d --no-deps app; then
      for attempt in $(seq 1 50); do
        if test "$(docker inspect --format '{{.State.Health.Status}}' atacadoapple-app)" = healthy && test "$(docker inspect --format '{{.Config.Image}}' atacadoapple-app)" = "atacadoapple:$previous"; then restored=1; break; fi
        sleep 1
      done
    fi
    if test "$restored" = 1; then echo 'Previous app restored; current data retained.'; else echo 'Rollback health requires attention; current data retained.'; fi
  fi
  systemctl start atacadoapple-backup.timer || { echo 'Backup timer requires attention.'; exit 1; }
  exit "$status"
}
trap 'cleanup "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
systemctl stop atacadoapple-backup.timer
test "$(systemctl show atacadoapple-backup.service -p ActiveState --value)" = inactive
test "$(systemctl show atacadoapple-backup.service -p Result --value)" = success
docker exec -i atacadoapple-app node --input-type=module - "$release" <<'NODE'
import fs from 'node:fs';
import { DatabaseSync, backup } from 'node:sqlite';
const status = JSON.parse(fs.readFileSync('/data/backups/last-success.json'));
const time = status.completedAt ?? status.capturedAt;
if (!Number.isFinite(time) || time <= 0 || time > Date.now() + 60000 || Date.now() - time >= 5400000) throw new Error('Scheduled backup is not recent.');
process.umask(0o077);
const directory = '/data/release-snapshots';
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const destination = `${directory}/pre-${process.argv[2]}-${Date.now()}.sqlite`;
if (fs.existsSync(destination)) throw new Error('Snapshot already exists.');
const source = new DatabaseSync('/data/pdv.sqlite', { readOnly: true, timeout: 5000 });
try { await backup(source, destination); } finally { source.close(); }
const snapshot = new DatabaseSync(destination, { readOnly: true });
try {
  if (snapshot.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Snapshot integrity check failed.');
  if (snapshot.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Snapshot foreign key check failed.');
} finally { snapshot.close(); }
console.log('Recent scheduled backup verified; on-server safety snapshot checked. No external copies.');
NODE
cp -p .env ".env.pre-$release"
if test "$migration" = public-reports; then
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --mount type=bind,source=/opt/atacadoapple/live/data,target=/data --entrypoint node "atacadoapple:$release" scripts/hostinger/apply-public-reports-migration.mjs /data/pdv.sqlite
fi
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
echo 'App-only release healthy. Data mount, OCR and scheduled backup configuration preserved.'
