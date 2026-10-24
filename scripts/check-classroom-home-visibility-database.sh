#!/usr/bin/env bash
set -euo pipefail
umask 077

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:-check}"
[[ "$#" -le 1 && ( "$mode" == check || "$mode" == --generate-artifact-only ) ]] || exit 2
source_container=supabase_db_pika
source_id="$(docker inspect "$source_container" --format '{{.Id}}')"
[[ "$source_id" =~ ^[a-f0-9]{64}$ ]] || exit 1
[[ "$(docker inspect "$source_id" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" == pika ]] || exit 1
[[ "$(docker port "$source_id" 5432/tcp)" == *:54322 ]] || exit 1
source_image="$(docker inspect "$source_id" --format '{{.Config.Image}}')"
# Existing local stack: .044; CI's pinned Supabase CLI2.103.0: .132.
# Keep exact official registry/version references, then bind the running image ID.
case "$source_image" in
  public.ecr.aws/supabase/postgres:17.6.1.044|ghcr.io/supabase/postgres:17.6.1.044) ;;
  public.ecr.aws/supabase/postgres:17.6.1.132|ghcr.io/supabase/postgres:17.6.1.132) ;;
  *) echo 'Refusing an unrecognized source database image/version.' >&2; exit 1 ;;
esac
[[ "$(docker inspect "$source_id" --format '{{.State.Running}}')" == true ]] || exit 1
image="$(docker image inspect "$source_image" --format '{{.Id}}')"
[[ "$(docker inspect "$source_id" --format '{{.Image}}')" == "$image" ]] || exit 1
source_version="$(docker exec "$source_id" psql -U postgres -d postgres -Atqc 'select max(version) from supabase_migrations.schema_migrations')"
[[ "$source_version" =~ ^[0-9]{3}$ ]] || exit 1
((10#$source_version >= 234 && 10#$source_version <= 292)) || exit 1
registry="${SUPABASE_INTERNAL_IMAGE_REGISTRY:-public.ecr.aws}"
[[ "$registry" == public.ecr.aws || "$registry" == ghcr.io ]] || exit 2
meta_image="$(docker image inspect "$registry/supabase/postgres-meta:v0.96.6" --format '{{.Id}}')"
[[ "$image" =~ ^sha256:[a-f0-9]{64}$ && "$meta_image" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1

scratch="$(mktemp -d /tmp/pika-home-visibility.XXXXXX)"
token="${scratch##*.}"
name="pika-home-visibility-$$-$token"
meta_name="$name-meta"
owner="$$:$token"
clone_id=''
meta_id=''
source_preserved=false
source_schema() {
  docker exec "$source_id" pg_dump -U postgres -d postgres --schema-only --no-owner --no-privileges --schema=public --schema=private --schema=auth --schema=storage
}
normalize_schema() { sed '/^\\restrict /d; /^\\unrestrict /d' "$1"; }
verify_source() {
  [[ "$(docker inspect "$source_container" --format '{{.Id}}')" == "$source_id" ]] || return 1
  [[ "$(docker inspect "$source_id" --format '{{.Id}}')" == "$source_id" ]] || return 1
  [[ "$(docker inspect "$source_id" --format '{{.Image}}')" == "$image" ]] || return 1
  [[ "$(docker exec "$source_id" psql -U postgres -d postgres -Atqc 'select max(version) from supabase_migrations.schema_migrations')" == "$source_version" ]] || return 1
  source_schema > "$scratch/schema-after.sql" || return 1
  normalize_schema "$scratch/schema-after.sql" > "$scratch/schema-after-normalized.sql"
  cmp -s "$scratch/schema-normalized.sql" "$scratch/schema-after-normalized.sql" || return 1
  source_preserved=true
}
cleanup() {
  local status=$? resource expected
  trap - EXIT INT TERM
  if docker info --format '{{.ServerVersion}}' >/dev/null 2>&1; then
    if [[ -f "$scratch/schema-normalized.sql" && "$source_preserved" != true ]]; then
      verify_source || { echo 'Canonical source preservation unresolved; inspect private evidence.' >&2; status=1; }
    fi
    for resource in "$meta_name" "$name"; do
      expected="$clone_id"; [[ "$resource" != "$meta_name" ]] || expected="$meta_id"
      if docker inspect "${expected:-$resource}" >/dev/null 2>&1; then
        [[ -n "$expected" && "$(docker inspect "$expected" --format '{{.Id}}')" == "$expected" ]] || { status=1; continue; }
        [[ "$(docker inspect "$expected" --format '{{ index .Config.Labels "pika.home-visibility.owner" }}')" == "$owner" ]] || { status=1; continue; }
        docker rm -fv "$expected" >/dev/null || status=1
        if docker inspect "$expected" >/dev/null 2>&1; then status=1; fi
      fi
    done
  else
    echo "Docker unavailable; owned clone cleanup unresolved: $name" >&2
    status=1
  fi
  echo "Private home visibility proof evidence: $scratch"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Seal the exact dirty-tree SQL inventory, rather than asserting a reviewed SHA.
# This validates contiguous001–292 and binds all migration and proof bytes.
manifest() {
  node - "$root" <<'NODE'
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const root = process.argv[2]
const paths = readdirSync(join(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort()
assert.equal(paths.length, 292, 'Expected exactly292 migrations')
paths.forEach((name, index) => assert.equal(name.match(/^(\d{3})_/u)?.[1], String(index + 1).padStart(3, '0'), 'Migration inventory must be contiguous and unique'))
for (const path of [...paths.map(name => `supabase/migrations/${name}`), 'scripts/check-classroom-home-visibility-database.sql', 'scripts/check-classroom-home-recovery-database.sql', 'scripts/check-classroom-home-visibility-contention.mjs']) {
  console.log(`${createHash('sha256').update(readFileSync(join(root, path))).digest('hex')}  ${path}`)
}
NODE
}
manifest > "$scratch/source-manifest.sha256"
printf 'source_id=%s\nsource_version=%s\ndatabase_image=%s\nmetadata_image=%s\n' "$source_id" "$source_version" "$image" "$meta_image" > "$scratch/identity.txt"
source_schema > "$scratch/schema.sql"
normalize_schema "$scratch/schema.sql" > "$scratch/schema-normalized.sql"
clone_id="$(docker create --pull=never --name "$name" --label "pika.home-visibility.owner=$owner" --network none --memory=2g --cpus=2 --pids-limit=256 -e POSTGRES_PASSWORD=disposable-home-visibility --entrypoint docker-entrypoint.sh "$image" postgres -c listen_addresses='*' -c shared_preload_libraries=pg_cron,pg_net -c cron.launch_active_jobs=off -c statement_timeout=120000 -c lock_timeout=10000)"
docker start "$clone_id" >/dev/null
ready=false
for i in {1..60}; do
  if docker exec "$clone_id" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || exit 1
docker exec "$clone_id" psql -U supabase_admin -d postgres -Xq -v ON_ERROR_STOP=1 -c 'alter role postgres superuser' > "$scratch/bootstrap.log" 2>&1
sql() { docker exec -i "$clone_id" psql -U postgres -d postgres -Xq -v ON_ERROR_STOP=1; }
printf 'drop schema if exists public cascade; drop schema if exists private cascade; drop schema if exists auth cascade; drop schema if exists storage cascade;' | sql > "$scratch/reset.log" 2>&1
sql < "$scratch/schema.sql" > "$scratch/restore.log" 2>&1
# Discard all application definitions from the schema-only source. Only platform
# Auth/Storage bootstrap survives; every application migration is replayed below.
printf 'drop schema public cascade; drop schema private cascade; create schema public; grant usage on schema public to anon, authenticated, service_role; alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role; alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role; alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;' | sql > "$scratch/application-reset.log" 2>&1
for path in "$root"/supabase/migrations/*.sql; do
  printf '\\echo Replay %s\n' "${path##*/}" >> "$scratch/replay.sql"
  cat "$path" >> "$scratch/replay.sql"
  printf '\n' >> "$scratch/replay.sql"
done
manifest > "$scratch/replay-manifest.sha256"
cmp -s "$scratch/source-manifest.sha256" "$scratch/replay-manifest.sha256" || { echo 'Source changed before replay.' >&2; exit 1; }
if ! sql < "$scratch/replay.sql" > "$scratch/replay.log" 2>&1; then tail -25 "$scratch/replay.log" >&2; exit 1; fi
echo 'PASS isolated replay001–292.'
if ! sql < "$root/scripts/check-classroom-home-visibility-database.sql" > "$scratch/behavior.log" 2>&1; then tail -25 "$scratch/behavior.log" >&2; exit 1; fi
echo 'PASS rollback-only home visibility contracts.'
if ! sql < "$root/scripts/check-classroom-home-recovery-database.sql" > "$scratch/recovery.log" 2>&1; then tail -25 "$scratch/recovery.log" >&2; exit 1; fi
node - "$scratch/recovery.log" <<'NODE'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const output = readFileSync(process.argv[2])
assert(output.length <= 1024, 'Recovery verdict exceeded its bound')
assert.equal(output.toString('utf8').trim(), 'ok\n{"version":1,"scope":"classroom-home-recovery-v1","outcome":"passed","stage":"rolled-back","nativeVerified":false}')
NODE
echo 'PASS rollback-only classroom creation freeze and capability recovery contracts.'
if ! node "$root/scripts/check-classroom-home-visibility-contention.mjs" --container-id "$clone_id" --owner "$owner" > "$scratch/contention.log" 2>&1; then tail -25 "$scratch/contention.log" >&2; exit 1; fi
echo 'PASS actual two-session visibility membership/owner/archive contention.'
meta_id="$(docker create --pull=never --name "$meta_name" --label "pika.home-visibility.owner=$owner" --network "container:$clone_id" --memory=512m --cpus=1 --pids-limit=128 -e PG_META_DB_HOST=127.0.0.1 -e PG_META_DB_PASSWORD=disposable-home-visibility -e PG_META_GENERATE_TYPES=typescript -e PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public -e PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS=true "$meta_image")"
docker start -a "$meta_id" > "$scratch/generated.ts" 2> "$scratch/meta.log"
[[ "$(docker inspect "$meta_id" --format '{{.State.ExitCode}}')" == 0 ]] || exit 1
(( $(wc -c < "$scratch/generated.ts") <= 8388608 )) || exit 1
for rpc in read_classroom_home_visibility_v1: set_classroom_home_visibility_v1:; do grep -Fq "$rpc" "$scratch/generated.ts"; done
awk '/^[[:space:]]*$/ { blank_lines += 1; next } { while (blank_lines > 0) { print ""; blank_lines -= 1 }; print }' "$scratch/generated.ts" > "$scratch/normalized.ts"
manifest > "$scratch/final-manifest.sha256"
cmp -s "$scratch/source-manifest.sha256" "$scratch/final-manifest.sha256" || { echo 'Source changed during proof.' >&2; exit 1; }
verify_source || { echo 'Canonical source schema/version changed.' >&2; exit 1; }
echo 'PASS canonical source ID/version/schema preserved; exact migration/proof manifest unchanged.'
if [[ "$mode" == --generate-artifact-only ]]; then
  echo "Generated types artifact: $scratch/normalized.ts"
else
  cmp -s "$scratch/normalized.ts" "$root/src/types/database.generated.ts" || { echo 'Generated types differ from the replay schema.' >&2; exit 1; }
  echo 'PASS generated types match isolated replay.'
fi
