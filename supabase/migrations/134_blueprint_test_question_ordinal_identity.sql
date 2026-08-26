-- Establish one portable Test-question identity from draft creation onward.
--
-- TestDraftQuestion intentionally has no persisted position field. Migrations 112
-- and 114 treated a missing position as zero while attaching stable identities,
-- so a multi-question Test repeatedly updated question zero and collided with the
-- per-Test artifact-id uniqueness constraint. Keep the public managed-storage
-- wrapper from migration 117 intact and replace its private implementation plus
-- the archived-Classroom reuse RPC with stable-identity validation. Persisted question
-- positions can contain gaps after deletion, and saved drafts can add, remove,
-- or reorder questions before test_questions is synchronized on activation.
-- Backfill legacy draft row IDs once, match existing source rows only by portable
-- identity, and tolerate draft-only questions. Capture validates source identity
-- without assigning or rewriting it.

do $$
declare
  v_draft record;
  v_question jsonb;
  v_question_id uuid;
  v_question_row_ids uuid[];
  v_portable_id uuid;
  v_questions jsonb;
  v_changed boolean;
begin
  for v_draft in
    select id, assessment_id, content
    from public.assessment_drafts
    where assessment_type = 'test'
  loop
    v_questions := '[]'::jsonb;
    v_changed := false;

    for v_question in
      select question.value
      from jsonb_array_elements(
        coalesce(v_draft.content->'questions', '[]'::jsonb)
      ) with ordinality as question(value, ordinal)
      order by question.ordinal
    loop
      v_question_id := (v_question->>'id')::uuid;
      select array_agg(source_question.id order by source_question.id)
      into v_question_row_ids
      from public.test_questions as source_question
      where source_question.test_id = v_draft.assessment_id
        and (
          source_question.artifact_id = v_question_id
          or source_question.source_artifact_id = v_question_id
          or source_question.id = v_question_id
        );

      if coalesce(cardinality(v_question_row_ids), 0) > 1 then
        raise exception 'Legacy Test draft question identity backfill is ambiguous'
          using errcode = '22023';
      elsif coalesce(cardinality(v_question_row_ids), 0) = 1 then
        select coalesce(
          source_question.source_artifact_id,
          source_question.artifact_id,
          source_question.id
        )
        into v_portable_id
        from public.test_questions as source_question
        where source_question.id = v_question_row_ids[1];

        if v_question_id is distinct from v_portable_id then
          v_question := jsonb_set(
            v_question,
            '{id}',
            to_jsonb(v_portable_id),
            false
          );
          v_changed := true;
        end if;
      end if;

      v_questions := v_questions || jsonb_build_array(v_question);
    end loop;

    if v_changed then
      update public.assessment_drafts
      set content = jsonb_set(content, '{questions}', v_questions, false)
      where id = v_draft.id;
    end if;
  end loop;
end;
$$;

create or replace function public.create_course_blueprint_atomic_v2_pre_managed_storage(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_operation_type text,
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
  v_result jsonb;
  v_blueprint_id uuid;
  v_item jsonb;
  v_child jsonb;
  v_parent_id uuid;
  v_position integer;
  v_question_row_ids uuid[];
  v_updated integer;
  v_error_code text;
  v_error_sqlstate text;
  v_resource_counts jsonb := '{}'::jsonb;
begin
  -- The base RPC owns its own domain-write savepoint, but this wrapper performs
  -- additional identity writes after the base RPC returns. Seed the ledger
  -- outside a wider savepoint so a wrapper failure can roll back the complete
  -- Blueprint graph while retaining durable failure evidence.
  insert into public.course_blueprint_operations (
    id,
    teacher_id,
    operation_type,
    request_sha256,
    status,
    source_classroom_id
  )
  values (
    p_operation_id,
    p_teacher_id,
    p_operation_type,
    p_request_sha256,
    'running',
    p_source_classroom_id
  )
  on conflict (id) do nothing;

  begin
  perform set_config('pika.identity_mapping', 'on', true);
  v_result := public.create_course_blueprint_atomic(
    p_operation_id,
    p_teacher_id,
    p_operation_type,
    p_request_sha256,
    p_source_classroom_id,
    p_expected_source_revision,
    p_plan
  );
  if coalesce((v_result->>'ok')::boolean, false) is false then
    perform set_config('pika.identity_mapping', 'off', true);
    return v_result;
  end if;
  if coalesce((v_result->>'replayed')::boolean, false) then
    perform set_config('pika.identity_mapping', 'off', true);
    return v_result;
  end if;
  v_resource_counts := coalesce(v_result->'counts', '{}'::jsonb);

  v_blueprint_id := (v_result->>'blueprint_id')::uuid;
  update public.course_blueprints
  set
    gradebook_use_weights = coalesce(
      (p_plan->'blueprint'->>'gradebook_use_weights')::boolean,
      false
    ),
    gradebook_assignments_weight = coalesce(
      (p_plan->'blueprint'->>'gradebook_assignments_weight')::smallint,
      70
    ),
    gradebook_tests_weight = coalesce(
      (p_plan->'blueprint'->>'gradebook_tests_weight')::smallint,
      30
    )
  where id = v_blueprint_id;

  for v_item in select value from jsonb_array_elements(p_plan->'assignments')
  loop
    v_position := coalesce((v_item->>'position')::integer, 0);
    update public.course_blueprint_assignments
    set
      artifact_id = (v_item->>'artifact_id')::uuid,
      track_authenticity = coalesce(
        (v_item->>'track_authenticity')::boolean,
        false
      )
    where course_blueprint_id = v_blueprint_id
      and position = v_position;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Assignment positions must be unique for identity mapping'
        using errcode = '22023';
    end if;
    if p_operation_type = 'capture' then
      update public.assignments
      set
        artifact_id = (v_item->>'artifact_id')::uuid,
        source_artifact_id = (v_item->>'artifact_id')::uuid
      where classroom_id = p_source_classroom_id
        and position = v_position
      returning id into v_parent_id;
      if not found then
        raise exception 'Captured assignment identity mapping failed'
          using errcode = '22023';
      end if;
      for v_child in
        select value
        from jsonb_array_elements(
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
          raise exception 'Captured assignment requirement identity mapping failed'
            using errcode = '22023';
        end if;
      end loop;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_plan->'assessments')
  loop
    v_position := coalesce((v_item->>'position')::integer, 0);
    update public.course_blueprint_assessments
    set artifact_id = (v_item->>'artifact_id')::uuid
    where course_blueprint_id = v_blueprint_id
      and assessment_type = 'test'
      and position = v_position;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Test positions must be unique for identity mapping'
        using errcode = '22023';
    end if;
    if p_operation_type = 'capture' then
      select array_agg(source_test.id order by source_test.id)
      into v_question_row_ids
      from public.tests as source_test
      where source_test.classroom_id = p_source_classroom_id
        and (
          source_test.artifact_id = (v_item->>'artifact_id')::uuid
          or source_test.source_artifact_id = (v_item->>'artifact_id')::uuid
        );
      if coalesce(cardinality(v_question_row_ids), 0) <> 1 then
        raise exception 'Captured Test identity mapping failed'
          using errcode = '22023';
      end if;
      v_parent_id := v_question_row_ids[1];

      for v_child in
        select question.value
        from jsonb_array_elements(
          coalesce(v_item->'content'->'questions', '[]'::jsonb)
        ) as question(value)
      loop
        select array_agg(source_question.id order by source_question.id)
        into v_question_row_ids
        from public.test_questions as source_question
        where source_question.test_id = v_parent_id
          and (
            source_question.artifact_id = (v_child->>'id')::uuid
            or source_question.source_artifact_id = (v_child->>'id')::uuid
          );

        if coalesce(cardinality(v_question_row_ids), 0) > 1 then
          v_error_code := 'test_question_identity_ambiguous';
          raise exception 'Captured Test question identity mapping is ambiguous'
            using errcode = '22023';
        end if;
      end loop;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_plan->'lesson_templates')
  loop
    v_position := coalesce((v_item->>'position')::integer, 0);
    update public.course_blueprint_lesson_templates
    set artifact_id = (v_item->>'artifact_id')::uuid
    where course_blueprint_id = v_blueprint_id
      and position = v_position;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Lesson positions must be unique for identity mapping'
        using errcode = '22023';
    end if;
    if p_operation_type = 'capture' then
      update public.lesson_plans
      set
        artifact_id = (v_item->>'artifact_id')::uuid,
        source_artifact_id = (v_item->>'artifact_id')::uuid
      where id = (
        select lesson.id
        from public.lesson_plans lesson
        where lesson.classroom_id = p_source_classroom_id
        order by lesson.date, lesson.id
        offset v_position
        limit 1
      );
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then
        raise exception 'Captured lesson identity mapping failed'
          using errcode = '22023';
      end if;
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_plan->'materials', '[]'::jsonb))
  loop
    insert into public.course_blueprint_materials (
      course_blueprint_id,
      artifact_id,
      title,
      content_markdown,
      position
    )
    values (
      v_blueprint_id,
      (v_item->>'artifact_id')::uuid,
      v_item->>'title',
      coalesce(v_item->>'content_markdown', ''),
      coalesce((v_item->>'position')::integer, 0)
    );
    if p_operation_type = 'capture' then
      update public.classwork_materials
      set
        artifact_id = (v_item->>'artifact_id')::uuid,
        source_artifact_id = (v_item->>'artifact_id')::uuid
      where classroom_id = p_source_classroom_id
        and position = coalesce((v_item->>'position')::integer, 0);
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then
        raise exception 'Captured material identity mapping failed'
          using errcode = '22023';
      end if;
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_plan->'surveys', '[]'::jsonb))
  loop
    insert into public.course_blueprint_surveys (
      course_blueprint_id,
      artifact_id,
      title,
      show_results,
      dynamic_responses,
      questions_json,
      position
    )
    values (
      v_blueprint_id,
      (v_item->>'artifact_id')::uuid,
      v_item->>'title',
      coalesce((v_item->>'show_results')::boolean, true),
      coalesce((v_item->>'dynamic_responses')::boolean, false),
      coalesce(v_item->'questions_json', '[]'::jsonb),
      coalesce((v_item->>'position')::integer, 0)
    );
    if p_operation_type = 'capture' then
      update public.surveys
      set
        artifact_id = (v_item->>'artifact_id')::uuid,
        source_artifact_id = (v_item->>'artifact_id')::uuid
      where classroom_id = p_source_classroom_id
        and position = coalesce((v_item->>'position')::integer, 0)
      returning id into v_parent_id;
      if not found then
        raise exception 'Captured survey identity mapping failed'
          using errcode = '22023';
      end if;
      for v_child in
        select value
        from jsonb_array_elements(coalesce(v_item->'questions_json', '[]'::jsonb))
      loop
        update public.survey_questions
        set
          artifact_id = (v_child->>'id')::uuid,
          source_artifact_id = (v_child->>'id')::uuid
        where survey_id = v_parent_id
          and position = coalesce((v_child->>'position')::integer, 0);
        get diagnostics v_updated = row_count;
        if v_updated <> 1 then
          raise exception 'Captured survey question identity mapping failed'
            using errcode = '22023';
        end if;
      end loop;
    end if;
  end loop;

  v_result := jsonb_set(
    v_result,
    '{counts}',
    coalesce(v_result->'counts', '{}'::jsonb) || jsonb_build_object(
      'materials', jsonb_array_length(coalesce(p_plan->'materials', '[]'::jsonb)),
      'surveys', jsonb_array_length(coalesce(p_plan->'surveys', '[]'::jsonb))
    ),
    true
  );
  update public.course_blueprint_operations
  set
    result = v_result,
    resource_counts = v_result->'counts',
    updated_at = now()
  where id = p_operation_id;

  perform set_config('pika.identity_mapping', 'off', true);
  return v_result;
  exception when others then
    get stacked diagnostics
      v_error_sqlstate = returned_sqlstate;
    v_error_code := coalesce(v_error_code, 'blueprint_identity_mapping_failed');
    v_result := jsonb_build_object(
      'ok', false,
      'status', case when v_error_code = 'test_question_identity_ambiguous' then 409 else 500 end,
      'operation_id', p_operation_id,
      'operation_type', p_operation_type,
      'error_code', v_error_code,
      'error', case
        when v_error_code = 'test_question_identity_ambiguous'
          then 'Test question identity mapping is ambiguous'
        else 'Blueprint identity mapping failed'
      end,
      'retryable', true
    );
    update public.course_blueprint_operations
    set
      status = 'failed',
      attempt_count = case when status = 'failed' then attempt_count + 1 else attempt_count end,
      result_blueprint_id = null,
      result_classroom_id = null,
      result = v_result,
      resource_counts = v_resource_counts,
      error_code = v_error_code,
      error_sqlstate = v_error_sqlstate,
      completed_at = now(),
      updated_at = now()
    where id = p_operation_id;
    perform set_config('pika.identity_mapping', 'off', true);
    return v_result;
  end;
end;
$$;

alter function public.instantiate_course_blueprint_atomic_v2_pre_managed_storage(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  bigint,
  jsonb
) rename to instantiate_course_blueprint_atomic_v2_pre_question_identity;

-- Migration 112 assigned freshly instantiated Test-question identities by
-- position after the base RPC inserted rows. Keep that compatibility RPC for
-- the rest of the graph, then rematerialize only the brand-new question rows
-- from explicit Version artifact IDs. The parent Test is resolved by its
-- established source_artifact_id, never by title or position.
create or replace function public.instantiate_course_blueprint_atomic_v2_pre_managed_storage(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_blueprint_id uuid,
  p_blueprint_version_id uuid,
  p_request_sha256 text,
  p_expected_content_revision bigint,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_classroom_id uuid;
  v_parent_id uuid;
  v_item jsonb;
  v_child jsonb;
begin
  v_result := public.instantiate_course_blueprint_atomic_v2_pre_question_identity(
    p_operation_id,
    p_teacher_id,
    p_blueprint_id,
    p_blueprint_version_id,
    p_request_sha256,
    p_expected_content_revision,
    p_plan
  );
  if coalesce((v_result->>'ok')::boolean, false) is false
    or coalesce((v_result->>'replayed')::boolean, false)
  then
    return v_result;
  end if;

  v_classroom_id := (v_result->>'classroom_id')::uuid;
  perform set_config('pika.identity_mapping', 'on', true);

  for v_item in
    select value from jsonb_array_elements(coalesce(p_plan->'tests', '[]'::jsonb))
  loop
    select source_test.id
    into v_parent_id
    from public.tests as source_test
    where source_test.classroom_id = v_classroom_id
      and source_test.source_artifact_id = (v_item->>'artifact_id')::uuid
      and source_test.blueprint_archived_at is null;
    if not found then
      raise exception 'Instantiated Test identity mapping failed'
        using errcode = '22023';
    end if;

    delete from public.test_questions
    where test_id = v_parent_id;

    for v_child in
      select value from jsonb_array_elements(coalesce(v_item->'questions', '[]'::jsonb))
    loop
      insert into public.test_questions (
        test_id,
        artifact_id,
        source_artifact_id,
        source_blueprint_version_id,
        question_type,
        question_text,
        options,
        correct_option,
        answer_key,
        sample_solution,
        points,
        response_max_chars,
        response_monospace,
        position
      )
      values (
        v_parent_id,
        (v_child->>'artifact_id')::uuid,
        (v_child->>'artifact_id')::uuid,
        p_blueprint_version_id,
        v_child->>'question_type',
        coalesce(v_child->>'question_text', ''),
        coalesce(v_child->'options', '[]'::jsonb),
        (v_child->>'correct_option')::integer,
        v_child->>'answer_key',
        v_child->>'sample_solution',
        coalesce((v_child->>'points')::numeric, 1),
        coalesce((v_child->>'response_max_chars')::integer, 5000),
        coalesce((v_child->>'response_monospace')::boolean, false),
        coalesce((v_child->>'position')::integer, 0)
      );
    end loop;
  end loop;

  perform set_config('pika.identity_mapping', 'off', true);
  return v_result;
exception when others then
  perform set_config('pika.identity_mapping', 'off', true);
  raise;
end;
$$;

revoke all on function public.instantiate_course_blueprint_atomic_v2_pre_question_identity(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  bigint,
  jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.instantiate_course_blueprint_atomic_v2_pre_managed_storage(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  bigint,
  jsonb
) from public, anon, authenticated, service_role;

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
  v_question_row_ids uuid[];
  v_updated integer;
  v_error_code text;
  v_error_sqlstate text;
  v_resource_counts jsonb := '{}'::jsonb;
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

  -- Retain the operation row outside the domain-write savepoint. The nested
  -- Blueprint creation and all archived-source identity writes then roll back
  -- together while a structured failure remains available for recovery.
  insert into public.course_blueprint_operations (
    id,
    teacher_id,
    operation_type,
    request_sha256,
    status,
    source_classroom_id
  )
  values (
    p_operation_id,
    p_teacher_id,
    'import',
    p_request_sha256,
    'running',
    p_source_classroom_id
  )
  on conflict (id) do nothing;

  begin

  -- The nested RPC participates in this savepoint. Any failure after it
  -- returns rolls back its Blueprint graph while preserving the outer ledger.
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
  v_resource_counts := coalesce(v_result->'counts', '{}'::jsonb);

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
    select array_agg(source_test.id order by source_test.id)
    into v_question_row_ids
    from public.tests as source_test
    where source_test.classroom_id = p_source_classroom_id
      and source_test.blueprint_archived_at is null
      and (
        source_test.artifact_id = (v_item->>'artifact_id')::uuid
        or source_test.source_artifact_id = (v_item->>'artifact_id')::uuid
      );
    if coalesce(cardinality(v_question_row_ids), 0) <> 1 then
      raise exception 'Archived Test identity mapping failed'
        using errcode = '22023';
    end if;
    v_parent_id := v_question_row_ids[1];

    for v_child in
      select question.value
      from jsonb_array_elements(
        coalesce(v_item->'content'->'questions', '[]'::jsonb)
      ) as question(value)
    loop
      select array_agg(source_question.id order by source_question.id)
      into v_question_row_ids
      from public.test_questions as source_question
      where source_question.test_id = v_parent_id
        and (
          source_question.artifact_id = (v_child->>'id')::uuid
          or source_question.source_artifact_id = (v_child->>'id')::uuid
        );

      if coalesce(cardinality(v_question_row_ids), 0) > 1 then
        v_error_code := 'test_question_identity_ambiguous';
        raise exception 'Archived Test question identity mapping is ambiguous'
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
  exception when others then
    get stacked diagnostics
      v_error_sqlstate = returned_sqlstate;
    v_error_code := coalesce(v_error_code, 'blueprint_identity_mapping_failed');
    v_result := jsonb_build_object(
      'ok', false,
      'status', case when v_error_code = 'test_question_identity_ambiguous' then 409 else 500 end,
      'operation_id', p_operation_id,
      'operation_type', 'import',
      'error_code', v_error_code,
      'error', case
        when v_error_code = 'test_question_identity_ambiguous'
          then 'Test question identity mapping is ambiguous'
        else 'Blueprint identity mapping failed'
      end,
      'retryable', true
    );
    update public.course_blueprint_operations
    set
      status = 'failed',
      attempt_count = case when status = 'failed' then attempt_count + 1 else attempt_count end,
      source_classroom_id = p_source_classroom_id,
      result_blueprint_id = null,
      result_classroom_id = null,
      result = v_result,
      resource_counts = v_resource_counts,
      error_code = v_error_code,
      error_sqlstate = v_error_sqlstate,
      completed_at = now(),
      updated_at = now()
    where id = p_operation_id;
    perform set_config('pika.identity_mapping', 'off', true);
    return v_result;
  end;
end;
$$;

revoke all on function public.create_course_blueprint_atomic_v2_pre_managed_storage(
  uuid,
  uuid,
  text,
  text,
  uuid,
  bigint,
  jsonb
) from public, anon, authenticated, service_role;

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
