#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

TMP_ONE="$(mktemp)"
TMP_TWO="$(mktemp)"

cleanup() {
  rm -f "$TMP_ONE" "$TMP_TWO"
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
alter table public.test_attempts
  drop constraint if exists atomic_test_submit_forced_failure;
delete from public.classrooms
where id = 'e0000000-0000-4000-8000-000000000010';
delete from public.users
where id::text like 'e0000000-0000-4000-8000-0000000000%';
SQL
}
trap cleanup EXIT
cleanup

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
begin;

insert into public.users (id, email, role) values
  ('e0000000-0000-4000-8000-000000000001', 'atomic-test-teacher@example.test', 'teacher'),
  ('e0000000-0000-4000-8000-000000000002', 'atomic-test-success@example.test', 'student'),
  ('e0000000-0000-4000-8000-000000000003', 'atomic-test-placeholder@example.test', 'student'),
  ('e0000000-0000-4000-8000-000000000004', 'atomic-test-invalid-missing@example.test', 'student'),
  ('e0000000-0000-4000-8000-000000000005', 'atomic-test-closed-access@example.test', 'student'),
  ('e0000000-0000-4000-8000-000000000006', 'atomic-test-submitted@example.test', 'student'),
  ('e0000000-0000-4000-8000-000000000007', 'atomic-test-concurrent@example.test', 'student'),
  ('e0000000-0000-4000-8000-000000000008', 'atomic-test-close-race@example.test', 'student'),
  ('e0000000-0000-4000-8000-000000000009', 'atomic-test-unenrolled@example.test', 'student'),
  ('e0000000-0000-4000-8000-00000000000a', 'atomic-test-draft@example.test', 'student'),
  ('e0000000-0000-4000-8000-00000000000b', 'atomic-test-invalid-option@example.test', 'student'),
  ('e0000000-0000-4000-8000-00000000000c', 'atomic-test-availability-race@example.test', 'student'),
  ('e0000000-0000-4000-8000-00000000000d', 'atomic-test-delete-race@example.test', 'student');

insert into public.classrooms (id, teacher_id, title, class_code) values
  ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000001', 'Atomic test submit contract', 'ATOMIC88');

insert into public.classroom_enrollments (classroom_id, student_id) values
  ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000003'),
  ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000004'),
  ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000005'),
  ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000006'),
  ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000007'),
  ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000008'),
  ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-00000000000a'),
  ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-00000000000b'),
  ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-00000000000c'),
  ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-00000000000d');

insert into public.tests (id, classroom_id, title, status, points_possible, created_by) values
  ('e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000010', 'Submission cases', 'active', 5, 'e0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000012', 'e0000000-0000-4000-8000-000000000010', 'Concurrent submission', 'active', 5, 'e0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000013', 'e0000000-0000-4000-8000-000000000010', 'Close submission race', 'active', 5, 'e0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000014', 'e0000000-0000-4000-8000-000000000010', 'Draft submission rejection', 'draft', 5, 'e0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000015', 'e0000000-0000-4000-8000-000000000010', 'Cascade deletion', 'draft', 5, 'e0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000016', 'e0000000-0000-4000-8000-000000000010', 'Availability race', 'active', 5, 'e0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000017', 'e0000000-0000-4000-8000-000000000010', 'Deletion race', 'active', 5, 'e0000000-0000-4000-8000-000000000001');

insert into public.test_questions (
  id, test_id, question_type, question_text, options, correct_option,
  points, response_max_chars, position
)
select
  question_id,
  test_id,
  question_type,
  question_text,
  options,
  correct_option,
  points,
  response_max_chars,
  position
from (values
  ('e0000000-0000-4000-8000-000000000101'::uuid, 'e0000000-0000-4000-8000-000000000011'::uuid, 'multiple_choice', 'Pick the second option', '["wrong","right"]'::jsonb, 1, 3::numeric, 5000, 0),
  ('e0000000-0000-4000-8000-000000000102'::uuid, 'e0000000-0000-4000-8000-000000000011'::uuid, 'open_response', 'Explain the answer', '[]'::jsonb, null, 2::numeric, 40, 1),
  ('e0000000-0000-4000-8000-000000000103'::uuid, 'e0000000-0000-4000-8000-000000000012'::uuid, 'multiple_choice', 'Pick the second option', '["wrong","right"]'::jsonb, 1, 3::numeric, 5000, 0),
  ('e0000000-0000-4000-8000-000000000104'::uuid, 'e0000000-0000-4000-8000-000000000012'::uuid, 'open_response', 'Explain the answer', '[]'::jsonb, null, 2::numeric, 40, 1),
  ('e0000000-0000-4000-8000-000000000105'::uuid, 'e0000000-0000-4000-8000-000000000013'::uuid, 'multiple_choice', 'Pick the second option', '["wrong","right"]'::jsonb, 1, 3::numeric, 5000, 0),
  ('e0000000-0000-4000-8000-000000000106'::uuid, 'e0000000-0000-4000-8000-000000000013'::uuid, 'open_response', 'Explain the answer', '[]'::jsonb, null, 2::numeric, 40, 1),
  ('e0000000-0000-4000-8000-000000000107'::uuid, 'e0000000-0000-4000-8000-000000000014'::uuid, 'multiple_choice', 'Pick the second option', '["wrong","right"]'::jsonb, 1, 3::numeric, 5000, 0),
  ('e0000000-0000-4000-8000-000000000108'::uuid, 'e0000000-0000-4000-8000-000000000014'::uuid, 'open_response', 'Explain the answer', '[]'::jsonb, null, 2::numeric, 40, 1),
  ('e0000000-0000-4000-8000-000000000109'::uuid, 'e0000000-0000-4000-8000-000000000016'::uuid, 'multiple_choice', 'Pick the second option', '["wrong","right"]'::jsonb, 1, 3::numeric, 5000, 0),
  ('e0000000-0000-4000-8000-00000000010a'::uuid, 'e0000000-0000-4000-8000-000000000016'::uuid, 'open_response', 'Explain the answer', '[]'::jsonb, null, 2::numeric, 40, 1),
  ('e0000000-0000-4000-8000-00000000010b'::uuid, 'e0000000-0000-4000-8000-000000000017'::uuid, 'multiple_choice', 'Pick the second option', '["wrong","right"]'::jsonb, 1, 3::numeric, 5000, 0),
  ('e0000000-0000-4000-8000-00000000010c'::uuid, 'e0000000-0000-4000-8000-000000000017'::uuid, 'open_response', 'Explain the answer', '[]'::jsonb, null, 2::numeric, 40, 1)
) as questions(question_id, test_id, question_type, question_text, options, correct_option, points, response_max_chars, position);

insert into public.test_attempts (
  test_id, student_id, responses, is_submitted, submitted_at
) values
  ('e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000004', '{"draft":"missing-kept"}', false, null),
  ('e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000005', '{"draft":"closed-kept"}', false, null),
  ('e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000006', '{"submitted":"kept"}', true, '2026-07-14T13:00:00Z'),
  ('e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-00000000000b', '{"draft":"option-kept"}', false, null);

insert into public.test_student_availability (
  test_id, student_id, state, updated_by
) values (
  'e0000000-0000-4000-8000-000000000011',
  'e0000000-0000-4000-8000-000000000005',
  'closed',
  'e0000000-0000-4000-8000-000000000001'
), (
  'e0000000-0000-4000-8000-000000000015',
  'e0000000-0000-4000-8000-00000000000a',
  'closed',
  'e0000000-0000-4000-8000-000000000001'
);

insert into public.test_responses (
  test_id, question_id, student_id, response_text, submitted_at
) values (
  'e0000000-0000-4000-8000-000000000011',
  'e0000000-0000-4000-8000-000000000102',
  'e0000000-0000-4000-8000-000000000003',
  '',
  '2026-07-14T12:00:00Z'
);

commit;
SQL

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
do $contract$
declare
  v_signature constant text := 'public.submit_test_attempt_atomic(uuid,uuid,jsonb,timestamp with time zone)';
  v_save_signature constant text := 'public.save_test_attempt_atomic(uuid,uuid,jsonb)';
  v_result jsonb;
  v_attempt public.test_attempts%rowtype;
  v_mc public.test_responses%rowtype;
  v_open public.test_responses%rowtype;
  v_count integer;
begin
  if has_function_privilege('anon', v_signature, 'execute')
    or has_function_privilege('authenticated', v_signature, 'execute')
    or not has_function_privilege('service_role', v_signature, 'execute')
  then
    raise exception 'Unexpected atomic test-submit RPC privileges';
  end if;
  if has_function_privilege('anon', v_save_signature, 'execute')
    or has_function_privilege('authenticated', v_save_signature, 'execute')
    or not has_function_privilege('service_role', v_save_signature, 'execute')
  then
    raise exception 'Unexpected atomic test-attempt save RPC privileges';
  end if;

  v_result := public.submit_test_attempt_atomic(
    'e0000000-0000-4000-8000-000000000011',
    'e0000000-0000-4000-8000-000000000002',
    jsonb_build_object(
      'e0000000-0000-4000-8000-000000000101', jsonb_build_object('question_type', 'multiple_choice', 'selected_option', 1),
      'e0000000-0000-4000-8000-000000000102', jsonb_build_object('question_type', 'open_response', 'response_text', 'A mixed response')
    ),
    '2026-07-14T14:00:00Z'
  );

  if (v_result->>'inserted_responses')::integer <> 2
    or nullif(v_result->>'attempt_id', '') is null
    or (v_result->>'submitted_at')::timestamptz <> '2026-07-14T14:00:00Z'::timestamptz
  then
    raise exception 'Unexpected successful submission result: %', v_result;
  end if;

  v_result := public.save_test_attempt_atomic(
    'e0000000-0000-4000-8000-000000000017',
    'e0000000-0000-4000-8000-00000000000d',
    jsonb_build_object(
      'e0000000-0000-4000-8000-00000000010b',
      jsonb_build_object('question_type', 'multiple_choice', 'selected_option', 0)
    )
  );
  if not (v_result->>'created')::boolean
    or v_result->'attempt'->'responses' <> jsonb_build_object(
      'e0000000-0000-4000-8000-00000000010b',
      jsonb_build_object('question_type', 'multiple_choice', 'selected_option', 0)
    )
  then
    raise exception 'Atomic partial test-attempt save returned unexpected state: %', v_result;
  end if;

  select * into strict v_attempt
  from public.test_attempts
  where test_id = 'e0000000-0000-4000-8000-000000000011'
    and student_id = 'e0000000-0000-4000-8000-000000000002';
  select * into strict v_mc
  from public.test_responses
  where question_id = 'e0000000-0000-4000-8000-000000000101'
    and student_id = 'e0000000-0000-4000-8000-000000000002';
  select * into strict v_open
  from public.test_responses
  where question_id = 'e0000000-0000-4000-8000-000000000102'
    and student_id = 'e0000000-0000-4000-8000-000000000002';

  if not v_attempt.is_submitted
    or v_attempt.submitted_at <> '2026-07-14T14:00:00Z'::timestamptz
    or v_attempt.responses <> jsonb_build_object(
      'e0000000-0000-4000-8000-000000000101', jsonb_build_object('question_type', 'multiple_choice', 'selected_option', 1),
      'e0000000-0000-4000-8000-000000000102', jsonb_build_object('question_type', 'open_response', 'response_text', 'A mixed response')
    )
    or v_mc.selected_option <> 1
    or v_mc.response_text is not null
    or v_mc.score <> 3
    or v_mc.graded_at <> '2026-07-14T14:00:00Z'::timestamptz
    or v_open.selected_option is not null
    or v_open.response_text <> 'A mixed response'
    or v_open.score is not null
    or v_open.graded_at is not null
    or v_mc.submitted_at <> '2026-07-14T14:00:00Z'::timestamptz
    or v_open.submitted_at <> '2026-07-14T14:00:00Z'::timestamptz
  then
    raise exception 'Mixed submission did not persist the expected atomic state';
  end if;

  v_result := public.submit_test_attempt_atomic(
    'e0000000-0000-4000-8000-000000000011',
    'e0000000-0000-4000-8000-000000000003',
    jsonb_build_object(
      'e0000000-0000-4000-8000-000000000101', jsonb_build_object('question_type', 'multiple_choice', 'selected_option', 0),
      'e0000000-0000-4000-8000-000000000102', jsonb_build_object('question_type', 'open_response', 'response_text', 'Placeholder replaced')
    ),
    '2026-07-14T14:05:00Z'
  );
  select count(*) into v_count
  from public.test_responses
  where test_id = 'e0000000-0000-4000-8000-000000000011'
    and student_id = 'e0000000-0000-4000-8000-000000000003';
  if (v_result->>'inserted_responses')::integer <> 2
    or v_count <> 2
    or not exists (
      select 1 from public.test_responses
      where question_id = 'e0000000-0000-4000-8000-000000000102'
        and student_id = 'e0000000-0000-4000-8000-000000000003'
        and response_text = 'Placeholder replaced'
        and submitted_at = '2026-07-14T14:05:00Z'::timestamptz
    )
  then
    raise exception 'Blank placeholder was not replaced atomically: %, count %', v_result, v_count;
  end if;

  delete from public.tests
  where id = 'e0000000-0000-4000-8000-000000000015';
  if exists (
    select 1 from public.test_student_availability
    where test_id = 'e0000000-0000-4000-8000-000000000015'
  ) then
    raise exception 'Availability parent lock blocked test cascade deletion';
  end if;
end;
$contract$;
SQL

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
do $contract$
declare
  v_rejected boolean;
  v_count integer;
begin
  v_rejected := false;
  begin
    perform public.submit_test_attempt_atomic(
      'e0000000-0000-4000-8000-000000000011',
      'e0000000-0000-4000-8000-000000000004',
      jsonb_build_object(
        'e0000000-0000-4000-8000-000000000101', jsonb_build_object('question_type', 'multiple_choice', 'selected_option', 1)
      ),
      '2026-07-14T14:10:00Z'
    );
  exception when invalid_parameter_value then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Missing required response was accepted';
  end if;

  v_rejected := false;
  begin
    perform public.submit_test_attempt_atomic(
      'e0000000-0000-4000-8000-000000000011',
      'e0000000-0000-4000-8000-00000000000b',
      jsonb_build_object(
        'e0000000-0000-4000-8000-000000000101', jsonb_build_object('question_type', 'multiple_choice', 'selected_option', 9),
        'e0000000-0000-4000-8000-000000000102', jsonb_build_object('question_type', 'open_response', 'response_text', 'Invalid option')
      ),
      '2026-07-14T14:11:00Z'
    );
  exception when invalid_parameter_value then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Out-of-range selected option was accepted';
  end if;

  v_rejected := false;
  begin
    perform public.submit_test_attempt_atomic(
      'e0000000-0000-4000-8000-000000000011',
      'e0000000-0000-4000-8000-00000000000b',
      jsonb_build_object(
        'e0000000-0000-4000-8000-000000000101', jsonb_build_object('question_type', 'multiple_choice', 'selected_option', 999999999999999999999999::numeric),
        'e0000000-0000-4000-8000-000000000102', jsonb_build_object('question_type', 'open_response', 'response_text', 'Oversized option')
      ),
      '2026-07-14T14:11:30Z'
    );
  exception when invalid_parameter_value then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Oversized selected option was accepted or returned the wrong SQLSTATE';
  end if;

  v_rejected := false;
  begin
    perform public.submit_test_attempt_atomic(
      'e0000000-0000-4000-8000-000000000011',
      'e0000000-0000-4000-8000-000000000005',
      jsonb_build_object(
        'e0000000-0000-4000-8000-000000000101', jsonb_build_object('question_type', 'multiple_choice', 'selected_option', 1),
        'e0000000-0000-4000-8000-000000000102', jsonb_build_object('question_type', 'open_response', 'response_text', 'Closed access')
      ),
      '2026-07-14T14:12:00Z'
    );
  exception when invalid_parameter_value then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Student-specific closed availability was ignored';
  end if;

  v_rejected := false;
  begin
    perform public.submit_test_attempt_atomic(
      'e0000000-0000-4000-8000-000000000011',
      'e0000000-0000-4000-8000-000000000006',
      jsonb_build_object(
        'e0000000-0000-4000-8000-000000000101', jsonb_build_object('question_type', 'multiple_choice', 'selected_option', 1),
        'e0000000-0000-4000-8000-000000000102', jsonb_build_object('question_type', 'open_response', 'response_text', 'Duplicate submit')
      ),
      '2026-07-14T14:13:00Z'
    );
  exception when invalid_parameter_value then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Already-submitted attempt was accepted';
  end if;

  v_rejected := false;
  begin
    perform public.submit_test_attempt_atomic(
      'e0000000-0000-4000-8000-000000000014',
      'e0000000-0000-4000-8000-00000000000a',
      jsonb_build_object(
        'e0000000-0000-4000-8000-000000000107', jsonb_build_object('question_type', 'multiple_choice', 'selected_option', 1),
        'e0000000-0000-4000-8000-000000000108', jsonb_build_object('question_type', 'open_response', 'response_text', 'Draft test')
      ),
      '2026-07-14T14:14:00Z'
    );
  exception when invalid_parameter_value then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Draft test accepted a submission';
  end if;

  v_rejected := false;
  begin
    perform public.submit_test_attempt_atomic(
      'e0000000-0000-4000-8000-000000000011',
      'e0000000-0000-4000-8000-000000000009',
      jsonb_build_object(
        'e0000000-0000-4000-8000-000000000101', jsonb_build_object('question_type', 'multiple_choice', 'selected_option', 1),
        'e0000000-0000-4000-8000-000000000102', jsonb_build_object('question_type', 'open_response', 'response_text', 'Not enrolled')
      ),
      '2026-07-14T14:15:00Z'
    );
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Unenrolled student accepted a submission';
  end if;

  select count(*) into v_count
  from public.test_responses
  where student_id in (
    'e0000000-0000-4000-8000-000000000004',
    'e0000000-0000-4000-8000-000000000005',
    'e0000000-0000-4000-8000-000000000006',
    'e0000000-0000-4000-8000-000000000009',
    'e0000000-0000-4000-8000-00000000000a',
    'e0000000-0000-4000-8000-00000000000b'
  );
  if v_count <> 0 then
    raise exception 'Rejected submissions left % response row(s)', v_count;
  end if;

  if (select responses from public.test_attempts
      where test_id = 'e0000000-0000-4000-8000-000000000011'
        and student_id = 'e0000000-0000-4000-8000-000000000004') <> '{"draft":"missing-kept"}'::jsonb
    or (select responses from public.test_attempts
        where test_id = 'e0000000-0000-4000-8000-000000000011'
          and student_id = 'e0000000-0000-4000-8000-000000000005') <> '{"draft":"closed-kept"}'::jsonb
    or (select responses from public.test_attempts
        where test_id = 'e0000000-0000-4000-8000-000000000011'
          and student_id = 'e0000000-0000-4000-8000-000000000006') <> '{"submitted":"kept"}'::jsonb
    or (select responses from public.test_attempts
        where test_id = 'e0000000-0000-4000-8000-000000000011'
          and student_id = 'e0000000-0000-4000-8000-00000000000b') <> '{"draft":"option-kept"}'::jsonb
    or exists (
      select 1 from public.test_attempts
      where student_id in (
        'e0000000-0000-4000-8000-000000000009',
        'e0000000-0000-4000-8000-00000000000a'
      )
    )
  then
    raise exception 'Rejected submissions partially mutated attempt state';
  end if;
end;
$contract$;
SQL

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
alter table public.test_attempts
  add constraint atomic_test_submit_forced_failure
  check (
    student_id <> 'e0000000-0000-4000-8000-000000000004'
    or is_submitted = false
  );

do $contract$
declare
  v_rejected boolean := false;
begin
  begin
    perform public.submit_test_attempt_atomic(
      'e0000000-0000-4000-8000-000000000011',
      'e0000000-0000-4000-8000-000000000004',
      jsonb_build_object(
        'e0000000-0000-4000-8000-000000000101', jsonb_build_object('question_type', 'multiple_choice', 'selected_option', 1),
        'e0000000-0000-4000-8000-000000000102', jsonb_build_object('question_type', 'open_response', 'response_text', 'Must roll back after insert')
      ),
      '2026-07-14T14:20:00Z'
    );
  exception when check_violation then
    v_rejected := true;
  end;

  if not v_rejected
    or exists (
      select 1 from public.test_responses
      where test_id = 'e0000000-0000-4000-8000-000000000011'
        and student_id = 'e0000000-0000-4000-8000-000000000004'
    )
    or (select responses from public.test_attempts
        where test_id = 'e0000000-0000-4000-8000-000000000011'
          and student_id = 'e0000000-0000-4000-8000-000000000004') <> '{"draft":"missing-kept"}'::jsonb
    or (select is_submitted from public.test_attempts
        where test_id = 'e0000000-0000-4000-8000-000000000011'
          and student_id = 'e0000000-0000-4000-8000-000000000004')
  then
    raise exception 'Post-insert failure did not roll back response and attempt state';
  end if;
end;
$contract$;

alter table public.test_attempts
  drop constraint atomic_test_submit_forced_failure;
SQL

wait_for_application_event() {
  local application_name="$1"
  local wait_event="$2"
  for _ in {1..50}; do
    if [[ "$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc \
      "select count(*) from pg_stat_activity where application_name = '$application_name' and wait_event = '$wait_event';")" == "1" ]]; then
      return 0
    fi
    sleep 0.1
  done
  echo "Timed out waiting for PostgreSQL application $application_name to enter $wait_event." >&2
  exit 1
}

wait_for_lock_waiters() {
  local application_prefix="$1"
  local expected_count="$2"
  for _ in {1..50}; do
    if [[ "$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc \
      "select count(*) from pg_stat_activity where application_name like '$application_prefix%' and wait_event_type = 'Lock';")" == "$expected_count" ]]; then
      return 0
    fi
    sleep 0.1
  done
  echo "Timed out waiting for $expected_count lock waiter(s) with prefix $application_prefix." >&2
  exit 1
}

docker exec -e PGAPPNAME=atomic-test-double-holder -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select 1 from public.tests
where id = 'e0000000-0000-4000-8000-000000000012'
for update;
select pg_sleep(3);
commit;
SQL
DOUBLE_HOLDER_PID=$!
wait_for_application_event atomic-test-double-holder PgSleep

run_concurrent_submit() {
  local application_name="$1"
  docker exec -e PGAPPNAME="$application_name" -i "$DB_CONTAINER" \
    psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -Atc \
    "select public.submit_test_attempt_atomic(
      'e0000000-0000-4000-8000-000000000012',
      'e0000000-0000-4000-8000-000000000007',
      jsonb_build_object(
        'e0000000-0000-4000-8000-000000000103', jsonb_build_object('question_type', 'multiple_choice', 'selected_option', 1),
        'e0000000-0000-4000-8000-000000000104', jsonb_build_object('question_type', 'open_response', 'response_text', 'Concurrent answer')
      ),
      '2026-07-14T15:00:00Z'
    );"
}

run_concurrent_submit atomic-test-double-worker-one >"$TMP_ONE" 2>&1 &
DOUBLE_ONE_PID=$!
run_concurrent_submit atomic-test-double-worker-two >"$TMP_TWO" 2>&1 &
DOUBLE_TWO_PID=$!
wait_for_lock_waiters atomic-test-double-worker 2
wait "$DOUBLE_HOLDER_PID"
set +e
wait "$DOUBLE_ONE_PID"
DOUBLE_ONE_STATUS=$?
wait "$DOUBLE_TWO_PID"
DOUBLE_TWO_STATUS=$?
set -e

if [[ "$DOUBLE_ONE_STATUS" -eq "$DOUBLE_TWO_STATUS" ]]; then
  echo "Expected exactly one concurrent submit to succeed." >&2
  echo "Worker one: $(cat "$TMP_ONE")" >&2
  echo "Worker two: $(cat "$TMP_TWO")" >&2
  exit 1
fi

if [[ "$DOUBLE_ONE_STATUS" -ne 0 ]]; then
  DOUBLE_LOSER_OUTPUT="$TMP_ONE"
else
  DOUBLE_LOSER_OUTPUT="$TMP_TWO"
fi
if ! grep -q '22023' "$DOUBLE_LOSER_OUTPUT" \
  || ! grep -q 'You have already responded to this test' "$DOUBLE_LOSER_OUTPUT"
then
  echo "Concurrent submit loser returned an unexpected error: $(cat "$DOUBLE_LOSER_OUTPUT")" >&2
  exit 1
fi

DOUBLE_STATE="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select
     (select count(*) from public.test_attempts
      where test_id = 'e0000000-0000-4000-8000-000000000012'
        and student_id = 'e0000000-0000-4000-8000-000000000007'
        and is_submitted = true)
     || ':' ||
     (select count(*) from public.test_responses
      where test_id = 'e0000000-0000-4000-8000-000000000012'
        and student_id = 'e0000000-0000-4000-8000-000000000007');")"
if [[ "$DOUBLE_STATE" != "1:2" ]]; then
  echo "Concurrent submit left incoherent state: $DOUBLE_STATE" >&2
  exit 1
fi

docker exec -e PGAPPNAME=atomic-test-access-holder -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select 1 from public.tests
where id = 'e0000000-0000-4000-8000-000000000016'
for update;
select pg_sleep(3);
commit;
SQL
ACCESS_HOLDER_PID=$!
wait_for_application_event atomic-test-access-holder PgSleep

docker exec -e PGAPPNAME=atomic-test-access-close -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select public.update_test_student_access_atomic(
    'e0000000-0000-4000-8000-000000000016',
    array['e0000000-0000-4000-8000-00000000000c']::uuid[],
    'closed',
    'e0000000-0000-4000-8000-000000000001'
  );" >"$TMP_ONE" 2>&1 &
ACCESS_CLOSE_PID=$!
wait_for_lock_waiters atomic-test-access-close 1

docker exec -e PGAPPNAME=atomic-test-access-submit -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -Atc \
  "select public.submit_test_attempt_atomic(
    'e0000000-0000-4000-8000-000000000016',
    'e0000000-0000-4000-8000-00000000000c',
    jsonb_build_object(
      'e0000000-0000-4000-8000-000000000109', jsonb_build_object('question_type', 'multiple_choice', 'selected_option', 1),
      'e0000000-0000-4000-8000-00000000010a', jsonb_build_object('question_type', 'open_response', 'response_text', 'Availability race answer')
    ),
    '2026-07-14T15:02:00Z'
  );" >"$TMP_TWO" 2>&1 &
ACCESS_SUBMIT_PID=$!
wait_for_lock_waiters atomic-test-access- 2
wait "$ACCESS_HOLDER_PID"
set +e
wait "$ACCESS_CLOSE_PID"
ACCESS_CLOSE_STATUS=$?
wait "$ACCESS_SUBMIT_PID"
ACCESS_SUBMIT_STATUS=$?
set -e

if [[ "$ACCESS_CLOSE_STATUS" -ne 0 || "$ACCESS_SUBMIT_STATUS" -eq 0 ]] \
  || ! grep -q '22023' "$TMP_TWO" \
  || ! grep -q 'Test is not active' "$TMP_TWO"
then
  echo "Availability/submit race did not serialize as expected." >&2
  echo "Access output: $(cat "$TMP_ONE")" >&2
  echo "Submit output: $(cat "$TMP_TWO")" >&2
  exit 1
fi

ACCESS_STATE="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select state
     || ':' ||
     (select count(*) from public.test_attempts
      where test_id = 'e0000000-0000-4000-8000-000000000016'
        and student_id = 'e0000000-0000-4000-8000-00000000000c')
     || ':' ||
     (select count(*) from public.test_responses
      where test_id = 'e0000000-0000-4000-8000-000000000016'
        and student_id = 'e0000000-0000-4000-8000-00000000000c')
   from public.test_student_availability
   where test_id = 'e0000000-0000-4000-8000-000000000016'
     and student_id = 'e0000000-0000-4000-8000-00000000000c';")"
if [[ "$ACCESS_STATE" != "closed:0:0" ]]; then
  echo "Availability/submit race left incoherent state: $ACCESS_STATE" >&2
  exit 1
fi

docker exec -e PGAPPNAME=atomic-test-autosave-holder -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select 1 from public.tests
where id = 'e0000000-0000-4000-8000-000000000017'
for update;
select pg_sleep(3);
commit;
SQL
AUTOSAVE_HOLDER_PID=$!
wait_for_application_event atomic-test-autosave-holder PgSleep

docker exec -e PGAPPNAME=atomic-test-draft-question -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "update public.test_questions
   set response_max_chars = 5
   where id = 'e0000000-0000-4000-8000-00000000010c';" >"$TMP_ONE" 2>&1 &
DRAFT_QUESTION_PID=$!
wait_for_lock_waiters atomic-test-draft-question 1

docker exec -e PGAPPNAME=atomic-test-draft-save -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -Atc \
  "select public.save_test_attempt_atomic(
    'e0000000-0000-4000-8000-000000000017',
    'e0000000-0000-4000-8000-00000000000d',
    jsonb_build_object(
      'e0000000-0000-4000-8000-00000000010c',
      jsonb_build_object('question_type', 'open_response', 'response_text', 'stale answer')
    )
  );" >"$TMP_TWO" 2>&1 &
DRAFT_SAVE_PID=$!
wait_for_lock_waiters atomic-test-draft- 2
wait "$AUTOSAVE_HOLDER_PID"
wait "$DRAFT_QUESTION_PID"
set +e
wait "$DRAFT_SAVE_PID"
DRAFT_SAVE_STATUS=$?
set -e

if [[ "$DRAFT_SAVE_STATUS" -eq 0 ]] \
  || ! grep -q '22023' "$TMP_TWO" \
  || ! grep -q 'Response is too long' "$TMP_TWO"
then
  echo "Question/autosave race accepted a response validated against stale questions." >&2
  echo "Question output: $(cat "$TMP_ONE")" >&2
  echo "Save output: $(cat "$TMP_TWO")" >&2
  exit 1
fi

DRAFT_STATE="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select responses from public.test_attempts
   where test_id = 'e0000000-0000-4000-8000-000000000017'
     and student_id = 'e0000000-0000-4000-8000-00000000000d';")"
if [[ "$DRAFT_STATE" != '{"e0000000-0000-4000-8000-00000000010b": {"question_type": "multiple_choice", "selected_option": 0}}' ]]; then
  echo "Rejected stale autosave changed the preserved draft: $DRAFT_STATE" >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -c \
  "update public.test_questions
   set response_max_chars = 40
   where id = 'e0000000-0000-4000-8000-00000000010c';" >/dev/null

docker exec -e PGAPPNAME=atomic-test-delete-holder -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select 1 from public.tests
where id = 'e0000000-0000-4000-8000-000000000017'
for update;
select pg_sleep(3);
commit;
SQL
DELETE_HOLDER_PID=$!
wait_for_application_event atomic-test-delete-holder PgSleep

docker exec -e PGAPPNAME=atomic-test-delete-submit -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select public.submit_test_attempt_atomic(
    'e0000000-0000-4000-8000-000000000017',
    'e0000000-0000-4000-8000-00000000000d',
    jsonb_build_object(
      'e0000000-0000-4000-8000-00000000010b', jsonb_build_object('question_type', 'multiple_choice', 'selected_option', 1),
      'e0000000-0000-4000-8000-00000000010c', jsonb_build_object('question_type', 'open_response', 'response_text', 'Delete race answer')
    ),
    '2026-07-14T15:03:00Z'
  );" >"$TMP_ONE" 2>&1 &
DELETE_SUBMIT_PID=$!
wait_for_lock_waiters atomic-test-delete-submit 1

docker exec -e PGAPPNAME=atomic-test-delete-worker -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select public.delete_student_test_attempt_atomic(
    'e0000000-0000-4000-8000-000000000017',
    'e0000000-0000-4000-8000-00000000000d'
  );" >"$TMP_TWO" 2>&1 &
DELETE_WORKER_PID=$!
wait_for_lock_waiters atomic-test-delete- 2
wait "$DELETE_HOLDER_PID"
wait "$DELETE_SUBMIT_PID"
wait "$DELETE_WORKER_PID"

DELETE_STATE="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select
     (select count(*) from public.test_attempts
      where test_id = 'e0000000-0000-4000-8000-000000000017'
        and student_id = 'e0000000-0000-4000-8000-00000000000d')
     || ':' ||
     (select count(*) from public.test_responses
      where test_id = 'e0000000-0000-4000-8000-000000000017'
        and student_id = 'e0000000-0000-4000-8000-00000000000d');")"
if [[ "$DELETE_STATE" != "0:0" ]]; then
  echo "Submit/delete race left orphaned test work: $DELETE_STATE" >&2
  echo "Submit output: $(cat "$TMP_ONE")" >&2
  echo "Delete output: $(cat "$TMP_TWO")" >&2
  exit 1
fi

docker exec -e PGAPPNAME=atomic-test-close-holder -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select 1 from public.tests
where id = 'e0000000-0000-4000-8000-000000000013'
for update;
select pg_sleep(3);
commit;
SQL
CLOSE_HOLDER_PID=$!
wait_for_application_event atomic-test-close-holder PgSleep

docker exec -e PGAPPNAME=atomic-test-close-worker -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select public.close_test_for_grading_atomic(
    'e0000000-0000-4000-8000-000000000013',
    'e0000000-0000-4000-8000-000000000001'
  );" >"$TMP_ONE" 2>&1 &
CLOSE_WORKER_PID=$!
wait_for_lock_waiters atomic-test-close-worker 1

docker exec -e PGAPPNAME=atomic-test-close-submit -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -Atc \
  "select public.submit_test_attempt_atomic(
    'e0000000-0000-4000-8000-000000000013',
    'e0000000-0000-4000-8000-000000000008',
    jsonb_build_object(
      'e0000000-0000-4000-8000-000000000105', jsonb_build_object('question_type', 'multiple_choice', 'selected_option', 1),
      'e0000000-0000-4000-8000-000000000106', jsonb_build_object('question_type', 'open_response', 'response_text', 'Close race answer')
    ),
    '2026-07-14T15:05:00Z'
  );" >"$TMP_TWO" 2>&1 &
CLOSE_SUBMIT_PID=$!
wait_for_lock_waiters atomic-test-close- 2
wait "$CLOSE_HOLDER_PID"
set +e
wait "$CLOSE_WORKER_PID"
CLOSE_WORKER_STATUS=$?
wait "$CLOSE_SUBMIT_PID"
CLOSE_SUBMIT_STATUS=$?
set -e

if [[ "$CLOSE_WORKER_STATUS" -ne 0 ]]; then
  echo "Concurrent test close failed: $(cat "$TMP_ONE")" >&2
  exit 1
fi

CLOSE_STATE="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select status
     || ':' ||
     (select count(*) from public.test_attempts
      where test_id = 'e0000000-0000-4000-8000-000000000013'
        and student_id = 'e0000000-0000-4000-8000-000000000008'
        and is_submitted = true)
     || ':' ||
     (select count(*) from public.test_responses
      where test_id = 'e0000000-0000-4000-8000-000000000013'
        and student_id = 'e0000000-0000-4000-8000-000000000008')
   from public.tests
   where id = 'e0000000-0000-4000-8000-000000000013';")"

if [[ "$CLOSE_SUBMIT_STATUS" -eq 0 ]] \
  || ! grep -q '22023' "$TMP_TWO" \
  || ! grep -q 'Test is not active' "$TMP_TWO"
then
  echo "Close/submit race did not preserve close-first lock ordering: $(cat "$TMP_TWO")" >&2
  exit 1
fi
if [[ "$CLOSE_STATE" != "closed:0:0" ]]; then
  echo "Close/submit race partially committed a rejected submission: $CLOSE_STATE" >&2
  echo "Submit output: $(cat "$TMP_TWO")" >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
delete from public.tests
where id = 'e0000000-0000-4000-8000-000000000012';

do $contract$
begin
  if exists (
    select 1 from public.test_attempts
    where test_id = 'e0000000-0000-4000-8000-000000000012'
  ) or exists (
    select 1 from public.test_responses
    where test_id = 'e0000000-0000-4000-8000-000000000012'
  ) or exists (
    select 1 from public.test_questions
    where test_id = 'e0000000-0000-4000-8000-000000000012'
  ) then
    raise exception 'Question parent lock blocked test cascade deletion with student work';
  end if;
end;
$contract$;
SQL

echo "Atomic test submission database checks passed."
