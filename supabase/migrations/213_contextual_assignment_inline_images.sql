-- Dormant service-only authorization for Assignment inline images. This is
-- intentionally independent from the classroom-core and artifact gates. It
-- changes no durable product rows until an explicitly matched route invokes a
-- function below; route admission remains disabled by default.

begin;

create function private.lock_assignment_inline_image_member_context_v1(
  p_actor_id uuid,
  p_assignment_doc_id uuid
)
returns table (
  classroom_id uuid,
  assignment_id uuid,
  assignment_doc_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_initial_assignment_id uuid;
  v_initial_classroom_id uuid;
  v_assignment_classroom_id uuid;
  v_assignment_is_draft boolean;
  v_assignment_released_at timestamptz;
  v_teacher_id uuid;
  v_archived_at timestamptz;
  v_doc public.assignment_docs%rowtype;
begin
  if p_actor_id is null or p_assignment_doc_id is null then
    raise exception using errcode = '22023', message = 'Invalid assignment image request';
  end if;

  -- This read establishes only advisory-lock namespaces. All identity and
  -- lifecycle evidence is re-read under the shared submission/editor,
  -- classroom-operation, and membership fences below.
  select document.assignment_id, assignment.classroom_id
  into v_initial_assignment_id, v_initial_classroom_id
  from public.assignment_docs as document
  join public.assignments as assignment on assignment.id = document.assignment_id
  where document.id = p_assignment_doc_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Assignment document not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || v_initial_assignment_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(v_initial_assignment_id::text || ':' || p_actor_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || v_initial_classroom_id::text, 0)
  );
  perform private.try_lock_classroom_membership_change(v_initial_classroom_id, p_actor_id);

  select
    assignment.classroom_id,
    assignment.is_draft,
    assignment.released_at,
    classroom.teacher_id,
    classroom.archived_at
  into
    v_assignment_classroom_id,
    v_assignment_is_draft,
    v_assignment_released_at,
    v_teacher_id,
    v_archived_at
  from public.assignments as assignment
  join public.classrooms as classroom on classroom.id = assignment.classroom_id
  where assignment.id = v_initial_assignment_id
  for update of classroom, assignment;

  if not found or v_assignment_classroom_id is distinct from v_initial_classroom_id then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;

  -- Classroom ownership takes precedence over historical self-enrollment.
  -- Owners inspect through the read boundary only; they never upload as a
  -- member to their own Classroom.
  if v_teacher_id = p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
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

  select document.* into v_doc
  from public.assignment_docs as document
  where document.id = p_assignment_doc_id
    and document.assignment_id = v_initial_assignment_id
    and document.student_id = p_actor_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;

  if v_doc.is_submitted then
    return query select
      v_assignment_classroom_id, v_initial_assignment_id, v_doc.id;
    return;
  end if;

  return query select v_assignment_classroom_id, v_initial_assignment_id, v_doc.id;
end;
$function$;

revoke all on function private.lock_assignment_inline_image_member_context_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.reserve_assignment_inline_image_for_member_v1(
  p_actor_id uuid,
  p_expected_classroom_id uuid,
  p_assignment_doc_id uuid,
  p_object_id uuid,
  p_extension text,
  p_content_type text,
  p_byte_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_object public.managed_storage_objects%rowtype;
  v_path text;
begin
  if p_expected_classroom_id is null or p_object_id is null
    or p_extension !~ '^[a-z0-9]{1,10}$'
    or p_content_type not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')
    or p_byte_size is null or p_byte_size <= 0 or p_byte_size > 10485760
  then
    raise exception using errcode = '22023', message = 'Invalid assignment image request';
  end if;

  -- Managed Storage writers must acquire their protocol settings fence before
  -- the Assignment lifecycle/member fences; begin_managed_storage_upload
  -- repeats that shared lock while creating the exact immutable reservation.
  perform public.lock_managed_storage_protocol();
  select * into strict v_context
  from private.lock_assignment_inline_image_member_context_v1(p_actor_id, p_assignment_doc_id);
  if v_context.classroom_id is distinct from p_expected_classroom_id then
    raise exception using errcode = '40001', message = 'Assignment classroom changed';
  end if;
  if exists (
    select 1 from public.assignment_docs as document
    where document.id = v_context.assignment_doc_id and document.is_submitted
  ) then
    return jsonb_build_object('ok', false, 'status', 409,
      'error', 'Cannot edit a submitted document');
  end if;

  v_path := format(
    'classrooms/%s/students/%s/assignment-docs/%s/%s.%s',
    v_context.classroom_id, p_actor_id, v_context.assignment_doc_id, p_object_id, p_extension
  );
  -- Reservation is deliberately inside the authorization transaction. A
  -- separate preflight cannot fence membership removal or document submission.
  select * into v_object from public.begin_managed_storage_upload(
    p_object_id,
    'submission-images',
    v_path,
    v_context.classroom_id,
    null,
    null,
    'student_inline_image',
    p_actor_id,
    p_actor_id,
    'assignment_doc',
    v_context.assignment_doc_id,
    p_content_type,
    p_byte_size
  );

  if v_object.id is distinct from p_object_id
    or v_object.storage_bucket <> 'submission-images'
    or v_object.storage_path <> v_path
    or v_object.classroom_id is distinct from v_context.classroom_id
    or v_object.created_by_user_id is distinct from p_actor_id
    or v_object.data_subject_user_id is distinct from p_actor_id
    or v_object.resource_type <> 'assignment_doc'
    or v_object.resource_id is distinct from v_context.assignment_doc_id
    or v_object.status not in ('reserved', 'verified', 'ready')
  then
    raise exception using errcode = '55000', message = 'Invalid assignment image reservation';
  end if;

  return jsonb_build_object(
    'ok', true,
    'classroom_id', v_context.classroom_id,
    'assignment_id', v_context.assignment_id,
    'assignment_doc_id', v_context.assignment_doc_id,
    'managed_object_id', v_object.id
  );
end;
$function$;

create function public.finalize_assignment_inline_image_for_member_v1(
  p_actor_id uuid,
  p_expected_classroom_id uuid,
  p_assignment_doc_id uuid,
  p_managed_object_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_object public.managed_storage_objects%rowtype;
begin
  if p_expected_classroom_id is null or p_managed_object_id is null then
    raise exception using errcode = '22023', message = 'Invalid assignment image request';
  end if;

  -- Keep the managed Storage protocol fence ahead of the document/member
  -- locks. verify_managed_storage_upload repeats it before object locking.
  perform public.lock_managed_storage_protocol();
  select * into strict v_context
  from private.lock_assignment_inline_image_member_context_v1(p_actor_id, p_assignment_doc_id);
  if v_context.classroom_id is distinct from p_expected_classroom_id then
    raise exception using errcode = '40001', message = 'Assignment classroom changed';
  end if;
  if exists (
    select 1 from public.assignment_docs as document
    where document.id = v_context.assignment_doc_id and document.is_submitted
  ) then
    return jsonb_build_object('ok', false, 'status', 409,
      'error', 'Cannot edit a submitted document');
  end if;

  select * into v_object from public.managed_storage_objects as object
  where object.id = p_managed_object_id
  for update;
  if not found
    or v_object.storage_bucket <> 'submission-images'
    or v_object.purpose <> 'student_inline_image'
    or v_object.classroom_id is distinct from v_context.classroom_id
    or v_object.created_by_user_id is distinct from p_actor_id
    or v_object.data_subject_user_id is distinct from p_actor_id
    or v_object.resource_type <> 'assignment_doc'
    or v_object.resource_id is distinct from v_context.assignment_doc_id
    or v_object.status not in ('reserved', 'verified')
  then
    raise exception using errcode = 'P0002', message = 'Image upload not found';
  end if;

  -- This storage transition is inside the same membership/document fence.
  select * into v_object from public.verify_managed_storage_upload(p_managed_object_id);
  if v_object.status not in ('verified', 'ready') then
    raise exception using errcode = '55000', message = 'Invalid assignment image finalization';
  end if;

  return jsonb_build_object(
    'ok', true,
    'classroom_id', v_context.classroom_id,
    'assignment_id', v_context.assignment_id,
    'assignment_doc_id', v_context.assignment_doc_id,
    'managed_object_id', v_object.id
  );
end;
$function$;

create function public.read_assignment_inline_image_for_context_v1(
  p_actor_id uuid,
  p_expected_classroom_id uuid,
  p_assignment_doc_id uuid,
  p_managed_object_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_initial_assignment_id uuid;
  v_initial_classroom_id uuid;
  v_subject_id uuid;
  v_assignment_classroom_id uuid;
  v_teacher_id uuid;
  v_assignment_is_draft boolean;
  v_assignment_released_at timestamptz;
  v_archived_at timestamptz;
  v_is_owner boolean;
  v_current_assignment_id uuid;
  v_current_subject_id uuid;
  v_object public.managed_storage_objects%rowtype;
begin
  if p_actor_id is null or p_expected_classroom_id is null or p_assignment_doc_id is null or p_managed_object_id is null then
    raise exception using errcode = '22023', message = 'Invalid assignment image request';
  end if;

  select document.assignment_id, assignment.classroom_id, document.student_id
  into v_initial_assignment_id, v_initial_classroom_id, v_subject_id
  from public.assignment_docs as document
  join public.assignments as assignment on assignment.id = document.assignment_id
  where document.id = p_assignment_doc_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Assignment document not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || v_initial_assignment_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(v_initial_assignment_id::text || ':' || v_subject_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || v_initial_classroom_id::text, 0)
  );
  perform private.try_lock_classroom_membership_change(v_initial_classroom_id, v_subject_id);

  select assignment.classroom_id, classroom.teacher_id, assignment.is_draft,
    assignment.released_at, classroom.archived_at
  into v_assignment_classroom_id, v_teacher_id, v_assignment_is_draft,
    v_assignment_released_at, v_archived_at
  from public.assignments as assignment
  join public.classrooms as classroom on classroom.id = assignment.classroom_id
  where assignment.id = v_initial_assignment_id
  for share of classroom, assignment;
  if not found or v_assignment_classroom_id is distinct from v_initial_classroom_id then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;
  if v_assignment_classroom_id is distinct from p_expected_classroom_id then
    raise exception using errcode = '40001', message = 'Assignment classroom changed';
  end if;

  select document.assignment_id, document.student_id
  into v_current_assignment_id, v_current_subject_id
  from public.assignment_docs as document
  where document.id = p_assignment_doc_id
  for share;
  if not found
    or v_current_assignment_id is distinct from v_initial_assignment_id
    or v_current_subject_id is distinct from v_subject_id
  then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'Image not found');
  end if;

  v_is_owner := v_teacher_id = p_actor_id;
  if not v_is_owner then
    if p_actor_id is distinct from v_subject_id
      or v_archived_at is not null
      or v_assignment_is_draft
      or v_assignment_released_at > clock_timestamp()
    then
      return jsonb_build_object('ok', false, 'status', 404, 'error', 'Image not found');
    end if;
  end if;

  -- Owners retain the canonical history/detail behaviour: their inspected
  -- subject must still be enrolled, even for archived Classrooms.
  perform 1 from public.classroom_enrollments as enrollment
  where enrollment.classroom_id = v_assignment_classroom_id
    and enrollment.student_id = v_subject_id
  for share;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'Image not found');
  end if;

  select * into v_object from public.managed_storage_objects as object
  where object.id = p_managed_object_id
  for share;
  if not found
    or v_object.storage_bucket <> 'submission-images'
    or v_object.purpose <> 'student_inline_image'
    or v_object.classroom_id is distinct from v_assignment_classroom_id
    or v_object.created_by_user_id is distinct from v_subject_id
    or v_object.data_subject_user_id is distinct from v_subject_id
    or v_object.resource_type <> 'assignment_doc'
    or v_object.resource_id is distinct from p_assignment_doc_id
    or (v_is_owner and v_object.status <> 'ready')
    or (not v_is_owner and (
      v_object.created_by_user_id is distinct from p_actor_id
      or v_object.status not in ('verified', 'ready')
    ))
  then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'Image not found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'classroom_id', v_assignment_classroom_id,
    'assignment_id', v_initial_assignment_id,
    'assignment_doc_id', p_assignment_doc_id,
    'managed_object_id', p_managed_object_id
  );
end;
$function$;

revoke all on function public.reserve_assignment_inline_image_for_member_v1(uuid, uuid, uuid, uuid, text, text, bigint),
  public.finalize_assignment_inline_image_for_member_v1(uuid, uuid, uuid, uuid),
  public.read_assignment_inline_image_for_context_v1(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_assignment_inline_image_for_member_v1(uuid, uuid, uuid, uuid, text, text, bigint),
  public.finalize_assignment_inline_image_for_member_v1(uuid, uuid, uuid, uuid),
  public.read_assignment_inline_image_for_context_v1(uuid, uuid, uuid, uuid)
  to service_role;

commit;
