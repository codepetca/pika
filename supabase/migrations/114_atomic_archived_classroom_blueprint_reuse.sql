-- Make archived-classroom reuse a single transaction. The classroom row is the
-- durable fence: concurrent requests serialize on it, and only the first may
-- create and link a Blueprint.

-- Match hashCanonicalJson: recursively sort object keys and emit minified JSON
-- without altering whitespace inside string values.
create or replace function public.course_blueprint_canonical_jsonb_text(
  p_value jsonb
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result text;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select '{' || coalesce(
        string_agg(
          to_jsonb(entry.key)::text || ':'
            || public.course_blueprint_canonical_jsonb_text(entry.value),
          ','
          order by entry.key
        ),
        ''
      ) || '}'
      into v_result
      from jsonb_each(p_value) entry;
    when 'array' then
      select '[' || coalesce(
        string_agg(
          public.course_blueprint_canonical_jsonb_text(item.value),
          ','
          order by item.ordinality
        ),
        ''
      ) || ']'
      into v_result
      from jsonb_array_elements(p_value)
        with ordinality as item(value, ordinality);
    else
      v_result := p_value::text;
  end case;
  return v_result;
end;
$$;

revoke all on function public.course_blueprint_canonical_jsonb_text(jsonb)
  from public, anon, authenticated;
grant execute on function public.course_blueprint_canonical_jsonb_text(jsonb)
  to service_role;

create or replace function public.archived_classroom_blueprint_snapshot_from_plan(
  p_blueprint_id uuid,
  p_draft_revision bigint,
  p_plan jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 2,
    'blueprint_id', p_blueprint_id,
    'draft_revision', p_draft_revision,
    'metadata', jsonb_build_object(
      'title', p_plan->'blueprint'->>'title',
      'subject', coalesce(p_plan->'blueprint'->>'subject', ''),
      'grade_level', coalesce(p_plan->'blueprint'->>'grade_level', ''),
      'course_code', coalesce(p_plan->'blueprint'->>'course_code', ''),
      'term_template', coalesce(p_plan->'blueprint'->>'term_template', '')
    ),
    'sections', jsonb_build_object(
      'overview_markdown',
        coalesce(p_plan->'blueprint'->>'overview_markdown', ''),
      'outline_markdown',
        coalesce(p_plan->'blueprint'->>'outline_markdown', ''),
      'resources_markdown',
        coalesce(p_plan->'blueprint'->>'resources_markdown', '')
    ),
    'grading', jsonb_build_object(
      'use_weights',
        coalesce((p_plan->'blueprint'->>'gradebook_use_weights')::boolean, false),
      'assignments_weight',
        coalesce((p_plan->'blueprint'->>'gradebook_assignments_weight')::integer, 70),
      'tests_weight',
        coalesce((p_plan->'blueprint'->>'gradebook_tests_weight')::integer, 30)
    ),
    'planned_site', jsonb_build_object(
      'slug', nullif(p_plan->'blueprint'->>'planned_site_slug', ''),
      'published',
        coalesce((p_plan->'blueprint'->>'planned_site_published')::boolean, false),
      'config',
        coalesce(p_plan->'blueprint'->'planned_site_config', '{}'::jsonb)
    ),
    'assignments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'artifact_id', item.value->>'artifact_id',
          'title', item.value->>'title',
          'instructions_markdown',
            coalesce(item.value->>'instructions_markdown', ''),
          'submission_requirements',
            coalesce(item.value->'submission_requirements_json', '[]'::jsonb),
          'default_due_days',
            coalesce((item.value->>'default_due_days')::integer, 0),
          'default_due_time',
            coalesce(item.value->>'default_due_time', '23:59'),
          'points_possible', item.value->'points_possible',
          'gradebook_weight',
            coalesce((item.value->>'gradebook_weight')::integer, 10),
          'include_in_final',
            coalesce((item.value->>'include_in_final')::boolean, true),
          'is_draft', true,
          'track_authenticity',
            coalesce((item.value->>'track_authenticity')::boolean, false),
          'position', coalesce((item.value->>'position')::integer, 0)
        )
        order by item.ordinality
      )
      from jsonb_array_elements(coalesce(p_plan->'assignments', '[]'::jsonb))
        with ordinality as item(value, ordinality)
    ), '[]'::jsonb),
    'assessments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'artifact_id', item.value->>'artifact_id',
          'assessment_type', 'test',
          'title', item.value->>'title',
          'content', coalesce(item.value->'content', '{}'::jsonb),
          'documents', coalesce(item.value->'documents', '[]'::jsonb),
          'points_possible', item.value->'points_possible',
          'gradebook_weight',
            coalesce((item.value->>'gradebook_weight')::integer, 10),
          'include_in_final',
            coalesce((item.value->>'include_in_final')::boolean, true),
          'position', coalesce((item.value->>'position')::integer, 0)
        )
        order by item.ordinality
      )
      from jsonb_array_elements(coalesce(p_plan->'assessments', '[]'::jsonb))
        with ordinality as item(value, ordinality)
    ), '[]'::jsonb),
    'lesson_templates', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'artifact_id', item.value->>'artifact_id',
          'title', coalesce(item.value->>'title', ''),
          'content_markdown', coalesce(item.value->>'content_markdown', ''),
          'position', coalesce((item.value->>'position')::integer, 0)
        )
        order by item.ordinality
      )
      from jsonb_array_elements(
        coalesce(p_plan->'lesson_templates', '[]'::jsonb)
      ) with ordinality as item(value, ordinality)
    ), '[]'::jsonb),
    'materials', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'artifact_id', item.value->>'artifact_id',
          'title', item.value->>'title',
          'content_markdown', coalesce(item.value->>'content_markdown', ''),
          'position', coalesce((item.value->>'position')::integer, 0)
        )
        order by item.ordinality
      )
      from jsonb_array_elements(coalesce(p_plan->'materials', '[]'::jsonb))
        with ordinality as item(value, ordinality)
    ), '[]'::jsonb),
    'surveys', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'artifact_id', item.value->>'artifact_id',
          'title', item.value->>'title',
          'show_results',
            coalesce((item.value->>'show_results')::boolean, true),
          'dynamic_responses',
            coalesce((item.value->>'dynamic_responses')::boolean, false),
          'questions', coalesce((
            select jsonb_agg(
              (question.value - 'id')
                || jsonb_build_object(
                  'artifact_id',
                  question.value->>'id'
                )
              order by question.ordinality
            )
            from jsonb_array_elements(
              coalesce(item.value->'questions_json', '[]'::jsonb)
            ) with ordinality as question(value, ordinality)
          ), '[]'::jsonb),
          'position', coalesce((item.value->>'position')::integer, 0)
        )
        order by item.ordinality
      )
      from jsonb_array_elements(coalesce(p_plan->'surveys', '[]'::jsonb))
        with ordinality as item(value, ordinality)
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.archived_classroom_blueprint_snapshot_from_plan(
  uuid,
  bigint,
  jsonb
) from public, anon, authenticated;
grant execute on function public.archived_classroom_blueprint_snapshot_from_plan(
  uuid,
  bigint,
  jsonb
) to service_role;

create or replace function public.create_archived_classroom_blueprint_atomic(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_request_sha256 text,
  p_source_classroom_id uuid,
  p_expected_source_revision bigint,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom public.classrooms;
  v_result jsonb;
  v_blueprint_id uuid;
  v_blueprint_revision bigint;
  v_version public.course_blueprint_versions;
  v_version_snapshot jsonb;
  v_version_sha256 text;
  v_item jsonb;
  v_child jsonb;
  v_parent_id uuid;
  v_position integer;
  v_updated integer;
begin
  select *
  into v_classroom
  from public.classrooms
  where id = p_source_classroom_id
    and teacher_id = p_teacher_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'status', 404,
      'operation_id', p_operation_id,
      'operation_type', 'import',
      'error_code', 'source_classroom_not_found',
      'error', 'Archived classroom not found',
      'retryable', false
    );
  end if;

  if v_classroom.archived_at is null then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'operation_type', 'import',
      'error_code', 'source_classroom_not_archived',
      'error', 'Only archived classrooms can be used again',
      'retryable', false
    );
  end if;

  -- A distinct concurrent request that waited on this row reuses the winner.
  -- No second Blueprint or operation row is created.
  if v_classroom.source_blueprint_id is not null then
    select content_revision
    into v_blueprint_revision
    from public.course_blueprints
    where id = v_classroom.source_blueprint_id
      and teacher_id = p_teacher_id;

    if not found then
      raise exception 'Archived classroom Blueprint lineage is invalid'
        using errcode = '23503';
    end if;

    return jsonb_build_object(
      'ok', true,
      'status', 201,
      'operation_id', p_operation_id,
      'operation_type', 'import',
      'replayed', true,
      'blueprint_id', v_classroom.source_blueprint_id,
      'source_revision', v_classroom.blueprint_source_revision,
      'result_content_revision', v_blueprint_revision,
      'counts', jsonb_build_object(
        'assignments', 0,
        'assessments', 0,
        'lesson_templates', 0
      )
    );
  end if;

  if v_classroom.blueprint_source_revision <> p_expected_source_revision then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'operation_type', 'import',
      'error_code', 'source_classroom_changed',
      'error', 'The archived classroom changed while preparing this course',
      'retryable', true
    );
  end if;

  -- The nested RPC participates in this transaction. Any failure after it
  -- returns rolls back its Blueprint graph and operation-ledger write too.
  v_result := public.create_course_blueprint_atomic_v2(
    p_operation_id,
    p_teacher_id,
    'import',
    p_request_sha256,
    null,
    null,
    p_plan
  );
  if coalesce((v_result->>'ok')::boolean, false) is false then
    return v_result;
  end if;

  v_blueprint_id := (v_result->>'blueprint_id')::uuid;
  v_blueprint_revision := (v_result->>'result_content_revision')::bigint;

  perform set_config('pika.identity_mapping', 'on', true);

  for v_item in
    select value from jsonb_array_elements(
      coalesce(p_plan->'assignments', '[]'::jsonb)
    )
  loop
    v_position := coalesce((v_item->>'position')::integer, 0);
    update public.assignments
    set
      artifact_id = (v_item->>'artifact_id')::uuid,
      source_artifact_id = (v_item->>'artifact_id')::uuid
    where classroom_id = p_source_classroom_id
      and blueprint_archived_at is null
      and position = v_position
    returning id into v_parent_id;
    if not found then
      raise exception 'Archived assignment identity mapping failed'
        using errcode = '22023';
    end if;

    for v_child in
      select value from jsonb_array_elements(
        coalesce(v_item->'submission_requirements_json', '[]'::jsonb)
      )
    loop
      update public.assignment_submission_requirements
      set
        artifact_id = (v_child->>'id')::uuid,
        source_artifact_id = (v_child->>'id')::uuid
      where assignment_id = v_parent_id
        and position = coalesce((v_child->>'position')::integer, 0);
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then
        raise exception 'Archived assignment requirement identity mapping failed'
          using errcode = '22023';
      end if;
    end loop;
  end loop;

  for v_item in
    select value from jsonb_array_elements(
      coalesce(p_plan->'assessments', '[]'::jsonb)
    )
  loop
    v_position := coalesce((v_item->>'position')::integer, 0);
    update public.tests
    set
      artifact_id = (v_item->>'artifact_id')::uuid,
      source_artifact_id = (v_item->>'artifact_id')::uuid
    where classroom_id = p_source_classroom_id
      and blueprint_archived_at is null
      and position = v_position
    returning id into v_parent_id;
    if not found then
      raise exception 'Archived Test identity mapping failed'
        using errcode = '22023';
    end if;

    for v_child in
      select value from jsonb_array_elements(
        coalesce(v_item->'content'->'questions', '[]'::jsonb)
      )
    loop
      update public.test_questions
      set
        artifact_id = (v_child->>'id')::uuid,
        source_artifact_id = (v_child->>'id')::uuid
      where test_id = v_parent_id
        and position = coalesce((v_child->>'position')::integer, 0);
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then
        raise exception 'Archived Test question identity mapping failed'
          using errcode = '22023';
      end if;
    end loop;
  end loop;

  for v_item in
    select value from jsonb_array_elements(
      coalesce(p_plan->'lesson_templates', '[]'::jsonb)
    )
  loop
    v_position := coalesce((v_item->>'position')::integer, 0);
    update public.lesson_plans
    set
      artifact_id = (v_item->>'artifact_id')::uuid,
      source_artifact_id = (v_item->>'artifact_id')::uuid
    where id = (
      select lesson.id
      from public.lesson_plans lesson
      where lesson.classroom_id = p_source_classroom_id
        and lesson.blueprint_archived_at is null
      order by lesson.date, lesson.id
      offset v_position
      limit 1
    );
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Archived lesson identity mapping failed'
        using errcode = '22023';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(
      coalesce(p_plan->'materials', '[]'::jsonb)
    )
  loop
    update public.classwork_materials
    set
      artifact_id = (v_item->>'artifact_id')::uuid,
      source_artifact_id = (v_item->>'artifact_id')::uuid
    where classroom_id = p_source_classroom_id
      and blueprint_archived_at is null
      and position = coalesce((v_item->>'position')::integer, 0);
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Archived material identity mapping failed'
        using errcode = '22023';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(
      coalesce(p_plan->'surveys', '[]'::jsonb)
    )
  loop
    update public.surveys
    set
      artifact_id = (v_item->>'artifact_id')::uuid,
      source_artifact_id = (v_item->>'artifact_id')::uuid
    where classroom_id = p_source_classroom_id
      and blueprint_archived_at is null
      and position = coalesce((v_item->>'position')::integer, 0)
    returning id into v_parent_id;
    if not found then
      raise exception 'Archived survey identity mapping failed'
        using errcode = '22023';
    end if;

    for v_child in
      select value from jsonb_array_elements(
        coalesce(v_item->'questions_json', '[]'::jsonb)
      )
    loop
      update public.survey_questions
      set
        artifact_id = (v_child->>'id')::uuid,
        source_artifact_id = (v_child->>'id')::uuid
      where survey_id = v_parent_id
        and position = coalesce((v_child->>'position')::integer, 0);
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then
        raise exception 'Archived survey question identity mapping failed'
          using errcode = '22023';
      end if;
    end loop;
  end loop;

  v_version_snapshot :=
    public.archived_classroom_blueprint_snapshot_from_plan(
      v_blueprint_id,
      v_blueprint_revision,
      p_plan
    );
  v_version_sha256 := encode(
    extensions.digest(
      convert_to(
        public.course_blueprint_canonical_jsonb_text(v_version_snapshot),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  select *
  into v_version
  from public.save_course_blueprint_version_atomic(
    p_teacher_id,
    v_blueprint_id,
    v_blueprint_revision,
    2,
    v_version_snapshot,
    v_version_sha256,
    'classroom',
    jsonb_build_object(
      'classroom_id', p_source_classroom_id,
      'operation_id', p_operation_id,
      'reuse_source', 'archived_classroom'
    )
  );

  update public.assignments
  set source_blueprint_version_id = v_version.id
  where classroom_id = p_source_classroom_id
    and blueprint_archived_at is null
    and source_artifact_id is not null;
  update public.assignment_submission_requirements requirement
  set source_blueprint_version_id = v_version.id
  where exists (
    select 1
    from public.assignments assignment
    where assignment.id = requirement.assignment_id
      and assignment.classroom_id = p_source_classroom_id
      and assignment.blueprint_archived_at is null
  ) and requirement.source_artifact_id is not null;
  update public.tests
  set source_blueprint_version_id = v_version.id
  where classroom_id = p_source_classroom_id
    and blueprint_archived_at is null
    and source_artifact_id is not null;
  update public.test_questions question
  set source_blueprint_version_id = v_version.id
  where exists (
    select 1
    from public.tests test
    where test.id = question.test_id
      and test.classroom_id = p_source_classroom_id
      and test.blueprint_archived_at is null
  ) and question.source_artifact_id is not null;
  update public.lesson_plans
  set source_blueprint_version_id = v_version.id
  where classroom_id = p_source_classroom_id
    and blueprint_archived_at is null
    and source_artifact_id is not null;
  update public.classwork_materials
  set source_blueprint_version_id = v_version.id
  where classroom_id = p_source_classroom_id
    and blueprint_archived_at is null
    and source_artifact_id is not null;
  update public.surveys
  set source_blueprint_version_id = v_version.id
  where classroom_id = p_source_classroom_id
    and blueprint_archived_at is null
    and source_artifact_id is not null;
  update public.survey_questions question
  set source_blueprint_version_id = v_version.id
  where exists (
    select 1
    from public.surveys survey
    where survey.id = question.survey_id
      and survey.classroom_id = p_source_classroom_id
      and survey.blueprint_archived_at is null
  ) and question.source_artifact_id is not null;

  update public.classrooms
  set
    source_blueprint_id = v_blueprint_id,
    source_blueprint_version_id = v_version.id,
    source_blueprint_origin = jsonb_build_object(
      'blueprint_id', v_blueprint_id,
      'blueprint_title', p_plan->'blueprint'->>'title',
      'blueprint_content_revision', v_blueprint_revision,
      'blueprint_version_id', v_version.id,
      'blueprint_version_number', v_version.version_number,
      'package_manifest_version', p_plan->>'manifest_version',
      'package_exported_at', now(),
      'operation_id', p_operation_id,
      'reuse_source', 'archived_classroom'
    )
  where id = p_source_classroom_id;

  v_result := v_result || jsonb_build_object(
    'source_blueprint_version_id',
    v_version.id
  );
  update public.course_blueprint_operations
  set
    source_classroom_id = p_source_classroom_id,
    result_classroom_id = p_source_classroom_id,
    result = v_result,
    updated_at = now()
  where id = p_operation_id;

  perform set_config('pika.identity_mapping', 'off', true);
  return v_result;
end;
$$;

revoke all on function public.create_archived_classroom_blueprint_atomic(
  uuid,
  uuid,
  text,
  uuid,
  bigint,
  jsonb
) from public, anon, authenticated;
grant execute on function public.create_archived_classroom_blueprint_atomic(
  uuid,
  uuid,
  text,
  uuid,
  bigint,
  jsonb
) to service_role;

-- Promotion is also archive-specific. Lock and validate the hot archive in the
-- same transaction as the existing proposal application so a concurrent
-- Restore cannot turn this into an active-classroom write.
create or replace function public.apply_archived_classroom_blueprint_proposal_atomic(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_expected_classroom_revision bigint,
  p_proposal_id uuid,
  p_candidate_snapshot jsonb,
  p_candidate_sha256 text,
  p_result_snapshot_sha256 text
)
returns public.course_blueprint_change_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom public.classrooms;
  v_proposal public.course_blueprint_change_proposals;
  v_version public.course_blueprint_versions;
  v_version_snapshot jsonb;
begin
  if p_result_snapshot_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid result Blueprint Version digest'
      using errcode = '22023';
  end if;

  select *
  into v_classroom
  from public.classrooms
  where id = p_classroom_id
    and teacher_id = p_teacher_id
  for update;

  if not found then
    raise exception 'Archived classroom not found' using errcode = 'P0002';
  end if;
  if v_classroom.archived_at is null
    or v_classroom.blueprint_source_revision <> p_expected_classroom_revision
  then
    raise exception 'Archived classroom changed before Blueprint promotion'
      using errcode = '40001';
  end if;

  select *
  into v_proposal
  from public.apply_course_blueprint_proposal_atomic(
    p_teacher_id,
    p_proposal_id,
    p_candidate_snapshot,
    p_candidate_sha256
  );

  if v_proposal.status = 'applied' then
    v_version_snapshot := jsonb_set(
      p_candidate_snapshot,
      '{draft_revision}',
      to_jsonb(v_proposal.applied_blueprint_revision),
      true
    );
    select *
    into v_version
    from public.save_course_blueprint_version_atomic(
      p_teacher_id,
      v_proposal.course_blueprint_id,
      v_proposal.applied_blueprint_revision,
      coalesce((v_version_snapshot->>'schema_version')::integer, 2),
      v_version_snapshot,
      p_result_snapshot_sha256,
      'classroom',
      jsonb_build_object(
        'classroom_id', p_classroom_id,
        'proposal_id', p_proposal_id,
        'reuse_source', 'archived_classroom'
      )
    );

    perform set_config('pika.identity_mapping', 'on', true);
    update public.assignments
    set
      source_artifact_id = coalesce(source_artifact_id, artifact_id),
      source_blueprint_version_id = v_version.id
    where classroom_id = p_classroom_id
      and blueprint_archived_at is null;
    update public.assignment_submission_requirements requirement
    set
      source_artifact_id = coalesce(
        requirement.source_artifact_id,
        requirement.artifact_id
      ),
      source_blueprint_version_id = v_version.id
    where exists (
      select 1
      from public.assignments assignment
      where assignment.id = requirement.assignment_id
        and assignment.classroom_id = p_classroom_id
        and assignment.blueprint_archived_at is null
    );
    update public.tests
    set
      source_artifact_id = coalesce(source_artifact_id, artifact_id),
      source_blueprint_version_id = v_version.id
    where classroom_id = p_classroom_id
      and blueprint_archived_at is null;
    update public.test_questions question
    set
      source_artifact_id = coalesce(
        question.source_artifact_id,
        question.artifact_id
      ),
      source_blueprint_version_id = v_version.id
    where exists (
      select 1
      from public.tests test
      where test.id = question.test_id
        and test.classroom_id = p_classroom_id
        and test.blueprint_archived_at is null
    );
    update public.lesson_plans
    set
      source_artifact_id = coalesce(source_artifact_id, artifact_id),
      source_blueprint_version_id = v_version.id
    where classroom_id = p_classroom_id
      and blueprint_archived_at is null;
    update public.classwork_materials
    set
      source_artifact_id = coalesce(source_artifact_id, artifact_id),
      source_blueprint_version_id = v_version.id
    where classroom_id = p_classroom_id
      and blueprint_archived_at is null;
    update public.surveys
    set
      source_artifact_id = coalesce(source_artifact_id, artifact_id),
      source_blueprint_version_id = v_version.id
    where classroom_id = p_classroom_id
      and blueprint_archived_at is null;
    update public.survey_questions question
    set
      source_artifact_id = coalesce(
        question.source_artifact_id,
        question.artifact_id
      ),
      source_blueprint_version_id = v_version.id
    where exists (
      select 1
      from public.surveys survey
      where survey.id = question.survey_id
        and survey.classroom_id = p_classroom_id
        and survey.blueprint_archived_at is null
    );

    update public.classrooms
    set
      source_blueprint_version_id = v_version.id,
      source_blueprint_origin = coalesce(source_blueprint_origin, '{}'::jsonb)
        || jsonb_build_object(
          'blueprint_content_revision',
          v_proposal.applied_blueprint_revision,
          'blueprint_version_id',
          v_version.id,
          'blueprint_version_number',
          v_version.version_number,
          'updated_from_proposal_id',
          p_proposal_id
        )
    where id = p_classroom_id;
    perform set_config('pika.identity_mapping', 'off', true);
  end if;

  return v_proposal;
end;
$$;

revoke all on function public.apply_archived_classroom_blueprint_proposal_atomic(
  uuid,
  uuid,
  bigint,
  uuid,
  jsonb,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.apply_archived_classroom_blueprint_proposal_atomic(
  uuid,
  uuid,
  bigint,
  uuid,
  jsonb,
  text,
  text
) to service_role;
