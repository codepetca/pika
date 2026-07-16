#!/usr/bin/env bash

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}' | head -n 1)"
if [[ -z "$DB_CONTAINER" ]]; then
  DB_CONTAINER="$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)"
fi

if [[ -z "$DB_CONTAINER" ]]; then
  echo "Local Supabase database container is not running." >&2
  exit 1
fi

TMP_DB="${ASSIGNMENT_CONCURRENCY_DATABASE_NAME:-pika_assignment_concurrency_${RANDOM}_$$}"
cleanup() {
  if [[ "${KEEP_ASSIGNMENT_CONCURRENCY_DATABASE:-false}" == "true" ]]; then
    echo "Kept disposable assignment database: $TMP_DB"
    return
  fi
  docker exec "$DB_CONTAINER" dropdb -U postgres --if-exists "$TMP_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker exec "$DB_CONTAINER" createdb -U postgres "$TMP_DB"
docker exec "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 -c '
  drop schema public;
  create schema extensions;
  create extension "uuid-ossp" with schema extensions;
  create extension pgcrypto with schema extensions;
  create extension pg_stat_statements with schema extensions;
  create schema vault;
  create extension supabase_vault with schema vault;
  create extension pg_net with schema extensions;
' >/dev/null

# Clone only the Supabase platform baseline, then rebuild application schemas at 098.
docker exec "$DB_CONTAINER" pg_dump -U postgres -d postgres --schema-only --no-owner --no-privileges \
  --schema=public --schema=private --schema=auth --schema=storage \
  | sed '/^SET log_min_messages =/d; /^CREATE SCHEMA extensions;/d; /^CREATE SCHEMA vault;/d' \
  | docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
set client_min_messages = warning;
do $$
declare
  v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'storage'
  loop
    execute format(
      'drop policy %I on %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );
  end loop;
end;
$$;
drop schema public cascade;
drop schema private cascade;
create schema public;
SQL

for migration in "$ROOT"/supabase/migrations/*.sql; do
  if [[ "$(basename "$migration")" == 099_* ]]; then
    break
  fi
  docker exec -e PGOPTIONS='-c client_min_messages=warning' -i "$DB_CONTAINER" \
    psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 \
    < "$migration" >/dev/null
done
docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
begin;
select set_config('pika.classroom_archive_restore', 'on', true);
select set_config('pika.classroom_archive_source_revision', '1', true);
insert into public.users (id, email, role, email_verified_at) values
  ('20000000-0000-4000-8000-000000000001', 'backfill-teacher@example.invalid', 'teacher', clock_timestamp()),
  ('20000000-0000-4000-8000-000000000002', 'backfill-student@example.invalid', 'student', clock_timestamp());
insert into public.classrooms (id, teacher_id, title, class_code) values
  ('20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'Backfill', 'BACKFILL');
insert into public.assignments (id, classroom_id, title, description, due_at, created_by) values
  ('20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000003',
   'Backfill assignment', '', '2026-03-01T00:00:00.000Z', '20000000-0000-4000-8000-000000000001');
insert into public.assignment_docs (
  id, assignment_id, student_id, content, is_submitted, submitted_at
) values (
  '20000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000002', '{"type":"doc","content":[]}'::jsonb,
  true, '2026-02-01T00:00:00.000Z'
);
insert into public.assignment_doc_history (
  id, assignment_doc_id, patch, snapshot, word_count, char_count, trigger, created_at
) values (
  '20000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000005',
  null, '{"type":"doc","content":[]}'::jsonb, 0, 0, 'submit', '2026-01-01T00:00:00.000Z'
);
commit;
SQL
docker exec -e PGOPTIONS='-c client_min_messages=warning' -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 \
  < "$ROOT/supabase/migrations/099_assignment_submission_integrity_guards.sql" >/dev/null

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$
begin
  if (select count(*) from public.classroom_archive_resource_contract) <> 42 then
    raise exception 'Migration changed the 42-resource classroom archive contract';
  end if;
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.assignment_doc_save_operations'::regclass
      and contype = 'f'
  ) then
    raise exception 'Operational save ledger unexpectedly entered classroom FK ownership';
  end if;
  if not exists (
    select 1
    from public.assignment_doc_history h
    join public.assignment_docs d on d.id = h.assignment_doc_id
    where d.id = '20000000-0000-4000-8000-000000000005'
      and h.trigger = 'submit'
      and h.created_at >= d.submitted_at
      and h.patch is null
      and h.snapshot = d.content
  ) then
    raise exception 'Migration did not backfill the current authoritative submit snapshot';
  end if;
end;
$$;
SQL

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into public.users (id, email, role, email_verified_at) values
  ('10000000-0000-4000-8000-000000000001', 'concurrency-teacher@example.invalid', 'teacher', clock_timestamp()),
  ('10000000-0000-4000-8000-000000000002', 'concurrency-student@example.invalid', 'student', clock_timestamp());

insert into public.classrooms (id, teacher_id, title, class_code) values
  ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Concurrency', 'CONCUR01');

insert into public.assignments (id, classroom_id, title, description, due_at, created_by) values
  ('10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003',
   'Concurrency assignment', '', clock_timestamp() + interval '1 day', '10000000-0000-4000-8000-000000000001');

insert into public.assignment_docs (
  id, assignment_id, student_id, content, save_session_id, save_sequence
) values (
  '10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000002', '{"type":"doc","content":[]}'::jsonb,
  '10000000-0000-4000-8000-000000000006', 1
);

insert into public.assignment_doc_history (
  id, assignment_doc_id, patch, snapshot, word_count, char_count, trigger
) values (
  '10000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000005',
  null, '{"type":"doc","content":[]}'::jsonb, 0, 0, 'baseline'
);

insert into public.assignment_submission_requirements (
  id, assignment_id, type, label, required, position
) values (
  '10000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000004',
  'link', 'Link', false, 0
);

insert into public.assignment_submission_artifacts (
  id, assignment_doc_id, requirement_id, student_id, type, url, validation_status
) values (
  '10000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000002',
  'link', 'https://example.invalid/old', 'valid'
);
SQL

run_history_cleanup_race() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
create or replace function public.pause_assignment_doc_update_for_concurrency_check()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('pika.assignment_concurrency_pause', true) = 'on' then
    perform pg_sleep(1);
  end if;
  return new;
end;
$$;
create trigger zzz_pause_assignment_doc_update_for_concurrency_check
after update on public.assignment_docs
for each row execute function public.pause_assignment_doc_update_for_concurrency_check();
SQL

  docker exec "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 -c "
    set lock_timeout = '5s';
    begin;
    select set_config('pika.assignment_concurrency_pause', 'on', true);
    select public.save_assignment_doc_atomic(
      '10000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000002',
      '{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}'::jsonb,
      (select updated_at from public.assignment_docs where id = '10000000-0000-4000-8000-000000000005'),
      'autosave', 0, 1, '[]'::jsonb, null, 0, 0,
      '10000000-0000-4000-8000-000000000006', 2, gen_random_uuid()
    );
    commit;
  " >/dev/null &
  local save_pid=$!

  sleep 0.2
  docker exec "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 -c "
    set lock_timeout = '5s';
    begin;
    delete from public.assignment_doc_history
      where id = '10000000-0000-4000-8000-000000000007';
    select pg_sleep(1);
    commit;
  " >/dev/null &
  local cleanup_pid=$!

  wait "$save_pid"
  wait "$cleanup_pid"

  docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
drop trigger zzz_pause_assignment_doc_update_for_concurrency_check on public.assignment_docs;
drop function public.pause_assignment_doc_update_for_concurrency_check();
SQL
}

run_old_submit_new_requirement_rpc_race() {
  docker exec "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 -c "
    set lock_timeout = '5s';
    begin;
    update public.assignment_docs
      set is_submitted = true, submitted_at = clock_timestamp()
      where id = '10000000-0000-4000-8000-000000000005';
    select pg_sleep(1);
    insert into public.assignment_doc_history (
      assignment_doc_id, patch, snapshot, word_count, char_count, trigger
    ) select id, null, content, 0, 0, 'submit'
      from public.assignment_docs
      where id = '10000000-0000-4000-8000-000000000005';
    commit;
  " >/dev/null &
  local submit_pid=$!

  sleep 0.2
  docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
set lock_timeout = '5s';
do $$
declare
  v_result jsonb;
begin
  v_result := public.update_assignment_with_submission_requirements_atomic(
    '10000000-0000-4000-8000-000000000004',
    '{"title":"Concurrent teacher update"}'::jsonb,
    '[{"id":"10000000-0000-4000-8000-000000000008","type":"link","label":"Link","required":false,"position":0,"validation_policy_json":{}}]'::jsonb
  );
  if (v_result->>'status')::integer is distinct from 409 then
    raise exception 'Concurrent requirement update was not rejected: %', v_result;
  end if;
exception
  when check_violation then
    if sqlerrm not like '%assignment_requirements_submitted_documents_immutable%' then
      raise;
    end if;
end;
$$;
SQL
  local requirement_rpc_pid=$!

  wait "$submit_pid"
  wait "$requirement_rpc_pid"

  docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$
declare
  v_result jsonb;
begin
  v_result := public.unsubmit_assignment_doc_atomic(
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000002'
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Concurrency fixture could not be reset after direct submit: %', v_result;
  end if;
end;
$$;
SQL
}

run_legacy_stale_snapshot_repair() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$
declare
  v_result jsonb;
  v_revision timestamptz;
begin
  select updated_at into v_revision
  from public.assignment_docs
  where id = '10000000-0000-4000-8000-000000000005';

  v_result := public.save_assignment_doc_atomic(
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000002',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Concurrent newer draft"}]}]}'::jsonb,
    v_revision, 'autosave', 0, 1, '[]'::jsonb, null, 3, 22,
    '10000000-0000-4000-8000-000000000006', 3, gen_random_uuid()
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Newer overlap save failed: %', v_result;
  end if;
end;
$$;

update public.assignment_docs
set is_submitted = true, submitted_at = clock_timestamp()
where id = '10000000-0000-4000-8000-000000000005';

do $$
begin
  begin
    insert into public.assignment_doc_history (
      assignment_doc_id, patch, snapshot, word_count, char_count, trigger
    ) values (
      '10000000-0000-4000-8000-000000000005', null,
      '{"type":"doc","content":[]}'::jsonb, 0, 0, 'submit'
    );
    raise exception 'Stale legacy submit snapshot unexpectedly succeeded';
  exception
    when check_violation then
      if sqlerrm not like '%assignment_submit_history_snapshot_invalid%' then
        raise;
      end if;
  end;

  if not exists (
    select 1
    from public.assignment_doc_history h
    join public.assignment_docs d on d.id = h.assignment_doc_id
    where d.id = '10000000-0000-4000-8000-000000000005'
      and h.trigger = 'submit'
      and h.created_at >= d.submitted_at
      and h.patch is null
      and h.snapshot = d.content
      and h.word_count = 3
      and h.char_count = 22
  ) then
    raise exception 'Legacy direct submit was left without authoritative counted history';
  end if;

  if coalesce((public.unsubmit_assignment_doc_atomic(
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000002'
  )->>'ok')::boolean, false) is not true then
    raise exception 'Legacy overlap fixture could not be reset';
  end if;
end;
$$;
SQL
}

run_teacher_artifact_race() {
  docker exec "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 -c "
    set lock_timeout = '5s';
    begin;
    select 1 from public.assignment_submission_artifacts
      where id = '10000000-0000-4000-8000-000000000009' for update;
    select pg_sleep(1);
    update public.assignment_submission_artifacts
      set url = 'https://example.invalid/new'
      where id = '10000000-0000-4000-8000-000000000009';
    commit;
  " >/dev/null &
  local artifact_pid=$!

  sleep 0.2
  docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
set lock_timeout = '5s';
do $$
declare
  v_result jsonb;
begin
  v_result := public.update_assignment_with_submission_requirements_atomic(
    '10000000-0000-4000-8000-000000000004',
    '{}'::jsonb,
    '[{"id":"10000000-0000-4000-8000-000000000008","type":"link","label":"Link","required":false,"position":0,"validation_policy_json":{}}]'::jsonb
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Concurrent teacher requirement update failed: %', v_result;
  end if;
end;
$$;
SQL
  local requirement_pid=$!

  wait "$artifact_pid"
  wait "$requirement_pid"
}

run_old_replace_new_combined_race() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
set lock_timeout = '5s';
begin;
select * from public.replace_assignment_submission_requirements_atomic(
  '10000000-0000-4000-8000-000000000004',
  '[{"id":"10000000-0000-4000-8000-000000000008","type":"link","label":"Legacy","required":false,"position":0,"validation_policy_json":{}}]'::jsonb
);
select pg_sleep(1);
commit;
SQL
  local legacy_pid=$!

  sleep 0.2
  docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
set lock_timeout = '5s';
do $$
declare
  v_result jsonb;
begin
  v_result := public.update_assignment_with_submission_requirements_atomic(
    '10000000-0000-4000-8000-000000000004',
    '{"title":"Combined after legacy"}'::jsonb,
    '[{"id":"10000000-0000-4000-8000-000000000008","type":"link","label":"Combined","required":false,"position":0,"validation_policy_json":{}}]'::jsonb
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Combined update after legacy overlap failed: %', v_result;
  end if;
end;
$$;
SQL
  local combined_pid=$!

  wait "$legacy_pid"
  wait "$combined_pid"
}

run_artifact_cleanup_lease_reenqueue_race() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$
declare
  v_path text := 'concurrency/cleanup-lease.png';
  v_first_lease constant uuid := '10000000-0000-4000-8000-000000000020';
  v_second_lease constant uuid := '10000000-0000-4000-8000-000000000021';
  v_claim public.assignment_artifact_storage_cleanup%rowtype;
begin
  perform public.enqueue_assignment_artifact_storage_cleanup_path(v_path, 0);
  select * into v_claim
  from public.claim_assignment_artifact_storage_cleanup_path(v_path, v_first_lease, 120);
  if v_claim.id is null then
    raise exception 'Cleanup lease race fixture was not claimed';
  end if;

  -- This models a second request arriving while the first worker is outside
  -- PostgreSQL deleting from Storage under its committed lease.
  perform public.enqueue_assignment_artifact_storage_cleanup_path(v_path, 0);
  if not exists (
    select 1 from public.assignment_artifact_storage_cleanup
    where id = v_claim.id and status = 'processing' and lease_token = v_first_lease
  ) then
    raise exception 'Concurrent re-enqueue revoked the active cleanup lease';
  end if;
  if exists (
    select 1 from public.claim_assignment_artifact_storage_cleanup_path(v_path, v_second_lease, 120)
  ) then
    raise exception 'Concurrent exact-path claim stole an active cleanup lease';
  end if;
  if public.complete_assignment_artifact_storage_cleanup(v_claim.id, v_second_lease) then
    raise exception 'Stale cleanup worker completed another lease';
  end if;
  if not public.complete_assignment_artifact_storage_cleanup(v_claim.id, v_first_lease) then
    raise exception 'Owning cleanup worker could not complete its lease';
  end if;
end;
$$;
SQL
}

run_history_cleanup_race
run_legacy_stale_snapshot_repair
run_old_submit_new_requirement_rpc_race
run_teacher_artifact_race
run_old_replace_new_combined_race
run_artifact_cleanup_lease_reenqueue_race

echo "Assignment submission concurrency checks passed in a disposable database."
