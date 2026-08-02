#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${MANAGED_STORAGE_DB_CONTAINER:-$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)}"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
begin;

insert into public.users (id, email, role) values
  ('a1100000-0000-4000-8000-000000000001', 'managed-teacher@example.test', 'teacher'),
  ('a1100000-0000-4000-8000-000000000002', 'managed-student@example.test', 'student');
insert into public.classrooms (id, teacher_id, title, class_code) values (
  'a1100000-0000-4000-8000-000000000003',
  'a1100000-0000-4000-8000-000000000001',
  'Managed storage fixture',
  'MSO119'
);
insert into public.classroom_enrollments (classroom_id, student_id) values (
  'a1100000-0000-4000-8000-000000000003',
  'a1100000-0000-4000-8000-000000000002'
);
insert into public.assignments (id, classroom_id, title, due_at, created_by) values (
  'a1100000-0000-4000-8000-000000000004',
  'a1100000-0000-4000-8000-000000000003',
  'Managed assignment',
  clock_timestamp() + interval '1 day',
  'a1100000-0000-4000-8000-000000000001'
);
insert into public.assignment_docs (id, assignment_id, student_id) values (
  'a1100000-0000-4000-8000-000000000005',
  'a1100000-0000-4000-8000-000000000004',
  'a1100000-0000-4000-8000-000000000002'
);
insert into public.assignment_submission_requirements (
  id, assignment_id, type, title, required, position
) values (
  'a1100000-0000-4000-8000-000000000006',
  'a1100000-0000-4000-8000-000000000004',
  'image', 'Evidence', true, 0
);

select public.begin_managed_storage_upload(
  'a1100000-0000-4000-8000-000000000010',
  'assignment-artifacts',
  'managed-fixture/attached.png',
  'a1100000-0000-4000-8000-000000000003',
  null, null,
  'student_assignment_artifact',
  'a1100000-0000-4000-8000-000000000002',
  'a1100000-0000-4000-8000-000000000002',
  'assignment_doc',
  'a1100000-0000-4000-8000-000000000005',
  'image/png', 4
);
insert into storage.objects (bucket_id, name)
values ('assignment-artifacts', 'managed-fixture/attached.png');
select public.verify_managed_storage_upload(
  'a1100000-0000-4000-8000-000000000010', null
);
insert into public.assignment_submission_artifacts (
  id, assignment_doc_id, requirement_id, student_id, type,
  storage_path, managed_object_id
) values (
  'a1100000-0000-4000-8000-000000000011',
  'a1100000-0000-4000-8000-000000000005',
  'a1100000-0000-4000-8000-000000000006',
  'a1100000-0000-4000-8000-000000000002',
  'image', 'managed-fixture/attached.png',
  'a1100000-0000-4000-8000-000000000010'
);

do $fixture$
declare
  v_run public.managed_storage_readiness_runs;
  v_claim public.managed_storage_objects;
begin
  if (select status from public.managed_storage_objects
      where id = 'a1100000-0000-4000-8000-000000000010') <> 'ready'
  then raise exception 'Relational attach did not atomically adopt the object'; end if;

  select * into v_run from public.refresh_managed_storage_readiness();
  if v_run.status <> 'ready' then
    raise exception 'Expected ready managed inventory, found % findings', v_run.finding_count;
  end if;
  perform public.activate_managed_storage_enforcement(v_run.generation, v_run.inventory_digest);

  begin
    update public.assignment_submission_artifacts
    set managed_object_id = null
    where id = 'a1100000-0000-4000-8000-000000000011';
    raise exception 'Managed identity removal was not rejected';
  exception when sqlstate '55000' then
    if sqlerrm not like '%assignment_artifact_managed%' then raise; end if;
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('submission-images', 'managed-fixture/unreserved.png');
    raise exception 'Legacy Storage writer was not rejected';
  exception when sqlstate '55000' then null;
  end;

  perform public.pause_managed_storage_enforcement();
  perform public.begin_managed_storage_upload(
    'a1100000-0000-4000-8000-000000000020',
    'submission-images', 'managed-fixture/interrupted.png',
    'a1100000-0000-4000-8000-000000000003', null, null,
    'student_inline_image',
    'a1100000-0000-4000-8000-000000000002',
    'a1100000-0000-4000-8000-000000000002',
    'assignment_doc', 'a1100000-0000-4000-8000-000000000005',
    'image/png', 4
  );
  insert into storage.objects (bucket_id, name)
  values ('submission-images', 'managed-fixture/interrupted.png');
  update public.managed_storage_objects
  set reservation_expires_at = clock_timestamp() - interval '1 second'
  where id = 'a1100000-0000-4000-8000-000000000020';
  select * into v_claim from public.claim_managed_storage_cleanup(
    'a1100000-0000-4000-8000-000000000021', 1, 30
  );
  if v_claim.id is distinct from 'a1100000-0000-4000-8000-000000000020' then
    raise exception 'Interrupted upload was not claimed for cleanup';
  end if;
  delete from storage.objects
  where bucket_id = v_claim.storage_bucket and name = v_claim.storage_path;
  if not public.complete_managed_storage_cleanup(v_claim.id, v_claim.lease_token) then
    raise exception 'Cleanup completion failed';
  end if;
  if not public.complete_managed_storage_cleanup(v_claim.id, v_claim.lease_token) then
    raise exception 'Cleanup completion replay was not idempotent';
  end if;
end;
$fixture$;

rollback;
SQL

echo "Managed-storage database contract checks passed."

# Prove that activation cannot overtake a writer which observed compatibility
# mode. The writer holds the shared protocol lock, then advances the revision
# and commits. Activation waits for that transaction and must reject the stale
# readiness evidence rather than enabling enforcement.
concurrency_dir="$(mktemp -d)"
trap 'rm -r -- "$concurrency_dir"' EXIT
readiness_evidence="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -q -A -t -F '|' -v ON_ERROR_STOP=1 <<'SQL'
insert into public.users (id, email, role) values (
  'a1200000-0000-4000-8000-000000000001',
  'managed-concurrency@example.test',
  'teacher'
);
insert into public.classrooms (id, teacher_id, title, class_code) values (
  'a1200000-0000-4000-8000-000000000002',
  'a1200000-0000-4000-8000-000000000001',
  'Managed concurrency fixture',
  'MSOACT'
);
select generation, inventory_digest
from public.refresh_managed_storage_readiness();
SQL
)"
readiness_generation="${readiness_evidence%%|*}"
readiness_digest="${readiness_evidence##*|}"
if [[ ! "$readiness_generation" =~ ^[0-9]+$ || ! "$readiness_digest" =~ ^[a-f0-9]{64}$ ]]; then
  echo "Managed-storage concurrency readiness evidence was invalid." >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  >"$concurrency_dir/writer.out" 2>"$concurrency_dir/writer.err" <<'SQL' &
set application_name = 'managed-storage-activation-writer';
begin;
select public.begin_managed_storage_upload(
  'a1200000-0000-4000-8000-000000000003',
  'submission-images', 'managed-fixture/concurrent.png',
  'a1200000-0000-4000-8000-000000000002', null, null,
  'student_inline_image',
  'a1200000-0000-4000-8000-000000000001', null,
  'assignment_doc', null, 'image/png', 4
);
select pg_sleep(3);
insert into storage.objects (bucket_id, name)
values ('submission-images', 'managed-fixture/concurrent.png');
commit;
SQL
writer_pid=$!

writer_waiting=false
for _ in $(seq 1 50); do
  active_writer="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -A -t -c \
    "select count(*) from pg_stat_activity where application_name = 'managed-storage-activation-writer' and state = 'active' and query like '%pg_sleep%';")"
  if [[ "$active_writer" = "1" ]]; then
    writer_waiting=true
    break
  fi
  sleep 0.1
done
if [[ "$writer_waiting" != "true" ]]; then
  wait "$writer_pid" || true
  echo "Managed-storage concurrency writer did not reach the activation fence." >&2
  exit 1
fi

set +e
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -c \
  "select public.activate_managed_storage_enforcement(${readiness_generation}, '${readiness_digest}');" \
  >"$concurrency_dir/activation.out" 2>"$concurrency_dir/activation.err"
activation_status=$?
set -e
wait "$writer_pid"
if [[ "$activation_status" -eq 0 ]] \
  || ! rg -q 'managed_storage_readiness_stale' "$concurrency_dir/activation.err"; then
  echo "Managed-storage activation overtook a pre-enforcement writer." >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
do $fixture$
begin
  if (select mode from public.managed_storage_settings where singleton) <> 'compatibility'
    or not exists (
      select 1 from storage.objects
      where bucket_id = 'submission-images' and name = 'managed-fixture/concurrent.png'
    )
  then
    raise exception 'Concurrent writer/activation postcondition failed';
  end if;
end;
$fixture$;
delete from storage.objects
where bucket_id = 'submission-images' and name = 'managed-fixture/concurrent.png';
delete from public.managed_storage_objects
where id = 'a1200000-0000-4000-8000-000000000003';
delete from public.classrooms where id = 'a1200000-0000-4000-8000-000000000002';
delete from public.users where id = 'a1200000-0000-4000-8000-000000000001';
SQL

echo "Managed-storage activation concurrency checks passed."
