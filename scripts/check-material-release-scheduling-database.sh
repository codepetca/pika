#!/usr/bin/env bash
set -euo pipefail
umask 077
# Read schema metadata only from the shared stack. All writes use an owned clone.
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$(docker inspect supabase_db_pika --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" == 'pika' ]]
source_version="$(docker exec supabase_db_pika psql -U postgres -d postgres -Atqc 'select max(version) from supabase_migrations.schema_migrations')"
[[ "$source_version" =~ ^[0-9]{3}$ ]]
# The privilege-free snapshot must predate 283 so its RPC ACLs are replayed.
# An already-283 snapshot would restore v3 with default PUBLIC execution access.
if ! ((10#$source_version >= 234 && 10#$source_version <= 282)); then
  echo 'Material scheduling proof requires a source migration baseline from 234 through 282; source 283+ is unsupported because snapshot ACLs are omitted.' >&2
  exit 1
fi
scratch=$(mktemp -d /tmp/pika-material-replay.XXXXXX)
name=pika-material-schedule-$$
image=$(docker inspect supabase_db_pika --format '{{.Image}}')
cleanup() {
  local status=$?
  if docker inspect "$name" >/dev/null 2>&1; then
    [[ "$(docker inspect "$name" --format '{{ index .Config.Labels "pika.material-scheduling.owner" }}')" == "$$" ]] || exit 1
    docker rm -fv "$name" >/dev/null || status=1
  fi
  rm -rf -- "$scratch"
  exit "$status"
}
trap cleanup EXIT
docker exec supabase_db_pika pg_dump -U postgres -d postgres --schema-only --no-owner --no-privileges --schema=public --schema=private --schema=auth --schema=storage > "$scratch/schema.sql"
docker run -d --pull=never --name "$name" --label pika.material-scheduling.owner=$$ --network none -e POSTGRES_PASSWORD=disposable-material-check --entrypoint docker-entrypoint.sh "$image" postgres -c listen_addresses='*' -c shared_preload_libraries=pg_cron,pg_net -c cron.launch_active_jobs=off > "$scratch/container"
for i in {1..60}; do if docker exec "$name" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then break; fi; sleep 1; done
docker exec "$name" psql -U supabase_admin -d postgres -Xq -v ON_ERROR_STOP=1 -c 'alter role postgres superuser' >/dev/null
sql() { docker exec -i "$name" psql -U postgres -d postgres -Xq -v ON_ERROR_STOP=1; }
printf 'drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists storage cascade;' | sql > "$scratch/reset.log" 2>&1
sql < "$scratch/schema.sql" > "$scratch/restore.log" 2>&1
# pg_dump --no-privileges omits the platform schema usage grants.
printf 'grant usage on schema public to anon, authenticated, service_role;' | sql > /dev/null
for path in "$root"/supabase/migrations/*.sql; do file=${path##*/}; num=${file%%_*}; if [[ "$num" =~ ^[0-9]{3}$ ]] && ((10#$num > 10#$source_version)); then echo "Replay $file"; sql < "$path" > "$scratch/replay-$num.log" 2>&1; fi; done
docker run --rm --pull=never --network "container:$name" -e PG_META_DB_HOST=127.0.0.1 -e PG_META_DB_PASSWORD=disposable-material-check -e PG_META_GENERATE_TYPES=typescript -e PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public -e PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS=true public.ecr.aws/supabase/postgres-meta:v0.96.6 > "$scratch/generated.ts"
grep -q 'create_classwork_material_for_owner_v3:' "$scratch/generated.ts"
if [[ "${1:-}" == --generate-types ]]; then
  # Canonical Supabase pg-meta template, using only the disposable replay schema.
  python3 - "$scratch/generated.ts" "$root/src/types/database.generated.ts" <<'NORMALIZE'
import sys
from pathlib import Path
Path(sys.argv[2]).write_text(Path(sys.argv[1]).read_text().rstrip() + '\n')
NORMALIZE
fi
if ! sql < "$root/scripts/check-material-release-scheduling-database.sql" > "$scratch/behavior.log" 2>&1; then
  tail -20 "$scratch/behavior.log" >&2
  exit 1
fi
echo "Material scheduling replay, metadata generation and rollback behavior passed."
