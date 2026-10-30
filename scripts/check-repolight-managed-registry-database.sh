#!/usr/bin/env bash
# Isolated registry unit contract, not a full Pika migration replay. No app rows,
# credentials, ports, host volumes, or networks are copied into this container.
set -euo pipefail
umask 077
registry_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
registry_name="pika-repolight-registry-$$-$RANDOM"
registry_token="$$-$RANDOM-$RANDOM"
registry_id=''
cleanup() {
  local registry_status=$?
  if [[ -n "$registry_id" ]]; then
    if [[ "$(docker inspect "$registry_id" --format '{{ index .Config.Labels "pika.repolight-registry.owner" }}')" != "$registry_token" ]]; then
      echo 'Registry container cleanup ownership mismatch.' >&2; exit 1
    fi
    docker rm -fv "$registry_id" >/dev/null || registry_status=1
  fi
  exit "$registry_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
[[ "$(docker inspect supabase_db_pika --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" == 'pika' ]] || { echo 'Expected cached Pika database image.' >&2; exit 1; }
registry_image="$(docker inspect supabase_db_pika --format '{{.Image}}')"
registry_id="$(docker run -d --pull=never --name "$registry_name" --network none \
  --label "pika.repolight-registry.owner=$registry_token" -e POSTGRES_PASSWORD=disposable-registry-contract \
  --entrypoint docker-entrypoint.sh "$registry_image" postgres -c shared_preload_libraries=pg_cron,pg_net -c cron.launch_active_jobs=off)"
[[ "$registry_id" =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid owned container identity.' >&2; exit 1; }
for ((registry_attempt=0;registry_attempt<45;registry_attempt++)); do
  if docker exec "$registry_id" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then break;fi
  if ((registry_attempt==44));then echo 'Registry fixture startup timed out.' >&2;exit 1;fi
  sleep 1
done
registry_sql() { docker exec -i "$registry_id" psql -U postgres -d postgres -Xq -v ON_ERROR_STOP=1; }
registry_sql <<'SQL'
create schema private;
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
end$$;
create table private.registry_test_access(allowed boolean);
insert into private.registry_test_access values(true);
-- Stub only this independent boundary; full integration must replay296.
create function public.get_repolight_analysis_access_v1(p_subject_user_id uuid) returns jsonb language sql as $$
 select jsonb_build_object('allowed',allowed) from private.registry_test_access
$$;
SQL
registry_sql < "$registry_root/supabase/migrations/297_repolight_managed_registry.sql"
registry_sql < "$registry_root/scripts/check-repolight-managed-registry-database.sql"
registry_sql <<'SQL'
create table private.registry_test_candidates(label text primary key,candidate jsonb);
create table private.registry_test_receipts(label text primary key,result jsonb);
insert into private.registry_test_candidates
select label,jsonb_build_object('teacherId','33333333-3333-4333-8333-333333333333','tenantRef','opaque-concurrent-'||label,'operationRef',gen_random_uuid(),'keyId',gen_random_uuid(),'secretHash',repeat('b',64),'connectionRef','connection-'||label,'apiOrigin','https://reports.example.test','installationRef','installation-1','encryptedKey',jsonb_build_object('ciphertext','encrypted'),'operationKind','provision','expectedKeyId',null,'state','pending','workspaceRef',null)
from unnest(array['one','two'])label;
SQL
registry_sql >/dev/null <<'SQL' &
begin;
insert into private.registry_test_receipts select label,public.prepare_repolight_managed_connection_v1('33333333-3333-4333-8333-333333333333',candidate) from private.registry_test_candidates where label='one';
select pg_sleep(0.2);
commit;
SQL
registry_first_pid=$!
registry_sql >/dev/null <<'SQL' &
begin;
insert into private.registry_test_receipts select label,public.prepare_repolight_managed_connection_v1('33333333-3333-4333-8333-333333333333',candidate) from private.registry_test_candidates where label='two';
commit;
SQL
registry_second_pid=$!
wait "$registry_first_pid"
wait "$registry_second_pid"
registry_sql <<'SQL'
do $$begin
 if (select count(*) from private.registry_test_receipts)<>2 or (select count(distinct result->>'operationRef') from private.registry_test_receipts)<>1
 or (select count(*) from private.repolight_managed_connections where teacher_id='33333333-3333-4333-8333-333333333333')<>1 then raise exception 'Concurrent provisioning replaced durable identity';end if;
end$$;
SQL
echo 'Managed RepoLight isolated registry contracts passed.'
