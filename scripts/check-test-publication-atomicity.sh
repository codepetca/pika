#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${TEST_PUBLICATION_DB_CONTAINER:-$(docker ps --filter 'name=supabase_db_pika' --format '{{.Names}}' | head -n 1)}"
if [[ -z "$DB_CONTAINER" ]]; then
  DB_CONTAINER="$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)"
fi
DATABASE_NAME="${TEST_PUBLICATION_DATABASE_NAME:-postgres}"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 <<'SQL'
begin;

do $contract$
begin
  if has_function_privilege(
    'anon',
    'public.publish_test_from_draft_atomic(uuid,uuid,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.publish_test_from_draft_atomic(uuid,uuid,integer)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.publish_test_from_draft_atomic(uuid,uuid,integer)',
    'EXECUTE'
  ) then
    raise exception 'Unexpected atomic Test publication RPC privileges';
  end if;
end;
$contract$;

insert into public.users (id, email, role) values (
  'b1390000-0000-4000-8000-000000000001',
  'test-publication-atomicity@example.test',
  'teacher'
);
insert into public.classrooms (
  id, teacher_id, title, class_code
) values (
  'b1390000-0000-4000-8000-000000000010',
  'b1390000-0000-4000-8000-000000000001',
  'Atomic Test publication contract',
  'B139P1'
);
insert into public.tests (
  id, classroom_id, title, status, show_results, points_possible, created_by
) values
  (
    'b1390000-0000-4000-8000-000000000011',
    'b1390000-0000-4000-8000-000000000010',
    'Successful publication',
    'draft',
    false,
    1,
    'b1390000-0000-4000-8000-000000000001'
  ),
  (
    'b1390000-0000-4000-8000-000000000021',
    'b1390000-0000-4000-8000-000000000010',
    'Rollback publication',
    'draft',
    false,
    1,
    'b1390000-0000-4000-8000-000000000001'
  );
insert into public.assessment_drafts (
  id, assessment_type, assessment_id, classroom_id, content, version,
  created_by, updated_by
) values
  (
    'b1390000-0000-4000-8000-000000000012',
    'test',
    'b1390000-0000-4000-8000-000000000011',
    'b1390000-0000-4000-8000-000000000010',
    '{"title":"Successful publication","show_results":false,"question_identity_version":1,"questions":[{"id":"b1390000-0000-4000-8000-000000000013","question_type":"open_response","question_text":"Published atomically?","options":[],"correct_option":null,"answer_key":"Yes","sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
    1,
    'b1390000-0000-4000-8000-000000000001',
    'b1390000-0000-4000-8000-000000000001'
  ),
  (
    'b1390000-0000-4000-8000-000000000022',
    'test',
    'b1390000-0000-4000-8000-000000000021',
    'b1390000-0000-4000-8000-000000000010',
    '{"title":"Rollback publication","show_results":false,"question_identity_version":1,"questions":[{"id":"b1390000-0000-4000-8000-000000000023","question_type":"open_response","question_text":"Must roll back","options":[],"correct_option":null,"answer_key":"Yes","sample_solution":null,"points":1,"response_max_chars":5000,"response_monospace":false}]}'::jsonb,
    1,
    'b1390000-0000-4000-8000-000000000001',
    'b1390000-0000-4000-8000-000000000001'
  );

do $contract$
declare
  v_result jsonb;
begin
  v_result := public.publish_test_from_draft_atomic(
    'b1390000-0000-4000-8000-000000000001',
    'b1390000-0000-4000-8000-000000000011',
    1
  );

  if v_result->'test'->>'status' is distinct from 'closed'
    or not exists (
      select 1 from public.tests test
      where test.id = 'b1390000-0000-4000-8000-000000000011'
        and test.status = 'closed'
    )
    or not exists (
      select 1 from public.test_questions question
      where question.test_id = 'b1390000-0000-4000-8000-000000000011'
        and question.artifact_id = 'b1390000-0000-4000-8000-000000000013'
    ) then
    raise exception 'Successful publication did not return one closed materialized Test';
  end if;
end;
$contract$;

create function pg_temp.reject_test_publication_close()
returns trigger
language plpgsql
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'forced_publication_close_failure';
end;
$$;

create trigger reject_test_publication_close
before update on public.tests
for each row
when (
  new.id = 'b1390000-0000-4000-8000-000000000021'::uuid
  and old.status = 'active'
  and new.status = 'closed'
)
execute function pg_temp.reject_test_publication_close();

do $contract$
declare
  v_before_revision bigint;
  v_error_message text;
begin
  select classroom.blueprint_source_revision
    into v_before_revision
  from public.classrooms classroom
  where classroom.id = 'b1390000-0000-4000-8000-000000000010';

  begin
    perform public.publish_test_from_draft_atomic(
      'b1390000-0000-4000-8000-000000000001',
      'b1390000-0000-4000-8000-000000000021',
      1
    );
    raise exception 'Forced publication failure unexpectedly succeeded';
  exception when sqlstate '55000' then
    get stacked diagnostics v_error_message = message_text;
    if v_error_message is distinct from 'forced_publication_close_failure' then
      raise;
    end if;
  end;

  if (
    select test.status
    from public.tests test
    where test.id = 'b1390000-0000-4000-8000-000000000021'
  ) is distinct from 'draft' then
    raise exception 'Failed publication did not restore the draft Test status';
  end if;

  if exists (
    select 1
    from public.test_questions question
    where question.test_id = 'b1390000-0000-4000-8000-000000000021'
  ) then
    raise exception 'Failed publication did not roll back materialized questions';
  end if;

  if (
    select classroom.blueprint_source_revision
    from public.classrooms classroom
    where classroom.id = 'b1390000-0000-4000-8000-000000000010'
  ) is distinct from v_before_revision then
    raise exception 'Failed publication did not roll back the Classroom revision';
  end if;
end;
$contract$;

rollback;
SQL
