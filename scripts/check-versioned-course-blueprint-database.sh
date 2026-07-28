#!/usr/bin/env bash
set -euo pipefail

DEFAULT_DB_CONTAINER="$(docker ps --filter 'name=supabase_db_pika' --format '{{.Names}}' | head -n 1)"
if [[ -z "$DEFAULT_DB_CONTAINER" ]]; then
  DEFAULT_DB_CONTAINER="$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)"
fi
DB_CONTAINER="${VERSIONED_BLUEPRINT_DB_CONTAINER:-$DEFAULT_DB_CONTAINER}"
DATABASE_NAME="${VERSIONED_BLUEPRINT_DATABASE_NAME:-postgres}"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

TEACHER_ID='81000000-0000-4000-8000-000000000001'
CASCADE_TEACHER_ID='81000000-0000-4000-8000-000000000002'
STUDENT_ONE_ID='81000000-0000-4000-8000-000000000011'
STUDENT_TWO_ID='81000000-0000-4000-8000-000000000012'
STUDENT_THREE_ID='81000000-0000-4000-8000-000000000013'
STUDENT_FOUR_ID='81000000-0000-4000-8000-000000000014'
BLUEPRINT_ID='82000000-0000-4000-8000-000000000001'
CASCADE_BLUEPRINT_ID='82000000-0000-4000-8000-000000000002'
CLASSROOM_ID='83000000-0000-4000-8000-000000000001'
VERSION_ID='84000000-0000-4000-8000-000000000001'
CASCADE_VERSION_ID='84000000-0000-4000-8000-000000000002'
IDEMPOTENCY_KEY='85000000-0000-4000-8000-000000000001'
RESULT_ONE=''
RESULT_TWO=''

run_psql() {
  docker exec -i "$DB_CONTAINER" psql \
    -U postgres -d "$DATABASE_NAME" -X -A -t -v ON_ERROR_STOP=1 "$@"
}

cleanup() {
  if [[ -n "$RESULT_ONE" ]]; then rm -f "$RESULT_ONE"; fi
  if [[ -n "$RESULT_TWO" ]]; then rm -f "$RESULT_TWO"; fi
  run_psql -c "
    delete from public.classrooms
    where id = '$CLASSROOM_ID'::uuid;
    delete from public.users
    where id in (
      '$TEACHER_ID'::uuid,
      '$CASCADE_TEACHER_ID'::uuid,
      '$STUDENT_ONE_ID'::uuid,
      '$STUDENT_TWO_ID'::uuid,
      '$STUDENT_THREE_ID'::uuid,
      '$STUDENT_FOUR_ID'::uuid
    );
  " >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

run_psql <<SQL >/dev/null
insert into public.users (id, email, role) values
  ('$TEACHER_ID', 'versioned-blueprint-contract@example.test', 'teacher'),
  ('$CASCADE_TEACHER_ID', 'versioned-blueprint-cascade@example.test', 'teacher'),
  ('$STUDENT_ONE_ID', 'versioned-blueprint-student-1@example.test', 'student'),
  ('$STUDENT_TWO_ID', 'versioned-blueprint-student-2@example.test', 'student'),
  ('$STUDENT_THREE_ID', 'versioned-blueprint-student-3@example.test', 'student'),
  ('$STUDENT_FOUR_ID', 'versioned-blueprint-student-4@example.test', 'student');

insert into public.course_blueprints (id, teacher_id, title) values
  ('$BLUEPRINT_ID', '$TEACHER_ID', 'Versioned Blueprint'),
  ('$CASCADE_BLUEPRINT_ID', '$CASCADE_TEACHER_ID', 'Cascade Blueprint');

insert into public.classrooms (
  id, teacher_id, title, class_code, source_blueprint_id
) values (
  '$CLASSROOM_ID', '$TEACHER_ID', 'Versioned Classroom', 'VBPC01', '$BLUEPRINT_ID'
);

insert into public.course_blueprint_versions (
  id, course_blueprint_id, version_number, source_draft_revision,
  snapshot_json, snapshot_sha256, created_by
) values
  (
    '$VERSION_ID', '$BLUEPRINT_ID', 1, 1,
    '{}'::jsonb, repeat('a', 64), '$TEACHER_ID'
  ),
  (
    '$CASCADE_VERSION_ID', '$CASCADE_BLUEPRINT_ID', 1, 1,
    '{}'::jsonb, repeat('b', 64), '$CASCADE_TEACHER_ID'
  );
SQL

DIRECT_DELETE_RESULT="$(run_psql -c "
  do \$contract\$
  begin
    begin
      delete from public.course_blueprint_versions where id = '$VERSION_ID';
      raise exception 'Direct Blueprint Version deletion was accepted';
    exception when object_not_in_prerequisite_state then
      null;
    end;
  end
  \$contract\$;

  create temp table nested_blueprint_version_delete_probe (
    version_id uuid not null
  );
  create function pg_temp.try_nested_blueprint_version_delete()
  returns trigger
  language plpgsql
  as \$probe\$
  begin
    delete from public.course_blueprint_versions where id = new.version_id;
    return new;
  end
  \$probe\$;
  create trigger try_nested_blueprint_version_delete
    after insert on nested_blueprint_version_delete_probe
    for each row execute function pg_temp.try_nested_blueprint_version_delete();
  do \$contract\$
  begin
    begin
      insert into nested_blueprint_version_delete_probe (version_id)
      values ('$VERSION_ID');
      raise exception 'Unrelated nested trigger deleted a Blueprint Version';
    exception when object_not_in_prerequisite_state then
      null;
    end;
  end
  \$contract\$;

  select count(*) from public.course_blueprint_versions where id = '$VERSION_ID';
")"
if [[ "${DIRECT_DELETE_RESULT##*$'\n'}" != "1" ]]; then
  echo "Direct Blueprint Version deletion contract failed." >&2
  exit 1
fi

PROPOSAL_SQL="
select (
  public.create_course_blueprint_proposal_atomic(
    '$TEACHER_ID'::uuid,
    '$BLUEPRINT_ID'::uuid,
    '$IDEMPOTENCY_KEY'::uuid,
    'repository',
    (select content_revision from public.course_blueprints where id = '$BLUEPRINT_ID'),
    null,
    null,
    null,
    '[]'::jsonb,
    jsonb_build_object('candidate_sha256', repeat('c', 64)),
    repeat('d', 64)
  )
).id;
"

RESULT_ONE="$(mktemp)"
RESULT_TWO="$(mktemp)"
run_psql -c "$PROPOSAL_SQL" >"$RESULT_ONE" &
PID_ONE=$!
run_psql -c "$PROPOSAL_SQL" >"$RESULT_TWO" &
PID_TWO=$!
wait "$PID_ONE"
wait "$PID_TWO"
PROPOSAL_ONE="$(tr -d '[:space:]' <"$RESULT_ONE")"
PROPOSAL_TWO="$(tr -d '[:space:]' <"$RESULT_TWO")"
rm -f "$RESULT_ONE" "$RESULT_TWO"
RESULT_ONE=''
RESULT_TWO=''
if [[ -z "$PROPOSAL_ONE" || "$PROPOSAL_ONE" != "$PROPOSAL_TWO" ]]; then
  echo "Concurrent proposal retries did not replay one proposal." >&2
  exit 1
fi

CLASSROOM_PROPOSAL_SQL="
select (
  public.create_course_blueprint_classroom_proposal_atomic(
    '$TEACHER_ID'::uuid,
    '$BLUEPRINT_ID'::uuid,
    '$VERSION_ID'::uuid,
    '$CLASSROOM_ID'::uuid,
    (select content_revision from public.course_blueprints where id = '$BLUEPRINT_ID'),
    (select blueprint_source_revision from public.classrooms where id = '$CLASSROOM_ID'),
    '85000000-0000-4000-8000-000000000003'::uuid,
    '[]'::jsonb,
    '{}'::jsonb,
    repeat('1', 64)
  )
).id;
"

RESULT_ONE="$(mktemp)"
RESULT_TWO="$(mktemp)"
run_psql -c "$CLASSROOM_PROPOSAL_SQL" >"$RESULT_ONE" &
PID_ONE=$!
run_psql -c "$CLASSROOM_PROPOSAL_SQL" >"$RESULT_TWO" &
PID_TWO=$!
wait "$PID_ONE"
wait "$PID_TWO"
CLASSROOM_PROPOSAL_ONE="$(tr -d '[:space:]' <"$RESULT_ONE")"
CLASSROOM_PROPOSAL_TWO="$(tr -d '[:space:]' <"$RESULT_TWO")"
rm -f "$RESULT_ONE" "$RESULT_TWO"
RESULT_ONE=''
RESULT_TWO=''
if [[
  -z "$CLASSROOM_PROPOSAL_ONE"
  || "$CLASSROOM_PROPOSAL_ONE" != "$CLASSROOM_PROPOSAL_TWO"
]]; then
  echo "Concurrent classroom-target proposal retries did not replay one proposal." >&2
  exit 1
fi

run_psql <<SQL >/dev/null
do \$contract\$
declare
  v_proposal public.course_blueprint_change_proposals;
  v_applied public.course_blueprint_change_proposals;
  v_base_revision bigint;
  v_candidate_sha constant text := repeat('e', 64);
begin
  select blueprint_source_revision
  into v_base_revision
  from public.classrooms
  where id = '$CLASSROOM_ID';

  v_proposal := public.create_course_blueprint_proposal_atomic(
    '$TEACHER_ID',
    '$BLUEPRINT_ID',
    '85000000-0000-4000-8000-000000000002',
    'classroom',
    (select content_revision from public.course_blueprints where id = '$BLUEPRINT_ID'),
    '$VERSION_ID',
    '$CLASSROOM_ID',
    v_base_revision,
    '[]'::jsonb,
    jsonb_build_object('candidate_sha256', v_candidate_sha),
    repeat('f', 64)
  );

  update public.classrooms
  set course_overview_markdown = 'Changed after proposal'
  where id = '$CLASSROOM_ID';

  v_applied := public.apply_course_blueprint_proposal_atomic(
    '$TEACHER_ID',
    v_proposal.id,
    '{}'::jsonb,
    v_candidate_sha
  );
  if v_applied.status <> 'stale' then
    raise exception 'Changed source classroom did not stale the proposal: %', v_applied;
  end if;
  if (select title from public.course_blueprints where id = '$BLUEPRINT_ID')
    <> 'Versioned Blueprint'
  then
    raise exception 'Stale classroom proposal changed the Blueprint';
  end if;
end
\$contract\$;

update public.course_blueprints
set authority_mode = 'repository'
where id = '$BLUEPRINT_ID';

do \$contract\$
declare
  v_proposal public.course_blueprint_change_proposals;
  v_candidate jsonb;
  v_revision bigint;
begin
  select content_revision into v_revision
  from public.course_blueprints
  where id = '$BLUEPRINT_ID';

  v_candidate := jsonb_build_object(
    'blueprint_id', '$BLUEPRINT_ID',
    'draft_revision', v_revision,
    'metadata', jsonb_build_object(
      'title', 'Publication Guard',
      'subject', '',
      'grade_level', '',
      'course_code', '',
      'term_template', ''
    ),
    'sections', jsonb_build_object(
      'overview_markdown', '',
      'outline_markdown', '',
      'resources_markdown', ''
    ),
    'grading', jsonb_build_object(
      'use_weights', false,
      'assignments_weight', 70,
      'tests_weight', 30
    ),
    'planned_site', jsonb_build_object(
      'slug', 'publication-guard',
      'published', true,
      'config', '{}'::jsonb
    ),
    'assignments', '[]'::jsonb,
    'assessments', '[]'::jsonb,
    'lesson_templates', '[]'::jsonb,
    'materials', '[]'::jsonb,
    'surveys', '[]'::jsonb
  );

  v_proposal := public.create_course_blueprint_proposal_atomic(
    '$TEACHER_ID',
    '$BLUEPRINT_ID',
    '85000000-0000-4000-8000-000000000004',
    'repository',
    v_revision,
    null,
    null,
    null,
    '[]'::jsonb,
    jsonb_build_object('candidate_sha256', repeat('2', 64)),
    repeat('3', 64)
  );
  perform public.apply_course_blueprint_proposal_atomic(
    '$TEACHER_ID',
    v_proposal.id,
    v_candidate,
    repeat('2', 64)
  );
  if (
    select planned_site_published
    from public.course_blueprints
    where id = '$BLUEPRINT_ID'
  ) then
    raise exception 'Repository proposal published a planned site';
  end if;

  update public.course_blueprints
  set planned_site_published = true
  where id = '$BLUEPRINT_ID';
  select content_revision into v_revision
  from public.course_blueprints
  where id = '$BLUEPRINT_ID';
  v_candidate := jsonb_set(
    jsonb_set(v_candidate, '{draft_revision}', to_jsonb(v_revision)),
    '{planned_site,published}',
    'false'::jsonb
  );

  v_proposal := public.create_course_blueprint_proposal_atomic(
    '$TEACHER_ID',
    '$BLUEPRINT_ID',
    '85000000-0000-4000-8000-000000000005',
    'repository',
    v_revision,
    null,
    null,
    null,
    '[]'::jsonb,
    jsonb_build_object('candidate_sha256', repeat('4', 64)),
    repeat('5', 64)
  );
  perform public.apply_course_blueprint_proposal_atomic(
    '$TEACHER_ID',
    v_proposal.id,
    v_candidate,
    repeat('4', 64)
  );
  if not (
    select planned_site_published
    from public.course_blueprints
    where id = '$BLUEPRINT_ID'
  ) then
    raise exception 'Repository proposal unpublished a planned site';
  end if;
end
\$contract\$;

do \$contract\$
declare
  v_assignment_id constant uuid := '86000000-0000-4000-8000-000000000001';
  v_requirement_id constant uuid := '87000000-0000-4000-8000-000000000001';
  v_assignment_artifact_id constant uuid := '88000000-0000-4000-8000-000000000001';
  v_requirement_artifact_id constant uuid := '89000000-0000-4000-8000-000000000001';
  v_operation_id constant uuid := '85000000-0000-4000-8000-000000000010';
  v_source_revision bigint;
  v_result jsonb;
  v_plan jsonb;
  v_docs_before jsonb;
  v_docs_after jsonb;
  v_requirement_before jsonb;
  v_requirement_after jsonb;
  v_student_id uuid;
  v_doc_updated_at timestamptz;
  v_content jsonb;
begin
  insert into public.assignments (
    id, classroom_id, title, description, instructions_markdown, due_at,
    created_by, position, is_draft, released_at, track_authenticity,
    points_possible, gradebook_weight, include_in_final
  ) values (
    v_assignment_id, '$CLASSROOM_ID', 'Submitted Blueprint assignment',
    'Student-bearing capture contract', 'Submit the repository link.',
    '2026-09-15T23:59:00-04:00'::timestamptz, '$TEACHER_ID', 0, false,
    now(), false, 20, 10, true
  );

  insert into public.assignment_submission_requirements (
    id, assignment_id, type, label, instructions, required, position,
    validation_policy_json
  ) values (
    v_requirement_id, v_assignment_id, 'repo_link', 'Repository link',
    'Paste the repository URL.', false, 0, '{"provider":"github"}'::jsonb
  );

  foreach v_student_id in array array[
    '$STUDENT_ONE_ID'::uuid,
    '$STUDENT_TWO_ID'::uuid,
    '$STUDENT_THREE_ID'::uuid,
    '$STUDENT_FOUR_ID'::uuid
  ]
  loop
    v_content := jsonb_build_object(
      'type', 'doc',
      'content', jsonb_build_array(jsonb_build_object(
        'type', 'paragraph',
        'content', jsonb_build_array(jsonb_build_object(
          'type', 'text',
          'text', 'Submitted work ' || v_student_id::text
        ))
      ))
    );
    insert into public.assignment_docs (
      assignment_id, student_id, content, is_submitted
    ) values (
      v_assignment_id, v_student_id, v_content, false
    )
    returning updated_at into v_doc_updated_at;

    v_result := public.submit_assignment_doc_atomic(
      v_assignment_id,
      v_student_id,
      v_content,
      v_doc_updated_at,
      2,
      50
    );
    if not coalesce((v_result->>'ok')::boolean, false) then
      raise exception 'Could not create submitted Blueprint fixture: %', v_result;
    end if;
  end loop;

  select blueprint_source_revision
  into v_source_revision
  from public.classrooms
  where id = '$CLASSROOM_ID';

  select jsonb_agg(to_jsonb(doc) order by doc.id)
  into v_docs_before
  from public.assignment_docs doc
  where doc.assignment_id = v_assignment_id;

  select to_jsonb(requirement)
  into v_requirement_before
  from public.assignment_submission_requirements requirement
  where requirement.id = v_requirement_id;

  v_plan := jsonb_build_object(
    'blueprint', jsonb_build_object(
      'title', 'Submitted Requirement Capture',
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
    'assignments', jsonb_build_array(jsonb_build_object(
      'artifact_id', v_assignment_artifact_id,
      'title', 'Submitted Blueprint assignment',
      'instructions_markdown', 'Submit the repository link.',
      'submission_requirements_json', jsonb_build_array(jsonb_build_object(
        'id', v_requirement_artifact_id,
        'type', 'repo_link',
        'label', 'Repository link',
        'instructions', 'Paste the repository URL.',
        'required', false,
        'position', 0,
        'validation_policy_json', '{"provider":"github"}'::jsonb
      )),
      'default_due_days', 0,
      'default_due_time', '23:59',
      'points_possible', 20,
      'gradebook_weight', 10,
      'include_in_final', true,
      'is_draft', true,
      'track_authenticity', false,
      'position', 0
    )),
    'assessments', '[]'::jsonb,
    'lesson_templates', '[]'::jsonb,
    'materials', '[]'::jsonb,
    'surveys', '[]'::jsonb,
    'manifest_version', '3',
    'source_package_exported_at', null
  );

  perform set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.create_course_blueprint_atomic_v2(
    v_operation_id,
    '$TEACHER_ID',
    'capture',
    repeat('6', 64),
    '$CLASSROOM_ID',
    v_source_revision,
    v_plan
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Submitted-requirement Blueprint capture failed: %', v_result;
  end if;

  select jsonb_agg(to_jsonb(doc) order by doc.id)
  into v_docs_after
  from public.assignment_docs doc
  where doc.assignment_id = v_assignment_id;
  if v_docs_after is distinct from v_docs_before then
    raise exception 'Blueprint capture changed submitted assignment documents';
  end if;

  select to_jsonb(requirement)
  into v_requirement_after
  from public.assignment_submission_requirements requirement
  where requirement.id = v_requirement_id;
  if (
    v_requirement_after - array[
      'artifact_id',
      'source_artifact_id',
      'source_blueprint_version_id',
      'updated_at'
    ]::text[]
  ) is distinct from (
    v_requirement_before - array[
      'artifact_id',
      'source_artifact_id',
      'source_blueprint_version_id',
      'updated_at'
    ]::text[]
  ) then
    raise exception 'Blueprint capture changed requirement definition content';
  end if;
  if v_requirement_after->>'artifact_id' <> v_requirement_artifact_id::text
    or v_requirement_after->>'source_artifact_id' <> v_requirement_artifact_id::text
  then
    raise exception 'Blueprint capture did not attach stable requirement identity';
  end if;

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    perform set_config('pika.identity_mapping', 'on', true);
    update public.assignment_submission_requirements
    set source_artifact_id = null
    where id = v_requirement_id;
    raise exception 'Authenticated identity marker bypassed submitted-work immutability';
  exception when check_violation then
    if sqlerrm not like '%assignment_requirements_submitted_documents_immutable%' then
      raise;
    end if;
  end;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  begin
    perform set_config('pika.identity_mapping', 'on', true);
    update public.assignment_submission_requirements
    set label = 'Forbidden content change'
    where id = v_requirement_id;
    raise exception 'Identity mapping accepted a pedagogical requirement change';
  exception when check_violation then
    if sqlerrm not like '%assignment_requirements_submitted_documents_immutable%' then
      raise;
    end if;
  end;
  perform set_config('pika.identity_mapping', 'off', true);
end
\$contract\$;

delete from public.course_blueprints where id = '$BLUEPRINT_ID';
do \$contract\$
begin
  if exists (
    select 1 from public.course_blueprint_versions where id = '$VERSION_ID'
  ) then
    raise exception 'Blueprint deletion did not cascade through immutable Versions';
  end if;
end
\$contract\$;

delete from public.users where id = '$CASCADE_TEACHER_ID';
do \$contract\$
begin
  if exists (
    select 1 from public.course_blueprint_versions where id = '$CASCADE_VERSION_ID'
  ) then
    raise exception 'User deletion did not cascade through immutable Versions';
  end if;
end
\$contract\$;
SQL

echo "Versioned Course Blueprint database contract passed."
