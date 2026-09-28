#!/usr/bin/env bash
set -euo pipefail

DEFAULT_DB_CONTAINER="$(docker ps --filter 'name=supabase_db_pika' --format '{{.Names}}' | head -n 1)"
if [[ -z "$DEFAULT_DB_CONTAINER" ]]; then
  DEFAULT_DB_CONTAINER="$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)"
fi
DB_CONTAINER="${CLASSROOM_GUIDED_DRAFT_DB_CONTAINER:-$DEFAULT_DB_CONTAINER}"
DATABASE_NAME="${CLASSROOM_GUIDED_DRAFT_DATABASE_NAME:-postgres}"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DATABASE_NAME" \
  -X -v ON_ERROR_STOP=1 <<'SQL'
begin;

do $contract$
declare
  v_owner constant uuid := 'c1900000-0000-4000-8000-000000000001';
  v_other constant uuid := 'c1900000-0000-4000-8000-000000000002';
  v_blueprint constant uuid := 'c1900000-0000-4000-8000-000000000003';
  v_version constant uuid := 'c1900000-0000-4000-8000-000000000004';
  v_classroom constant uuid := 'c1900000-0000-4000-8000-000000000005';
  v_unit constant uuid := 'c1900000-0000-4000-8000-000000000006';
  v_assignment_draft constant uuid := 'c1900000-0000-4000-8000-000000000007';
  v_test_draft constant uuid := 'c1900000-0000-4000-8000-000000000008';
  v_assignment_rules constant text := '## Course expectations' || E'\n\n' || 'Use taught vocabulary.' || E'\n\n' || '## Assignment rules' || E'\n\n' || 'State a deliverable.' || E'\n\n' || '## Unit: Loops' || E'\n\n' || 'Use a loop.';
  v_test_rules constant text := '## Course expectations' || E'\n\n' || 'Use taught vocabulary.' || E'\n\n' || '## Test rules' || E'\n\n' || 'Short prompts.' || E'\n\n' || '## Unit: Loops' || E'\n\n' || 'Use iteration.';
  v_test_content constant jsonb := '{"title":"Guided Test","show_results":false,"questions":[{"id":"c1900000-0000-4000-8000-000000000009","question_type":"open_response","question_text":"Write a loop.","options":[],"correct_option":null,"answer_key":"A loop.","sample_solution":"for ...","points":5,"response_max_chars":5000,"response_monospace":true}]}';
  v_assignment jsonb;
  v_test jsonb;
  v_assignment_id uuid;
  v_test_id uuid;
begin
  if not exists (
    select 1 from pg_class where oid = 'public.classroom_guided_draft_provenance'::regclass
      and relrowsecurity
  ) or has_table_privilege('anon', 'public.classroom_guided_draft_provenance', 'SELECT')
    or has_table_privilege('authenticated', 'public.classroom_guided_draft_provenance', 'SELECT')
    or not has_table_privilege('service_role', 'public.classroom_guided_draft_provenance', 'SELECT')
    or has_function_privilege('authenticated',
      'public.create_guided_test_for_owner_v1(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text)', 'EXECUTE')
  then
    raise exception 'Guided draft provenance privacy contract failed';
  end if;
  if not exists (
    select 1 from public.classroom_archive_resource_contract_versions
    where format_version = 2 and table_name = 'classroom_guided_draft_provenance'
      and parent_table = 'classrooms' and parent_column = 'classroom_id'
      and actor_columns = array['created_by']
      and restore_after = array['classrooms', 'assignments', 'tests']
  ) or not exists (
    select 1 from public.classroom_archive_resource_contract
    where table_name = 'classroom_guided_draft_provenance'
      and parent_table = 'classrooms' and parent_column = 'classroom_id'
      and actor_columns = array['created_by']
      and restore_after = array['classrooms', 'assignments', 'tests']
  ) then
    raise exception 'Guided draft archive resource contract failed';
  end if;

  insert into public.users (id, email, role) values
    (v_owner, 'guided-draft-owner@example.test', 'teacher'),
    (v_other, 'guided-draft-other@example.test', 'teacher');
  insert into public.course_blueprints (id, teacher_id, title)
  values (v_blueprint, v_owner, 'Guided contract');
  insert into public.classrooms (id, teacher_id, title, class_code, source_blueprint_id)
  values (v_classroom, v_owner, 'Guided contract', 'CGDC01', v_blueprint);
  insert into public.course_blueprint_versions (
    id, course_blueprint_id, version_number, source_draft_revision,
    snapshot_schema_version, snapshot_json, snapshot_sha256, created_by
  ) values (
    v_version, v_blueprint, 2, 7, 3,
    jsonb_build_object('authoring_guidance', jsonb_build_object(
      'course_expectations_markdown', 'Use taught vocabulary.',
      'assignment_guidance_markdown', 'State a deliverable.',
      'test_guidance_markdown', 'Short prompts.',
      'unit_exceptions', jsonb_build_array(jsonb_build_object(
        'id', v_unit::text,
        'unit_label', 'Loops',
        'assignment_guidance_markdown', 'Use a loop.',
        'test_guidance_markdown', 'Use iteration.'
      ))
    )), repeat('a', 64), v_owner
  );
  update public.classrooms set source_blueprint_version_id = v_version
  where id = v_classroom;

  if public.resolve_classroom_guided_rules_v1(
    (select snapshot_json->'authoring_guidance' from public.course_blueprint_versions where id = v_version),
    'assignments', v_unit
  )->>'rules_markdown' is distinct from v_assignment_rules then
    raise exception 'Frozen assignment rules differ from application context';
  end if;

  v_assignment := public.create_guided_assignment_for_owner_v1(
    v_owner, v_classroom, v_version, v_unit, v_assignment_draft,
    'Guided Assignment', 'Write a program.', 'Write a program.', '{}'::jsonb,
    '2030-01-01T23:59:00Z'::timestamptz, '[]'::jsonb, 12,
    v_assignment_rules, repeat('b', 64)
  );
  v_assignment_id := (v_assignment->'assignment'->>'id')::uuid;
  if v_assignment->>'ok' <> 'true'
    or (v_assignment->'assignment'->>'source_blueprint_version_id') is not null
    or (v_assignment->'assignment'->>'points_possible')::numeric <> 12
    or (select count(*) from public.classroom_guided_draft_provenance
      where assignment_id = v_assignment_id and draft_id = v_assignment_draft
        and source_blueprint_version_id = v_version
        and source_blueprint_version_number = 2
        and source_draft_revision = 7
        and unit_exception_id = v_unit and unit_label = 'Loops'
        and rules_markdown = v_assignment_rules
        and seed_sha256 = repeat('b', 64)) <> 1
  then
    raise exception 'Guided Assignment atomic creation or provenance failed';
  end if;

  v_test := public.create_guided_test_for_owner_v1(
    v_owner, v_classroom, v_version, v_unit, v_test_draft,
    v_test_content,
    '[{"id":"c1900000-0000-4000-8000-00000000000a","title":"Instructions","source":"text","content":"# Instructions"}]'::jsonb,
    v_test_rules, repeat('c', 64)
  );
  v_test_id := (v_test->'test'->>'id')::uuid;
  if v_test->>'ok' <> 'true'
    or (v_test->'test'->>'source_blueprint_version_id') is not null
    or (v_test->'test'->>'points_possible')::numeric <> 5
    or (select count(*) from public.assessment_drafts
      where assessment_type = 'test' and assessment_id = v_test_id
        and content = v_test_content) <> 1
    or (select count(*) from public.classroom_guided_draft_provenance
      where test_id = v_test_id and draft_id = v_test_draft
        and source_blueprint_version_id = v_version and unit_exception_id = v_unit
        and rules_markdown = v_test_rules and seed_sha256 = repeat('c', 64)) <> 1
  then
    raise exception 'Guided Test atomic creation or provenance failed';
  end if;

  begin
    perform public.create_guided_assignment_for_owner_v1(
      v_other, v_classroom, v_version, v_unit, gen_random_uuid(),
      'Forbidden', '', '', '{}'::jsonb, '2030-01-01'::timestamptz,
      '[]'::jsonb, 1, v_assignment_rules, repeat('d', 64)
    );
    raise exception 'Foreign teacher was accepted';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.create_guided_test_for_owner_v1(
      v_owner, v_classroom, gen_random_uuid(), v_unit, gen_random_uuid(),
      v_test_content, '[]'::jsonb, v_test_rules, repeat('d', 64)
    );
    raise exception 'Stale Version was accepted';
  exception when serialization_failure then null;
  end;

  begin
    perform public.create_guided_test_for_owner_v1(
      v_owner, v_classroom, v_version, gen_random_uuid(), gen_random_uuid(),
      v_test_content, '[]'::jsonb, v_test_rules, repeat('d', 64)
    );
    raise exception 'Foreign unit was accepted';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.create_guided_test_for_owner_v1(
      v_owner, v_classroom, v_version, v_unit, gen_random_uuid(),
      v_test_content, '[]'::jsonb, 'Different rules', repeat('d', 64)
    );
    raise exception 'Mismatched rules were accepted';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.create_guided_test_for_owner_v1(
      v_owner, v_classroom, v_version, v_unit, v_test_draft,
      v_test_content, '[]'::jsonb, v_test_rules, repeat('d', 64)
    );
    raise exception 'Replayed draft id was accepted';
  exception when unique_violation then null;
  end;

  if (select count(*) from public.tests where classroom_id = v_classroom) <> 1
    or (select count(*) from public.assessment_drafts where classroom_id = v_classroom) <> 1
    or (select count(*) from public.classroom_guided_draft_provenance where classroom_id = v_classroom) <> 2
  then
    raise exception 'Failed guided Test creation left a partial artifact';
  end if;

  update public.classrooms set archived_at = now() where id = v_classroom;
  begin
    perform public.create_guided_test_for_owner_v1(
      v_owner, v_classroom, v_version, v_unit, gen_random_uuid(),
      v_test_content, '[]'::jsonb, v_test_rules, repeat('d', 64)
    );
    raise exception 'Archived classroom was accepted';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$contract$;

rollback;
SQL

echo "Guided classroom draft provenance contract passed."
