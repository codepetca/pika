#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${BLUEPRINT_IDENTITY_DB_CONTAINER:-$(docker ps --filter 'name=supabase_db_pika' --format '{{.Names}}' | head -n 1)}"
if [[ -z "$DB_CONTAINER" ]]; then
  DB_CONTAINER="$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)"
fi
DATABASE_NAME="${BLUEPRINT_IDENTITY_DATABASE_NAME:-postgres}"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

# This contract is CI-only because it intentionally rebuilds the ephemeral
# local database at migration 133, seeds the production collision shape, then
# applies the real pending migration through the Supabase migration runner.
supabase db reset --local --version 133 --no-seed

docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into public.users (id, email, role) values (
  'b1349000-0000-4000-8000-000000000001',
  'blueprint-question-migration-lifecycle@example.test',
  'teacher'
), (
  'b1349000-0000-4000-8000-000000000002',
  'blueprint-question-migration-student@example.test',
  'student'
);
insert into public.classrooms (
  id, teacher_id, title, class_code
) values (
  'b1349000-0000-4000-8000-000000000010',
  'b1349000-0000-4000-8000-000000000001',
  'Migration 134 lifecycle',
  'B134M1'
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
insert into public.classroom_enrollments (classroom_id, student_id) values (
  'b1349000-0000-4000-8000-000000000010',
  'b1349000-0000-4000-8000-000000000002'
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

# Exercise the real application compatibility path while the database is still
# at migration 133. The missing atomic RPC must fall back to legacy row-ID
# persistence without confusing a portable ID that collides with another row.
# Activation remains unavailable until the migration installs its atomic RPC.
pnpm exec tsx scripts/check-test-question-identity-pre-migration.ts

# Prove the bounded production cutover fails atomically behind an unexpected
# writer, leaves migration history untouched, and succeeds after the blocker is
# gone. The retry here is CI-only; a real target requires fresh authorization.
docker exec -e PGAPPNAME=b134_rollout_lock_blocker -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
lock table public.assessment_drafts in row exclusive mode;
select pg_sleep(12);
rollback;
SQL
rollout_lock_pid=$!
rollout_lock_ready=false
for _attempt in {1..40}; do
  held_rollout_lock="$(docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -Atqc \
    "select count(*) from pg_catalog.pg_locks l join pg_catalog.pg_class relation on relation.oid = l.relation join pg_catalog.pg_stat_activity activity on activity.pid = l.pid where activity.application_name = 'b134_rollout_lock_blocker' and relation.relname = 'assessment_drafts' and l.mode = 'RowExclusiveLock' and l.granted")"
  if [[ "$held_rollout_lock" == "1" ]]; then
    rollout_lock_ready=true
    break
  fi
  sleep 0.1
done
if [[ "$rollout_lock_ready" != "true" ]]; then
  kill "$rollout_lock_pid" 2>/dev/null || true
  wait "$rollout_lock_pid" 2>/dev/null || true
  echo "Migration 134 timeout rehearsal did not acquire its blocker lock." >&2
  exit 1
fi

set +e
blocked_migration_output="$(supabase migration up --local 2>&1)"
blocked_migration_status=$?
set -e
wait "$rollout_lock_pid"
if [[ "$blocked_migration_status" -eq 0 ]] \
  || [[ "$blocked_migration_output" != *"lock timeout"* ]]; then
  echo "Migration 134 did not fail with the bounded lock timeout." >&2
  echo "$blocked_migration_output" >&2
  exit 1
fi
if [[ "$(docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -Atqc \
  "select count(*) from supabase_migrations.schema_migrations where version = '134'")" != "0" ]]; then
  echo "Timed-out migration 134 was incorrectly recorded as applied." >&2
  exit 1
fi

supabase migration up --local

docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $contract$
begin
  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '134'
  ) then
    raise exception 'Migration 134 was not recorded by the migration runner';
  end if;
  if not exists (
    select 1
    from public.assessment_drafts draft
    where draft.id = 'b1349000-0000-4000-8000-000000000012'
      and draft.version = 10
      and draft.content->>'question_identity_version' = '1'
      and draft.content->'questions'->0->>'id'
        = 'b1349000-0000-4000-8000-000000000041'
      and draft.content->'questions'->1->>'id'
        = 'b1349000-0000-4000-8000-000000000021'
      and draft.content->'questions'->2->>'id'
        = 'b1349000-0000-4000-8000-000000000031'
  ) then
    raise exception 'Actual 133-to-134 migration did not backfill the collision';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'assessment_drafts_test_question_identity_version_check'
  ) or not exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = 'test_questions_test_portable_identity_unique'
  ) or not exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = 'tests_classroom_active_portable_identity_unique'
  ) then
    raise exception 'Actual migration did not install the canonical identity fences';
  end if;
end;
$contract$;

select public.save_test_draft_atomic(
  'b1349000-0000-4000-8000-000000000001',
  'b1349000-0000-4000-8000-000000000011',
  10,
  '{"title":"Legacy row-ID precedence","show_results":false,"question_identity_version":1,"questions":[{"id":"b1349000-0000-4000-8000-000000000041","question_type":"open_response","question_text":"Draft-only addition retained","options":[],"correct_option":null,"answer_key":null,"sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false},{"id":"b1349000-0000-4000-8000-000000000021","question_type":"open_response","question_text":"Edited original question retained","options":[],"correct_option":null,"answer_key":null,"sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false},{"id":"b1349000-0000-4000-8000-000000000031","question_type":"open_response","question_text":"Moved collision question retained","options":[],"correct_option":null,"answer_key":null,"sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
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
  11
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
      and draft.version = 11
      and draft.content->>'question_identity_version' = '1'
      and (
        select array_agg(
          coalesce(question.source_artifact_id, question.artifact_id)
          order by question.position
        )
        from public.test_questions question
        where question.test_id = test.id
      ) = array[
        'b1349000-0000-4000-8000-000000000041'::uuid,
        'b1349000-0000-4000-8000-000000000021'::uuid,
        'b1349000-0000-4000-8000-000000000031'::uuid
      ]
  ) then
    raise exception 'Migrated collision did not survive save and activation';
  end if;
end;
$contract$;

delete from public.classrooms
where id = 'b1349000-0000-4000-8000-000000000010';
delete from public.users
where id in (
  'b1349000-0000-4000-8000-000000000001',
  'b1349000-0000-4000-8000-000000000002'
);
SQL

echo "Migration 134 production-shaped lifecycle contract passed."
