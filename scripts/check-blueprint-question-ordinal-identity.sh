#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${BLUEPRINT_ORDINAL_DB_CONTAINER:-$(docker ps --filter 'name=supabase_db_pika' --format '{{.Names}}' | head -n 1)}"
if [[ -z "$DB_CONTAINER" ]]; then
  DB_CONTAINER="$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)"
fi
DATABASE_NAME="${BLUEPRINT_ORDINAL_DATABASE_NAME:-postgres}"
MIGRATION_FILE="${BLUEPRINT_ORDINAL_MIGRATION_FILE:-supabase/migrations/134_blueprint_test_question_ordinal_identity.sql}"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

# Rehearse the migration's two-table write fence with two database sessions.
# A question writer must wait while both backfill source tables carry the exact
# lock mode declared by migration 134.
docker exec -e PGAPPNAME=b134_backfill_lock_contract -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
lock table public.assessment_drafts in exclusive mode;
lock table public.test_questions in share row exclusive mode;
select pg_sleep(5);
rollback;
SQL
backfill_locker_pid=$!
backfill_lock_ready=false
for _attempt in {1..40}; do
  held_backfill_locks="$(docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -Atqc \
    "select count(*) from pg_catalog.pg_locks l join pg_catalog.pg_class c on c.oid = l.relation join pg_catalog.pg_stat_activity a on a.pid = l.pid where a.application_name = 'b134_backfill_lock_contract' and l.granted and ((c.relname = 'assessment_drafts' and l.mode = 'ExclusiveLock') or (c.relname = 'test_questions' and l.mode = 'ShareRowExclusiveLock'))")"
  if [[ "$held_backfill_locks" == "2" ]]; then
    backfill_lock_ready=true
    break
  fi
  sleep 0.1
done
if [[ "$backfill_lock_ready" != "true" ]]; then
  kill "$backfill_locker_pid" 2>/dev/null || true
  wait "$backfill_locker_pid" 2>/dev/null || true
  echo "Migration backfill lock rehearsal did not acquire both source-table locks." >&2
  exit 1
fi

set +e
blocked_writer_output="$(docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 2>&1 <<'SQL'
set lock_timeout = '500ms';
update public.test_questions set position = position where false;
SQL
)"
blocked_writer_status=$?
set -e
wait "$backfill_locker_pid"
if [[ "$blocked_writer_status" -eq 0 ]] \
  || [[ "$blocked_writer_output" != *"lock timeout"* ]]; then
  echo "Question writes were not fenced by the migration backfill locks." >&2
  echo "$blocked_writer_output" >&2
  exit 1
fi

# Rehearse the application save lock order against the migration fence. A save
# may already hold Classroom/Test/Draft row locks before its first table write.
# The migration must wait at the Draft table before it holds the question fence,
# allowing the save to finish without a lock-upgrade deadlock.
docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into public.users (id, email, role) values (
  'b1348000-0000-4000-8000-000000000001',
  'blueprint-question-migration-lock-order@example.test',
  'teacher'
);
insert into public.classrooms (
  id, teacher_id, title, class_code
) values (
  'b1348000-0000-4000-8000-000000000010',
  'b1348000-0000-4000-8000-000000000001',
  'Migration lock order',
  'B134L8'
);
insert into public.tests (
  id, classroom_id, title, status, show_results, points_possible, created_by
) values (
  'b1348000-0000-4000-8000-000000000011',
  'b1348000-0000-4000-8000-000000000010',
  'Migration lock order',
  'active',
  false,
  1,
  'b1348000-0000-4000-8000-000000000001'
);
insert into public.test_questions (
  id, test_id, artifact_id, question_type, question_text, options,
  correct_option, points, response_max_chars, response_monospace, position
) values (
  'b1348000-0000-4000-8000-000000000013',
  'b1348000-0000-4000-8000-000000000011',
  'b1348000-0000-4000-8000-000000000014',
  'open_response',
  'Migration lock order question',
  '[]'::jsonb,
  null,
  1,
  5000,
  false,
  0
);
insert into public.assessment_drafts (
  id, assessment_type, assessment_id, classroom_id, content, version,
  created_by, updated_by
) values (
  'b1348000-0000-4000-8000-000000000012',
  'test',
  'b1348000-0000-4000-8000-000000000011',
  'b1348000-0000-4000-8000-000000000010',
  '{"title":"Migration lock order","show_results":false,"question_identity_version":1,"questions":[{"id":"b1348000-0000-4000-8000-000000000014","question_type":"open_response","question_text":"Migration lock order question","options":[],"correct_option":null,"answer_key":null,"sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
  1,
  'b1348000-0000-4000-8000-000000000001',
  'b1348000-0000-4000-8000-000000000001'
);
SQL

docker exec -e PGAPPNAME=b134_save_before_migration_fence -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select teacher_id
from public.classrooms
where id = 'b1348000-0000-4000-8000-000000000010'
for update;
select id
from public.tests
where id = 'b1348000-0000-4000-8000-000000000011'
for update;
select id
from public.assessment_drafts
where id = 'b1348000-0000-4000-8000-000000000012'
for update;
select pg_sleep(5);
update public.test_questions
set position = position
where id = 'b1348000-0000-4000-8000-000000000013';
update public.assessment_drafts
set version = version
where id = 'b1348000-0000-4000-8000-000000000012';
commit;
SQL
save_before_fence_pid=$!
save_before_fence_ready=false
for _attempt in {1..40}; do
  save_before_fence_sleeping="$(docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -Atqc \
    "select count(*) from pg_catalog.pg_stat_activity where application_name = 'b134_save_before_migration_fence' and wait_event = 'PgSleep'")"
  if [[ "$save_before_fence_sleeping" == "1" ]]; then
    save_before_fence_ready=true
    break
  fi
  sleep 0.1
done
if [[ "$save_before_fence_ready" != "true" ]]; then
  kill "$save_before_fence_pid" 2>/dev/null || true
  wait "$save_before_fence_pid" 2>/dev/null || true
  echo "In-flight draft save did not reach the migration-fence checkpoint." >&2
  exit 1
fi

docker exec -e PGAPPNAME=b134_migration_fence_waits_for_save -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
lock table public.assessment_drafts in exclusive mode;
lock table public.test_questions in share row exclusive mode;
select id
from public.assessment_drafts
where id = 'b1348000-0000-4000-8000-000000000012'
for update;
rollback;
SQL
migration_fence_pid=$!
migration_fence_waited=false
for _attempt in {1..40}; do
  migration_fence_waiting="$(docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -Atqc \
    "select count(*) from pg_catalog.pg_stat_activity where application_name = 'b134_migration_fence_waits_for_save' and wait_event_type = 'Lock'")"
  if [[ "$migration_fence_waiting" == "1" ]]; then
    migration_fence_waited=true
    break
  fi
  sleep 0.1
done
if [[ "$migration_fence_waited" != "true" ]]; then
  kill "$migration_fence_pid" 2>/dev/null || true
  kill "$save_before_fence_pid" 2>/dev/null || true
  wait "$migration_fence_pid" 2>/dev/null || true
  wait "$save_before_fence_pid" 2>/dev/null || true
  echo "Migration fence did not wait behind the in-flight draft save." >&2
  exit 1
fi
wait "$save_before_fence_pid"
wait "$migration_fence_pid"

# Prove the inverse order is also safe. When the migration owns both table
# fences first, a save may hold Test and Classroom while waiting on Draft. The
# identity-only draft rewrite must not ask the structural-revision trigger to
# update that Classroom, or PostgreSQL can deadlock the two sessions.
docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
update public.assessment_drafts
set
  content = jsonb_set(
    content,
    '{questions,0,id}',
    to_jsonb('b1348000-0000-4000-8000-000000000013'::text),
    false
  ),
  version = version + 1
where id = 'b1348000-0000-4000-8000-000000000012';

update public.classrooms
set blueprint_source_revision = 17
where id = 'b1348000-0000-4000-8000-000000000010';
SQL

docker exec -e PGAPPNAME=b134_migration_before_save_fence -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
set local statement_timeout = '15s';
lock table public.assessment_drafts in exclusive mode;
lock table public.test_questions in share row exclusive mode;
select pg_sleep(5);
select set_config('pika.identity_mapping', 'on', true);
update public.assessment_drafts
set
  content = jsonb_set(
    content,
    '{questions,0,id}',
    to_jsonb('b1348000-0000-4000-8000-000000000014'::text),
    false
  ),
  version = version + 1
where id = 'b1348000-0000-4000-8000-000000000012';
select set_config('pika.identity_mapping', 'off', true);
commit;
SQL
migration_before_save_pid=$!
migration_before_save_ready=false
for _attempt in {1..40}; do
  migration_before_save_state="$(docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -Atqc \
    "select count(*) from pg_catalog.pg_stat_activity a where a.application_name = 'b134_migration_before_save_fence' and a.wait_event = 'PgSleep' and 2 = (select count(*) from pg_catalog.pg_locks l join pg_catalog.pg_class c on c.oid = l.relation where l.pid = a.pid and l.granted and ((c.relname = 'assessment_drafts' and l.mode = 'ExclusiveLock') or (c.relname = 'test_questions' and l.mode = 'ShareRowExclusiveLock')))")"
  if [[ "$migration_before_save_state" == "1" ]]; then
    migration_before_save_ready=true
    break
  fi
  sleep 0.1
done
if [[ "$migration_before_save_ready" != "true" ]]; then
  kill "$migration_before_save_pid" 2>/dev/null || true
  wait "$migration_before_save_pid" 2>/dev/null || true
  echo "Migration-first rehearsal did not acquire both source-table locks." >&2
  exit 1
fi

docker exec -e PGAPPNAME=b134_save_waits_for_migration_fence -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
set local statement_timeout = '15s';
select id
from public.tests
where id = 'b1348000-0000-4000-8000-000000000011'
for update;
select teacher_id
from public.classrooms
where id = 'b1348000-0000-4000-8000-000000000010'
for update;
select id
from public.assessment_drafts
where id = 'b1348000-0000-4000-8000-000000000012'
for update;
rollback;
SQL
save_waits_for_migration_pid=$!
save_waited_for_migration=false
for _attempt in {1..40}; do
  save_waiting="$(docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -Atqc \
    "select count(*) from pg_catalog.pg_stat_activity where application_name = 'b134_save_waits_for_migration_fence' and wait_event_type = 'Lock'")"
  if [[ "$save_waiting" == "1" ]]; then
    save_waited_for_migration=true
    break
  fi
  sleep 0.1
done
if [[ "$save_waited_for_migration" != "true" ]]; then
  kill "$migration_before_save_pid" 2>/dev/null || true
  kill "$save_waits_for_migration_pid" 2>/dev/null || true
  wait "$migration_before_save_pid" 2>/dev/null || true
  wait "$save_waits_for_migration_pid" 2>/dev/null || true
  echo "Draft save did not wait behind the migration-first fence." >&2
  exit 1
fi

set +e
wait "$migration_before_save_pid"
migration_before_save_status=$?
wait "$save_waits_for_migration_pid"
save_waits_for_migration_status=$?
set -e
if [[ "$migration_before_save_status" -ne 0 ]] \
  || [[ "$save_waits_for_migration_status" -ne 0 ]]; then
  echo "Migration-first draft identity rewrite deadlocked with a draft save." >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$
begin
  if (
    select blueprint_source_revision
    from public.classrooms
    where id = 'b1348000-0000-4000-8000-000000000010'
  ) <> 17 then
    raise exception 'Migration identity backfill advanced the Classroom structural revision';
  end if;

  if (
    select content #>> '{questions,0,id}'
    from public.assessment_drafts
    where id = 'b1348000-0000-4000-8000-000000000012'
  ) <> 'b1348000-0000-4000-8000-000000000014' then
    raise exception 'Migration-first draft identity rewrite did not complete';
  end if;
end;
$$;
SQL

# Two Test saves in one Classroom both advance the shared structural revision.
# They must serialize at the Classroom row instead of each holding a shared lock
# and deadlocking when their Draft triggers upgrade it.
docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into public.tests (
  id, classroom_id, title, status, show_results, points_possible, created_by
) values
  (
    'b1348000-0000-4000-8000-000000000021',
    'b1348000-0000-4000-8000-000000000010',
    'Concurrent draft save A',
    'draft',
    false,
    1,
    'b1348000-0000-4000-8000-000000000001'
  ),
  (
    'b1348000-0000-4000-8000-000000000031',
    'b1348000-0000-4000-8000-000000000010',
    'Concurrent draft save B',
    'draft',
    false,
    1,
    'b1348000-0000-4000-8000-000000000001'
  );

insert into public.assessment_drafts (
  id, assessment_type, assessment_id, classroom_id, content, version,
  created_by, updated_by
) values
  (
    'b1348000-0000-4000-8000-000000000022',
    'test',
    'b1348000-0000-4000-8000-000000000021',
    'b1348000-0000-4000-8000-000000000010',
    '{"title":"Concurrent draft save A","show_results":false,"question_identity_version":1,"questions":[{"id":"b1348000-0000-4000-8000-000000000023","question_type":"open_response","question_text":"Question A","options":[],"correct_option":null,"answer_key":null,"sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
    1,
    'b1348000-0000-4000-8000-000000000001',
    'b1348000-0000-4000-8000-000000000001'
  ),
  (
    'b1348000-0000-4000-8000-000000000032',
    'test',
    'b1348000-0000-4000-8000-000000000031',
    'b1348000-0000-4000-8000-000000000010',
    '{"title":"Concurrent draft save B","show_results":false,"question_identity_version":1,"questions":[{"id":"b1348000-0000-4000-8000-000000000033","question_type":"open_response","question_text":"Question B","options":[],"correct_option":null,"answer_key":null,"sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
    1,
    'b1348000-0000-4000-8000-000000000001',
    'b1348000-0000-4000-8000-000000000001'
  );

create or replace function public.b134_hold_concurrent_draft_save()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id in (
    'b1348000-0000-4000-8000-000000000022'::uuid,
    'b1348000-0000-4000-8000-000000000032'::uuid
  ) then
    perform pg_sleep(3);
  end if;
  return new;
end;
$$;

create trigger b134_hold_concurrent_draft_save
before update of content on public.assessment_drafts
for each row execute function public.b134_hold_concurrent_draft_save();
SQL

docker exec -e PGAPPNAME=b134_concurrent_draft_save_a -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
set statement_timeout = '15s';
select public.save_test_draft_atomic(
  'b1348000-0000-4000-8000-000000000001',
  'b1348000-0000-4000-8000-000000000021',
  1,
  '{"title":"Concurrent draft save A","show_results":false,"question_identity_version":1,"questions":[{"id":"b1348000-0000-4000-8000-000000000023","question_type":"open_response","question_text":"Question A updated","options":[],"correct_option":null,"answer_key":null,"sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
  false,
  '[]'::jsonb,
  '[]'::jsonb
);
SQL
concurrent_save_a_pid=$!
concurrent_save_a_ready=false
for _attempt in {1..40}; do
  concurrent_save_a_sleeping="$(docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -Atqc \
    "select count(*) from pg_catalog.pg_stat_activity where application_name = 'b134_concurrent_draft_save_a' and wait_event = 'PgSleep'")"
  if [[ "$concurrent_save_a_sleeping" == "1" ]]; then
    concurrent_save_a_ready=true
    break
  fi
  sleep 0.1
done
if [[ "$concurrent_save_a_ready" != "true" ]]; then
  kill "$concurrent_save_a_pid" 2>/dev/null || true
  wait "$concurrent_save_a_pid" 2>/dev/null || true
  echo "First concurrent draft save did not reach its trigger checkpoint." >&2
  exit 1
fi

docker exec -e PGAPPNAME=b134_concurrent_draft_save_b -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
set statement_timeout = '15s';
select public.save_test_draft_atomic(
  'b1348000-0000-4000-8000-000000000001',
  'b1348000-0000-4000-8000-000000000031',
  1,
  '{"title":"Concurrent draft save B","show_results":false,"question_identity_version":1,"questions":[{"id":"b1348000-0000-4000-8000-000000000033","question_type":"open_response","question_text":"Question B updated","options":[],"correct_option":null,"answer_key":null,"sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
  false,
  '[]'::jsonb,
  '[]'::jsonb
);
SQL
concurrent_save_b_pid=$!
concurrent_save_b_waited=false
for _attempt in {1..40}; do
  concurrent_save_b_waiting="$(docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -Atqc \
    "select count(*) from pg_catalog.pg_stat_activity where application_name = 'b134_concurrent_draft_save_b' and wait_event_type = 'Lock'")"
  if [[ "$concurrent_save_b_waiting" == "1" ]]; then
    concurrent_save_b_waited=true
    break
  fi
  sleep 0.1
done
if [[ "$concurrent_save_b_waited" != "true" ]]; then
  kill "$concurrent_save_a_pid" 2>/dev/null || true
  kill "$concurrent_save_b_pid" 2>/dev/null || true
  wait "$concurrent_save_a_pid" 2>/dev/null || true
  wait "$concurrent_save_b_pid" 2>/dev/null || true
  echo "Concurrent Test saves did not serialize at the Classroom row." >&2
  exit 1
fi

wait "$concurrent_save_a_pid"
wait "$concurrent_save_b_pid"

docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
drop trigger b134_hold_concurrent_draft_save on public.assessment_drafts;
drop function public.b134_hold_concurrent_draft_save();

do $$
begin
  if (
    select count(*)
    from public.assessment_drafts
    where id in (
      'b1348000-0000-4000-8000-000000000022'::uuid,
      'b1348000-0000-4000-8000-000000000032'::uuid
    )
      and version = 2
      and content->>'question_identity_version' = '1'
  ) <> 2 then
    raise exception 'Concurrent Test saves did not both commit';
  end if;
end;
$$;
SQL

docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
delete from public.assessment_drafts
where id in (
  'b1348000-0000-4000-8000-000000000012',
  'b1348000-0000-4000-8000-000000000022',
  'b1348000-0000-4000-8000-000000000032'
);
delete from public.test_questions
where id = 'b1348000-0000-4000-8000-000000000013';
delete from public.tests
where id in (
  'b1348000-0000-4000-8000-000000000011',
  'b1348000-0000-4000-8000-000000000021',
  'b1348000-0000-4000-8000-000000000031'
);
delete from public.classrooms
where id = 'b1348000-0000-4000-8000-000000000010';
delete from public.users
where id = 'b1348000-0000-4000-8000-000000000001';
SQL

# Re-run the migration's exact backfill statement against the production
# collision shape left by migrations 112/114. Legacy drafts stored row IDs,
# while the broken ordinal mapper could stamp question zero with a later row's
# ID as portable identity. The row-ID match must win without reading content or
# position, and the backfill must not mutate either persisted question row.
docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
alter table public.assessment_drafts
  drop constraint assessment_drafts_test_question_identity_version_check;

insert into public.users (id, email, role) values (
  'b1349000-0000-4000-8000-000000000001',
  'blueprint-question-legacy-backfill@example.test',
  'teacher'
);
insert into public.classrooms (
  id, teacher_id, title, class_code
) values (
  'b1349000-0000-4000-8000-000000000010',
  'b1349000-0000-4000-8000-000000000001',
  'Legacy question identity backfill',
  'B134L1'
);
insert into public.tests (
  id, classroom_id, title, status, show_results, points_possible, created_by
) values (
  'b1349000-0000-4000-8000-000000000011',
  'b1349000-0000-4000-8000-000000000010',
  'Legacy row-ID precedence',
  'closed',
  false,
  2,
  'b1349000-0000-4000-8000-000000000001'
);
insert into public.test_questions (
  id, test_id, artifact_id, source_artifact_id, question_type,
  question_text, options, correct_option, points,
  response_max_chars, response_monospace, position
) values
  (
    'b1349000-0000-4000-8000-000000000020',
    'b1349000-0000-4000-8000-000000000011',
    'b1349000-0000-4000-8000-000000000021',
    'b1349000-0000-4000-8000-000000000021',
    'open_response',
    'Question zero carrying the later row ID',
    '[]'::jsonb,
    null,
    1,
    5000,
    false,
    0
  ),
  (
    'b1349000-0000-4000-8000-000000000021',
    'b1349000-0000-4000-8000-000000000011',
    'b1349000-0000-4000-8000-000000000031',
    'b1349000-0000-4000-8000-000000000031',
    'open_response',
    'Later question whose row ID was reused',
    '[]'::jsonb,
    null,
    1,
    5000,
    false,
    7
  );
insert into public.assessment_drafts (
  id, assessment_type, assessment_id, classroom_id, content, version,
  created_by, updated_by
) values (
  'b1349000-0000-4000-8000-000000000012',
  'test',
  'b1349000-0000-4000-8000-000000000011',
  'b1349000-0000-4000-8000-000000000010',
  '{"title":"Legacy row-ID precedence","show_results":false,"questions":[{"id":"b1349000-0000-4000-8000-000000000020","question_type":"open_response","question_text":"Question zero carrying the later row ID","options":[],"correct_option":null,"answer_key":null,"sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false},{"id":"b1349000-0000-4000-8000-000000000021","question_type":"open_response","question_text":"Later question whose row ID was reused","options":[],"correct_option":null,"answer_key":null,"sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
  7,
  'b1349000-0000-4000-8000-000000000001',
  'b1349000-0000-4000-8000-000000000001'
);
SQL

sed -n '1,/^\$\$;$/p' "$MIGRATION_FILE" \
  | docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null

docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
alter table public.assessment_drafts
  add constraint assessment_drafts_test_question_identity_version_check
  check (
    assessment_type <> 'test'
    or content->'question_identity_version' is not distinct from '1'::jsonb
  );

do $contract$
begin
  if not exists (
    select 1
    from public.assessment_drafts draft
    where draft.id = 'b1349000-0000-4000-8000-000000000012'
      and draft.version = 8
      and draft.content->'questions'->0->>'id'
        = 'b1349000-0000-4000-8000-000000000021'
      and draft.content->'questions'->1->>'id'
        = 'b1349000-0000-4000-8000-000000000031'
  ) then
    raise exception 'Legacy row-ID precedence did not resolve the question-zero identity collision';
  end if;

  if not exists (
    select 1
    from public.assessment_drafts draft
    where draft.id = 'b1349000-0000-4000-8000-000000000012'
      and draft.content->>'question_identity_version' = '1'
  ) then
    raise exception 'Backfill did not mark the canonical portable draft identity version';
  end if;

  if (
    select jsonb_agg(
      jsonb_build_object(
        'id', question.id,
        'artifact_id', question.artifact_id,
        'source_artifact_id', question.source_artifact_id,
        'position', question.position,
        'question_text', question.question_text
      ) order by question.position
    )
    from public.test_questions question
    where question.test_id = 'b1349000-0000-4000-8000-000000000011'
  ) is distinct from jsonb_build_array(
    jsonb_build_object(
      'id', 'b1349000-0000-4000-8000-000000000020',
      'artifact_id', 'b1349000-0000-4000-8000-000000000021',
      'source_artifact_id', 'b1349000-0000-4000-8000-000000000021',
      'position', 0,
      'question_text', 'Question zero carrying the later row ID'
    ),
    jsonb_build_object(
      'id', 'b1349000-0000-4000-8000-000000000021',
      'artifact_id', 'b1349000-0000-4000-8000-000000000031',
      'source_artifact_id', 'b1349000-0000-4000-8000-000000000031',
      'position', 7,
      'question_text', 'Later question whose row ID was reused'
    )
  ) then
    raise exception 'Legacy row-ID precedence mutated persisted question rows';
  end if;
end;
$contract$;
SQL

# A successfully marked draft is already in the portable namespace. Replaying
# the backfill must validate it strictly without treating a coincident row UUID
# as a legacy alias or advancing its optimistic-lock version again.
sed -n '1,/^\$\$;$/p' "$MIGRATION_FILE" \
  | docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null

docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $contract$
begin
  if not exists (
    select 1
    from public.assessment_drafts draft
    where draft.id = 'b1349000-0000-4000-8000-000000000012'
      and draft.version = 8
      and draft.content->>'question_identity_version' = '1'
      and draft.content->'questions'->0->>'id'
        = 'b1349000-0000-4000-8000-000000000021'
      and draft.content->'questions'->1->>'id'
        = 'b1349000-0000-4000-8000-000000000031'
  ) then
    raise exception 'Portable draft replay re-entered the legacy row-ID namespace';
  end if;
end;
$contract$;

select public.save_test_draft_atomic(
  'b1349000-0000-4000-8000-000000000001',
  'b1349000-0000-4000-8000-000000000011',
  8,
  '{"title":"Legacy row-ID precedence","show_results":false,"question_identity_version":1,"questions":[{"id":"b1349000-0000-4000-8000-000000000021","question_type":"open_response","question_text":"Question zero carrying the later row ID","options":[],"correct_option":null,"answer_key":null,"sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false},{"id":"b1349000-0000-4000-8000-000000000031","question_type":"open_response","question_text":"Later question whose row ID was reused","options":[],"correct_option":null,"answer_key":null,"sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
  false,
  '[]'::jsonb,
  '[]'::jsonb
);

update public.tests
set status = 'draft'
where id = 'b1349000-0000-4000-8000-000000000011';

select public.activate_test_from_draft_atomic(
  'b1349000-0000-4000-8000-000000000001',
  'b1349000-0000-4000-8000-000000000011',
  9
);

do $contract$
begin
  if not exists (
    select 1
    from public.tests test
    join public.assessment_drafts draft
      on draft.assessment_type = 'test'
      and draft.assessment_id = test.id
    where test.id = 'b1349000-0000-4000-8000-000000000011'
      and test.status = 'active'
      and draft.version = 9
      and draft.content->'questions'->0->>'id'
        = 'b1349000-0000-4000-8000-000000000021'
      and draft.content->'questions'->1->>'id'
        = 'b1349000-0000-4000-8000-000000000031'
      and draft.content->>'question_identity_version' = '1'
      and (
        select count(*)
        from public.test_questions question
        where question.test_id = test.id
          and (
            (
              question.id = 'b1349000-0000-4000-8000-000000000020'
              and question.artifact_id = 'b1349000-0000-4000-8000-000000000021'
            )
            or (
              question.id = 'b1349000-0000-4000-8000-000000000021'
              and question.artifact_id = 'b1349000-0000-4000-8000-000000000031'
            )
          )
      ) = 2
  ) then
    raise exception 'Post-backfill save and activation did not preserve canonical question identity';
  end if;
end;
$contract$;

delete from public.assessment_drafts
where id = 'b1349000-0000-4000-8000-000000000012';
delete from public.test_questions
where test_id = 'b1349000-0000-4000-8000-000000000011';
delete from public.tests
where id = 'b1349000-0000-4000-8000-000000000011';
delete from public.classrooms
where id = 'b1349000-0000-4000-8000-000000000010';
delete from public.users
where id = 'b1349000-0000-4000-8000-000000000001';
SQL

# Prove the application ordering contract with two real sessions. The saver
# owns the Test lock first and deliberately keeps its transaction open;
# activation must wait, then consume the newly committed draft version.
docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into public.users (id, email, role) values (
  'b1341000-0000-4000-8000-000000000001',
  'blueprint-question-activation-order@example.test',
  'teacher'
);
insert into public.classrooms (
  id, teacher_id, title, class_code
) values (
  'b1341000-0000-4000-8000-000000000010',
  'b1341000-0000-4000-8000-000000000001',
  'Draft activation ordering contract',
  'B134S1'
);
insert into public.tests (
  id, classroom_id, title, status, show_results, points_possible, created_by
) values
  (
    'b1341000-0000-4000-8000-000000000011',
    'b1341000-0000-4000-8000-000000000010',
    'Question A',
    'draft',
    false,
    1,
    'b1341000-0000-4000-8000-000000000001'
  ),
  (
    'b1341000-0000-4000-8000-000000000021',
    'b1341000-0000-4000-8000-000000000010',
    'Rollback Test',
    'draft',
    false,
    1,
    'b1341000-0000-4000-8000-000000000001'
  );
insert into public.test_questions (
  id, test_id, artifact_id, question_type, question_text, options,
  correct_option, points, response_max_chars, response_monospace, position
) values (
  'b1341000-0000-4000-8000-000000000023',
  'b1341000-0000-4000-8000-000000000021',
  'b1341000-0000-4000-8000-000000000123',
  'open_response',
  'Original rollback question',
  '[]'::jsonb,
  null,
  1,
  5000,
  false,
  0
);
insert into public.assessment_drafts (
  id, assessment_type, assessment_id, classroom_id, content, version,
  created_by, updated_by
) values (
  'b1341000-0000-4000-8000-000000000012',
  'test',
  'b1341000-0000-4000-8000-000000000011',
  'b1341000-0000-4000-8000-000000000010',
  '{"title":"Question A","show_results":false,"question_identity_version":1,"questions":[{"id":"b1341000-0000-4000-8000-000000000013","question_type":"open_response","question_text":"Question A","options":[],"correct_option":null,"answer_key":"A","sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
  1,
  'b1341000-0000-4000-8000-000000000001',
  'b1341000-0000-4000-8000-000000000001'
), (
  'b1341000-0000-4000-8000-000000000022',
  'test',
  'b1341000-0000-4000-8000-000000000021',
  'b1341000-0000-4000-8000-000000000010',
  '{"title":"Rollback Test","show_results":false,"question_identity_version":1,"questions":[{"id":"b1341000-0000-4000-8000-000000000123","question_type":"open_response","question_text":"Partially changed question","options":[],"correct_option":null,"answer_key":"changed","sample_solution":null,"points":2,"response_max_chars":5000,"response_monospace":false},{"id":"b1341000-0000-4000-8000-000000000124","question_type":"multiple_choice","question_text":"Invalid second question","options":["only one"],"correct_option":0,"answer_key":null,"sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
  1,
  'b1341000-0000-4000-8000-000000000001',
  'b1341000-0000-4000-8000-000000000001'
);

do $contract$
declare
  v_error_message text;
begin
  begin
    perform public.save_test_draft_atomic(
      'b1341000-0000-4000-8000-000000000001',
      'b1341000-0000-4000-8000-000000000011',
      1,
      '{"title":"Invalid legacy identity","show_results":false,"question_identity_version":1,"questions":[{"id":"b1341000-0000-1000-8000-000000000013","question_type":"open_response","question_text":"Legacy UUIDv1 question","options":[],"correct_option":null,"answer_key":"legacy","sample_solution":null,"points":4,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
      false,
      '[]'::jsonb,
      '[]'::jsonb
    );
    raise exception 'Non-UUIDv4 draft question identity unexpectedly saved';
  exception when invalid_parameter_value then
    get stacked diagnostics v_error_message = message_text;
    if v_error_message is distinct from 'invalid_draft_content' then
      raise;
    end if;
  end;

  if not exists (
    select 1
    from public.assessment_drafts draft
    where draft.assessment_type = 'test'
      and draft.assessment_id = 'b1341000-0000-4000-8000-000000000011'
      and draft.version = 1
      and draft.content->>'title' = 'Question A'
      and draft.content->'questions'->0->>'id'
        = 'b1341000-0000-4000-8000-000000000013'
  ) or exists (
    select 1
    from public.test_questions question
    where question.test_id = 'b1341000-0000-4000-8000-000000000011'
  ) then
    raise exception 'Rejected non-UUIDv4 draft identity changed persisted Test state';
  end if;
end;
$contract$;
SQL

docker exec -e PGAPPNAME=b134_draft_save_first -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select public.save_test_draft_atomic(
  'b1341000-0000-4000-8000-000000000001',
  'b1341000-0000-4000-8000-000000000011',
  1,
  '{"title":"Question B","show_results":true,"question_identity_version":1,"questions":[{"id":"b1341000-0000-4000-8000-000000000013","question_type":"open_response","question_text":"Question B","options":[],"correct_option":null,"answer_key":"B","sample_solution":null,"points":2,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
  false,
  '[]'::jsonb,
  '[]'::jsonb
);
select pg_sleep(3);
commit;
SQL
draft_saver_pid=$!
draft_save_ready=false
for _attempt in {1..40}; do
  saver_sleeping="$(docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -Atqc \
    "select count(*) from pg_catalog.pg_stat_activity where application_name = 'b134_draft_save_first' and wait_event = 'PgSleep'")"
  if [[ "$saver_sleeping" == "1" ]]; then
    draft_save_ready=true
    break
  fi
  sleep 0.1
done
if [[ "$draft_save_ready" != "true" ]]; then
  kill "$draft_saver_pid" 2>/dev/null || true
  wait "$draft_saver_pid" 2>/dev/null || true
  echo "Atomic draft save did not reach the lock-holding checkpoint." >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
select public.activate_test_from_draft_atomic(
  'b1341000-0000-4000-8000-000000000001',
  'b1341000-0000-4000-8000-000000000011',
  2
);
SQL
wait "$draft_saver_pid"

docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $contract$
declare
  v_error_message text;
  v_source_revision bigint;
begin
  begin
    perform public.activate_test_from_draft_atomic(
      'b1341000-0000-4000-8000-000000000001',
      'b1341000-0000-4000-8000-000000000021',
      1
    );
    raise exception 'Invalid activation unexpectedly succeeded';
  exception when check_violation then
    null;
  end;
  if not exists (
    select 1
    from public.tests test
    where test.id = 'b1341000-0000-4000-8000-000000000021'
      and test.status = 'draft'
  ) or not exists (
    select 1
    from public.test_questions question
    where question.id = 'b1341000-0000-4000-8000-000000000023'
      and question.question_text = 'Original rollback question'
      and question.points = 1
  ) or (
    select count(*)
    from public.test_questions question
    where question.test_id = 'b1341000-0000-4000-8000-000000000021'
  ) <> 1 then
    raise exception 'Failed activation did not roll back its partial question synchronization';
  end if;

  if not exists (
    select 1
    from public.tests test
    where test.id = 'b1341000-0000-4000-8000-000000000011'
      and test.status = 'active'
      and test.title = 'Question B'
      and test.show_results
  ) then
    raise exception 'Activation did not consume the completed draft save';
  end if;
  if not exists (
    select 1
    from public.test_questions question
    where question.test_id = 'b1341000-0000-4000-8000-000000000011'
      and question.artifact_id = 'b1341000-0000-4000-8000-000000000013'
      and question.question_text = 'Question B'
      and question.answer_key = 'B'
      and question.points = 2
  ) then
    raise exception 'Activation materialized stale question content';
  end if;

  begin
    perform public.save_test_draft_atomic(
      'b1341000-0000-4000-8000-000000000001',
      'b1341000-0000-4000-8000-000000000011',
      2,
      '{"title":"Question C","show_results":false,"question_identity_version":1,"questions":[{"id":"b1341000-0000-4000-8000-000000000013","question_type":"open_response","question_text":"Question C","options":[],"correct_option":null,"answer_key":"C","sample_solution":null,"points":3,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
      false,
      '[]'::jsonb,
      '[]'::jsonb
    );
  exception when others then
    raise exception 'Post-activation authoring save failed: %', sqlerrm;
  end;

  if not exists (
    select 1
    from public.tests test
    where test.id = 'b1341000-0000-4000-8000-000000000011'
      and test.status = 'active'
      and test.title = 'Question C'
      and not test.show_results
  ) or not exists (
    select 1
    from public.test_questions question
    where question.test_id = 'b1341000-0000-4000-8000-000000000011'
      and question.artifact_id = 'b1341000-0000-4000-8000-000000000013'
      and question.question_text = 'Question C'
      and question.answer_key = 'C'
      and question.points = 3
  ) then
    raise exception 'Post-activation authoring did not synchronize materialized rows';
  end if;

  insert into public.test_attempts (test_id, student_id)
  values (
    'b1341000-0000-4000-8000-000000000011',
    'b1341000-0000-4000-8000-000000000001'
  );

  select classroom.blueprint_source_revision
    into v_source_revision
  from public.classrooms classroom
  where classroom.id = 'b1341000-0000-4000-8000-000000000010';

  -- AI grading may populate operational reference caches after responses or
  -- attempts exist. This must not reopen authored content or create a new
  -- reusable Classroom revision.
  update public.test_questions question
  set
    ai_reference_cache_key = 'b134-cache-key',
    ai_reference_cache_answers = '["Reference C"]'::jsonb,
    ai_reference_cache_model = 'b134-contract-model',
    ai_reference_cache_generated_at = clock_timestamp()
  where question.test_id = 'b1341000-0000-4000-8000-000000000011'
    and question.artifact_id = 'b1341000-0000-4000-8000-000000000013';

  if not exists (
    select 1
    from public.test_questions question
    where question.test_id = 'b1341000-0000-4000-8000-000000000011'
      and question.artifact_id = 'b1341000-0000-4000-8000-000000000013'
      and question.ai_reference_cache_key = 'b134-cache-key'
      and question.ai_reference_cache_answers = '["Reference C"]'::jsonb
      and question.ai_reference_cache_model = 'b134-contract-model'
      and question.ai_reference_cache_generated_at is not null
  ) then
    raise exception 'AI reference cache did not persist after student work';
  end if;

  if (
    select classroom.blueprint_source_revision
    from public.classrooms classroom
    where classroom.id = 'b1341000-0000-4000-8000-000000000010'
  ) is distinct from v_source_revision then
    raise exception 'AI reference cache changed the Classroom structural revision';
  end if;

  -- Metadata-only saves remain valid after student work because unchanged
  -- question rows are not rewritten and therefore cannot distort responses.
  perform public.save_test_draft_atomic(
    'b1341000-0000-4000-8000-000000000001',
    'b1341000-0000-4000-8000-000000000011',
    3,
    '{"title":"Metadata only","show_results":true,"question_identity_version":1,"questions":[{"id":"b1341000-0000-4000-8000-000000000013","question_type":"open_response","question_text":"Question C","options":[],"correct_option":null,"answer_key":"C","sample_solution":null,"points":3,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
    false,
    '[]'::jsonb,
    '[]'::jsonb
  );

  begin
    perform public.save_test_draft_atomic(
      'b1341000-0000-4000-8000-000000000001',
      'b1341000-0000-4000-8000-000000000011',
      4,
      '{"title":"Unsafe question edit","show_results":true,"question_identity_version":1,"questions":[{"id":"b1341000-0000-4000-8000-000000000013","question_type":"open_response","question_text":"Question D","options":[],"correct_option":null,"answer_key":"D","sample_solution":null,"points":4,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
      false,
      '[]'::jsonb,
      '[]'::jsonb
    );
    raise exception 'Question mutation with student work unexpectedly succeeded';
  exception when sqlstate '55000' then
    get stacked diagnostics v_error_message = message_text;
    if v_error_message not like 'test_questions_locked:%' then
      raise;
    end if;
  end;

  if not exists (
    select 1
    from public.assessment_drafts draft
    where draft.assessment_type = 'test'
      and draft.assessment_id = 'b1341000-0000-4000-8000-000000000011'
      and draft.version = 4
      and draft.content->>'title' = 'Metadata only'
  ) or not exists (
    select 1
    from public.test_questions question
    where question.test_id = 'b1341000-0000-4000-8000-000000000011'
      and question.question_text = 'Question C'
      and question.answer_key = 'C'
      and question.points = 3
  ) then
    raise exception 'Rejected question mutation did not roll back atomically';
  end if;
end;
$contract$;

delete from public.classrooms
where id = 'b1341000-0000-4000-8000-000000000010';
delete from public.users
where id = 'b1341000-0000-4000-8000-000000000001';
SQL

# Save/activation and classroom archive must serialize on the classroom row.
# These fixtures exercise both winners for each RPC: authoring-first keeps the
# archive waiting until commit, while archive-first makes authoring fail closed
# without changing draft, question, or Test state.
docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into public.users (id, email, role) values (
  'b1342000-0000-4000-8000-000000000001',
  'blueprint-question-archive-order@example.test',
  'teacher'
);
insert into public.classrooms (id, teacher_id, title, class_code) values
  (
    'b1342000-0000-4000-8000-000000000010',
    'b1342000-0000-4000-8000-000000000001',
    'Save before archive',
    'B134S2'
  ),
  (
    'b1342000-0000-4000-8000-000000000020',
    'b1342000-0000-4000-8000-000000000001',
    'Archive before save',
    'B134S3'
  ),
  (
    'b1342000-0000-4000-8000-000000000030',
    'b1342000-0000-4000-8000-000000000001',
    'Activation before archive',
    'B134A2'
  ),
  (
    'b1342000-0000-4000-8000-000000000040',
    'b1342000-0000-4000-8000-000000000001',
    'Archive before activation',
    'B134A3'
  );
insert into public.tests (
  id, classroom_id, title, status, show_results, points_possible, created_by
) values
  (
    'b1342000-0000-4000-8000-000000000011',
    'b1342000-0000-4000-8000-000000000010',
    'Save-first seed',
    'draft',
    false,
    1,
    'b1342000-0000-4000-8000-000000000001'
  ),
  (
    'b1342000-0000-4000-8000-000000000021',
    'b1342000-0000-4000-8000-000000000020',
    'Archive-first save seed',
    'draft',
    false,
    1,
    'b1342000-0000-4000-8000-000000000001'
  ),
  (
    'b1342000-0000-4000-8000-000000000031',
    'b1342000-0000-4000-8000-000000000030',
    'Activation-first seed',
    'draft',
    false,
    1,
    'b1342000-0000-4000-8000-000000000001'
  ),
  (
    'b1342000-0000-4000-8000-000000000041',
    'b1342000-0000-4000-8000-000000000040',
    'Archive-first activation seed',
    'draft',
    false,
    1,
    'b1342000-0000-4000-8000-000000000001'
  );
insert into public.assessment_drafts (
  id, assessment_type, assessment_id, classroom_id, content, version,
  created_by, updated_by
) values
  (
    'b1342000-0000-4000-8000-000000000012',
    'test',
    'b1342000-0000-4000-8000-000000000011',
    'b1342000-0000-4000-8000-000000000010',
    '{"title":"Save-first seed","show_results":false,"question_identity_version":1,"questions":[{"id":"b1342000-0000-4000-8000-000000000013","question_type":"open_response","question_text":"Save-first question","options":[],"correct_option":null,"answer_key":"A","sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
    1,
    'b1342000-0000-4000-8000-000000000001',
    'b1342000-0000-4000-8000-000000000001'
  ),
  (
    'b1342000-0000-4000-8000-000000000022',
    'test',
    'b1342000-0000-4000-8000-000000000021',
    'b1342000-0000-4000-8000-000000000020',
    '{"title":"Archive-first save seed","show_results":false,"question_identity_version":1,"questions":[{"id":"b1342000-0000-4000-8000-000000000023","question_type":"open_response","question_text":"Archive-first save question","options":[],"correct_option":null,"answer_key":"A","sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
    1,
    'b1342000-0000-4000-8000-000000000001',
    'b1342000-0000-4000-8000-000000000001'
  ),
  (
    'b1342000-0000-4000-8000-000000000032',
    'test',
    'b1342000-0000-4000-8000-000000000031',
    'b1342000-0000-4000-8000-000000000030',
    '{"title":"Activation-first seed","show_results":false,"question_identity_version":1,"questions":[{"id":"b1342000-0000-4000-8000-000000000033","question_type":"open_response","question_text":"Activation-first question","options":[],"correct_option":null,"answer_key":"A","sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
    1,
    'b1342000-0000-4000-8000-000000000001',
    'b1342000-0000-4000-8000-000000000001'
  ),
  (
    'b1342000-0000-4000-8000-000000000042',
    'test',
    'b1342000-0000-4000-8000-000000000041',
    'b1342000-0000-4000-8000-000000000040',
    '{"title":"Archive-first activation seed","show_results":false,"question_identity_version":1,"questions":[{"id":"b1342000-0000-4000-8000-000000000043","question_type":"open_response","question_text":"Archive-first activation question","options":[],"correct_option":null,"answer_key":"A","sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
    1,
    'b1342000-0000-4000-8000-000000000001',
    'b1342000-0000-4000-8000-000000000001'
  );

create function public.b134_archived_reuse_plan(p_test_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $plan$
  select jsonb_build_object(
    'blueprint', jsonb_build_object(
      'title', test.title || ' Blueprint',
      'subject', '',
      'grade_level', '',
      'course_code', '',
      'term_template', '',
      'overview_markdown', '',
      'outline_markdown', '',
      'resources_markdown', '',
      'gradebook_use_weights', false,
      'gradebook_assignments_weight', 70,
      'gradebook_tests_weight', 30,
      'planned_site_slug', null,
      'planned_site_published', false,
      'planned_site_config', '{}'::jsonb
    ),
    'assignments', '[]'::jsonb,
    'assessments', jsonb_build_array(jsonb_build_object(
      'artifact_id', coalesce(test.source_artifact_id, test.artifact_id),
      'assessment_type', 'test',
      'title', test.title,
      'content', draft.content,
      'documents', coalesce(test.documents, '[]'::jsonb),
      'points_possible', test.points_possible,
      'gradebook_weight', coalesce(test.gradebook_weight, 10),
      'include_in_final', test.include_in_final,
      'position', test.position
    )),
    'lesson_templates', '[]'::jsonb,
    'materials', '[]'::jsonb,
    'surveys', '[]'::jsonb,
    'manifest_version', '3',
    'source_package_exported_at', null
  )
  from public.tests test
  join public.assessment_drafts draft
    on draft.assessment_type = 'test'
    and draft.assessment_id = test.id
  where test.id = p_test_id;
$plan$;
SQL

docker exec -e PGAPPNAME=b134_save_holds_classroom -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select public.save_test_draft_atomic(
  'b1342000-0000-4000-8000-000000000001',
  'b1342000-0000-4000-8000-000000000011',
  1,
  '{"title":"Saved before archive","show_results":true,"question_identity_version":1,"questions":[{"id":"b1342000-0000-4000-8000-000000000013","question_type":"open_response","question_text":"Saved before archive","options":[],"correct_option":null,"answer_key":"B","sample_solution":null,"points":2,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
  false,
  '[]'::jsonb,
  '[]'::jsonb
);
select pg_sleep(3);
commit;
SQL
save_before_archive_pid=$!
save_classroom_lock_ready=false
for _attempt in {1..40}; do
  saver_sleeping="$(docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -Atqc \
    "select count(*) from pg_catalog.pg_stat_activity where application_name = 'b134_save_holds_classroom' and wait_event = 'PgSleep'")"
  if [[ "$saver_sleeping" == "1" ]]; then
    save_classroom_lock_ready=true
    break
  fi
  sleep 0.1
done
if [[ "$save_classroom_lock_ready" != "true" ]]; then
  kill "$save_before_archive_pid" 2>/dev/null || true
  wait "$save_before_archive_pid" 2>/dev/null || true
  echo "Draft save did not reach its classroom-lock checkpoint." >&2
  exit 1
fi

docker exec -e PGAPPNAME=b134_archive_waits_for_save -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
update public.classrooms
set archived_at = clock_timestamp()
where id = 'b1342000-0000-4000-8000-000000000010';
do $contract$
declare
  v_result jsonb;
  v_revision bigint;
begin
  select blueprint_source_revision into v_revision
  from public.classrooms
  where id = 'b1342000-0000-4000-8000-000000000010';
  v_result := public.create_archived_classroom_blueprint_atomic(
    'b1342000-0000-4000-8000-000000000051',
    'b1342000-0000-4000-8000-000000000001',
    repeat('1', 64),
    'b1342000-0000-4000-8000-000000000010',
    v_revision,
    public.b134_archived_reuse_plan('b1342000-0000-4000-8000-000000000011')
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Archived reuse after save failed: %', v_result;
  end if;
end;
$contract$;
commit;
SQL
archive_after_save_pid=$!
archive_waited_for_save=false
for _attempt in {1..40}; do
  archive_waiting="$(docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -Atqc \
    "select count(*) from pg_catalog.pg_stat_activity where application_name = 'b134_archive_waits_for_save' and wait_event_type = 'Lock'")"
  if [[ "$archive_waiting" == "1" ]]; then
    archive_waited_for_save=true
    break
  fi
  sleep 0.1
done
if [[ "$archive_waited_for_save" != "true" ]]; then
  kill "$archive_after_save_pid" 2>/dev/null || true
  kill "$save_before_archive_pid" 2>/dev/null || true
  wait "$archive_after_save_pid" 2>/dev/null || true
  wait "$save_before_archive_pid" 2>/dev/null || true
  echo "Classroom archive did not wait for the in-flight draft save." >&2
  exit 1
fi
wait "$save_before_archive_pid"
wait "$archive_after_save_pid"

docker exec -e PGAPPNAME=b134_archive_holds_before_save -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
update public.classrooms
set archived_at = clock_timestamp()
where id = 'b1342000-0000-4000-8000-000000000020';
do $contract$
declare
  v_result jsonb;
  v_revision bigint;
begin
  select blueprint_source_revision into v_revision
  from public.classrooms
  where id = 'b1342000-0000-4000-8000-000000000020';
  v_result := public.create_archived_classroom_blueprint_atomic(
    'b1342000-0000-4000-8000-000000000052',
    'b1342000-0000-4000-8000-000000000001',
    repeat('2', 64),
    'b1342000-0000-4000-8000-000000000020',
    v_revision,
    public.b134_archived_reuse_plan('b1342000-0000-4000-8000-000000000021')
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Archived reuse before save failed: %', v_result;
  end if;
end;
$contract$;
select pg_sleep(3);
commit;
SQL
archive_before_save_pid=$!
archive_before_save_ready=false
for _attempt in {1..40}; do
  archiver_sleeping="$(docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -Atqc \
    "select count(*) from pg_catalog.pg_stat_activity where application_name = 'b134_archive_holds_before_save' and wait_event = 'PgSleep'")"
  if [[ "$archiver_sleeping" == "1" ]]; then
    archive_before_save_ready=true
    break
  fi
  sleep 0.1
done
if [[ "$archive_before_save_ready" != "true" ]]; then
  kill "$archive_before_save_pid" 2>/dev/null || true
  wait "$archive_before_save_pid" 2>/dev/null || true
  echo "Archive-first save fixture did not reach its lock checkpoint." >&2
  exit 1
fi

set +e
archive_first_save_output="$(docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 2>&1 <<'SQL'
select public.save_test_draft_atomic(
  'b1342000-0000-4000-8000-000000000001',
  'b1342000-0000-4000-8000-000000000021',
  1,
  '{"title":"Must not save","show_results":true,"question_identity_version":1,"questions":[{"id":"b1342000-0000-4000-8000-000000000023","question_type":"open_response","question_text":"Must not save","options":[],"correct_option":null,"answer_key":"B","sample_solution":null,"points":2,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
  false,
  '[]'::jsonb,
  '[]'::jsonb
);
SQL
)"
archive_first_save_status=$?
set -e
wait "$archive_before_save_pid"
if [[ "$archive_first_save_status" -eq 0 ]] \
  || [[ "$archive_first_save_output" != *"test_archived"* ]]; then
  echo "Archive-first draft save did not fail closed." >&2
  echo "$archive_first_save_output" >&2
  exit 1
fi

docker exec -e PGAPPNAME=b134_activation_holds_classroom -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select public.activate_test_from_draft_atomic(
  'b1342000-0000-4000-8000-000000000001',
  'b1342000-0000-4000-8000-000000000031',
  1
);
insert into public.test_attempts (id, test_id, student_id)
values (
  'b1342000-0000-4000-8000-000000000055',
  'b1342000-0000-4000-8000-000000000031',
  'b1342000-0000-4000-8000-000000000001'
);
insert into public.test_responses (
  id, test_id, question_id, student_id, response_text
)
select
  'b1342000-0000-4000-8000-000000000056',
  question.test_id,
  question.id,
  'b1342000-0000-4000-8000-000000000001',
  'Archived response must remain unchanged'
from public.test_questions question
where question.test_id = 'b1342000-0000-4000-8000-000000000031'
  and question.artifact_id = 'b1342000-0000-4000-8000-000000000033';
select pg_sleep(3);
commit;
SQL
activation_before_archive_pid=$!
activation_classroom_lock_ready=false
for _attempt in {1..40}; do
  activator_sleeping="$(docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -Atqc \
    "select count(*) from pg_catalog.pg_stat_activity where application_name = 'b134_activation_holds_classroom' and wait_event = 'PgSleep'")"
  if [[ "$activator_sleeping" == "1" ]]; then
    activation_classroom_lock_ready=true
    break
  fi
  sleep 0.1
done
if [[ "$activation_classroom_lock_ready" != "true" ]]; then
  kill "$activation_before_archive_pid" 2>/dev/null || true
  wait "$activation_before_archive_pid" 2>/dev/null || true
  echo "Activation did not reach its classroom-lock checkpoint." >&2
  exit 1
fi

docker exec -e PGAPPNAME=b134_archive_waits_for_activation -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
update public.classrooms
set archived_at = clock_timestamp()
where id = 'b1342000-0000-4000-8000-000000000030';
do $contract$
declare
  v_result jsonb;
  v_revision bigint;
begin
  select blueprint_source_revision into v_revision
  from public.classrooms
  where id = 'b1342000-0000-4000-8000-000000000030';
  v_result := public.create_archived_classroom_blueprint_atomic(
    'b1342000-0000-4000-8000-000000000053',
    'b1342000-0000-4000-8000-000000000001',
    repeat('3', 64),
    'b1342000-0000-4000-8000-000000000030',
    v_revision,
    public.b134_archived_reuse_plan('b1342000-0000-4000-8000-000000000031')
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Archived reuse after activation failed: %', v_result;
  end if;
end;
$contract$;
commit;
SQL
archive_after_activation_pid=$!
archive_waited_for_activation=false
for _attempt in {1..40}; do
  archive_waiting="$(docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -Atqc \
    "select count(*) from pg_catalog.pg_stat_activity where application_name = 'b134_archive_waits_for_activation' and wait_event_type = 'Lock'")"
  if [[ "$archive_waiting" == "1" ]]; then
    archive_waited_for_activation=true
    break
  fi
  sleep 0.1
done
if [[ "$archive_waited_for_activation" != "true" ]]; then
  kill "$archive_after_activation_pid" 2>/dev/null || true
  kill "$activation_before_archive_pid" 2>/dev/null || true
  wait "$archive_after_activation_pid" 2>/dev/null || true
  wait "$activation_before_archive_pid" 2>/dev/null || true
  echo "Classroom archive did not wait for in-flight activation." >&2
  exit 1
fi
wait "$activation_before_archive_pid"
wait "$archive_after_activation_pid"

docker exec -e PGAPPNAME=b134_archive_holds_before_activation -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
update public.classrooms
set archived_at = clock_timestamp()
where id = 'b1342000-0000-4000-8000-000000000040';
do $contract$
declare
  v_result jsonb;
  v_revision bigint;
begin
  select blueprint_source_revision into v_revision
  from public.classrooms
  where id = 'b1342000-0000-4000-8000-000000000040';
  v_result := public.create_archived_classroom_blueprint_atomic(
    'b1342000-0000-4000-8000-000000000054',
    'b1342000-0000-4000-8000-000000000001',
    repeat('4', 64),
    'b1342000-0000-4000-8000-000000000040',
    v_revision,
    public.b134_archived_reuse_plan('b1342000-0000-4000-8000-000000000041')
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Archived reuse before activation failed: %', v_result;
  end if;
end;
$contract$;
select pg_sleep(3);
commit;
SQL
archive_before_activation_pid=$!
archive_before_activation_ready=false
for _attempt in {1..40}; do
  archiver_sleeping="$(docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -Atqc \
    "select count(*) from pg_catalog.pg_stat_activity where application_name = 'b134_archive_holds_before_activation' and wait_event = 'PgSleep'")"
  if [[ "$archiver_sleeping" == "1" ]]; then
    archive_before_activation_ready=true
    break
  fi
  sleep 0.1
done
if [[ "$archive_before_activation_ready" != "true" ]]; then
  kill "$archive_before_activation_pid" 2>/dev/null || true
  wait "$archive_before_activation_pid" 2>/dev/null || true
  echo "Archive-first activation fixture did not reach its lock checkpoint." >&2
  exit 1
fi

set +e
archive_first_activation_output="$(docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 2>&1 <<'SQL'
select public.activate_test_from_draft_atomic(
  'b1342000-0000-4000-8000-000000000001',
  'b1342000-0000-4000-8000-000000000041',
  1
);
SQL
)"
archive_first_activation_status=$?
set -e
wait "$archive_before_activation_pid"
if [[ "$archive_first_activation_status" -eq 0 ]] \
  || [[ "$archive_first_activation_output" != *"test_archived"* ]]; then
  echo "Archive-first activation did not fail closed." >&2
  echo "$archive_first_activation_output" >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $contract$
declare
  v_error_message text;
begin
  if not exists (
    select 1
    from public.assessment_drafts draft
    join public.tests test on test.id = draft.assessment_id
    join public.classrooms classroom on classroom.id = test.classroom_id
    where draft.assessment_type = 'test'
      and test.id = 'b1342000-0000-4000-8000-000000000011'
      and draft.version = 2
      and draft.content->>'title' = 'Saved before archive'
      and test.title = 'Saved before archive'
      and test.status = 'draft'
      and classroom.archived_at is not null
  ) then
    raise exception 'Save-first ordering did not commit before archive';
  end if;

  if not exists (
    select 1
    from public.assessment_drafts draft
    join public.tests test on test.id = draft.assessment_id
    join public.classrooms classroom on classroom.id = test.classroom_id
    where draft.assessment_type = 'test'
      and test.id = 'b1342000-0000-4000-8000-000000000021'
      and draft.version = 1
      and draft.content->>'title' = 'Archive-first save seed'
      and test.title = 'Archive-first save seed'
      and test.status = 'draft'
      and classroom.archived_at is not null
      and not exists (
        select 1 from public.test_questions question where question.test_id = test.id
      )
  ) then
    raise exception 'Archive-first save changed protected Test state';
  end if;

  if not exists (
    select 1
    from public.assessment_drafts draft
    join public.tests test on test.id = draft.assessment_id
    join public.classrooms classroom on classroom.id = test.classroom_id
    where draft.assessment_type = 'test'
      and test.id = 'b1342000-0000-4000-8000-000000000031'
      and draft.version = 1
      and test.status = 'active'
      and classroom.archived_at is not null
      and exists (
        select 1
        from public.test_questions question
        where question.test_id = test.id
          and question.artifact_id = 'b1342000-0000-4000-8000-000000000033'
      )
  ) then
    raise exception 'Activation-first ordering did not commit before archive';
  end if;

  if not exists (
    select 1
    from public.test_questions question
    join public.test_responses response
      on response.question_id = question.id
    join public.test_attempts attempt
      on attempt.test_id = question.test_id
      and attempt.student_id = response.student_id
    where question.test_id = 'b1342000-0000-4000-8000-000000000031'
      and question.artifact_id = 'b1342000-0000-4000-8000-000000000033'
      and question.question_text = 'Activation-first question'
      and question.source_blueprint_version_id is not null
      and response.id = 'b1342000-0000-4000-8000-000000000056'
      and response.response_text = 'Archived response must remain unchanged'
      and attempt.id = 'b1342000-0000-4000-8000-000000000055'
  ) then
    raise exception 'Archived reuse changed student work';
  end if;
  begin
    update public.test_questions
    set question_text = 'Unsafe archived authored change'
    where test_id = 'b1342000-0000-4000-8000-000000000031'
      and artifact_id = 'b1342000-0000-4000-8000-000000000033';
    raise exception 'Authored archived question update bypassed the student-work freeze';
  exception when sqlstate '55000' then
    get stacked diagnostics v_error_message = message_text;
    if v_error_message not like 'test_questions_locked:%' then
      raise;
    end if;
  end;

  if not exists (
    select 1
    from public.assessment_drafts draft
    join public.tests test on test.id = draft.assessment_id
    join public.classrooms classroom on classroom.id = test.classroom_id
    where draft.assessment_type = 'test'
      and test.id = 'b1342000-0000-4000-8000-000000000041'
      and draft.version = 1
      and draft.content->>'title' = 'Archive-first activation seed'
      and test.title = 'Archive-first activation seed'
      and test.status = 'draft'
      and classroom.archived_at is not null
      and not exists (
        select 1 from public.test_questions question where question.test_id = test.id
      )
  ) then
    raise exception 'Archive-first activation changed protected Test state';
  end if;
end;
$contract$;

drop function public.b134_archived_reuse_plan(uuid);

delete from public.classrooms
where teacher_id = 'b1342000-0000-4000-8000-000000000001';
delete from public.users
where id = 'b1342000-0000-4000-8000-000000000001';
SQL

docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 <<'SQL'
begin;

insert into public.users (id, email, role) values (
  'b1340000-0000-4000-8000-000000000001',
  'blueprint-question-ordinal@example.test',
  'teacher'
);

insert into public.classrooms (
  id, teacher_id, title, class_code, archived_at
) values
  (
    'b1340000-0000-4000-8000-000000000010',
    'b1340000-0000-4000-8000-000000000001',
    'Active ordinal capture',
    'B134A1',
    null
  ),
  (
    'b1340000-0000-4000-8000-000000000020',
    'b1340000-0000-4000-8000-000000000001',
    'Archived ordinal reuse',
    'B134R1',
    clock_timestamp()
  );

insert into public.tests (
  id, classroom_id, artifact_id, source_artifact_id, title, status,
  show_results, points_possible, created_by, position, blueprint_archived_at
) values
  (
    'b1340000-0000-4000-8000-000000000011',
    'b1340000-0000-4000-8000-000000000010',
    'b1340000-0000-4000-8000-000000000111',
    null,
    'Active multi-question Test',
    'draft',
    false,
    2,
    'b1340000-0000-4000-8000-000000000001',
    0,
    null
  ),
  -- A retained archived generation may share the portable source identity and
  -- position with its active replacement. Active capture must ignore it.
  (
    'b1340000-0000-4000-8000-000000000015',
    'b1340000-0000-4000-8000-000000000010',
    'b1340000-0000-4000-8000-000000000115',
    'b1340000-0000-4000-8000-000000000111',
    'Retained archived Test generation',
    'draft',
    false,
    1,
    'b1340000-0000-4000-8000-000000000001',
    0,
    clock_timestamp()
  ),
  (
    'b1340000-0000-4000-8000-000000000021',
    'b1340000-0000-4000-8000-000000000020',
    'b1340000-0000-4000-8000-000000000211',
    null,
    'Archived multi-question Test',
    'draft',
    false,
    2,
    'b1340000-0000-4000-8000-000000000001',
    0,
    null
  );

insert into public.test_questions (
  id, test_id, artifact_id, source_artifact_id, question_type, question_text,
  options, correct_option, points, response_max_chars, response_monospace, position
) values
  -- Position gaps are valid after question deletion. Stable identity matching
  -- must not infer question identity from ordinal position.
  (
    'b1340000-0000-4000-8000-000000000012',
    'b1340000-0000-4000-8000-000000000011',
    'b1340000-0000-4000-8000-000000000112',
    null,
    'multiple_choice',
    'Active question one',
    '["A","B"]'::jsonb,
    0,
    1,
    5000,
    false,
    0
  ),
  (
    'b1340000-0000-4000-8000-000000000013',
    'b1340000-0000-4000-8000-000000000011',
    'b1340000-0000-4000-8000-000000000113',
    null,
    'open_response',
    'Active question two',
    '[]'::jsonb,
    null,
    1,
    5000,
    false,
    2
  ),
  (
    'b1340000-0000-4000-8000-000000000016',
    'b1340000-0000-4000-8000-000000000015',
    'b1340000-0000-4000-8000-000000000116',
    'b1340000-0000-4000-8000-000000000113',
    'open_response',
    'Retained archived question generation',
    '[]'::jsonb,
    null,
    1,
    5000,
    false,
    2
  ),
  (
    'b1340000-0000-4000-8000-000000000022',
    'b1340000-0000-4000-8000-000000000021',
    'b1340000-0000-4000-8000-000000000212',
    null,
    'multiple_choice',
    'Archived question one',
    '["A","B"]'::jsonb,
    0,
    1,
    5000,
    false,
    0
  ),
  (
    'b1340000-0000-4000-8000-000000000023',
    'b1340000-0000-4000-8000-000000000021',
    'b1340000-0000-4000-8000-000000000213',
    null,
    'open_response',
    'Archived question two',
    '[]'::jsonb,
    null,
    1,
    5000,
    false,
    2
  );

insert into public.course_blueprints (
  id, teacher_id, title
) values (
  'b1340000-0000-4000-8000-000000000301',
  'b1340000-0000-4000-8000-000000000001',
  'Question identity instantiation source'
);

insert into public.course_blueprint_versions (
  id, course_blueprint_id, version_number, source_draft_revision,
  snapshot_json, snapshot_sha256, created_by
) values (
  'b1340000-0000-4000-8000-000000000302',
  'b1340000-0000-4000-8000-000000000301',
  1,
  1,
  '{}'::jsonb,
  repeat('d', 64),
  'b1340000-0000-4000-8000-000000000001'
);

-- Fail only the explicit-identity insertion performed by migration 134. The
-- compatibility RPC receives no Test questions, so this proves a failure after
-- the base Classroom graph returned still rolls that graph back and retains its
-- operation ledger.
create function public.b134_fail_question_rematerialization_once()
returns trigger
language plpgsql
set search_path = ''
as $failure$
begin
  if coalesce(
    current_setting('pika.b134_force_rematerialization_failure', true),
    'off'
  ) = 'on' and new.source_artifact_id is not null then
    raise exception 'Forced question rematerialization failure'
      using errcode = '40001';
  end if;
  return new;
end;
$failure$;

create trigger b134_fail_question_rematerialization_once
before insert on public.test_questions
for each row execute function public.b134_fail_question_rematerialization_once();

do $contract$
declare
  v_teacher_id constant uuid := 'b1340000-0000-4000-8000-000000000001';
  v_active_classroom_id constant uuid := 'b1340000-0000-4000-8000-000000000010';
  v_archived_classroom_id constant uuid := 'b1340000-0000-4000-8000-000000000020';
  v_active_failed_operation_id constant uuid := 'b1340000-0000-4000-8000-000000000200';
  v_active_student_work_operation_id constant uuid := 'b1340000-0000-4000-8000-000000000204';
  v_archived_failed_operation_id constant uuid := 'b1340000-0000-4000-8000-000000000220';
  v_active_test_artifact_id constant uuid := 'b1340000-0000-4000-8000-000000000111';
  v_active_question_one_id constant uuid := 'b1340000-0000-4000-8000-000000000112';
  v_active_question_two_id constant uuid := 'b1340000-0000-4000-8000-000000000113';
  v_active_draft_only_question_id constant uuid := 'b1340000-0000-4000-8000-000000000114';
  v_active_question_one_row_id constant uuid := 'b1340000-0000-4000-8000-000000000012';
  v_active_archived_test_row_id constant uuid := 'b1340000-0000-4000-8000-000000000015';
  v_active_archived_question_row_id constant uuid := 'b1340000-0000-4000-8000-000000000016';
  v_archived_test_artifact_id constant uuid := 'b1340000-0000-4000-8000-000000000211';
  v_archived_question_one_id constant uuid := 'b1340000-0000-4000-8000-000000000212';
  v_archived_question_two_id constant uuid := 'b1340000-0000-4000-8000-000000000213';
  v_archived_draft_only_question_id constant uuid := 'b1340000-0000-4000-8000-000000000214';
  v_archived_question_one_row_id constant uuid := 'b1340000-0000-4000-8000-000000000022';
  v_archived_winner_operation_id constant uuid := 'b1340000-0000-4000-8000-000000000221';
  v_archived_fresh_replay_operation_id constant uuid := 'b1340000-0000-4000-8000-000000000222';
  v_archived_stale_operation_id constant uuid := 'b1340000-0000-4000-8000-000000000223';
  v_instantiation_blueprint_id constant uuid := 'b1340000-0000-4000-8000-000000000301';
  v_instantiation_version_id constant uuid := 'b1340000-0000-4000-8000-000000000302';
  v_instantiation_operation_id constant uuid := 'b1340000-0000-4000-8000-000000000303';
  v_instantiation_test_id constant uuid := 'b1340000-0000-4000-8000-000000000311';
  v_instantiation_question_one_id constant uuid := 'b1340000-0000-4000-8000-000000000312';
  v_instantiation_question_two_id constant uuid := 'b1340000-0000-4000-8000-000000000313';
  v_active_revision bigint;
  v_archived_failed_revision bigint;
  v_archived_revision bigint;
  v_active_plan jsonb;
  v_active_failure_plan jsonb;
  v_active_student_work_plan jsonb;
  v_archived_plan jsonb;
  v_archived_failure_plan jsonb;
  v_instantiation_plan jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_blueprint_id uuid;
  v_instantiated_classroom_id uuid;
  v_artifact_ids uuid[];
  v_source_artifact_ids uuid[];
  v_blueprint_question_ids uuid[];
  v_content jsonb;
  v_count integer;
  v_error_message text;
begin
  v_active_plan := jsonb_build_object(
    'blueprint', jsonb_build_object(
      'title', 'Active ordinal Blueprint',
      'subject', '',
      'grade_level', '',
      'course_code', '',
      'term_template', '',
      'overview_markdown', '',
      'outline_markdown', '',
      'resources_markdown', '',
      'gradebook_use_weights', false,
      'gradebook_assignments_weight', 70,
      'gradebook_tests_weight', 30,
      'planned_site_slug', null,
      'planned_site_published', false,
      'planned_site_config', '{}'::jsonb
    ),
    'assignments', '[]'::jsonb,
    'assessments', jsonb_build_array(jsonb_build_object(
      'artifact_id', v_active_test_artifact_id,
      'assessment_type', 'test',
      'title', 'Active multi-question Test',
      'content', jsonb_build_object(
        'title', 'Active multi-question Test',
        'show_results', false,
        'question_identity_version', 1,
        'questions', jsonb_build_array(
          jsonb_build_object(
            'id', v_active_question_two_id,
            'question_type', 'open_response',
            'question_text', 'Active question two',
            'options', '[]'::jsonb,
            'correct_option', null,
            'answer_key', 'A concise explanation',
            'sample_solution', null,
            'points', 1,
            'response_max_chars', 5000,
            'response_monospace', false
          ),
          jsonb_build_object(
            'id', v_active_draft_only_question_id,
            'question_type', 'open_response',
            'question_text', 'Active draft-only question',
            'options', '[]'::jsonb,
            'correct_option', null,
            'answer_key', null,
            'sample_solution', null,
            'points', 1,
            'response_max_chars', 5000,
            'response_monospace', false
          )
        )
      ),
      'documents', '[]'::jsonb,
      'points_possible', 2,
      'gradebook_weight', 10,
      'include_in_final', true,
      'position', 0
    )),
    'lesson_templates', '[]'::jsonb,
    'materials', '[]'::jsonb,
    'surveys', '[]'::jsonb,
    'manifest_version', '3',
    'source_package_exported_at', null
  );

  v_active_failure_plan := jsonb_set(
    v_active_plan,
    '{blueprint,title}',
    to_jsonb('Active identity rollback'::text)
  );

  -- The canonical unique index normally prevents this corruption at write
  -- time. Suspend it only inside this rolled-back fixture to prove capture's
  -- defense-in-depth still fails closed if pre-constraint or manually
  -- corrupted data reaches the RPC.
  execute 'drop index public.test_questions_test_portable_identity_unique';

  -- Duplicate portable identity is ambiguous even though row IDs and positions
  -- are distinct. Capture must fail without rewriting either source row.
  update public.test_questions
  set source_artifact_id = v_active_question_two_id
  where id = v_active_question_one_row_id;

  select blueprint_source_revision
  into v_active_revision
  from public.classrooms
  where id = v_active_classroom_id;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.create_course_blueprint_atomic_v2(
    v_active_failed_operation_id,
    v_teacher_id,
    'capture',
    repeat('0', 64),
    v_active_classroom_id,
    v_active_revision,
    v_active_failure_plan
  );
  if coalesce((v_result->>'ok')::boolean, true)
    or v_result->>'status' is distinct from '409'
    or v_result->>'operation_id' is distinct from v_active_failed_operation_id::text
    or v_result->>'operation_type' is distinct from 'capture'
    or v_result->>'error_code' is distinct from 'test_question_identity_ambiguous'
    or v_result->>'error' is distinct from 'Test question identity mapping is ambiguous'
    or not coalesce((v_result->>'retryable')::boolean, false)
  then
    raise exception 'Active ambiguity did not return a structured failure: %', v_result;
  end if;
  select count(*)
  into v_count
  from public.course_blueprint_operations
  where id = v_active_failed_operation_id
    and teacher_id = v_teacher_id
    and operation_type = 'capture'
    and request_sha256 = repeat('0', 64)
    and status = 'failed'
    and attempt_count = 1
    and source_classroom_id = v_active_classroom_id
    and result_blueprint_id is null
    and result_classroom_id is null
    and result = v_result
    and resource_counts->>'assessments' = '1'
    and error_code = 'test_question_identity_ambiguous'
    and error_sqlstate = '22023'
    and completed_at is not null;
  if v_count <> 1 then
    raise exception 'Active ambiguity did not retain its failed operation ledger';
  end if;
  if exists (
    select 1
    from public.course_blueprints
    where teacher_id = v_teacher_id
      and title = 'Active identity rollback'
  ) or exists (
    select 1
    from public.classrooms
    where id = v_active_classroom_id
      and (
        source_blueprint_id is not null
        or source_blueprint_origin is not null
      )
  ) or not exists (
    select 1
    from public.test_questions
    where id = v_active_question_one_row_id
      and artifact_id = v_active_question_one_id
      and source_artifact_id = v_active_question_two_id
  ) then
    raise exception 'Active ambiguous identity was not rolled back atomically';
  end if;

  update public.test_questions
  set source_artifact_id = null
  where id = v_active_question_one_row_id;

  execute $index$
    create unique index test_questions_test_portable_identity_unique
      on public.test_questions (
        test_id,
        (coalesce(source_artifact_id, artifact_id))
      )
  $index$;

  select blueprint_source_revision
  into v_active_revision
  from public.classrooms
  where id = v_active_classroom_id;

  v_result := public.create_course_blueprint_atomic_v2(
    v_active_failed_operation_id,
    v_teacher_id,
    'capture',
    repeat('0', 64),
    v_active_classroom_id,
    v_active_revision,
    v_active_failure_plan
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Active same-key retry after repair failed: %', v_result;
  end if;
  v_blueprint_id := (v_result->>'blueprint_id')::uuid;
  select count(*)
  into v_count
  from public.course_blueprint_operations
  where id = v_active_failed_operation_id
    and status = 'completed'
    and attempt_count = 2
    and result_blueprint_id = v_blueprint_id
    and result = v_result
    and error_code is null
    and error_sqlstate is null
    and completed_at is not null;
  if v_count <> 1 then
    raise exception 'Active retry did not complete the retained operation ledger';
  end if;

  select
    array_agg(artifact_id order by position),
    array_agg(source_artifact_id order by position)
  into v_artifact_ids, v_source_artifact_ids
  from public.test_questions
  where test_id = 'b1340000-0000-4000-8000-000000000011';
  if v_artifact_ids is distinct from array[
    v_active_question_one_id,
    v_active_question_two_id
  ] or v_source_artifact_ids is distinct from array[null::uuid, null::uuid]
  then
    raise exception 'Active capture rewrote persisted question identity';
  end if;
  if exists (
    select 1
    from public.tests
    where id = 'b1340000-0000-4000-8000-000000000011'
      and source_artifact_id is not null
  ) then
    raise exception 'Active capture rewrote persisted Test identity';
  end if;
  if not exists (
    select 1
    from public.tests
    where id = v_active_archived_test_row_id
      and artifact_id = 'b1340000-0000-4000-8000-000000000115'::uuid
      and source_artifact_id = v_active_test_artifact_id
      and blueprint_archived_at is not null
  ) or not exists (
    select 1
    from public.test_questions
    where id = v_active_archived_question_row_id
      and test_id = v_active_archived_test_row_id
      and artifact_id = 'b1340000-0000-4000-8000-000000000116'::uuid
      and source_artifact_id = v_active_question_two_id
  ) then
    raise exception 'Active capture included the retained archived Test generation';
  end if;

  select content
  into v_content
  from public.course_blueprint_assessments
  where course_blueprint_id = v_blueprint_id
    and position = 0;
  if exists (
    select 1
    from jsonb_array_elements(v_content->'questions') as question(value)
    where question.value ? 'position'
  ) then
    raise exception 'Active capture persisted a redundant Test question position';
  end if;
  select array_agg(
    (question.value->>'id')::uuid
    order by question.ordinality
  )
  into v_blueprint_question_ids
  from jsonb_array_elements(v_content->'questions')
    with ordinality as question(value, ordinality);
  if v_blueprint_question_ids is distinct from array[
    v_active_question_two_id,
    v_active_draft_only_question_id
  ] then
    raise exception 'Active capture did not preserve reordered and draft-only questions';
  end if;

  v_replay := public.create_course_blueprint_atomic_v2(
    v_active_failed_operation_id,
    v_teacher_id,
    'capture',
    repeat('0', 64),
    v_active_classroom_id,
    v_active_revision,
    v_active_failure_plan
  );
  if not coalesce((v_replay->>'replayed')::boolean, false)
    or v_replay->>'blueprint_id' <> v_blueprint_id::text
  then
    raise exception 'Active ordinal Blueprint capture did not replay';
  end if;
  select count(*)
  into v_count
  from public.course_blueprints
  where teacher_id = v_teacher_id
    and title = 'Active identity rollback';
  if v_count <> 1 then
    raise exception 'Active same-key replay created duplicate Blueprints';
  end if;

  -- Once the Test is active, capture must validate against its materialized
  -- question graph. Recapture with student work records only immutable Version
  -- provenance and must preserve attempts, responses, identity, and content.
  v_active_student_work_plan := jsonb_set(
    jsonb_set(
      v_active_plan,
      '{blueprint,title}',
      to_jsonb('Active capture with student work'::text)
    ),
    '{assessments,0,content,questions}',
    jsonb_build_array(
      jsonb_build_object(
        'id', v_active_question_two_id,
        'question_type', 'open_response',
        'question_text', 'Active question two',
        'options', '[]'::jsonb,
        'correct_option', null,
        'answer_key', 'A concise explanation',
        'sample_solution', null,
        'points', 1,
        'response_max_chars', 5000,
        'response_monospace', false
      ),
      jsonb_build_object(
        'id', v_active_question_one_id,
        'question_type', 'multiple_choice',
        'question_text', 'Active question one',
        'options', '["A","B"]'::jsonb,
        'correct_option', 0,
        'answer_key', null,
        'sample_solution', null,
        'points', 1,
        'response_max_chars', 5000,
        'response_monospace', false
      )
    )
  );
  update public.tests
  set status = 'active'
  where id = 'b1340000-0000-4000-8000-000000000011';
  insert into public.test_attempts (id, test_id, student_id)
  values (
    'b1340000-0000-4000-8000-000000000401',
    'b1340000-0000-4000-8000-000000000011',
    v_teacher_id
  );
  insert into public.test_responses (
    id, test_id, question_id, student_id, response_text
  ) values (
    'b1340000-0000-4000-8000-000000000402',
    'b1340000-0000-4000-8000-000000000011',
    'b1340000-0000-4000-8000-000000000013',
    v_teacher_id,
    'Active response must remain unchanged'
  );
  select blueprint_source_revision
  into v_active_revision
  from public.classrooms
  where id = v_active_classroom_id;
  v_result := public.create_course_blueprint_atomic_v2(
    v_active_student_work_operation_id,
    v_teacher_id,
    'capture',
    repeat('4', 64),
    v_active_classroom_id,
    v_active_revision,
    v_active_student_work_plan
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Active capture with student work failed: %', v_result;
  end if;
  if not exists (
    select 1
    from public.test_questions question
    join public.test_responses response
      on response.question_id = question.id
    join public.test_attempts attempt
      on attempt.test_id = question.test_id
      and attempt.student_id = response.student_id
    where question.id = 'b1340000-0000-4000-8000-000000000013'
      and question.artifact_id = v_active_question_two_id
      and question.source_artifact_id is null
      and question.question_text = 'Active question two'
      and question.source_blueprint_version_id =
        (v_result->>'source_blueprint_version_id')::uuid
      and response.id = 'b1340000-0000-4000-8000-000000000402'
      and response.response_text = 'Active response must remain unchanged'
      and attempt.id = 'b1340000-0000-4000-8000-000000000401'
  ) then
    raise exception 'Active capture changed student work';
  end if;
  begin
    update public.test_questions
    set question_text = 'Unsafe active authored change'
    where id = 'b1340000-0000-4000-8000-000000000013';
    raise exception 'Authored active question update bypassed the student-work freeze';
  exception when sqlstate '55000' then
    get stacked diagnostics v_error_message = message_text;
    if v_error_message not like 'test_questions_locked:%' then
      raise;
    end if;
  end;

  v_archived_plan := jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          v_active_plan,
          '{blueprint,title}',
          to_jsonb('Archived ordinal Blueprint'::text)
        ),
        '{assessments,0,artifact_id}',
        to_jsonb(v_archived_test_artifact_id)
      ),
      '{assessments,0,title}',
      to_jsonb('Archived multi-question Test'::text)
    ),
    '{assessments,0,content}',
    jsonb_build_object(
      'title', 'Archived multi-question Test',
      'show_results', false,
      'question_identity_version', 1,
      'questions', jsonb_build_array(
        jsonb_build_object(
          'id', v_archived_question_two_id,
          'question_type', 'open_response',
          'question_text', 'Archived question two',
          'options', '[]'::jsonb,
          'correct_option', null,
          'answer_key', 'A concise explanation',
          'sample_solution', null,
          'points', 1,
          'response_max_chars', 5000,
          'response_monospace', false
        ),
        jsonb_build_object(
          'id', v_archived_draft_only_question_id,
          'question_type', 'open_response',
          'question_text', 'Archived draft-only question',
          'options', '[]'::jsonb,
          'correct_option', null,
          'answer_key', null,
          'sample_solution', null,
          'points', 1,
          'response_max_chars', 5000,
          'response_monospace', false
        )
      )
    )
  );

  v_archived_failure_plan := jsonb_set(
    v_archived_plan,
    '{blueprint,title}',
    to_jsonb('Archived identity rollback'::text)
  );

  -- As in the active-source case above, bypass the canonical write-time fence
  -- only long enough to exercise the archived capture RPC's defense-in-depth
  -- against legacy or manually corrupted rows.
  execute 'drop index public.test_questions_test_portable_identity_unique';

  update public.test_questions
  set source_artifact_id = v_archived_question_two_id
  where id = v_archived_question_one_row_id;

  select blueprint_source_revision
  into v_archived_failed_revision
  from public.classrooms
  where id = v_archived_classroom_id;

  v_result := public.create_archived_classroom_blueprint_atomic(
    v_archived_failed_operation_id,
    v_teacher_id,
    repeat('b', 64),
    v_archived_classroom_id,
    v_archived_failed_revision,
    v_archived_failure_plan
  );
  if coalesce((v_result->>'ok')::boolean, true)
    or v_result->>'status' is distinct from '409'
    or v_result->>'operation_id' is distinct from v_archived_failed_operation_id::text
    or v_result->>'operation_type' is distinct from 'import'
    or v_result->>'error_code' is distinct from 'test_question_identity_ambiguous'
    or v_result->>'error' is distinct from 'Test question identity mapping is ambiguous'
    or not coalesce((v_result->>'retryable')::boolean, false)
  then
    raise exception 'Archived ambiguity did not return a structured failure: %', v_result;
  end if;
  select count(*)
  into v_count
  from public.course_blueprint_operations
  where id = v_archived_failed_operation_id
    and teacher_id = v_teacher_id
    and operation_type = 'import'
    and request_sha256 = repeat('b', 64)
    and status = 'failed'
    and attempt_count = 1
    and source_classroom_id = v_archived_classroom_id
    and result_blueprint_id is null
    and result_classroom_id is null
    and result = v_result
    and resource_counts->>'assessments' = '1'
    and error_code = 'test_question_identity_ambiguous'
    and error_sqlstate = '22023'
    and completed_at is not null;
  if v_count <> 1 then
    raise exception 'Archived ambiguity did not retain its failed operation ledger';
  end if;
  if exists (
    select 1
    from public.course_blueprints
    where teacher_id = v_teacher_id
      and title = 'Archived identity rollback'
  ) or exists (
    select 1
    from public.classrooms
    where id = v_archived_classroom_id
      and source_blueprint_id is not null
  ) or not exists (
    select 1
    from public.test_questions
    where id = v_archived_question_one_row_id
      and artifact_id = v_archived_question_one_id
      and source_artifact_id = v_archived_question_two_id
  ) then
    raise exception 'Archived ambiguous identity was not rolled back atomically';
  end if;

  update public.test_questions
  set source_artifact_id = null
  where id = v_archived_question_one_row_id;

  execute $index$
    create unique index test_questions_test_portable_identity_unique
      on public.test_questions (
        test_id,
        (coalesce(source_artifact_id, artifact_id))
      )
  $index$;

  select blueprint_source_revision
  into v_archived_revision
  from public.classrooms
  where id = v_archived_classroom_id;
  if v_archived_revision <= v_archived_failed_revision then
    raise exception 'Archived identity repair did not advance the source revision';
  end if;

  -- A stale request must retain durable failed evidence instead of leaving a
  -- running operation behind. Operation B then wins, after which the stale
  -- request can retry with the current revision and reconcile to that winner.
  v_replay := public.create_archived_classroom_blueprint_atomic(
    v_archived_stale_operation_id,
    v_teacher_id,
    repeat('0', 64),
    v_archived_classroom_id,
    v_archived_revision - 1,
    v_archived_failure_plan
  );
  if coalesce((v_replay->>'ok')::boolean, true)
    or v_replay->>'status' is distinct from '409'
    or v_replay->>'error_code' is distinct from 'source_classroom_changed'
    or not coalesce((v_replay->>'retryable')::boolean, false)
  then
    raise exception 'Stale archived request did not return a retryable conflict: %', v_replay;
  end if;
  if not exists (
    select 1
    from public.course_blueprint_operations
    where id = v_archived_stale_operation_id
      and request_sha256 = repeat('0', 64)
      and status = 'failed'
      and attempt_count = 1
      and source_classroom_id = v_archived_classroom_id
      and result_blueprint_id is null
      and result_classroom_id is null
      and result = v_replay
      and resource_counts = '{}'::jsonb
      and error_code = 'source_classroom_changed'
      and completed_at is not null
  ) then
    raise exception 'Stale archived request did not retain its failed ledger';
  end if;

  -- Operation B wins after the source repair while failed operation A remains
  -- retained. A mismatched replay must conflict before the classroom winner
  -- shortcut, then compatible retries must reconcile both failed ledgers.
  v_result := public.create_archived_classroom_blueprint_atomic(
    v_archived_winner_operation_id,
    v_teacher_id,
    repeat('c', 64),
    v_archived_classroom_id,
    v_archived_revision,
    v_archived_failure_plan
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Archived winner operation after repair failed: %', v_result;
  end if;
  v_blueprint_id := (v_result->>'blueprint_id')::uuid;
  select count(*)
  into v_count
  from public.course_blueprint_operations
  where id = v_archived_winner_operation_id
    and status = 'completed'
    and attempt_count = 1
    and source_classroom_id = v_archived_classroom_id
    and result_blueprint_id = v_blueprint_id
    and result_classroom_id = v_archived_classroom_id
    and result = v_result
    and error_code is null
    and error_sqlstate is null
    and completed_at is not null;
  if v_count <> 1 then
    raise exception 'Archived winner operation did not complete its ledger';
  end if;

  v_replay := public.create_archived_classroom_blueprint_atomic(
    v_archived_stale_operation_id,
    v_teacher_id,
    repeat('0', 64),
    v_archived_classroom_id,
    v_archived_revision,
    v_archived_failure_plan
  );
  if not coalesce((v_replay->>'ok')::boolean, false)
    or not coalesce((v_replay->>'replayed')::boolean, false)
    or v_replay->>'blueprint_id' is distinct from v_blueprint_id::text
  then
    raise exception 'Stale archived operation did not reconcile to the winner: %', v_replay;
  end if;
  if not exists (
    select 1
    from public.course_blueprint_operations
    where id = v_archived_stale_operation_id
      and request_sha256 = repeat('0', 64)
      and status = 'completed'
      and attempt_count = 2
      and result_blueprint_id = v_blueprint_id
      and result_classroom_id = v_archived_classroom_id
      and result = v_replay
      and error_code is null
      and error_sqlstate is null
      and completed_at is not null
  ) then
    raise exception 'Stale archived winner retry did not reconcile its failed ledger';
  end if;

  v_replay := public.create_archived_classroom_blueprint_atomic(
    v_archived_failed_operation_id,
    v_teacher_id,
    repeat('c', 64),
    v_archived_classroom_id,
    v_archived_revision,
    v_archived_failure_plan
  );
  if coalesce((v_replay->>'ok')::boolean, true)
    or v_replay->>'status' is distinct from '409'
    or v_replay->>'error_code' is distinct from 'idempotency_conflict'
    or coalesce((v_replay->>'retryable')::boolean, true)
  then
    raise exception 'Archived winner shortcut bypassed hash validation: %', v_replay;
  end if;
  if not exists (
    select 1
    from public.course_blueprint_operations
    where id = v_archived_failed_operation_id
      and request_sha256 = repeat('b', 64)
      and status = 'failed'
      and attempt_count = 1
      and error_code = 'test_question_identity_ambiguous'
  ) then
    raise exception 'Archived hash conflict mutated the retained failed ledger';
  end if;

  v_result := public.create_archived_classroom_blueprint_atomic(
    v_archived_failed_operation_id,
    v_teacher_id,
    repeat('b', 64),
    v_archived_classroom_id,
    v_archived_revision,
    v_archived_failure_plan
  );
  if not coalesce((v_result->>'ok')::boolean, false)
    or not coalesce((v_result->>'replayed')::boolean, false)
    or v_result->>'blueprint_id' is distinct from v_blueprint_id::text
  then
    raise exception 'Archived failed operation did not reconcile to the winner: %', v_result;
  end if;
  select count(*)
  into v_count
  from public.course_blueprint_operations
  where id = v_archived_failed_operation_id
    and status = 'completed'
    and attempt_count = 2
    and request_sha256 = repeat('b', 64)
    and source_classroom_id = v_archived_classroom_id
    and result_blueprint_id = v_blueprint_id
    and result_classroom_id = v_archived_classroom_id
    and result = v_result
    and error_code is null
    and error_sqlstate is null
    and completed_at is not null;
  if v_count <> 1 then
    raise exception 'Archived winner replay did not reconcile the failed ledger';
  end if;

  -- A fresh operation arriving after the classroom winner must also reserve
  -- and complete its key. Reusing that key with a different hash must conflict
  -- rather than passing through the winner shortcut again.
  v_result := public.create_archived_classroom_blueprint_atomic(
    v_archived_fresh_replay_operation_id,
    v_teacher_id,
    repeat('e', 64),
    v_archived_classroom_id,
    v_archived_revision,
    v_archived_failure_plan
  );
  if not coalesce((v_result->>'ok')::boolean, false)
    or not coalesce((v_result->>'replayed')::boolean, false)
    or v_result->>'blueprint_id' is distinct from v_blueprint_id::text
  then
    raise exception 'Fresh archived winner replay failed: %', v_result;
  end if;
  if not exists (
    select 1
    from public.course_blueprint_operations
    where id = v_archived_fresh_replay_operation_id
      and request_sha256 = repeat('e', 64)
      and status = 'completed'
      and attempt_count = 1
      and result_blueprint_id = v_blueprint_id
      and result_classroom_id = v_archived_classroom_id
      and result = v_result
  ) then
    raise exception 'Fresh archived winner replay did not reserve its ledger key';
  end if;

  v_replay := public.create_archived_classroom_blueprint_atomic(
    v_archived_fresh_replay_operation_id,
    v_teacher_id,
    repeat('f', 64),
    v_archived_classroom_id,
    v_archived_revision,
    v_archived_failure_plan
  );
  if coalesce((v_replay->>'ok')::boolean, true)
    or v_replay->>'status' is distinct from '409'
    or v_replay->>'error_code' is distinct from 'idempotency_conflict'
  then
    raise exception 'Fresh archived winner replay reused its key with a different hash: %', v_replay;
  end if;
  if not exists (
    select 1
    from public.course_blueprint_operations
    where id = v_archived_fresh_replay_operation_id
      and request_sha256 = repeat('e', 64)
      and status = 'completed'
      and result_blueprint_id = v_blueprint_id
  ) then
    raise exception 'Fresh archived winner hash conflict mutated its ledger';
  end if;

  select
    array_agg(artifact_id order by position),
    array_agg(source_artifact_id order by position)
  into v_artifact_ids, v_source_artifact_ids
  from public.test_questions
  where test_id = 'b1340000-0000-4000-8000-000000000021';
  if v_artifact_ids is distinct from array[
    v_archived_question_one_id,
    v_archived_question_two_id
  ] or v_source_artifact_ids is distinct from array[null::uuid, null::uuid]
  then
    raise exception 'Archived reuse rewrote persisted question identity';
  end if;
  if exists (
    select 1
    from public.tests
    where id = 'b1340000-0000-4000-8000-000000000021'
      and source_artifact_id is not null
  ) then
    raise exception 'Archived reuse rewrote persisted Test identity';
  end if;

  select content
  into v_content
  from public.course_blueprint_assessments
  where course_blueprint_id = v_blueprint_id
    and position = 0;
  if exists (
    select 1
    from jsonb_array_elements(v_content->'questions') as question(value)
    where question.value ? 'position'
  ) then
    raise exception 'Archived reuse persisted a redundant Test question position';
  end if;
  select array_agg(
    (question.value->>'id')::uuid
    order by question.ordinality
  )
  into v_blueprint_question_ids
  from jsonb_array_elements(v_content->'questions')
    with ordinality as question(value, ordinality);
  if v_blueprint_question_ids is distinct from array[
    v_archived_question_two_id,
    v_archived_draft_only_question_id
  ] then
    raise exception 'Archived reuse did not preserve reordered and draft-only questions';
  end if;

  v_replay := public.create_archived_classroom_blueprint_atomic(
    v_archived_failed_operation_id,
    v_teacher_id,
    repeat('b', 64),
    v_archived_classroom_id,
    v_archived_revision,
    v_archived_failure_plan
  );
  if not coalesce((v_replay->>'replayed')::boolean, false)
    or v_replay->>'blueprint_id' <> v_blueprint_id::text
  then
    raise exception 'Archived ordinal Blueprint reuse did not replay';
  end if;
  select count(*)
  into v_count
  from public.course_blueprints
  where teacher_id = v_teacher_id
    and title = 'Archived identity rollback';
  if v_count <> 1 then
    raise exception 'Archived same-key replay created duplicate Blueprints';
  end if;

  v_instantiation_plan := jsonb_build_object(
    'expected_content_revision', 0,
    'manifest_version', '3',
    'classroom', jsonb_build_object(
      'title', 'Question identity classroom',
      'class_code', 'B134I1',
      'term_label', null,
      'theme_color', 'blue',
      'start_date', '2026-09-08',
      'end_date', '2027-01-29',
      'course_overview_markdown', '',
      'course_outline_markdown', '',
      'actual_site_config', '{}'::jsonb
    ),
    'class_days', '[]'::jsonb,
    'resources_content', null,
    'grading', jsonb_build_object(
      'use_weights', false,
      'assignments_weight', 70,
      'tests_weight', 30
    ),
    'assignments', '[]'::jsonb,
    'tests', jsonb_build_array(jsonb_build_object(
      'artifact_id', v_instantiation_test_id,
      'title', 'Versioned identity Test',
      'position', 0,
      'show_results', false,
      'documents', '[]'::jsonb,
      'points_possible', 2,
      'gradebook_weight', 10,
      'include_in_final', true,
      'questions', jsonb_build_array(
        jsonb_build_object(
          'artifact_id', v_instantiation_question_two_id,
          'question_type', 'open_response',
          'question_text', 'Second artifact, first in the plan',
          'options', '[]'::jsonb,
          'correct_option', null,
          'answer_key', null,
          'sample_solution', null,
          'points', 1,
          'response_max_chars', 5000,
          'response_monospace', false,
          'position', 4
        ),
        jsonb_build_object(
          'artifact_id', v_instantiation_question_one_id,
          'question_type', 'multiple_choice',
          'question_text', 'First artifact, second in the plan',
          'options', '["A","B"]'::jsonb,
          'correct_option', 0,
          'answer_key', null,
          'sample_solution', null,
          'points', 1,
          'response_max_chars', 5000,
          'response_monospace', false,
          'position', 1
        )
      ),
      'draft_content', jsonb_build_object(
        'title', 'Versioned identity Test',
        'show_results', false,
        'questions', jsonb_build_array(
          jsonb_build_object(
            'id', v_instantiation_question_two_id,
            'question_type', 'open_response',
            'question_text', 'Second artifact, first in the plan',
            'options', '[]'::jsonb,
            'correct_option', null,
            'answer_key', null,
            'sample_solution', null,
            'points', 1,
            'response_max_chars', 5000,
            'response_monospace', false
          ),
          jsonb_build_object(
            'id', v_instantiation_question_one_id,
            'question_type', 'multiple_choice',
            'question_text', 'First artifact, second in the plan',
            'options', '["A","B"]'::jsonb,
            'correct_option', 0,
            'answer_key', null,
            'sample_solution', null,
            'points', 1,
            'response_max_chars', 5000,
            'response_monospace', false
          )
        )
      )
    )),
    'lesson_plans', '[]'::jsonb,
    'materials', '[]'::jsonb,
    'surveys', '[]'::jsonb
  );

  perform set_config(
    'pika.b134_force_rematerialization_failure',
    'on',
    true
  );
  v_result := public.instantiate_course_blueprint_atomic_v2(
    v_instantiation_operation_id,
    v_teacher_id,
    v_instantiation_blueprint_id,
    v_instantiation_version_id,
    repeat('d', 64),
    1,
    v_instantiation_plan
  );
  perform set_config(
    'pika.b134_force_rematerialization_failure',
    'off',
    true
  );
  if coalesce((v_result->>'ok')::boolean, false)
    or v_result->>'error_code' <> 'test_question_identity_mapping_failed'
  then
    raise exception 'Forced Version question rematerialization did not fail: %', v_result;
  end if;
  select count(*)
  into v_count
  from public.classrooms
  where class_code = 'B134I1';
  if v_count <> 0 then
    raise exception 'Failed Version rematerialization retained a partial Classroom';
  end if;
  if not exists (
    select 1
    from public.course_blueprint_operations
    where id = v_instantiation_operation_id
      and status = 'failed'
      and attempt_count = 1
      and result_classroom_id is null
      and error_code = 'test_question_identity_mapping_failed'
      and error_sqlstate = '40001'
  ) then
    raise exception 'Failed Version rematerialization did not retain its ledger';
  end if;

  v_result := public.instantiate_course_blueprint_atomic_v2(
    v_instantiation_operation_id,
    v_teacher_id,
    v_instantiation_blueprint_id,
    v_instantiation_version_id,
    repeat('d', 64),
    1,
    v_instantiation_plan
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Version question identity instantiation failed: %', v_result;
  end if;
  if (v_result->'counts'->>'questions')::integer <> 2 then
    raise exception 'Version question identity instantiation returned the wrong question count: %', v_result;
  end if;
  v_instantiated_classroom_id := (v_result->>'classroom_id')::uuid;
  if not exists (
    select 1
    from public.course_blueprint_operations
    where id = v_instantiation_operation_id
      and status = 'completed'
      and attempt_count = 2
      and result_classroom_id = v_instantiated_classroom_id
      and (resource_counts->>'questions')::integer = 2
  ) then
    raise exception 'Version rematerialization retry did not complete its ledger';
  end if;

  -- A completed instantiate key belongs to a different RPC family. The outer
  -- capture wrapper must preserve the base function's allowed-type boundary
  -- before considering any completed ledger replay.
  begin
    perform public.create_course_blueprint_atomic_v2(
      v_instantiation_operation_id,
      v_teacher_id,
      'instantiate',
      repeat('d', 64),
      null,
      null,
      '{}'::jsonb
    );
    raise exception 'Capture RPC replayed a completed instantiate operation';
  exception when sqlstate '22023' then
    null;
  end;

  v_replay := public.instantiate_course_blueprint_atomic_v2(
    v_instantiation_operation_id,
    v_teacher_id,
    v_instantiation_blueprint_id,
    v_instantiation_version_id,
    repeat('d', 64),
    1,
    v_instantiation_plan
  );
  if not coalesce((v_replay->>'replayed')::boolean, false)
    or v_replay->>'classroom_id' <> v_instantiated_classroom_id::text
  then
    raise exception 'Version rematerialization same-key replay diverged: %', v_replay;
  end if;

  select
    array_agg(question.artifact_id order by question.position),
    array_agg(question.source_artifact_id order by question.position)
  into v_artifact_ids, v_source_artifact_ids
  from public.test_questions question
  join public.tests test on test.id = question.test_id
  where test.classroom_id = v_instantiated_classroom_id
    and test.source_artifact_id = v_instantiation_test_id;
  if v_artifact_ids is distinct from array[
    v_instantiation_question_one_id,
    v_instantiation_question_two_id
  ] or v_source_artifact_ids is distinct from array[
    v_instantiation_question_one_id,
    v_instantiation_question_two_id
  ] then
    raise exception 'Version instantiation did not preserve explicit question identity';
  end if;
  if exists (
    select 1
    from public.test_questions question
    join public.tests test on test.id = question.test_id
    where test.classroom_id = v_instantiated_classroom_id
      and question.id in (
        v_instantiation_question_one_id,
        v_instantiation_question_two_id
      )
  ) then
    raise exception 'Version instantiation reused portable identity as row identity';
  end if;
  if not exists (
    select 1
    from public.assessment_drafts draft
    join public.tests test
      on test.id = draft.assessment_id
      and draft.assessment_type = 'test'
    where test.classroom_id = v_instantiated_classroom_id
      and test.source_artifact_id = v_instantiation_test_id
      and draft.content->>'question_identity_version' = '1'
  ) then
    raise exception 'Instantiated Test draft did not retain the portable identity discriminator';
  end if;
end;
$contract$;

-- A captured origin Test is a Blueprint member even though capture leaves its
-- source identity null. Its immutable Version provenance must let a later
-- Blueprint proposal update the same Test row while preserving a genuinely
-- new Classroom-only Test.
do $proposal$
declare
  v_teacher_id constant uuid := 'b1340000-0000-4000-8000-000000000001';
  v_classroom_id constant uuid := 'b1344000-0000-4000-8000-000000000010';
  v_test_row_id constant uuid := 'b1344000-0000-4000-8000-000000000011';
  v_question_row_id constant uuid := 'b1344000-0000-4000-8000-000000000012';
  v_test_artifact_id constant uuid := 'b1344000-0000-4000-8000-000000000111';
  v_question_artifact_id constant uuid := 'b1344000-0000-4000-8000-000000000112';
  v_local_test_row_id constant uuid := 'b1344000-0000-4000-8000-000000000021';
  v_capture_operation_id constant uuid := 'b1344000-0000-4000-8000-000000000201';
  v_proposal_idempotency_key constant uuid := 'b1344000-0000-4000-8000-000000000202';
  v_blueprint_id uuid;
  v_blueprint_revision bigint;
  v_classroom_revision bigint;
  v_capture_plan jsonb;
  v_classroom_plan jsonb;
  v_result jsonb;
  v_snapshot jsonb;
  v_snapshot_sha256 text;
  v_plan_sha256 text;
  v_version public.course_blueprint_versions;
  v_proposal public.course_blueprint_change_proposals;
  v_count integer;
begin
  insert into public.classrooms (
    id, teacher_id, title, class_code, start_date, end_date
  ) values (
    v_classroom_id,
    v_teacher_id,
    'Captured proposal membership',
    'B134P4',
    '2026-09-01',
    '2027-06-30'
  );
  insert into public.tests (
    id, classroom_id, artifact_id, title, status, show_results,
    points_possible, created_by, position
  ) values (
    v_test_row_id,
    v_classroom_id,
    v_test_artifact_id,
    'Captured origin Test',
    'active',
    false,
    1,
    v_teacher_id,
    0
  );
  insert into public.test_questions (
    id, test_id, artifact_id, question_type, question_text, options,
    correct_option, points, response_max_chars, response_monospace, position
  ) values (
    v_question_row_id,
    v_test_row_id,
    v_question_artifact_id,
    'open_response',
    'Captured origin question',
    '[]'::jsonb,
    null,
    1,
    5000,
    false,
    0
  );

  v_capture_plan := jsonb_build_object(
    'blueprint', jsonb_build_object(
      'title', 'Captured proposal Blueprint',
      'subject', '',
      'grade_level', '',
      'course_code', '',
      'term_template', '',
      'overview_markdown', '',
      'outline_markdown', '',
      'resources_markdown', '',
      'gradebook_use_weights', false,
      'gradebook_assignments_weight', 70,
      'gradebook_tests_weight', 30,
      'planned_site_slug', null,
      'planned_site_published', false,
      'planned_site_config', '{}'::jsonb
    ),
    'assignments', '[]'::jsonb,
    'assessments', jsonb_build_array(jsonb_build_object(
      'artifact_id', v_test_artifact_id,
      'assessment_type', 'test',
      'title', 'Captured origin Test',
      'content', jsonb_build_object(
        'title', 'Captured origin Test',
        'show_results', false,
        'question_identity_version', 1,
        'questions', jsonb_build_array(jsonb_build_object(
          'id', v_question_artifact_id,
          'question_type', 'open_response',
          'question_text', 'Captured origin question',
          'options', '[]'::jsonb,
          'correct_option', null,
          'answer_key', null,
          'sample_solution', null,
          'points', 1,
          'response_max_chars', 5000,
          'response_monospace', false
        ))
      ),
      'documents', '[]'::jsonb,
      'points_possible', 1,
      'gradebook_weight', 10,
      'include_in_final', true,
      'position', 0
    )),
    'lesson_templates', '[]'::jsonb,
    'materials', '[]'::jsonb,
    'surveys', '[]'::jsonb,
    'manifest_version', '3',
    'source_package_exported_at', null
  );

  select blueprint_source_revision
  into v_classroom_revision
  from public.classrooms
  where id = v_classroom_id;
  v_result := public.create_course_blueprint_atomic_v2(
    v_capture_operation_id,
    v_teacher_id,
    'capture',
    repeat('4', 64),
    v_classroom_id,
    v_classroom_revision,
    v_capture_plan
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Captured proposal membership seed failed: %', v_result;
  end if;
  v_blueprint_id := (v_result->>'blueprint_id')::uuid;

  if not exists (
    select 1
    from public.tests test
    join public.course_blueprint_versions source_version
      on source_version.id = test.source_blueprint_version_id
    where test.id = v_test_row_id
      and test.artifact_id = v_test_artifact_id
      and test.source_artifact_id is null
      and source_version.course_blueprint_id = v_blueprint_id
  ) then
    raise exception 'Capture did not record Version membership without rewriting Test identity';
  end if;

  -- This Test was authored after capture and must remain Classroom-only.
  insert into public.tests (
    id, classroom_id, title, status, show_results, points_possible,
    created_by, position
  ) values (
    v_local_test_row_id,
    v_classroom_id,
    'Local Test after capture',
    'draft',
    false,
    1,
    v_teacher_id,
    1
  );

  v_capture_plan := jsonb_set(
    jsonb_set(
      v_capture_plan,
      '{assessments,0,title}',
      to_jsonb('Updated from Blueprint'::text)
    ),
    '{assessments,0,content,title}',
    to_jsonb('Updated from Blueprint'::text)
  );
  v_capture_plan := jsonb_set(
    v_capture_plan,
    '{assessments,0,content,questions,0,question_text}',
    to_jsonb('Updated Blueprint question'::text)
  );
  update public.course_blueprint_assessments
  set
    title = 'Updated from Blueprint',
    content = v_capture_plan->'assessments'->0->'content'
  where course_blueprint_id = v_blueprint_id
    and artifact_id = v_test_artifact_id;

  select content_revision
  into v_blueprint_revision
  from public.course_blueprints
  where id = v_blueprint_id;
  v_snapshot := public.archived_classroom_blueprint_snapshot_from_plan(
    v_blueprint_id,
    v_blueprint_revision,
    v_capture_plan
  );
  v_snapshot_sha256 := encode(
    extensions.digest(
      convert_to(public.course_blueprint_canonical_jsonb_text(v_snapshot), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  select *
  into v_version
  from public.save_course_blueprint_version_atomic(
    v_teacher_id,
    v_blueprint_id,
    v_blueprint_revision,
    2,
    v_snapshot,
    v_snapshot_sha256,
    'pika',
    jsonb_build_object('reason', 'captured_membership_contract')
  );

  v_classroom_plan := jsonb_build_object(
    'calendar_guard', jsonb_build_object(
      'start_date', '2026-09-01',
      'class_day_dates', '[]'::jsonb
    ),
    'sections', jsonb_build_object(
      'overview_markdown', '',
      'outline_markdown', ''
    ),
    'site_visibility_defaults', '{}'::jsonb,
    'resources_content', null,
    'grading', jsonb_build_object(
      'use_weights', false,
      'assignments_weight', 70,
      'tests_weight', 30
    ),
    'assignments', '[]'::jsonb,
    'tests', jsonb_build_array(jsonb_build_object(
      'artifact_id', v_test_artifact_id,
      'title', 'Updated from Blueprint',
      'position', 0,
      'show_results', false,
      'documents', '[]'::jsonb,
      'points_possible', 1,
      'gradebook_weight', 10,
      'include_in_final', true,
      'questions', jsonb_build_array(jsonb_build_object(
        'artifact_id', v_question_artifact_id,
        'question_type', 'open_response',
        'question_text', 'Updated Blueprint question',
        'options', '[]'::jsonb,
        'correct_option', null,
        'answer_key', null,
        'sample_solution', null,
        'points', 1,
        'response_max_chars', 5000,
        'response_monospace', false,
        'position', 0
      )),
      'draft_content', v_capture_plan->'assessments'->0->'content'
    )),
    'materials', '[]'::jsonb,
    'surveys', '[]'::jsonb,
    'lesson_plans', '[]'::jsonb
  );
  v_plan_sha256 := encode(
    extensions.digest(
      convert_to(
        public.course_blueprint_canonical_jsonb_text(v_classroom_plan),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  select blueprint_source_revision
  into v_classroom_revision
  from public.classrooms
  where id = v_classroom_id;

  select *
  into v_proposal
  from public.create_course_blueprint_classroom_proposal_atomic(
    v_teacher_id,
    v_blueprint_id,
    v_version.id,
    v_classroom_id,
    v_blueprint_revision,
    v_classroom_revision,
    v_proposal_idempotency_key,
    jsonb_build_array(jsonb_build_object(
      'action', 'update',
      'collection', 'assessments',
      'artifact_id', v_test_artifact_id
    )),
    jsonb_build_object('classroom_plan_sha256', v_plan_sha256),
    repeat('5', 64)
  );
  select *
  into v_proposal
  from public.apply_course_blueprint_classroom_proposal_atomic(
    v_teacher_id,
    v_proposal.id,
    v_classroom_plan,
    v_plan_sha256
  );
  if v_proposal.status <> 'applied' then
    raise exception 'Captured origin Test proposal did not apply: %', v_proposal.status;
  end if;

  if not exists (
    select 1
    from public.tests
    where id = v_test_row_id
      and title = 'Updated from Blueprint'
      and source_artifact_id is null
      and source_blueprint_version_id = v_version.id
      and blueprint_archived_at is null
  ) then
    raise exception 'Proposal did not update the captured origin Test in place';
  end if;
  if not exists (
    select 1
    from public.tests
    where id = v_local_test_row_id
      and source_artifact_id is null
      and source_blueprint_version_id is null
      and blueprint_archived_at is null
  ) then
    raise exception 'Proposal archived or adopted the local-only Test';
  end if;
  select count(*)
  into v_count
  from public.tests
  where classroom_id = v_classroom_id
    and coalesce(source_artifact_id, artifact_id) = v_test_artifact_id
    and blueprint_archived_at is null;
  if v_count <> 1 then
    raise exception 'Proposal duplicated the captured portable Test identity';
  end if;
end;
$proposal$;

drop trigger b134_fail_question_rematerialization_once on public.test_questions;
drop function public.b134_fail_question_rematerialization_once();

rollback;
SQL

echo "Blueprint test-question stable identity database contract passed."
