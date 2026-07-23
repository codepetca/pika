#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
PROJECT_ID="$(sed -n 's/^project_id = "\(.*\)"/\1/p' "$ROOT/supabase/config.toml" | head -n 1)"
DB_CONTAINER="${CLASSROOM_ARCHIVE_DB_CONTAINER:-supabase_db_${PROJECT_ID}}"
if [[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || true)" != "true" ]]; then
  echo "Supabase database container is not running: $DB_CONTAINER" >&2
  exit 2
fi

TMP_DB="${LEGACY_QUIZ_BACKFILL_DATABASE_NAME:-pika_quiz_backfill_${RANDOM}_$$}"
PAYLOAD_FILE="$(mktemp)"
PREFLIGHT_OUTPUT="$(mktemp)"
LOCK_OUTPUT="$(mktemp)"
MIGRATION_OUTPUT="$(mktemp)"
cleanup() {
  if [[ -n "${LOCK_HOLDER_PID:-}" ]]; then
    kill "$LOCK_HOLDER_PID" >/dev/null 2>&1 || true
    wait "$LOCK_HOLDER_PID" >/dev/null 2>&1 || true
  fi
  rm -f \
    "$PAYLOAD_FILE" \
    "$PREFLIGHT_OUTPUT" \
    "$LOCK_OUTPUT" \
    "$MIGRATION_OUTPUT"
  if [[ "${KEEP_LEGACY_QUIZ_BACKFILL_DATABASE:-false}" == "true" ]]; then
    echo "Kept disposable legacy Quiz backfill database: $TMP_DB"
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
' >/dev/null

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
  if [[ "$(basename "$migration")" == 106_* ]]; then
    break
  fi
  docker exec -e PGOPTIONS='-c client_min_messages=warning' -i "$DB_CONTAINER" \
    psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 \
    < "$migration" >/dev/null
done

CLASSROOM_ARCHIVE_DB_CONTAINER="$DB_CONTAINER" \
CLASSROOM_ARCHIVE_DATABASE_NAME="$TMP_DB" \
  bash "$ROOT/scripts/check-classroom-archive-restore-database.sh"
CLASSROOM_ARCHIVE_DB_CONTAINER="$DB_CONTAINER" \
CLASSROOM_ARCHIVE_DATABASE_NAME="$TMP_DB" \
  bash "$ROOT/scripts/check-classroom-archive-v2-database.sh"

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into public.users (id, email, role, email_verified_at) values
  ('61000000-0000-4000-8000-000000000001', 'quiz-backfill-teacher@example.invalid', 'teacher', clock_timestamp()),
  ('61000000-0000-4000-8000-000000000002', 'quiz-backfill-student@example.invalid', 'student', clock_timestamp());

insert into public.classrooms (id, teacher_id, title, class_code) values (
  '62000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  'Legacy Quiz backfill',
  'QBACK106'
);

insert into public.course_blueprints (
  id, teacher_id, title
) values (
  '62000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000001',
  'Legacy Quiz backfill blueprint'
);

insert into public.course_blueprint_assessments (
  id, course_blueprint_id, assessment_type, title, content, position
) values (
  '62000000-0000-4000-8000-000000000003',
  '62000000-0000-4000-8000-000000000002',
  'quiz',
  'Blocking historical Quiz blueprint',
  '{}'::jsonb,
  0
);

insert into public.quizzes (
  id, classroom_id, title, status, show_results, position, created_by,
  created_at, updated_at, points_possible, include_in_final, opens_at,
  gradebook_weight
) values (
  '63000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000001',
  'Historical Quiz',
  'closed',
  true,
  2,
  '61000000-0000-4000-8000-000000000001',
  '2026-01-02T03:04:05+00',
  '2026-01-03T03:04:05+00',
  12.50,
  true,
  '2026-01-04T03:04:05+00',
  25
);

insert into public.quiz_questions (
  id, quiz_id, question_text, options, position, created_at, updated_at,
  correct_option
) values (
  '63000000-0000-4000-8000-000000000002',
  '63000000-0000-4000-8000-000000000001',
  'Historical question',
  '["First","Second"]'::jsonb,
  0,
  '2026-01-02T03:05:05+00',
  '2026-01-03T03:05:05+00',
  1
);

insert into public.quiz_responses (
  id, quiz_id, question_id, student_id, selected_option, submitted_at
) values (
  '63000000-0000-4000-8000-000000000003',
  '63000000-0000-4000-8000-000000000001',
  '63000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000002',
  1,
  '2026-01-05T03:04:05+00'
);

insert into public.quiz_student_scores (
  id, quiz_id, student_id, manual_override_score, graded_at, graded_by,
  created_at, updated_at
) values (
  '63000000-0000-4000-8000-000000000004',
  '63000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000002',
  9.25,
  '2026-01-06T03:04:05+00',
  'teacher',
  '2026-01-06T03:04:05+00',
  '2026-01-06T03:04:05+00'
);

insert into public.assessment_drafts (
  id, assessment_type, assessment_id, classroom_id, content, version,
  created_by, updated_by, created_at, updated_at
) values (
  '63000000-0000-4000-8000-000000000005',
  'quiz',
  '63000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000001',
  '{"z":1.00,"a":{"b":2,"a":1},"0":"zero","10":"ten","tiny":0.0000001}'::jsonb,
  3,
  '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  '2026-01-07T03:04:05+00',
  '2026-01-08T03:04:05+00'
);
SQL

if docker exec -e PGOPTIONS='-c client_min_messages=warning' -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 \
  < "$ROOT/supabase/migrations/106_freeze_and_backfill_legacy_quiz.sql" \
  >"$PREFLIGHT_OUTPUT" 2>&1
then
  echo "Migration 106 accepted a legacy Quiz blueprint row." >&2
  exit 1
fi
if ! grep -q "Legacy Quiz blueprint rows must be zero before retirement" "$PREFLIGHT_OUTPUT"; then
  cat "$PREFLIGHT_OUTPUT" >&2
  echo "Migration 106 failed for an unexpected blueprint preflight reason." >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $rollback_proof$
begin
  if to_regclass('private.legacy_quiz_backfill_ledger') is not null
    or exists (
      select 1
      from pg_trigger
      where tgname = 'freeze_legacy_quizzes'
        and not tgisinternal
    )
  then
    raise exception 'Failed migration 106 attempt leaked schema changes';
  end if;
  if not exists (
    select 1
    from public.course_blueprint_assessments
    where id = '62000000-0000-4000-8000-000000000003'
      and assessment_type = 'quiz'
  ) then
    raise exception 'Failed migration 106 attempt changed the blocking blueprint row';
  end if;
end;
$rollback_proof$;

delete from public.course_blueprint_assessments
where id = '62000000-0000-4000-8000-000000000003';
SQL

assert_lock_conflict_rolled_back() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $lock_conflict_rollback_proof$
begin
  if to_regclass('private.legacy_quiz_backfill_ledger') is not null
    or exists (
      select 1
      from pg_trigger
      where tgname = 'freeze_legacy_quizzes'
        and not tgisinternal
    )
    or not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.course_blueprint_assessments'::regclass
        and conname = 'course_blueprint_assessments_assessment_type_check'
        and pg_get_constraintdef(oid) like '%quiz%'
    )
  then
    raise exception 'Lock-conflict migration attempt leaked schema changes';
  end if;
end;
$lock_conflict_rollback_proof$;
SQL
}

rehearse_no_wait_lock_conflict() {
  local marker="$1"
  local fixture_sql="$2"
  local description="$3"
  local lock_ready=0
  local lock_wait_started
  local lock_wait_seconds

  docker exec "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -qAt -v ON_ERROR_STOP=1 \
    -c "$fixture_sql" >"$LOCK_OUTPUT" 2>&1 &
  LOCK_HOLDER_PID=$!

  for _ in {1..50}; do
    lock_ready="$(docker exec "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -Atc \
      "select count(*)
       from pg_stat_activity
       where datname = '$TMP_DB'
         and pid <> pg_backend_pid()
         and state = 'active'
         and query like '%$marker%';")"
    [[ "$lock_ready" -gt 0 ]] && break
    sleep 0.1
  done
  if [[ "$lock_ready" -eq 0 ]]; then
    cat "$LOCK_OUTPUT" >&2
    echo "$description fixture did not acquire its conflicting lock." >&2
    exit 1
  fi

  lock_wait_started=$SECONDS
  if docker exec \
    -e PGOPTIONS='-c client_min_messages=warning -c timezone=America/Toronto' \
    -i "$DB_CONTAINER" \
    psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 \
    < "$ROOT/supabase/migrations/106_freeze_and_backfill_legacy_quiz.sql" \
    >"$PREFLIGHT_OUTPUT" 2>&1
  then
    echo "Migration 106 ignored the $description conflict." >&2
    exit 1
  fi
  lock_wait_seconds=$((SECONDS - lock_wait_started))
  if ! grep -q "could not obtain lock on relation" "$PREFLIGHT_OUTPUT"; then
    cat "$PREFLIGHT_OUTPUT" >&2
    echo "Migration 106 failed for an unexpected $description reason." >&2
    exit 1
  fi
  if [[ "$lock_wait_seconds" -gt 3 ]]; then
    echo "Migration 106 did not fail fast for $description: ${lock_wait_seconds}s" >&2
    exit 1
  fi
  if ! wait "$LOCK_HOLDER_PID"; then
    LOCK_HOLDER_PID=
    cat "$LOCK_OUTPUT" >&2
    echo "$description fixture was aborted instead of completing." >&2
    exit 1
  fi
  LOCK_HOLDER_PID=
  assert_lock_conflict_rolled_back
}

rehearse_no_wait_lock_conflict \
  "legacy_quiz_backfill_classroom_parent_conflict" \
  "begin;
   select id
   from public.classrooms
   where id = '62000000-0000-4000-8000-000000000001'
   for update;
   select pg_sleep(4) /* legacy_quiz_backfill_classroom_parent_conflict */;
   lock table public.classroom_retired_assessment_records in access share mode;
   commit;" \
  "classroom-parent-to-envelope-child traversal"

rehearse_no_wait_lock_conflict \
  "legacy_quiz_backfill_user_parent_conflict" \
  "begin;
   select id
   from public.users
   where id = '61000000-0000-4000-8000-000000000001'
   for update;
   select pg_sleep(4) /* legacy_quiz_backfill_user_parent_conflict */;
   lock table public.classroom_retired_assessment_record_actors in access share mode;
   commit;" \
  "user-parent-to-envelope-actor traversal"

rehearse_no_wait_lock_conflict \
  "legacy_quiz_backfill_final_table_conflict" \
  "begin;
   lock table public.classroom_retired_assessment_record_actors in access share mode;
   select pg_sleep(4) /* legacy_quiz_backfill_final_table_conflict */;
   commit;" \
  "final envelope table"

rehearse_no_wait_lock_conflict \
  "legacy_quiz_backfill_drafts_quizzes_conflict" \
  "begin;
   lock table public.assessment_drafts in access share mode;
   select pg_sleep(4) /* legacy_quiz_backfill_drafts_quizzes_conflict */;
   lock table public.quizzes in access share mode;
   commit;" \
  "assessment_drafts-to-quizzes traversal"

rehearse_no_wait_lock_conflict \
  "legacy_quiz_backfill_scores_responses_conflict" \
  "begin;
   lock table public.quiz_student_scores in access share mode;
   select pg_sleep(4) /* legacy_quiz_backfill_scores_responses_conflict */;
   lock table public.quiz_responses in access share mode;
   commit;" \
  "quiz_student_scores-to-quiz_responses traversal"

rehearse_no_wait_lock_conflict \
  "legacy_quiz_backfill_envelope_source_conflict" \
  "begin;
   select revision
   from public.classroom_archive_revisions
   where classroom_id = '62000000-0000-4000-8000-000000000001'
   for update;
   lock table public.classroom_retired_assessment_records in access share mode;
   select pg_sleep(4) /* legacy_quiz_backfill_envelope_source_conflict */;
   lock table public.assessment_drafts in access share mode;
   lock table public.quizzes in access share mode;
   select count(*)
   from public.classroom_retired_assessment_records
   where classroom_id = '62000000-0000-4000-8000-000000000001';
   commit;" \
  "envelope-to-source archive traversal"

ARCHIVE_ENVELOPE_COUNT="$(tail -n 1 "$LOCK_OUTPUT")"
if [[ "$ARCHIVE_ENVELOPE_COUNT" -ne 0 ]]; then
  cat "$LOCK_OUTPUT" >&2
  echo "Concurrent archive reader did not retain the coherent pre-backfill graph." >&2
  exit 1
fi

if ! docker exec \
  -e PGOPTIONS='-c client_min_messages=warning -c timezone=America/Toronto' \
  -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 \
  < "$ROOT/supabase/migrations/106_freeze_and_backfill_legacy_quiz.sql" \
  >"$MIGRATION_OUTPUT" 2>&1
then
  cat "$MIGRATION_OUTPUT" >&2
  echo "Migration 106 failed after all conflicting transactions completed." >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $contract$
begin
  if (
    select count(*)
    from private.legacy_quiz_backfill_ledger
    where source_count = 1
      and envelope_count = 1
      and source_aggregate_sha256 = envelope_aggregate_sha256
  ) <> 5 then
    raise exception 'Backfill ledger does not prove five-resource parity';
  end if;
  if (select count(*) from public.quizzes) <> 1
    or (select count(*) from public.quiz_questions) <> 1
    or (select count(*) from public.quiz_responses) <> 1
    or (select count(*) from public.quiz_student_scores) <> 1
    or (
      select count(*)
      from public.assessment_drafts
      where assessment_type = 'quiz'
    ) <> 1
  then
    raise exception 'Backfill changed the retained legacy Quiz source rows';
  end if;
  if (
    select count(*)
    from public.classroom_retired_assessment_records
    where source_contract = 'pika.classroom-archive@1/legacy-quiz'
  ) <> 5 then
    raise exception 'Backfill did not create all retired-assessment records';
  end if;
  if (
    select count(*)
    from public.classroom_retired_assessment_record_actors
  ) <> 5 then
    raise exception 'Backfill did not normalize all actor references';
  end if;
end;
$contract$;

do $write_freeze$
begin
  begin
    update public.quizzes set title = 'blocked';
    raise exception 'Legacy Quiz update unexpectedly succeeded';
  exception when feature_not_supported then null;
  end;

  begin
    delete from public.quiz_questions;
    raise exception 'Legacy Quiz delete unexpectedly succeeded';
  exception when feature_not_supported then null;
  end;

  begin
    insert into public.assessment_drafts (
      assessment_type, assessment_id, classroom_id, content, version,
      created_by, updated_by
    ) values (
      'quiz',
      '63000000-0000-4000-8000-000000000009',
      '62000000-0000-4000-8000-000000000001',
      '{}'::jsonb,
      1,
      '61000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001'
    );
    raise exception 'Legacy Quiz draft insert unexpectedly succeeded';
  exception when feature_not_supported then null;
  end;

  insert into public.tests (
    id, classroom_id, title, status, show_results, created_by
  ) values (
    '63000000-0000-4000-8000-000000000010',
    '62000000-0000-4000-8000-000000000001',
    'Current Test',
    'draft',
    false,
    '61000000-0000-4000-8000-000000000001'
  );
  insert into public.assessment_drafts (
    assessment_type, assessment_id, classroom_id, content, version,
    created_by, updated_by
  ) values (
    'test',
    '63000000-0000-4000-8000-000000000010',
    '62000000-0000-4000-8000-000000000001',
    '{}'::jsonb,
    1,
    '61000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001'
  );

  begin
    insert into public.course_blueprint_assessments (
      course_blueprint_id, assessment_type, title, content, position
    ) values (
      '62000000-0000-4000-8000-000000000002',
      'quiz',
      'blocked',
      '{}'::jsonb,
      0
    );
    raise exception 'Legacy Quiz blueprint insert unexpectedly succeeded';
  exception when check_violation then null;
  end;
end;
$write_freeze$;
SQL

docker exec "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -A -t -v ON_ERROR_STOP=1 -c "
select jsonb_build_object(
  'classroomId', '62000000-0000-4000-8000-000000000001'::text,
  'archiveActors', jsonb_build_array(
    jsonb_build_object('id', '61000000-0000-4000-8000-000000000001'),
    jsonb_build_object('id', '61000000-0000-4000-8000-000000000002')
  ),
  'resources', jsonb_build_object(
    'quizzes', (select jsonb_agg(to_jsonb(row) order by row.id) from public.quizzes row),
    'quiz_questions', (select jsonb_agg(to_jsonb(row) order by row.id) from public.quiz_questions row),
    'quiz_responses', (select jsonb_agg(to_jsonb(row) order by row.id) from public.quiz_responses row),
    'quiz_student_scores', (select jsonb_agg(to_jsonb(row) order by row.id) from public.quiz_student_scores row),
    'assessment_drafts', (
      select jsonb_agg(to_jsonb(row) order by row.id)
      from public.assessment_drafts row
      where row.assessment_type = 'quiz'
    )
  ),
  'envelopeRecords', (
    select jsonb_agg(to_jsonb(row) order by row.source_resource, row.source_row_id)
    from public.classroom_retired_assessment_records row
    where row.classroom_id = '62000000-0000-4000-8000-000000000001'
  ),
  'envelopeActors', (
    select jsonb_agg(to_jsonb(actor) order by actor.id)
    from public.classroom_retired_assessment_record_actors actor
    join public.classroom_retired_assessment_records record on record.id = actor.record_id
    where record.classroom_id = '62000000-0000-4000-8000-000000000001'
  )
);" > "$PAYLOAD_FILE"

pnpm exec tsx scripts/validate-legacy-quiz-backfill.ts < "$PAYLOAD_FILE"

echo "Legacy Quiz freeze and backfill database contract passes."
