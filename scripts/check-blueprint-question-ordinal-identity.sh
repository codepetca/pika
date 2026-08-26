#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${BLUEPRINT_ORDINAL_DB_CONTAINER:-$(docker ps --filter 'name=supabase_db_pika' --format '{{.Names}}' | head -n 1)}"
if [[ -z "$DB_CONTAINER" ]]; then
  DB_CONTAINER="$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)"
fi
DATABASE_NAME="${BLUEPRINT_ORDINAL_DATABASE_NAME:-postgres}"
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
lock table public.test_questions in share row exclusive mode;
lock table public.assessment_drafts in share row exclusive mode;
select pg_sleep(5);
rollback;
SQL
backfill_locker_pid=$!
backfill_lock_ready=false
for _attempt in {1..40}; do
  held_backfill_locks="$(docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -Atqc \
    "select count(distinct c.relname) from pg_catalog.pg_locks l join pg_catalog.pg_class c on c.oid = l.relation join pg_catalog.pg_stat_activity a on a.pid = l.pid where a.application_name = 'b134_backfill_lock_contract' and l.granted and l.mode = 'ShareRowExclusiveLock' and c.relname in ('assessment_drafts', 'test_questions')")"
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
  '{"title":"Question A","show_results":false,"questions":[{"id":"b1341000-0000-4000-8000-000000000013","question_type":"open_response","question_text":"Question A","options":[],"correct_option":null,"answer_key":"A","sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
  1,
  'b1341000-0000-4000-8000-000000000001',
  'b1341000-0000-4000-8000-000000000001'
), (
  'b1341000-0000-4000-8000-000000000022',
  'test',
  'b1341000-0000-4000-8000-000000000021',
  'b1341000-0000-4000-8000-000000000010',
  '{"title":"Rollback Test","show_results":false,"questions":[{"id":"b1341000-0000-4000-8000-000000000123","question_type":"open_response","question_text":"Partially changed question","options":[],"correct_option":null,"answer_key":"changed","sample_solution":null,"points":2,"response_max_chars":5000,"response_monospace":false},{"id":"b1341000-0000-4000-8000-000000000124","question_type":"multiple_choice","question_text":"Invalid second question","options":["only one"],"correct_option":0,"answer_key":null,"sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
  1,
  'b1341000-0000-4000-8000-000000000001',
  'b1341000-0000-4000-8000-000000000001'
);
SQL

docker exec -e PGAPPNAME=b134_draft_save_first -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select public.save_test_draft_atomic(
  'b1341000-0000-4000-8000-000000000001',
  'b1341000-0000-4000-8000-000000000011',
  1,
  '{"title":"Question B","show_results":true,"questions":[{"id":"b1341000-0000-4000-8000-000000000013","question_type":"open_response","question_text":"Question B","options":[],"correct_option":null,"answer_key":"B","sample_solution":null,"points":2,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
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
      '{"title":"Question C","show_results":false,"questions":[{"id":"b1341000-0000-4000-8000-000000000013","question_type":"open_response","question_text":"Question C","options":[],"correct_option":null,"answer_key":"C","sample_solution":null,"points":3,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
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

  -- Metadata-only saves remain valid after student work because unchanged
  -- question rows are not rewritten and therefore cannot distort responses.
  perform public.save_test_draft_atomic(
    'b1341000-0000-4000-8000-000000000001',
    'b1341000-0000-4000-8000-000000000011',
    3,
    '{"title":"Metadata only","show_results":true,"questions":[{"id":"b1341000-0000-4000-8000-000000000013","question_type":"open_response","question_text":"Question C","options":[],"correct_option":null,"answer_key":"C","sample_solution":null,"points":3,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
    false,
    '[]'::jsonb,
    '[]'::jsonb
  );

  begin
    perform public.save_test_draft_atomic(
      'b1341000-0000-4000-8000-000000000001',
      'b1341000-0000-4000-8000-000000000011',
      4,
      '{"title":"Unsafe question edit","show_results":true,"questions":[{"id":"b1341000-0000-4000-8000-000000000013","question_type":"open_response","question_text":"Question D","options":[],"correct_option":null,"answer_key":"D","sample_solution":null,"points":4,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
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
    '{"title":"Save-first seed","show_results":false,"questions":[{"id":"b1342000-0000-4000-8000-000000000013","question_type":"open_response","question_text":"Save-first question","options":[],"correct_option":null,"answer_key":"A","sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
    1,
    'b1342000-0000-4000-8000-000000000001',
    'b1342000-0000-4000-8000-000000000001'
  ),
  (
    'b1342000-0000-4000-8000-000000000022',
    'test',
    'b1342000-0000-4000-8000-000000000021',
    'b1342000-0000-4000-8000-000000000020',
    '{"title":"Archive-first save seed","show_results":false,"questions":[{"id":"b1342000-0000-4000-8000-000000000023","question_type":"open_response","question_text":"Archive-first save question","options":[],"correct_option":null,"answer_key":"A","sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
    1,
    'b1342000-0000-4000-8000-000000000001',
    'b1342000-0000-4000-8000-000000000001'
  ),
  (
    'b1342000-0000-4000-8000-000000000032',
    'test',
    'b1342000-0000-4000-8000-000000000031',
    'b1342000-0000-4000-8000-000000000030',
    '{"title":"Activation-first seed","show_results":false,"questions":[{"id":"b1342000-0000-4000-8000-000000000033","question_type":"open_response","question_text":"Activation-first question","options":[],"correct_option":null,"answer_key":"A","sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
    1,
    'b1342000-0000-4000-8000-000000000001',
    'b1342000-0000-4000-8000-000000000001'
  ),
  (
    'b1342000-0000-4000-8000-000000000042',
    'test',
    'b1342000-0000-4000-8000-000000000041',
    'b1342000-0000-4000-8000-000000000040',
    '{"title":"Archive-first activation seed","show_results":false,"questions":[{"id":"b1342000-0000-4000-8000-000000000043","question_type":"open_response","question_text":"Archive-first activation question","options":[],"correct_option":null,"answer_key":"A","sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
    1,
    'b1342000-0000-4000-8000-000000000001',
    'b1342000-0000-4000-8000-000000000001'
  );
SQL

docker exec -e PGAPPNAME=b134_save_holds_classroom -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select public.save_test_draft_atomic(
  'b1342000-0000-4000-8000-000000000001',
  'b1342000-0000-4000-8000-000000000011',
  1,
  '{"title":"Saved before archive","show_results":true,"questions":[{"id":"b1342000-0000-4000-8000-000000000013","question_type":"open_response","question_text":"Saved before archive","options":[],"correct_option":null,"answer_key":"B","sample_solution":null,"points":2,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
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
update public.classrooms
set archived_at = clock_timestamp()
where id = 'b1342000-0000-4000-8000-000000000010';
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
update public.classrooms
set archived_at = clock_timestamp()
where id = 'b1342000-0000-4000-8000-000000000020';
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
  '{"title":"Must not save","show_results":true,"questions":[{"id":"b1342000-0000-4000-8000-000000000023","question_type":"open_response","question_text":"Must not save","options":[],"correct_option":null,"answer_key":"B","sample_solution":null,"points":2,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
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
update public.classrooms
set archived_at = clock_timestamp()
where id = 'b1342000-0000-4000-8000-000000000030';
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
update public.classrooms
set archived_at = clock_timestamp()
where id = 'b1342000-0000-4000-8000-000000000040';
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

-- Fail only the explicit-identity reinsertion performed by migration 134. The
-- compatibility RPC's initial positional rows have no source_artifact_id, so
-- this proves a failure after the base RPC returned still retains its ledger.
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
  select blueprint_source_revision
  into v_archived_revision
  from public.classrooms
  where id = v_archived_classroom_id;
  if v_archived_revision <= v_archived_failed_revision then
    raise exception 'Archived identity repair did not advance the source revision';
  end if;

  -- Operation B wins after the source repair while failed operation A remains
  -- retained. A mismatched replay must conflict before the classroom winner
  -- shortcut, then a compatible retry of A must reconcile its failed ledger.
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
  v_instantiated_classroom_id := (v_result->>'classroom_id')::uuid;
  if not exists (
    select 1
    from public.course_blueprint_operations
    where id = v_instantiation_operation_id
      and status = 'completed'
      and attempt_count = 2
      and result_classroom_id = v_instantiated_classroom_id
  ) then
    raise exception 'Version rematerialization retry did not complete its ledger';
  end if;

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
end;
$contract$;

drop trigger b134_fail_question_rematerialization_once on public.test_questions;
drop function public.b134_fail_question_rematerialization_once();

rollback;
SQL

echo "Blueprint test-question stable identity database contract passed."
