-- Make archived-classroom reuse a single transaction. The classroom row is the
-- durable fence: concurrent requests serialize on it, and only the first may
-- create and link a Blueprint.

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

  update public.classrooms
  set
    source_blueprint_id = v_blueprint_id,
    source_blueprint_origin = jsonb_build_object(
      'blueprint_id', v_blueprint_id,
      'blueprint_title', p_plan->'blueprint'->>'title',
      'blueprint_content_revision', v_blueprint_revision,
      'package_manifest_version', p_plan->>'manifest_version',
      'package_exported_at', now(),
      'operation_id', p_operation_id,
      'reuse_source', 'archived_classroom'
    )
  where id = p_source_classroom_id;

  update public.course_blueprint_operations
  set
    source_classroom_id = p_source_classroom_id,
    result_classroom_id = p_source_classroom_id,
    updated_at = now()
  where id = p_operation_id;

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
  p_candidate_sha256 text
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
  v_version_sha256 text;
begin
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
    v_version_sha256 := encode(
      extensions.digest(
        convert_to(v_version_snapshot::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    );
    select *
    into v_version
    from public.save_course_blueprint_version_atomic(
      p_teacher_id,
      v_proposal.course_blueprint_id,
      v_proposal.applied_blueprint_revision,
      coalesce((v_version_snapshot->>'schema_version')::integer, 2),
      v_version_snapshot,
      v_version_sha256,
      'classroom',
      jsonb_build_object(
        'classroom_id', p_classroom_id,
        'proposal_id', p_proposal_id,
        'reuse_source', 'archived_classroom'
      )
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
  text
) from public, anon, authenticated;
grant execute on function public.apply_archived_classroom_blueprint_proposal_atomic(
  uuid,
  uuid,
  bigint,
  uuid,
  jsonb,
  text
) to service_role;
