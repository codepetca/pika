#!/usr/bin/env bash
set -euo pipefail
umask 077

resolve_attendance_meta_image() {
  local registry="${SUPABASE_INTERNAL_IMAGE_REGISTRY:-public.ecr.aws}" image
  case "$registry" in
    public.ecr.aws|ghcr.io) ;;
    *) echo 'Refusing unreviewed metadata image registry.' >&2; return 2 ;;
  esac
  # Supabase CI caches the GHCR alias; local CLI defaults to ECR. Use the same
  # pinned version already present, resolve it once, and never pull a fallback.
  image="$(docker image inspect "$registry/supabase/postgres-meta:v0.96.6" --format '{{.Id}}')" || return $?
  [[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Refusing malformed metadata image identity.' >&2; return 2; }
  printf '%s\n' "$image"
}

# The shared stack is a schema-only source. Replay and rollback fixtures run in
# a private, offline, owned clone; no hosted or shared migration application.
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:-check}"
[[ "$#" -le 1 && ( "$mode" == check || "$mode" == --generate-types ) ]] || exit 2
source_container=supabase_db_pika
[[ "$(docker inspect "$source_container" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" == pika ]] || exit 1
[[ "$(docker port "$source_container" 5432/tcp)" == *:54322 ]] || exit 1
source_id="$(docker inspect "$source_container" --format '{{.Id}}')"
source_version="$(docker exec "$source_container" psql -U postgres -d postgres -Atqc 'select max(version) from supabase_migrations.schema_migrations')"
[[ "$source_version" =~ ^[0-9]{3}$ ]] || exit 1
# Only reviewed source profiles may supply platform Auth/Storage definitions.
# No application ACLs or singleton data survive the full application replay.
((10#$source_version >= 234 && 10#$source_version <= 288)) || exit 1
pnpm --dir "$root" exec tsx -e "import assert from 'node:assert/strict'; import { loadAssignmentListReviewedMigrations } from './scripts/contextual-assignment-list-proof-platform'; import { validateLifecycleServicesReviewedMigrations } from './scripts/lifecycle-services-reviewed-migrations'; const migrations=loadAssignmentListReviewedMigrations(process.cwd()); assert.equal(migrations.length,288,'Attendance proof target must be exactly288'); validateLifecycleServicesReviewedMigrations(migrations);"
meta_image="$(resolve_attendance_meta_image)"

scratch="$(mktemp -d /tmp/pika-attendance-membership.XXXXXX)"
token="${scratch##*.}"
name="pika-attendance-membership-$$-$token"
meta_name="$name-meta"
image="$(docker inspect "$source_container" --format '{{.Image}}')"
clone_id=''
meta_id=''
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if ! docker info --format '{{.ServerVersion}}' >/dev/null 2>&1; then
    echo "Docker unavailable; attendance clone cleanup unresolved: $name" >&2
    exit 1
  fi
  for resource in "$meta_name" "$name"; do
    local expected="$clone_id" target
    [[ "$resource" != "$meta_name" ]] || expected="$meta_id"
    target="${expected:-$resource}"
    if docker inspect "$target" >/dev/null 2>&1; then
      [[ "$(docker inspect "$target" --format '{{ index .Config.Labels "pika.attendance-membership.owner" }}')" == "$$:$token" ]] || { status=1; continue; }
      [[ -n "$expected" && "$(docker inspect "$target" --format '{{.Id}}')" == "$expected" ]] || { status=1; continue; }
      docker rm -fv "$expected" >/dev/null || status=1
      if docker inspect "$expected" >/dev/null 2>&1; then status=1; fi
    fi
  done
  docker info --format '{{.ServerVersion}}' >/dev/null 2>&1 || status=1
  # Keep schema/replay/behavior evidence on success and failure, never secrets.
  echo "Private attendance proof evidence: $scratch"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
echo "Private attendance proof evidence: $scratch"
docker exec "$source_container" pg_dump -U postgres -d postgres --schema-only --no-owner --no-privileges --schema=public --schema=private --schema=auth --schema=storage > "$scratch/schema.sql"
clone_id="$(docker create --pull=never --name "$name" --label "pika.attendance-membership.owner=$$:$token" --network none --memory=2g --cpus=2 --pids-limit=256 -e POSTGRES_PASSWORD=disposable-attendance-check --entrypoint docker-entrypoint.sh "$image" postgres -c listen_addresses='*' -c shared_preload_libraries=pg_cron,pg_net -c cron.launch_active_jobs=off -c statement_timeout=120000 -c lock_timeout=10000)"
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
# Match the existing Data API replay harness: retain only platform Auth/Storage
# schema, then replay ALL application migrations. A schema-only application
# snapshot omits historical singleton seeds and cannot be a runtime fixture.
printf 'drop schema public cascade; drop schema private cascade; create schema public; grant usage on schema public to anon, authenticated, service_role; alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role; alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role; alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;' | sql > "$scratch/application-reset.log" 2>&1
for path in "$root"/supabase/migrations/*.sql; do
  file="${path##*/}"; number="${file%%_*}"
  [[ "$number" =~ ^[0-9]{3}$ ]] || exit 1
  if ! sql < "$path" > "$scratch/replay-$number.log" 2>&1; then
    echo "Attendance replay failed at $file" >&2
    tail -20 "$scratch/replay-$number.log" >&2
    exit 1
  fi
done
echo 'PASS replay001–288.'
# Record only versions whose actual replay just succeeded, so existing native
# harness preflights see the same real migration history as a CLI-created stack.
{
  printf 'create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);'
  for path in "$root"/supabase/migrations/*.sql; do
    file="${path##*/}"; number="${file%%_*}"
    [[ "$number" =~ ^[0-9]{3}$ ]] || exit 1
    printf "insert into supabase_migrations.schema_migrations(version) values('%s');" "$number"
  done
} | sql > "$scratch/history.log" 2>&1
if ! bash "$root/scripts/check-attendance-decommission-database.sh" --container-id "$clone_id" --owner "$$:$token" > "$scratch/decommission.log" 2>&1; then
  tail -25 "$scratch/decommission.log" >&2
  exit 1
fi
echo 'PASS existing full decommission contracts for both owner labels.'
if ! sql < "$root/scripts/check-attendance-membership-adoption-database.sql" > "$scratch/behavior.log" 2>&1; then
  tail -20 "$scratch/behavior.log" >&2
  exit 1
fi
if ! node "$root/scripts/check-attendance-membership-adoption-contention.mjs" --container-id "$clone_id" --owner "$$:$token" > "$scratch/contention.log" 2>&1; then
  tail -25 "$scratch/contention.log" >&2
  exit 1
fi
echo 'PASS actual two-session membership RPC conflicts and fresh committed state.'
meta_id="$(docker create --pull=never --name "$meta_name" --label "pika.attendance-membership.owner=$$:$token" --network "container:$clone_id" --memory=512m --cpus=1 --pids-limit=128 -e PG_META_DB_HOST=127.0.0.1 -e PG_META_DB_PASSWORD=disposable-attendance-check -e PG_META_GENERATE_TYPES=typescript -e PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public -e PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS=true "$meta_image")"
docker start -a "$meta_id" > "$scratch/generated.ts" 2> "$scratch/meta.log"
[[ "$(docker inspect "$meta_id" --format '{{.State.ExitCode}}')" == 0 ]] || exit 1
(( $(wc -c < "$scratch/generated.ts") <= 8388608 )) || exit 1
for rpc in prepare_attendance_membership_snapshot_v1: stage_attendance_membership_roster_snapshot_v1: resolve_attendance_membership_scan_generation: read_attendance_membership_status_v1: read_attendance_membership_session_for_owner_v1: apply_attendance_membership_status_overrides_v1:; do
  grep -Fq "$rpc" "$scratch/generated.ts"
done
awk '/^[[:space:]]*$/ { blank_lines += 1; next } { while (blank_lines > 0) { print ""; blank_lines -= 1 }; print }' "$scratch/generated.ts" > "$scratch/normalized.ts"
[[ "$(docker inspect "$source_container" --format '{{.Id}}')" == "$source_id" ]] || exit 1
[[ "$(docker exec "$source_container" psql -U postgres -d postgres -Atqc 'select max(version) from supabase_migrations.schema_migrations')" == "$source_version" ]] || exit 1
docker exec "$source_container" pg_dump -U postgres -d postgres --schema-only --no-owner --no-privileges --schema=public --schema=private --schema=auth --schema=storage > "$scratch/schema-after.sql"
# Recent pg_dump adds a fresh psql restriction token each time; it is transport
# framing, not schema. Compare all schema bytes except those two framing lines.
sed '/^\\restrict /d; /^\\unrestrict /d' "$scratch/schema.sql" > "$scratch/schema-normalized.sql"
sed '/^\\restrict /d; /^\\unrestrict /d' "$scratch/schema-after.sql" > "$scratch/schema-after-normalized.sql"
cmp -s "$scratch/schema-normalized.sql" "$scratch/schema-after-normalized.sql" || { echo 'Baseline must remain unchanged' >&2; exit 1; }
if [[ "$mode" == --generate-types ]]; then
  cp "$scratch/normalized.ts" "$root/src/types/database.generated.ts"
else
  cmp -s "$scratch/normalized.ts" "$root/src/types/database.generated.ts"
fi
echo 'PASS isolated attendance286/current288 replay, rollback behavior, real metadata and unchanged shared schema.'
