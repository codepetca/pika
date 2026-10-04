#!/usr/bin/env bash
# Requires an explicitly authorized disposable LOCAL database through migration
# 245, in compatibility mode. This harness creates committed cross-session
# fixtures; all worker transactions roll back except the two fencing cases.
# EXIT cleanup deletes only its exact fixture IDs/paths, in one transaction.
# Never run against a shared/hosted database. No migration/reset is performed.
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "Refusing to source the managed-storage database harness." >&2
  return 1
fi
set -euo pipefail
if [[ "${1:-}" != "--allow-fixture-writes" || -z "${MANAGED_STORAGE_DB_CONTAINER:-}" ]]; then
  echo 'Requires --allow-fixture-writes and exact MANAGED_STORAGE_DB_CONTAINER for an authorized disposable local DB.' >&2
  exit 2
fi
DB_CONTAINER="$MANAGED_STORAGE_DB_CONTAINER"
if [[ ! "$DB_CONTAINER" =~ ^supabase_db_([a-zA-Z0-9_-]+)$ ]]; then
  echo 'Expected an explicitly named local Supabase container.' >&2
  exit 2
fi
expected_project="${BASH_REMATCH[1]}"
container_name="$(docker inspect --format '{{.Name}}' "$DB_CONTAINER")"
project_label="$(docker inspect --format '{{index .Config.Labels "com.supabase.cli.project"}}' "$DB_CONTAINER")"
if [[ "$container_name" != "/$DB_CONTAINER" || "$project_label" != "$expected_project" ]]; then
  echo 'Local Supabase container identity did not match.' >&2
  exit 2
fi
run_dir="$(mktemp -d)"
fixture_ready=false
holder_pid=''
writer_pid=''
psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 "$@"; }
cleanup() {
  local outcome=$?
  trap - EXIT
  exec 9>&- || true
  for task_pid in "$holder_pid" "$writer_pid"; do
    if [[ -n "$task_pid" ]]; then kill "$task_pid" 2>/dev/null || true; wait "$task_pid" 2>/dev/null || true; fi
  done
  if [[ "$fixture_ready" == true ]]; then
    if ! psql_db <<'SQL'
begin;
set local statement_timeout = '20s';
select set_config('storage.allow_delete_query', 'true', true);
delete from public.managed_storage_objects
where id in (
 'a2450000-0000-4000-8000-000000000010','a2450000-0000-4000-8000-000000000011',
 'a2450000-0000-4000-8000-000000000012','a2450000-0000-4000-8000-000000000013',
 'a2450000-0000-4000-8000-000000000014','a2450000-0000-4000-8000-000000000015'
);
delete from storage.objects
where bucket_id = 'test-documents' and name in (
 'managed-lock-245/queue-rollback.pdf','managed-lock-245/verify-rollback.pdf',
 'managed-lock-245/queue-fence.pdf','managed-lock-245/absent.pdf',
 'managed-lock-245/a-target.pdf','managed-lock-245/z-source.pdf'
);
delete from public.classrooms where id = 'a2450000-0000-4000-8000-000000000002';
delete from public.users where id = 'a2450000-0000-4000-8000-000000000001';
commit;
SQL
    then
      echo "Fixture cleanup failed; retain logs $run_dir and clean the exact fixture IDs/paths before retry." >&2
      outcome=1
    fi
  fi
  echo "Lock-order harness logs: $run_dir" >&2
  exit "$outcome"
}
trap cleanup EXIT
psql_db <<'SQL'
begin;
do $preflight$
begin
  if (select mode from public.managed_storage_settings where singleton) <> 'compatibility' then
    raise exception 'Harness requires disposable DB compatibility mode; it never changes global mode';
  end if;
  if position('managed_storage_write_retry' in pg_get_functiondef(
    'public.enforce_managed_storage_object_write()'::regprocedure)) = 0 then
    raise exception 'Apply exact migration 245 through the separately authorized migration workflow first';
  end if;
  if exists (select 1 from public.users where id = 'a2450000-0000-4000-8000-000000000001')
    or exists (select 1 from storage.objects where bucket_id = 'test-documents' and name like 'managed-lock-245/%')
    or exists (select 1 from public.managed_storage_objects where storage_bucket = 'test-documents' and storage_path like 'managed-lock-245/%') then
    raise exception 'Fixture IDs/paths already exist; refusing to touch existing data';
  end if;
end;
$preflight$;
insert into public.users(id,email,role) values
  ('a2450000-0000-4000-8000-000000000001','managed-lock-245@example.test','teacher');
insert into public.classrooms(id,teacher_id,title,class_code) values
  ('a2450000-0000-4000-8000-000000000002','a2450000-0000-4000-8000-000000000001','Lock order 245','MSL245');
do $fixtures$
declare v_index integer; v_name text;
begin
  for v_index, v_name in select * from (values
    (10,'queue-rollback.pdf'), (11,'verify-rollback.pdf'), (12,'queue-fence.pdf'),
    (14,'a-target.pdf'), (15,'z-source.pdf')
  ) fixture(index,name) loop
    perform public.begin_managed_storage_upload(
      ('a2450000-0000-4000-8000-' || lpad(v_index::text,12,'0'))::uuid,
      'test-documents','managed-lock-245/' || v_name,
      'a2450000-0000-4000-8000-000000000002',null,null,'teacher_test_material',
      'a2450000-0000-4000-8000-000000000001',null,'test',null,'application/pdf',4
    );
  end loop;
end;
$fixtures$;
insert into storage.objects(bucket_id,name,metadata) values
  ('test-documents','managed-lock-245/verify-rollback.pdf','{"size":4}'::jsonb),
  ('test-documents','managed-lock-245/z-source.pdf','{"size":4}'::jsonb);
commit;
SQL
fixture_ready=true

# FIFO barriers, not fixed sleeps: the holder is idle with its row/path lock
# until the observer confirms the Storage writer is actually blocked on a lock.
start_holder() {
  local label="$1"
  mkfifo "$run_dir/$label.input"
  psql_db <"$run_dir/$label.input" >"$run_dir/$label.holder.out" 2>"$run_dir/$label.holder.err" &
  holder_pid=$!
  exec 9>"$run_dir/$label.input"
  printf "set application_name = 'managed-lock-245-holder';\nbegin;\nset local statement_timeout = '15s';\n" >&9
}
holder_sql() { cat >&9; }
wait_holder() {
  local label="$1" ready=false
  for ((attempt=0; attempt<100; attempt++)); do
    if grep -q '^HOLDER_READY$' "$run_dir/$label.holder.out"; then ready=true; break; fi
    sleep 0.1
  done
  [[ "$ready" == true ]] || { echo "$label holder did not reach its lock barrier" >&2; return 1; }
}
start_writer() {
  local label="$1"
  psql_db <&0 >"$run_dir/$label.writer.out" 2>"$run_dir/$label.writer.err" &
  writer_pid=$!
}
wait_writer_lock() {
  local waiting=false
  for ((attempt=0; attempt<100; attempt++)); do
    if [[ "$(psql_db -Atc "select count(*) from pg_stat_activity where application_name = 'managed-lock-245-writer' and wait_event_type = 'Lock';")" == 1 ]]; then
      waiting=true; break
    fi
    sleep 0.1
  done
  [[ "$waiting" == true ]] || { echo 'Writer never reached the actual lock wait' >&2; return 1; }
}
finish_race() {
  exec 9>&-
  wait "$holder_pid"; holder_pid=''
  wait "$writer_pid"; writer_pid=''
}

# Queue owns the row while INSERT begins. Old 118 path -> row deadlocks when
# queue requests the path. Both transactions must instead finish and roll back.
start_holder queue
holder_sql <<'SQL'
select public.lock_managed_storage_protocol();
select id from public.managed_storage_objects where id='a2450000-0000-4000-8000-000000000010' for update;
\echo HOLDER_READY
SQL
wait_holder queue
start_writer queue <<'SQL'
set application_name='managed-lock-245-writer';
begin; set local statement_timeout='15s';
insert into storage.objects(bucket_id,name) values ('test-documents','managed-lock-245/queue-rollback.pdf');
rollback;
SQL
wait_writer_lock
holder_sql <<'SQL'
select public.queue_managed_storage_cleanup('a2450000-0000-4000-8000-000000000010','fixture_rollback');
rollback;
\quit
SQL
finish_race

# Verification owns the same row while an existing metadata UPDATE begins.
start_holder verify
holder_sql <<'SQL'
select public.lock_managed_storage_protocol();
select id from public.managed_storage_objects where id='a2450000-0000-4000-8000-000000000011' for update;
\echo HOLDER_READY
SQL
wait_holder verify
start_writer verify <<'SQL'
set application_name='managed-lock-245-writer';
begin; set local statement_timeout='15s';
update storage.objects set metadata='{"size":4,"fixture":true}'::jsonb
where bucket_id='test-documents' and name='managed-lock-245/verify-rollback.pdf';
rollback;
SQL
wait_writer_lock
holder_sql <<'SQL'
select public.verify_managed_storage_upload('a2450000-0000-4000-8000-000000000011',null);
rollback;
\quit
SQL
finish_race

# Committing cancellation while INSERT waits must reject the bytes afterwards.
start_holder fence
holder_sql <<'SQL'
select public.lock_managed_storage_protocol();
select id from public.managed_storage_objects where id='a2450000-0000-4000-8000-000000000012' for update;
\echo HOLDER_READY
SQL
wait_holder fence
start_writer fence <<'SQL'
set application_name='managed-lock-245-writer';
begin; set local statement_timeout='15s';
do $fence$
begin
  insert into storage.objects(bucket_id,name) values ('test-documents','managed-lock-245/queue-fence.pdf');
  raise exception 'Storage write bypassed committed cleanup';
exception when sqlstate '55000' then
  if sqlerrm <> 'managed_storage_cleanup_in_progress' then raise; end if;
end;
$fence$;
rollback;
SQL
wait_writer_lock
holder_sql <<'SQL'
select public.queue_managed_storage_cleanup('a2450000-0000-4000-8000-000000000012','fixture_fence');
commit;
\quit
SQL
finish_race

# Registry initially invisible to the writer; it commits while writer waits for
# the exact path. The writer must retry, without taking a post-path row lock.
start_holder absent
holder_sql <<'SQL'
select public.begin_managed_storage_upload(
 'a2450000-0000-4000-8000-000000000013','test-documents','managed-lock-245/absent.pdf',
 'a2450000-0000-4000-8000-000000000002',null,null,'teacher_test_material',
 'a2450000-0000-4000-8000-000000000001',null,'test',null,'application/pdf',4
);
\echo HOLDER_READY
SQL
wait_holder absent
start_writer absent <<'SQL'
set application_name='managed-lock-245-writer';
begin; set local statement_timeout='15s';
do $retry$
begin
  insert into storage.objects(bucket_id,name) values ('test-documents','managed-lock-245/absent.pdf');
  raise exception 'Writer accepted a newly appeared unlocked registry row';
exception when sqlstate '40001' then
  if sqlerrm <> 'managed_storage_write_retry' then raise; end if;
end;
$retry$;
rollback;
SQL
wait_writer_lock
holder_sql <<'SQL'
commit;
\quit
SQL
finish_race

# Compatibility rename: old/new rows must both precede path acquisition, and
# follow UUID order. Target UUID 14 precedes source UUID 15.
start_holder rename
holder_sql <<'SQL'
select public.lock_managed_storage_protocol();
select id from public.managed_storage_objects where id='a2450000-0000-4000-8000-000000000014' for update;
\echo HOLDER_READY
SQL
wait_holder rename
start_writer rename <<'SQL'
set application_name='managed-lock-245-writer';
begin; set local statement_timeout='15s';
update storage.objects set name='managed-lock-245/a-target.pdf'
where bucket_id='test-documents' and name='managed-lock-245/z-source.pdf';
rollback;
SQL
wait_writer_lock
holder_sql <<'SQL'
select id from public.managed_storage_objects where id='a2450000-0000-4000-8000-000000000015' for update;
select public.managed_storage_exact_lock('test-documents','managed-lock-245/a-target.pdf');
select public.managed_storage_exact_lock('test-documents','managed-lock-245/z-source.pdf');
rollback;
\quit
SQL
finish_race
psql_db <<'SQL'
do $postconditions$
begin
 if exists (select 1 from storage.objects where bucket_id='test-documents'
   and name in ('managed-lock-245/queue-rollback.pdf','managed-lock-245/queue-fence.pdf','managed-lock-245/absent.pdf','managed-lock-245/a-target.pdf'))
   or (select status from public.managed_storage_objects where id='a2450000-0000-4000-8000-000000000010') <> 'reserved'
   or (select status from public.managed_storage_objects where id='a2450000-0000-4000-8000-000000000011') <> 'reserved'
   or (select status from public.managed_storage_objects where id='a2450000-0000-4000-8000-000000000012') <> 'cleanup_pending'
   or not exists (select 1 from storage.objects where bucket_id='test-documents' and name='managed-lock-245/z-source.pdf') then
   raise exception 'Lock-order/fence postconditions failed';
 end if;
end;
$postconditions$;
SQL
echo 'Managed storage write lock order and claimant fences PASS.'
