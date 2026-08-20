begin;

create or replace function public.begin_classroom_archive_export_v2_expected_revision(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_request_sha256 text,
  p_source_schema_migration text,
  p_source_app_commit text,
  p_retention jsonb,
  p_source_contract_version integer,
  p_archive_format_version integer,
  p_expected_source_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_id uuid;
  v_archived_at timestamptz;
  v_revision bigint;
begin
  if p_expected_source_revision is null or p_expected_source_revision < 0 then
    raise exception 'Invalid expected classroom archive source revision'
      using errcode = '22023';
  end if;

  select classroom.teacher_id, classroom.archived_at, revision.revision
  into v_teacher_id, v_archived_at, v_revision
  from public.classrooms classroom
  join public.classroom_archive_revisions revision
    on revision.classroom_id = classroom.id
  where classroom.id = p_classroom_id
  for share of classroom, revision;

  if v_teacher_id is null then
    return jsonb_build_object(
      'ok', false,
      'status', 404,
      'operation_id', p_operation_id,
      'error_code', 'classroom_not_found',
      'error', 'Classroom not found',
      'retryable', false
    );
  end if;
  if v_teacher_id <> p_teacher_id then
    return jsonb_build_object(
      'ok', false,
      'status', 403,
      'operation_id', p_operation_id,
      'error_code', 'classroom_forbidden',
      'error', 'Forbidden',
      'retryable', false
    );
  end if;
  if v_archived_at is null then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'classroom_not_archived',
      'error', 'Classroom must be archived before export',
      'retryable', false
    );
  end if;
  if v_revision <> p_expected_source_revision then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'classroom_archive_source_revision_changed',
      'error', 'Classroom archive status changed; refresh before creating a recovery copy',
      'retryable', false
    );
  end if;

  return public.begin_classroom_archive_export_v2(
    p_operation_id,
    p_teacher_id,
    p_classroom_id,
    p_request_sha256,
    p_source_schema_migration,
    p_source_app_commit,
    p_retention,
    p_source_contract_version,
    p_archive_format_version
  );
end;
$$;

revoke all on function public.begin_classroom_archive_export_v2_expected_revision(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  integer,
  integer,
  bigint
) from public, anon, authenticated;
grant execute on function public.begin_classroom_archive_export_v2_expected_revision(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  integer,
  integer,
  bigint
) to service_role;

comment on function public.begin_classroom_archive_export_v2_expected_revision(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  integer,
  integer,
  bigint
) is
  'Begins a classroom archive export only while the teacher-owned archived source remains at the revision shown to the caller.';

commit;
