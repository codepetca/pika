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
    delete from public.users
    where id in ('$TEACHER_ID'::uuid, '$CASCADE_TEACHER_ID'::uuid);
  " >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

run_psql <<SQL >/dev/null
insert into public.users (id, email, role) values
  ('$TEACHER_ID', 'versioned-blueprint-contract@example.test', 'teacher'),
  ('$CASCADE_TEACHER_ID', 'versioned-blueprint-cascade@example.test', 'teacher');

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
