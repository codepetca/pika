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
# Sealed 298–321 touch application schemas only; replay retains the same
# Auth/Storage platform-source assumption. The manifest below pins their bytes.
((10#$source_version >= 234 && 10#$source_version <= 321)) || exit 1
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
# This validates contiguous replay through 297, 300, 301, 303, 304, 307, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320 or 321 and binds all migration and proof bytes.
manifest() {
  node - "$root" <<'NODE'
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const root = process.argv[2]
const paths = readdirSync(join(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort()
assert([297, 300, 301, 303, 304, 307, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321].includes(paths.length), 'Expected replay through migration 297, 300, 301, 303, 304, 307, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320 or 321')
paths.forEach((name, index) => assert.equal(name.match(/^(\d{3})_/u)?.[1], String(index + 1).padStart(3, '0'), 'Migration inventory must be contiguous and unique'))
// Preserve the reviewed293 pin and require the exact admission294/calendar295/attendance296 tails.
const reviewed293 = '293_repolight_report_service.sql'
assert.equal(paths[292], reviewed293, 'Unreviewed migration 293 filename')
assert.equal(createHash('sha256').update(readFileSync(join(root, 'supabase/migrations', reviewed293))).digest('hex'), 'b03d4dccd88ecbbf06d103b57c0cee97fccd6b07f13dfc2b0a4ed438fd68d052', 'Unreviewed migration 293 source')
assert.equal(paths[293], '294_classroom_experience_admission_registry.sql', 'Unreviewed migration 294 filename')
assert.equal(createHash('sha256').update(readFileSync(join(root, 'supabase/migrations', paths[293]))).digest('hex'), '908ac8f3765426eb2ab93258206c1f2c10b0fa8299d118821414a1f4ebeaf197', 'Unreviewed migration 294 source')
assert.equal(paths[294], '295_independent_calendar_post_dates.sql', 'Unreviewed migration 295 filename')
assert.equal(createHash('sha256').update(readFileSync(join(root, 'supabase/migrations', paths[294]))).digest('hex'), '7b4d0853057c7876f4f45bdeaf568e8a62425ff53391fef7ada62bf63ce482d3', 'Unreviewed migration 295 source')
assert.equal(paths[295], '296_attendance_named_schedules.sql', 'Unreviewed migration 296 filename')
assert.equal(createHash('sha256').update(readFileSync(join(root, 'supabase/migrations', paths[295]))).digest('hex'), '4a640c6bd6f1217314387b2122861f286986cd4c07e6a7f1be9b149388e5c917', 'Unreviewed migration 296 source')
assert.equal(paths[296], '297_classroom_public_auto_admission.sql', 'Unreviewed migration 297 filename')
assert.equal(createHash('sha256').update(readFileSync(join(root, 'supabase/migrations', paths[296]))).digest('hex'), 'e7ee574ff2cb2d97deec109b4bbea49a564a892a3db8a7748db21a92745a5be1', 'Unreviewed migration 297 source')
if (paths.length >= 300) {
  for (const [index, name, digest] of [
    [297, '298_repolight_analysis_access.sql', '63d94e7f301180ff0524e0c0f0214899bb3e048ea303af0b88ede647344cf492'],
    [298, '299_repolight_managed_registry.sql', '8710a091f0d32447074d84b945175a764cba1e0a3f364deb1b845d9d2661788b'],
    [299, '300_repolight_provision_outbox.sql', '47a20f34e9fd03e6b9d8a0e07960c7eb9e199e02ccc09839bd17ac81b98baacf'],
  ]) {
    assert.equal(paths[index], name, `Unreviewed migration ${index + 1} filename`)
    assert.equal(createHash('sha256').update(readFileSync(join(root, 'supabase/migrations', name))).digest('hex'), digest, `Unreviewed migration ${index + 1} source`)
  }
}
if (paths.length >= 301) {
  const name = '301_repolight_universal_tier_benefit.sql'
  assert.equal(paths[300], name, 'Unreviewed migration 301 filename')
  assert.equal(createHash('sha256').update(readFileSync(join(root, 'supabase/migrations', name))).digest('hex'), '871db1a388284f8a4178f7d36385b7db267c26b0b936bdd25a78f85ac24956e3', 'Unreviewed migration 301 source')
}
const billingTailPath = 'scripts/disposable-billing-replay-tail.json'
if (paths.length > 301) {
  const billingTailBytes = readFileSync(join(root, billingTailPath))
  assert.equal(createHash('sha256').update(billingTailBytes).digest('hex'), '7ce540eb8478fcefab4ca4e5c30fc03101335a614405e398faa556d9d06212c1', 'Unreviewed billing replay seal')
  const billingTail = JSON.parse(billingTailBytes.toString('utf8'))
  assert.equal(billingTail.length, 6, 'Expected complete billing replay tail')
  for (const [offset, { name, sha256 }] of billingTail.slice(0, paths.length - 301).entries()) {
    const index = 301 + offset
    assert.equal(paths[index], name, `Unreviewed migration ${index + 1} filename`)
    assert.equal(createHash('sha256').update(readFileSync(join(root, 'supabase/migrations', name))).digest('hex'), sha256, `Unreviewed migration ${index + 1} source`)
  }
}
const cutoffTailPath = 'scripts/disposable-classroom-cutoff-replay-tail.json'
if (paths.length >= 310) {
  const bytes = readFileSync(join(root, cutoffTailPath))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '2c1283ba0827c979aa3f2eb833c857c7fa7c8b72a37d93f84c6d804b7dacab57', 'Unreviewed classroom cutoff replay seal')
  const tail = JSON.parse(bytes.toString('utf8'))
  assert.equal(tail.length, 3)
  for (const [offset, { name, sha256 }] of tail.entries()) {
    assert.equal(paths[307 + offset], name, 'Unreviewed classroom cutoff filename')
    assert.equal(createHash('sha256').update(readFileSync(join(root, 'supabase/migrations', name))).digest('hex'), sha256, 'Unreviewed classroom cutoff source')
  }
}
const releaseTailPath = 'scripts/disposable-assignment-release-replay-tail.json'
if (paths.length >= 311) {
  const bytes = readFileSync(join(root, releaseTailPath))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '5fe36236dcb2a93bd149035b988a3a56de1ac010fc79697f5ba5b353f921d7ab', 'Unreviewed assignment release replay seal')
  const tail = JSON.parse(bytes.toString('utf8'))
  assert.equal(tail.length, 2)
  for (const [offset, { name, sha256 }] of tail.slice(0, paths.length - 310).entries()) {
    assert.equal(paths[310 + offset], name, 'Unreviewed assignment release filename')
    assert.equal(createHash('sha256').update(readFileSync(join(root, 'supabase/migrations', name))).digest('hex'), sha256, 'Unreviewed assignment release source')
  }
}
const trialTailPath = 'scripts/disposable-live-trial-replay-tail.json'
if (paths.length >= 313) {
  const bytes = readFileSync(join(root, trialTailPath))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'bb5a238fe788fe2118c807d1b324b804ac98a66266ee3cb612c372d2bd60a067', 'Unreviewed live trial replay seal')
  const tail = JSON.parse(bytes.toString('utf8'))
  assert.equal(tail.length, 1)
  const { name, sha256 } = tail[0]
  assert.equal(paths[312], name, 'Unreviewed live trial filename')
  assert.equal(createHash('sha256').update(readFileSync(join(root, 'supabase/migrations', name))).digest('hex'), sha256, 'Unreviewed live trial source')
}
const paymentTailPath = 'scripts/disposable-live-payment-replay-tail.json'
if (paths.length >= 314) {
  const bytes = readFileSync(join(root, paymentTailPath))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'b59e62f479ca06122e3bf42cea40400d5f3a16a619f3196490f9ab09d728e6c8', 'Unreviewed live payment replay seal')
  const tail = JSON.parse(bytes.toString('utf8'))
  assert.equal(tail.length, 8)
  for (const [offset, { name, sha256 }] of tail.slice(0, paths.length - 313).entries()) {
    assert.equal(paths[313 + offset], name, 'Unreviewed live payment filename')
    assert.equal(createHash('sha256').update(readFileSync(join(root, 'supabase/migrations', name))).digest('hex'), sha256, 'Unreviewed live payment source')
  }
}
for (const path of [...paths.map(name => `supabase/migrations/${name}`), billingTailPath, cutoffTailPath, releaseTailPath, trialTailPath, ...(paths.length >= 314 ? [paymentTailPath] : []), 'scripts/check-classroom-home-visibility-database.sql', 'scripts/check-classroom-home-recovery-database.sql', 'scripts/check-classroom-home-visibility-contention.mjs', 'scripts/check-classroom-admission-registry-database.sql', 'scripts/check-classroom-admission-registry-contention.mjs', 'scripts/check-classroom-public-auto-admission.sql', 'scripts/check-classroom-public-auto-admission-native-catalog.sql', 'scripts/check-classroom-home-visibility-database.sh', 'src/lib/server/classroom-admission-manifest.ts']) {
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
echo 'PASS isolated replay of the sealed migration inventory.'
# Native 297 coverage uses the real users table. Adapt only fixture identities;
# the isolated synthetic contract remains unchanged and is sealed in manifest.
if ! sql < "$root/scripts/check-classroom-public-auto-admission-native-catalog.sql" > "$scratch/auto-catalog.log" 2>&1; then tail -25 "$scratch/auto-catalog.log" >&2; exit 1; fi
node - "$root/scripts/check-classroom-public-auto-admission.sql" > "$scratch/auto-native.sql" <<'NODE'
const fs=require('node:fs'); let s=fs.readFileSync(process.argv[2],'utf8')
const a='insert into public.users(id,email_verified_at)',b="  case when n = 74 then null else now() end"
if (!s.includes(a) || !s.includes(b) || s.split(a).length!==2 || s.split(b).length!==2) process.exit(1)
s=s.replace(a,'insert into public.users(id,email,role,email_verified_at)').replace(b,"  'pika-auto-' || n || '@example.invalid', 'student', case when n = 74 then null else now() end")
process.stdout.write(s)
NODE
if ! sql < "$scratch/auto-native.sql" > "$scratch/auto-native.log" 2>&1; then tail -25 "$scratch/auto-native.log" >&2; exit 1; fi
echo 'PASS native 297 catalog, ACL, RLS and rollback-only admission contracts.'

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
docker exec "$clone_id" pg_dump -U postgres -d postgres --no-owner --schema=public --schema=private > "$scratch/admission-before.sql"
normalize_schema "$scratch/admission-before.sql" > "$scratch/admission-before-normalized.sql"
if ! sql < "$root/scripts/check-classroom-admission-registry-database.sql" > "$scratch/admission.log" 2>&1; then tail -25 "$scratch/admission.log" >&2; exit 1; fi
echo 'PASS rollback-only classroom admission registry contracts.'
if ! node --import tsx "$root/scripts/check-classroom-admission-registry-contention.mjs" --container-id "$clone_id" --owner "$owner" > "$scratch/admission-contention.log" 2>&1; then tail -25 "$scratch/admission-contention.log" >&2; exit 1; fi
echo 'PASS actual two-session admission stop/batch/duplicate/reconciliation; fixture graph restored.'
docker exec "$clone_id" pg_dump -U postgres -d postgres --no-owner --schema=public --schema=private > "$scratch/admission-after.sql"
normalize_schema "$scratch/admission-after.sql" > "$scratch/admission-after-normalized.sql"
cmp -s "$scratch/admission-before-normalized.sql" "$scratch/admission-after-normalized.sql" || { echo 'Admission proofs changed the preproof clone graph/schema.' >&2; exit 1; }
meta_id="$(docker create --pull=never --name "$meta_name" --label "pika.home-visibility.owner=$owner" --network "container:$clone_id" --memory=512m --cpus=1 --pids-limit=128 -e PG_META_DB_HOST=127.0.0.1 -e PG_META_DB_PASSWORD=disposable-home-visibility -e PG_META_GENERATE_TYPES=typescript -e PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public -e PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS=true "$meta_image")"
docker start -a "$meta_id" > "$scratch/generated.ts" 2> "$scratch/meta.log"
[[ "$(docker inspect "$meta_id" --format '{{.State.ExitCode}}')" == 0 ]] || exit 1
(( $(wc -c < "$scratch/generated.ts") <= 8388608 )) || exit 1
for rpc in read_classroom_home_visibility_v1: set_classroom_home_visibility_v1: read_classroom_experience_admission_v2: commit_classroom_experience_admission_batch_v2: read_classroom_experience_admission_operation_v2: ensure_verified_classroom_admission_v1: set_classroom_auto_admission_enabled_v1: read_verified_classroom_auto_admission_eligibility_v1:; do grep -Fq "$rpc" "$scratch/generated.ts"; done
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
