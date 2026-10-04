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
run_marker="$(node -p 'require("node:crypto").randomBytes(32).toString("hex")')"
[[ "$run_marker" =~ ^[0-9a-f]{64}$ ]] || { echo 'Could not establish fixture run signature.' >&2; exit 2; }
fixture_email="managed-lock-245-$run_marker@example.invalid"
fixture_title="Managed storage lock fixture $run_marker"
fixture_resource="managed-lock-245-$run_marker"
printf 'run_marker=%s\nfixture_email=%s\nfixture_title=%s\nfixture_resource=%s\n' \
  "$run_marker" "$fixture_email" "$fixture_title" "$fixture_resource" >"$run_dir/fixture-signature.txt"
setup_attempted=false
fixture_ready=false
holder_pid=''
writer_pid=''
psql_db() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
    -v run_marker="$run_marker" -v fixture_email="$fixture_email" \
    -v fixture_title="$fixture_title" -v fixture_resource="$fixture_resource" "$@"
}
# This SELECT is also reused under cleanup locks. A lost COMMIT acknowledgement
# never establishes ownership by itself: every exact identity must match this
# run, including optional object13 once the absent-row fencing case commits.
fixture_state_sql="$(cat <<'SQL'
with expected_objects(id, path, required) as (values
 ('a2450000-0000-4000-8000-000000000010'::uuid,'managed-lock-245/queue-rollback.pdf',true),
 ('a2450000-0000-4000-8000-000000000011'::uuid,'managed-lock-245/verify-rollback.pdf',true),
 ('a2450000-0000-4000-8000-000000000012'::uuid,'managed-lock-245/queue-fence.pdf',true),
 ('a2450000-0000-4000-8000-000000000013'::uuid,'managed-lock-245/absent.pdf',false),
 ('a2450000-0000-4000-8000-000000000014'::uuid,'managed-lock-245/a-target.pdf',true),
 ('a2450000-0000-4000-8000-000000000015'::uuid,'managed-lock-245/z-source.pdf',true)
), fixture_users as (
 select * from public.users where id='a2450000-0000-4000-8000-000000000001'
   or email=:'fixture_email' or email like 'managed-lock-245-%@example.invalid'
), fixture_classrooms as (
 select * from public.classrooms where id='a2450000-0000-4000-8000-000000000002'
   or class_code='MSL245' or title=:'fixture_title'
   or teacher_id='a2450000-0000-4000-8000-000000000001'
), fixture_registry as (
 select * from public.managed_storage_objects
 where id in (select id from expected_objects)
   or (storage_bucket='test-documents' and storage_path like 'managed-lock-245/%')
   or classroom_id='a2450000-0000-4000-8000-000000000002'
   or created_by_user_id='a2450000-0000-4000-8000-000000000001'
   or resource_type=:'fixture_resource'
), fixture_storage as (
 select * from storage.objects
 where (bucket_id='test-documents' and name like 'managed-lock-245/%')
   or metadata->>'managed_lock_run'=:'run_marker'
)
select case
 when (select count(*) from fixture_users)=1
   and exists(select 1 from fixture_users where id='a2450000-0000-4000-8000-000000000001'
     and email=:'fixture_email' and role='teacher')
   and (select count(*) from fixture_classrooms)=1
   and exists(select 1 from fixture_classrooms where id='a2450000-0000-4000-8000-000000000002'
     and teacher_id='a2450000-0000-4000-8000-000000000001'
     and title=:'fixture_title' and class_code='MSL245')
   and not exists(select 1 from expected_objects expected where required
     and not exists(select 1 from fixture_registry object where object.id=expected.id))
   and not exists(select 1 from fixture_registry object left join expected_objects expected on object.id=expected.id
     where expected.id is null or object.storage_bucket is distinct from 'test-documents'
       or object.storage_path is distinct from expected.path
       or object.classroom_id is distinct from 'a2450000-0000-4000-8000-000000000002'::uuid
       or object.created_by_user_id is distinct from 'a2450000-0000-4000-8000-000000000001'::uuid
       or object.resource_type is distinct from :'fixture_resource'
       or object.purpose is distinct from 'teacher_test_material'
       or object.course_blueprint_id is not null or object.provisional_owner_id is not null)
   and (select count(*) from fixture_storage)=2
   and not exists(select 1 from fixture_storage where bucket_id is distinct from 'test-documents'
     or name is null or name not in ('managed-lock-245/verify-rollback.pdf','managed-lock-245/z-source.pdf')
     or metadata->>'managed_lock_run' is distinct from :'run_marker') then 'owned'
 when not exists(select 1 from fixture_users) and not exists(select 1 from fixture_classrooms)
   and not exists(select 1 from fixture_registry) and not exists(select 1 from fixture_storage) then 'empty'
 else 'unknown'
end as fixture_state;
SQL
)"
fixture_state() { printf '%s\n' "$fixture_state_sql" | psql_db -qAt 2>>"$run_dir/fixture-probe.err"; }
cleanup() {
  local outcome=$?
  trap - EXIT
  exec 9>&- || true
  for task_pid in "$holder_pid" "$writer_pid"; do
    if [[ -n "$task_pid" ]]; then kill "$task_pid" 2>/dev/null || true; wait "$task_pid" 2>/dev/null || true; fi
  done
  if [[ "$setup_attempted" == true ]]; then
    local state
    if ! state="$(fixture_state)"; then
      echo "Fixture setup/ownership outcome unknown; refusing cleanup. Inspect exact IDs/paths and logs $run_dir before retry." >&2
      outcome=1
    elif [[ "$state" == 'owned' ]]; then
      # Keep the same ownership recheck in the deletion transaction. Row locks
      # and exact path locks protect identities from drift after the probe.
      if ! {
        cat <<'SQL'
begin;
set local statement_timeout = '20s';
set local lock_timeout = '5s';
select public.lock_managed_storage_protocol();
select id from public.users where id='a2450000-0000-4000-8000-000000000001' for update;
select id from public.classrooms where id='a2450000-0000-4000-8000-000000000002' for update;
select id from public.managed_storage_objects
where id in (
 'a2450000-0000-4000-8000-000000000010','a2450000-0000-4000-8000-000000000011',
 'a2450000-0000-4000-8000-000000000012','a2450000-0000-4000-8000-000000000013',
 'a2450000-0000-4000-8000-000000000014','a2450000-0000-4000-8000-000000000015'
) order by id for update;
do $cleanup_paths$
declare v_path text;
begin
  for v_path in select path from (values
    ('managed-lock-245/queue-rollback.pdf'),('managed-lock-245/verify-rollback.pdf'),
    ('managed-lock-245/queue-fence.pdf'),('managed-lock-245/absent.pdf'),
    ('managed-lock-245/a-target.pdf'),('managed-lock-245/z-source.pdf')
  ) fixture(path) order by path loop
    perform public.managed_storage_exact_lock('test-documents', v_path);
  end loop;
end;
$cleanup_paths$;
select id from storage.objects where bucket_id='test-documents' and name like 'managed-lock-245/%'
order by name for update;
SQL
        printf '%s\n' "${fixture_state_sql%;}"
        cat <<'SQL'
\gset
select :'fixture_state' = 'owned' as fixture_owned \gset
\if :fixture_owned
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
SQL
        printf '%s\n' "${fixture_state_sql%;}"
        cat <<'SQL'
\gset
select :'fixture_state' = 'empty' as fixture_empty \gset
\if :fixture_empty
commit;
\else
do $cleanup_refused$ begin
  raise exception 'Exact fixture residue remains; rolling back cleanup.';
end; $cleanup_refused$;
\endif
\else
do $cleanup_refused$ begin
  raise exception 'Fixture ownership changed; refusing cleanup.';
end; $cleanup_refused$;
\endif
SQL
      } | psql_db -q >"$run_dir/cleanup.out" 2>"$run_dir/cleanup.err"; then
        echo "Fixture cleanup failed or ownership changed; retain logs $run_dir and inspect exact IDs/paths before retry." >&2
        outcome=1
      elif ! state="$(fixture_state)" || [[ "$state" != 'empty' ]]; then
        echo "Fixture cleanup acknowledgement/residue unknown; inspect exact IDs/paths and logs $run_dir before retry." >&2
        outcome=1
      else
        echo 'Exact managed-storage fixture teardown: PASS'
      fi
    elif [[ "$state" != 'empty' || "$fixture_ready" == true ]]; then
      echo "Partial, colliding or changed fixture ownership; refusing cleanup. Inspect exact IDs/paths and logs $run_dir before retry." >&2
      outcome=1
    fi
  fi
  echo "Lock-order harness logs: $run_dir" >&2
  exit "$outcome"
}
trap cleanup EXIT
# Arm recovery before the setup process: COMMIT may succeed even when its
# acknowledgement is lost. The run-signature SELECT above decides ownership.
setup_attempted=true
psql_db <<'SQL'
begin;
set local pika.managed_lock_run = :'run_marker';
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
    or exists (select 1 from public.users where email like 'managed-lock-245-%@example.invalid')
    or exists (select 1 from public.classrooms where id = 'a2450000-0000-4000-8000-000000000002'
      or class_code='MSL245' or teacher_id='a2450000-0000-4000-8000-000000000001'
      or title='Managed storage lock fixture ' || current_setting('pika.managed_lock_run'))
    or exists (select 1 from storage.objects where (bucket_id = 'test-documents' and name like 'managed-lock-245/%')
      or metadata->>'managed_lock_run'=current_setting('pika.managed_lock_run'))
    or exists (select 1 from public.managed_storage_objects where id in (
      'a2450000-0000-4000-8000-000000000010','a2450000-0000-4000-8000-000000000011',
      'a2450000-0000-4000-8000-000000000012','a2450000-0000-4000-8000-000000000013',
      'a2450000-0000-4000-8000-000000000014','a2450000-0000-4000-8000-000000000015'
    ) or (storage_bucket = 'test-documents' and storage_path like 'managed-lock-245/%')
      or classroom_id='a2450000-0000-4000-8000-000000000002'
      or created_by_user_id='a2450000-0000-4000-8000-000000000001'
      or resource_type='managed-lock-245-' || current_setting('pika.managed_lock_run')) then
    raise exception 'Fixture IDs/paths already exist; refusing to touch existing data';
  end if;
end;
$preflight$;
insert into public.users(id,email,role) values
  ('a2450000-0000-4000-8000-000000000001',:'fixture_email','teacher');
insert into public.classrooms(id,teacher_id,title,class_code) values
  ('a2450000-0000-4000-8000-000000000002','a2450000-0000-4000-8000-000000000001',:'fixture_title','MSL245');
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
      'a2450000-0000-4000-8000-000000000001',null,
      'managed-lock-245-' || current_setting('pika.managed_lock_run'),null,'application/pdf',4
    );
  end loop;
end;
$fixtures$;
insert into storage.objects(bucket_id,name,metadata) values
  ('test-documents','managed-lock-245/verify-rollback.pdf',jsonb_build_object('size',4,'managed_lock_run',:'run_marker')),
  ('test-documents','managed-lock-245/z-source.pdf',jsonb_build_object('size',4,'managed_lock_run',:'run_marker'));
commit;
SQL
if [[ "${MANAGED_STORAGE_FORCE_SETUP_ACK_FAILURE:-0}" == '1' ]]; then
  echo 'Forced failure after fixture setup COMMIT before acknowledgement (teardown control)' >&2
  exit 1
fi
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
 'a2450000-0000-4000-8000-000000000001',null,:'fixture_resource',null,'application/pdf',4
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
