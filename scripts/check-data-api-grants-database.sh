#!/usr/bin/env bash
# Read schema metadata from the CLI stack; write only inside our new container.
set -euo pipefail
umask 077

grants_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
grants_source="${DATA_API_GRANTS_SOURCE_CONTAINER:-supabase_db_pika}"
[[ "$grants_source" =~ ^supabase_db_[a-zA-Z0-9_-]+$ ]] || { echo 'Expected a Supabase CLI source container.' >&2; exit 1; }
[[ "$(docker inspect "$grants_source" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" == 'pika' ]] || { echo 'Source must be the Pika CLI stack.' >&2; exit 1; }
grants_image="$(docker inspect "$grants_source" --format '{{.Image}}')"
grants_tmp="$(mktemp -d "${TMPDIR:-/tmp}/pika-data-api-grants.XXXXXXXX")"
grants_token="${grants_tmp##*.}-$$-$RANDOM"
grants_name="pika-data-api-grants-$$-$RANDOM"
grants_owned=''
grants_launch_attempted=false
cleanup() {
  local grants_status=$? grants_cleanup_target="${grants_owned:-$grants_name}"
  if [[ "$grants_launch_attempted" == true ]]; then
    if ! docker info --format '{{.ServerVersion}}' >/dev/null 2>&1; then
      echo "Docker unavailable; cleanup unresolved for owned candidate $grants_name" >&2
      grants_status=1
    elif docker inspect "$grants_cleanup_target" >/dev/null 2>&1; then
      if [[ "$(docker inspect "$grants_cleanup_target" --format '{{ index .Config.Labels "pika.data-api-grants.owner" }}')" != "$grants_token" ]]; then
        echo 'Refusing to remove a Data API check container with a different owner.' >&2
        grants_status=1
      elif ! docker rm -fv "$grants_cleanup_target" >/dev/null 2>&1; then
        echo "Could not remove owned Data API check container: $grants_name" >&2
        grants_status=1
      fi
    fi
  fi
  rm -rf -- "$grants_tmp"
  exit "$grants_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# No row data, owners, ACLs, secrets, network ports, or host volumes are copied.
docker exec "$grants_source" pg_dump -U postgres -d postgres --schema-only --no-owner --no-privileges \
  --schema=public --schema=private --schema=auth --schema=storage > "$grants_tmp/platform.sql"
if docker inspect "$grants_name" >/dev/null 2>&1; then echo 'Disposable container name collision.' >&2; exit 1; fi
grants_launch_attempted=true
grants_owned="$(docker run -d --pull=never --name "$grants_name" --network none \
  --label "pika.data-api-grants.owner=$grants_token" \
  -e POSTGRES_PASSWORD=disposable-data-api-check --entrypoint docker-entrypoint.sh \
  "$grants_image" postgres -c shared_preload_libraries=pg_cron,pg_net -c cron.launch_active_jobs=off)"
[[ "$grants_owned" =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid owned container identity.' >&2; exit 1; }
for ((grants_attempt=0; grants_attempt<60; grants_attempt++)); do
  if docker exec "$grants_owned" pg_isready -U postgres -d postgres >/dev/null 2>&1; then break; fi
  if ((grants_attempt == 59)); then echo 'Disposable database startup timed out.' >&2; exit 1; fi
  sleep 1
done
# Supabase's image has postgres as a restricted admin. This elevation affects
# only our isolated cluster and permits deterministic schema-only restoration.
docker exec "$grants_owned" psql -U supabase_admin -d postgres -Xq -v ON_ERROR_STOP=1 \
  -c 'alter role postgres superuser' >/dev/null

sql() { docker exec -i "$grants_owned" psql -U postgres -d postgres -XqAt -v ON_ERROR_STOP=1; }
snapshot() { sql < "$grants_root/scripts/data-api-grants-snapshot.sql" > "$1"; }
compare() {
  if ! diff -u "$1" "$2"; then
    echo "Data API ACL contract changed: $3" >&2
    exit 1
  fi
}
reset_fixture() {
  docker exec "$grants_owned" psql -U supabase_admin -d postgres -Xq -v ON_ERROR_STOP=1 \
    -c 'alter role postgres superuser' >/dev/null
  sql > "$grants_tmp/reset.log" 2>&1 <<'SQL'
set client_min_messages = warning;
drop schema if exists public cascade;
drop schema if exists private cascade;
drop schema if exists auth cascade;
drop schema if exists storage cascade;
SQL
  if ! sql < "$grants_tmp/platform.sql" > "$grants_tmp/restore.log" 2>&1; then
    tail -20 "$grants_tmp/restore.log" >&2; exit 1
  fi
  sql > "$grants_tmp/reset.log" 2>&1 <<'SQL'
set client_min_messages = warning;
drop schema public cascade;
drop schema private cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
-- The historical platform defaults. Migration 075 later removes client access.
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
SQL
}
replay() {
  local grants_mode="$1" grants_path grants_filename grants_number
  for grants_path in "$grants_root"/supabase/migrations/*.sql; do
    grants_filename="$(basename "$grants_path")"
    grants_number="${grants_filename%%_*}"
    [[ "$grants_number" =~ ^[0-9]{3}$ ]] || continue
    ((10#$grants_number <= 280)) || continue
    if [[ "$grants_mode" == absent && "$grants_filename" == 075_auth_rls_hardening.sql ]]; then
      # Only fixture SQL is transformed. Historical files remain byte-identical.
      # Suppress the four grants that otherwise hide missing explicit grants.
      node - "$grants_path" > "$grants_tmp/migration.sql" <<'JS'
const fs = require('node:fs')
let text = fs.readFileSync(process.argv[2], 'utf8')
for (const pattern of [
  /grant all privileges on all tables in schema public to service_role;/g,
  /grant all privileges on all sequences in schema public to service_role;/g,
  /alter default privileges for role postgres in schema public\s+grant all on tables to service_role;/g,
  /alter default privileges for role postgres in schema public\s+grant all on sequences to service_role;/g,
]) {
  if ([...text.matchAll(pattern)].length !== 1) throw new Error('Historical grant fixture no longer matches')
  text = text.replace(pattern, '-- Historical automatic grant suppressed in disposable fixture.')
}
process.stdout.write(text)
JS
    else
      cp "$grants_path" "$grants_tmp/migration.sql"
    fi
    if ! sql < "$grants_tmp/migration.sql" > "$grants_tmp/replay.log" 2>&1; then
      echo "Data API $grants_mode replay failed at $grants_filename" >&2
      tail -20 "$grants_tmp/replay.log" >&2; exit 1
    fi
  done
}
apply_explicit_grants() {
  # The new migration must work with the real restricted migration authority.
  docker exec "$grants_owned" psql -U supabase_admin -d postgres -Xq -v ON_ERROR_STOP=1 \
    -c 'alter role postgres nosuperuser' >/dev/null
  if ! sql < "$grants_root/supabase/migrations/281_explicit_data_api_grants.sql" > "$grants_tmp/migration.log" 2>&1; then
    tail -20 "$grants_tmp/migration.log" >&2; exit 1
  fi
  sql < "$grants_root/scripts/check-data-api-grants.sql" >/dev/null
}

reset_fixture
sql >/dev/null <<'SQL'
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
SQL
replay historical
snapshot "$grants_tmp/historical.jsonl"
apply_explicit_grants
snapshot "$grants_tmp/explicit.jsonl"
compare "$grants_tmp/historical.jsonl" "$grants_tmp/explicit.jsonl" 'normal 280 -> 281'
echo 'Normal replay: all relation/function ACLs, owners and RLS unchanged.'

reset_fixture
replay absent
snapshot "$grants_tmp/absent.jsonl"
if cmp -s "$grants_tmp/historical.jsonl" "$grants_tmp/absent.jsonl"; then
  echo 'Automatic-grants-absent fixture failed to remove historical grants.' >&2; exit 1
fi
apply_explicit_grants
snapshot "$grants_tmp/restored.jsonl"
compare "$grants_tmp/historical.jsonl" "$grants_tmp/restored.jsonl" 'automatic grants absent -> 281'
# Idempotence also protects the immutable baseline on an already-upgraded DB.
apply_explicit_grants
snapshot "$grants_tmp/repeated.jsonl"
compare "$grants_tmp/restored.jsonl" "$grants_tmp/repeated.jsonl" 'repeated 281'
echo 'Absent-default replay: exact historical ACLs restored; clients denied; future defaults closed; repeat stable.'
