#!/usr/bin/env bash
set -euo pipefail
umask 077

resolve_repolight_access_meta_image() {
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
[[ "$#" -le 1 && ( "$mode" == check || "$mode" == --write-types ) ]] || exit 2
source_container=supabase_db_pika
[[ "$(docker inspect "$source_container" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" == pika ]] || exit 1
[[ "$(docker port "$source_container" 5432/tcp)" == *:54322 ]] || exit 1
source_id="$(docker inspect "$source_container" --format '{{.Id}}')"
source_version="$(docker exec "$source_container" psql -U postgres -d postgres -Atqc 'select max(version) from supabase_migrations.schema_migrations')"
[[ "$source_version" =~ ^[0-9]{3}$ ]] || exit 1
# Only reviewed source profiles may supply platform Auth/Storage definitions.
# The 295 extension also requires its exact reviewed source seal in the preflight below.
# No application ACLs or singleton data survive the full application replay.
((10#$source_version >= 234 && 10#$source_version <= 295)) || exit 1
pnpm --dir "$root" exec tsx -e "import assert from 'node:assert/strict'; import { loadAssignmentListReviewedMigrations } from './scripts/contextual-assignment-list-proof-platform'; import { validateLifecycleServicesReviewedMigrations } from './scripts/lifecycle-services-reviewed-migrations'; const migrations=loadAssignmentListReviewedMigrations(process.cwd()); assert.equal(migrations.length,298,'RepoLight access proof target must be exactly298'); validateLifecycleServicesReviewedMigrations(migrations.slice(0,295)); assert.equal(migrations[295].name,'296_repolight_analysis_access.sql'); assert.equal(migrations[295].sha256,'63d94e7f301180ff0524e0c0f0214899bb3e048ea303af0b88ede647344cf492'); assert.equal(migrations[296].name,'297_repolight_managed_registry.sql'); assert.equal(migrations[296].sha256,'8710a091f0d32447074d84b945175a764cba1e0a3f364deb1b845d9d2661788b'); assert.equal(migrations[297].name,'298_repolight_provision_outbox.sql'); assert.equal(migrations[297].sha256,'47a20f34e9fd03e6b9d8a0e07960c7eb9e199e02ccc09839bd17ac81b98baacf');"
meta_image="$(resolve_repolight_access_meta_image)"

scratch="$(mktemp -d /tmp/pika-repolight-analysis-access.XXXXXX)"
token="${scratch##*.}"
name="pika-repolight-analysis-access-$$-$token"
meta_name="$name-meta"
image="$(docker inspect "$source_container" --format '{{.Image}}')"
clone_id=''
meta_id=''
source_preserved=false
normalize_schema() { sed '/^\\restrict /d; /^\\unrestrict /d' "$1"; }
source_schema() { docker exec "$source_id" pg_dump -U postgres -d postgres --schema-only --no-owner --no-privileges --schema=public --schema=private --schema=auth --schema=storage; }
verify_source() {
  [[ "$(docker inspect "$source_container" --format '{{.Id}}')" == "$source_id" ]] || return 1
  [[ "$(docker inspect "$source_id" --format '{{.Image}}')" == "$image" ]] || return 1
  [[ "$(docker exec "$source_id" psql -U postgres -d postgres -Atqc 'select max(version) from supabase_migrations.schema_migrations')" == "$source_version" ]] || return 1
  source_schema > "$scratch/schema-after.sql" || return 1
  normalize_schema "$scratch/schema-after.sql" > "$scratch/schema-after-normalized.sql"
  cmp -s "$scratch/schema-normalized.sql" "$scratch/schema-after-normalized.sql" || return 1
  source_preserved=true
}
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if ! docker info --format '{{.ServerVersion}}' >/dev/null 2>&1; then
    echo "Docker unavailable; RepoLight access clone cleanup unresolved: $name" >&2
    exit 1
  fi
  if [[ -f "$scratch/schema-normalized.sql" && "$source_preserved" != true ]]; then
    verify_source || { echo 'Canonical source preservation unresolved; inspect private evidence.' >&2; status=1; }
  fi
  for resource in "$meta_name" "$name"; do
    local expected="$clone_id" target
    [[ "$resource" != "$meta_name" ]] || expected="$meta_id"
    target="${expected:-$resource}"
    if docker inspect "$target" >/dev/null 2>&1; then
      [[ "$(docker inspect "$target" --format '{{ index .Config.Labels "pika.repolight-analysis-access.owner" }}')" == "$$:$token" ]] || { status=1; continue; }
      [[ -n "$expected" && "$(docker inspect "$target" --format '{{.Id}}')" == "$expected" ]] || { status=1; continue; }
      docker rm -fv "$expected" >/dev/null || status=1
      if docker inspect "$expected" >/dev/null 2>&1; then status=1; fi
    fi
  done
  docker info --format '{{.ServerVersion}}' >/dev/null 2>&1 || status=1
  # Keep schema/replay/behavior evidence on success and failure, never secrets.
  echo "Private RepoLight access proof evidence: $scratch"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
echo "Private RepoLight access proof evidence: $scratch"
source_schema > "$scratch/schema.sql"
normalize_schema "$scratch/schema.sql" > "$scratch/schema-normalized.sql"
clone_id="$(docker create --pull=never --name "$name" --label "pika.repolight-analysis-access.owner=$$:$token" --label "pika.home-visibility.owner=$$:$token" --network none --memory=2g --cpus=2 --pids-limit=256 -e POSTGRES_PASSWORD=disposable-material-check --entrypoint docker-entrypoint.sh "$image" postgres -c listen_addresses='*' -c shared_preload_libraries=pg_cron,pg_net -c cron.launch_active_jobs=off -c statement_timeout=120000 -c lock_timeout=10000)"
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
# One owned psql session avoids hundreds of Docker daemon round trips. Exact
# source seals were checked above; per-file markers retain failure attribution.
cat > "$scratch/replay.sql" <<'SQL'
create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key);
SQL
for path in "$root"/supabase/migrations/*.sql; do
  file="${path##*/}"; number="${file%%_*}"
  [[ "$number" =~ ^[0-9]{3}$ ]] || exit 1
  printf '\\echo Replay %s\n' "$file" >> "$scratch/replay.sql"
  cat "$path" >> "$scratch/replay.sql"
  printf '\n' >> "$scratch/replay.sql"
  printf "insert into supabase_migrations.schema_migrations(version) values ('%s');\n" "$number" >> "$scratch/replay.sql"
done
if ! sql < "$scratch/replay.sql" > "$scratch/replay.log" 2>&1; then
  tail -25 "$scratch/replay.log" >&2
  exit 1
fi
echo 'PASS replay001–298.'
for proof in check-repolight-database.sql check-repolight-analysis-access-database.sql check-subscription-prorated-upgrades-database.sql check-repolight-provision-combined.sql; do
  if ! sql < "$root/scripts/$proof" > "$scratch/$proof.log" 2>&1; then
    tail -25 "$scratch/$proof.log" >&2
    exit 1
  fi
done
echo 'PASS rollback-only RepoLight compatibility and access contracts.'
node "$root/scripts/check-repolight-analysis-access-contention.mjs" "$clone_id" "$$:$token" > "$scratch/contention.log" 2>&1 || { tail -30 "$scratch/contention.log" >&2; exit 1; }
echo 'PASS two-session plan and exact-expiry contention.'
node "$root/scripts/check-repolight-provision-contention.mjs" "$clone_id" "$$:$token" > "$scratch/provision-contention.log" 2>&1 || { tail -30 "$scratch/provision-contention.log" >&2; exit 1; }
echo 'PASS provisioning epoch and cutoff contention.'
meta_id="$(docker create --pull=never --name "$meta_name" --label "pika.repolight-analysis-access.owner=$$:$token" --network "container:$clone_id" --memory=512m --cpus=1 --pids-limit=128 -e PG_META_DB_HOST=127.0.0.1 -e PG_META_DB_PASSWORD=disposable-material-check -e PG_META_GENERATE_TYPES=typescript -e PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public -e PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS=true "$meta_image")"
docker start -a "$meta_id" > "$scratch/generated.ts" 2> "$scratch/meta.log"
[[ "$(docker inspect "$meta_id" --format '{{.State.ExitCode}}')" == 0 ]] || exit 1
(( $(wc -c < "$scratch/generated.ts") <= 8388608 )) || exit 1
grep -Fq 'get_repolight_analysis_access_v1:' "$scratch/generated.ts"
awk '/^[[:space:]]*$/ { blank_lines += 1; next } { while (blank_lines > 0) { print ""; blank_lines -= 1 }; print }' "$scratch/generated.ts" > "$scratch/normalized.ts"
verify_source || { echo 'Baseline must remain unchanged' >&2; exit 1; }
if [[ "$mode" == --write-types ]]; then cp "$scratch/normalized.ts" "$root/src/types/database.generated.ts"; fi
cmp -s "$scratch/normalized.ts" "$root/src/types/database.generated.ts" || { echo 'Generated types differ from the replay schema' >&2; exit 1; }
echo 'PASS isolated298 replay, rollback behavior, generated-type equality and unchanged shared schema.'
