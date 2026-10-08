-- Add dormant, service-only contextual boundaries for learner assignment
-- artifact preparation, attachment, and deletion. Applying this migration
-- changes no rows and does not activate any route; exact-pair API admission
-- remains independently disabled by default.

begin;

create function private.lock_assignment_artifact_member_context_v1(
  p_actor_id uuid,
  p_assignment_id uuid,
  p_requirement_id uuid
)
returns table (
  classroom_id uuid,
  assignment_doc_id uuid,
  requirement_type text,
  requirement jsonb,
  artifact jsonb,
  doc_is_submitted boolean
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_initial_classroom_id uuid;
  v_assignment_classroom_id uuid;
  v_assignment_is_draft boolean;
  v_assignment_released_at timestamptz;
  v_archived_at timestamptz;
  v_requirement public.assignment_submission_requirements%rowtype;
  v_doc public.assignment_docs%rowtype;
  v_artifact public.assignment_submission_artifacts%rowtype;
begin
  if p_actor_id is null or p_assignment_id is null or p_requirement_id is null then
    raise exception using errcode = '22023', message = 'Invalid assignment artifact request';
  end if;

  -- Match save, submit, restore, and requirement mutation before taking the
  -- broader classroom/member fences.
  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || p_assignment_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(p_assignment_id::text || ':' || p_actor_id::text, 0)
  );

  select assignment.classroom_id
  into v_initial_classroom_id
  from public.assignments as assignment
  where assignment.id = p_assignment_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Assignment not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || v_initial_classroom_id::text, 0)
  );
  perform private.try_lock_classroom_membership_change(
    v_initial_classroom_id,
    p_actor_id
  );

  select
    assignment.classroom_id,
    assignment.is_draft,
    assignment.released_at,
    classroom.archived_at
  into
    v_assignment_classroom_id,
    v_assignment_is_draft,
    v_assignment_released_at,
    v_archived_at
  from public.assignments as assignment
  join public.classrooms as classroom on classroom.id = assignment.classroom_id
  where assignment.id = p_assignment_id
  for update of classroom, assignment;

  if not found
    or v_assignment_classroom_id is distinct from v_initial_classroom_id
  then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;

  if v_archived_at is not null
    or v_assignment_is_draft
    or v_assignment_released_at > clock_timestamp()
  then
    raise exception using errcode = 'P0002', message = 'Assignment not found';
  end if;

  perform 1
  from public.classroom_enrollments as enrollment
  where enrollment.classroom_id = v_assignment_classroom_id
    and enrollment.student_id = p_actor_id
  for share;

  if not found then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;

  select requirement_row.*
  into v_requirement
  from public.assignment_submission_requirements as requirement_row
  where requirement_row.id = p_requirement_id
    and requirement_row.assignment_id = p_assignment_id
  for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'Requirement not found';
  end if;

  select document.*
  into v_doc
  from public.assignment_docs as document
  where document.assignment_id = p_assignment_id
    and document.student_id = p_actor_id
  for update;

  if not found then
    insert into public.assignment_docs (
      assignment_id,
      student_id,
      content,
      repo_url,
      github_username,
      is_submitted,
      submitted_at,
      viewed_at
    ) values (
      p_assignment_id,
      p_actor_id,
      '{"type":"doc","content":[]}'::jsonb,
      null,
      null,
      false,
      null,
      clock_timestamp()
    )
    returning * into v_doc;
  end if;

  select artifact_row.*
  into v_artifact
  from public.assignment_submission_artifacts as artifact_row
  where artifact_row.assignment_doc_id = v_doc.id
    and artifact_row.requirement_id = p_requirement_id
  for update;

  if v_artifact.id is not null and (
    v_artifact.student_id is distinct from p_actor_id
    or v_artifact.type is distinct from v_requirement.type
  ) then
    raise exception using errcode = '22023', message = 'Invalid assignment artifact binding';
  end if;

  return query select
    v_assignment_classroom_id,
    v_doc.id,
    v_requirement.type,
    to_jsonb(v_requirement),
    case when v_artifact.id is null then null::jsonb else to_jsonb(v_artifact) end,
    v_doc.is_submitted;
end;
$function$;

revoke all on function private.lock_assignment_artifact_member_context_v1(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.prepare_assignment_artifact_for_member_v1(
  p_actor_id uuid,
  p_assignment_id uuid,
  p_requirement_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
begin
  select * into strict v_context
  from private.lock_assignment_artifact_member_context_v1(
    p_actor_id,
    p_assignment_id,
    p_requirement_id
  );

  if v_context.doc_is_submitted then
    return jsonb_build_object(
      'ok', false,
      'status', 403,
      'error_code', 'assignment_doc_submitted',
      'error', 'Cannot edit a submitted document'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'classroom_id', v_context.classroom_id,
    'assignment_doc_id', v_context.assignment_doc_id,
    'requirement', v_context.requirement,
    'artifact', v_context.artifact
  );
end;
$function$;

create function public.upsert_assignment_artifact_for_member_v1(
  p_actor_id uuid,
  p_assignment_id uuid,
  p_requirement_id uuid,
  p_type text,
  p_url text,
  p_storage_path text,
  p_metadata_json jsonb,
  p_validation_status text,
  p_validation_message text,
  p_validated_at timestamptz,
  p_managed_object_id uuid,
  p_save_github_identity boolean default false,
  p_github_login text default null,
  p_github_validation_status text default null,
  p_github_validation_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_artifact public.assignment_submission_artifacts%rowtype;
  v_previous_storage_path text;
begin
  if p_type not in ('repo_link', 'link', 'image')
    or p_metadata_json is null
    or jsonb_typeof(p_metadata_json) <> 'object'
    or p_validation_status not in (
      'missing', 'pending', 'valid', 'warning', 'invalid', 'inaccessible'
    )
    or p_validated_at is null
    or (
      p_type = 'image'
      and (
        nullif(btrim(p_storage_path), '') is null
        or p_url is not null
        or p_managed_object_id is null
      )
    )
    or (
      p_type <> 'image'
      and (
        nullif(btrim(p_url), '') is null
        or p_storage_path is not null
        or p_managed_object_id is not null
      )
    )
    or (
      p_save_github_identity
      and (
        p_type <> 'repo_link'
        or nullif(btrim(p_github_login), '') is null
        or p_github_login !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
        or p_github_validation_status not in (
          'unvalidated', 'valid', 'invalid', 'inaccessible'
        )
      )
    )
  then
    raise exception using errcode = '22023', message = 'Invalid assignment artifact request';
  end if;

  select * into strict v_context
  from private.lock_assignment_artifact_member_context_v1(
    p_actor_id,
    p_assignment_id,
    p_requirement_id
  );

  if v_context.doc_is_submitted then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'error_code', 'assignment_doc_submitted',
      'error', 'Cannot edit a submitted document'
    );
  end if;

  if v_context.requirement_type is distinct from p_type then
    raise exception using errcode = '22023', message = 'Invalid assignment artifact type';
  end if;

  v_previous_storage_path := v_context.artifact->>'storage_path';

  insert into public.assignment_submission_artifacts (
    assignment_doc_id,
    requirement_id,
    student_id,
    type,
    url,
    storage_path,
    metadata_json,
    validation_status,
    validation_message,
    validated_at,
    managed_object_id
  ) values (
    v_context.assignment_doc_id,
    p_requirement_id,
    p_actor_id,
    p_type,
    case when p_type = 'image' then null else btrim(p_url) end,
    case when p_type = 'image' then btrim(p_storage_path) else null end,
    p_metadata_json,
    p_validation_status,
    p_validation_message,
    p_validated_at,
    p_managed_object_id
  )
  on conflict (assignment_doc_id, requirement_id) do update
  set student_id = excluded.student_id,
      type = excluded.type,
      url = excluded.url,
      storage_path = excluded.storage_path,
      metadata_json = excluded.metadata_json,
      validation_status = excluded.validation_status,
      validation_message = excluded.validation_message,
      validated_at = excluded.validated_at,
      managed_object_id = excluded.managed_object_id
  returning * into v_artifact;

  if p_save_github_identity then
    insert into public.user_github_identities (
      user_id,
      github_login,
      validation_status,
      validation_message,
      validated_at
    ) values (
      p_actor_id,
      btrim(p_github_login),
      p_github_validation_status,
      p_github_validation_message,
      p_validated_at
    )
    on conflict (user_id) do update
    set github_login = excluded.github_login,
        validation_status = excluded.validation_status,
        validation_message = excluded.validation_message,
        validated_at = excluded.validated_at;
  end if;

  if v_artifact.assignment_doc_id is distinct from v_context.assignment_doc_id
    or v_artifact.requirement_id is distinct from p_requirement_id
    or v_artifact.student_id is distinct from p_actor_id
    or v_artifact.type is distinct from v_context.requirement_type
  then
    raise exception using errcode = '22023', message = 'Invalid assignment artifact result';
  end if;

  return jsonb_build_object(
    'ok', true,
    'classroom_id', v_context.classroom_id,
    'artifact', to_jsonb(v_artifact),
    'previous_storage_path', v_previous_storage_path
  );
end;
$function$;

create function public.delete_assignment_artifact_for_member_v1(
  p_actor_id uuid,
  p_assignment_id uuid,
  p_requirement_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_storage_path text;
begin
  select * into strict v_context
  from private.lock_assignment_artifact_member_context_v1(
    p_actor_id,
    p_assignment_id,
    p_requirement_id
  );

  if v_context.doc_is_submitted then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'error_code', 'assignment_doc_submitted',
      'error', 'Cannot edit a submitted document'
    );
  end if;

  if v_context.artifact is null then
    return jsonb_build_object(
      'ok', true,
      'classroom_id', v_context.classroom_id,
      'deleted', false,
      'storage_path', null
    );
  end if;

  delete from public.assignment_submission_artifacts as artifact
  where artifact.assignment_doc_id = v_context.assignment_doc_id
    and artifact.requirement_id = p_requirement_id
    and artifact.student_id = p_actor_id
  returning artifact.storage_path into v_storage_path;

  if not found then
    raise exception using errcode = '40001', message = 'Assignment artifact changed';
  end if;

  return jsonb_build_object(
    'ok', true,
    'classroom_id', v_context.classroom_id,
    'deleted', true,
    'storage_path', v_storage_path
  );
end;
$function$;

revoke all on function public.prepare_assignment_artifact_for_member_v1(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_assignment_artifact_for_member_v1(uuid, uuid, uuid)
  to service_role;

revoke all on function public.upsert_assignment_artifact_for_member_v1(
  uuid, uuid, uuid, text, text, text, jsonb, text, text, timestamptz, uuid,
  boolean, text, text, text
) from public, anon, authenticated;
grant execute on function public.upsert_assignment_artifact_for_member_v1(
  uuid, uuid, uuid, text, text, text, jsonb, text, text, timestamptz, uuid,
  boolean, text, text, text
) to service_role;

revoke all on function public.delete_assignment_artifact_for_member_v1(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_assignment_artifact_for_member_v1(uuid, uuid, uuid)
  to service_role;

comment on function public.prepare_assignment_artifact_for_member_v1(uuid, uuid, uuid) is
  'Dormant service-only artifact preflight with locked current membership, assignment visibility, requirement, and learner document.';
comment on function public.upsert_assignment_artifact_for_member_v1(
  uuid, uuid, uuid, text, text, text, jsonb, text, text, timestamptz, uuid,
  boolean, text, text, text
) is
  'Dormant service-only artifact attachment boundary with transaction-time membership and exact resource binding.';
comment on function public.delete_assignment_artifact_for_member_v1(uuid, uuid, uuid) is
  'Dormant service-only artifact deletion boundary with transaction-time membership and exact resource binding.';

commit;
