-- Retry-safe ordinary classroom creation.
--
-- The browser supplies one operation UUID for an unchanged create request. The
-- service-only RPC serializes that operation with the entitlement subject lock,
-- stores the created classroom, and replays the same result after a lost HTTP
-- response. Server-derived class codes, colors, and positions are deliberately
-- outside the request fingerprint so they can be regenerated before replay.

create table public.classroom_creation_operations (
  operation_id uuid primary key,
  subject_user_id uuid not null references public.users (id) on delete cascade,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  classroom_id uuid references public.classrooms (id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz not null default clock_timestamp()
);

create index classroom_creation_operations_subject_created
  on public.classroom_creation_operations (subject_user_id, created_at desc);

alter table public.classroom_creation_operations enable row level security;

revoke all on table public.classroom_creation_operations
  from public, anon, authenticated, service_role;
grant select on table public.classroom_creation_operations to service_role;

create function public.create_classroom_atomic_v1(
  p_operation_id uuid,
  p_subject_user_id uuid,
  p_request_sha256 text,
  p_title text,
  p_class_code text,
  p_term_label text,
  p_theme_color text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.classroom_creation_operations%rowtype;
  v_classroom public.classrooms%rowtype;
  v_position integer;
begin
  if p_operation_id is null
    or p_subject_user_id is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[a-f0-9]{64}$'
    or p_title is null
    or length(p_title) < 1
    or p_class_code is null
    or length(p_class_code) < 1
    or p_theme_color is null
  then
    raise exception using
      errcode = '22023',
      message = 'classroom_creation_request_invalid';
  end if;

  -- Keep the lock order consistent with Blueprint materialization and direct
  -- classroom writes: entitlement subject first, then operation identifier.
  perform public.lock_effective_feature_entitlement_v1(
    p_subject_user_id,
    'classrooms.create'
  );
  perform pg_advisory_xact_lock(
    hashtextextended(
      'classroom-creation-operation:' || p_operation_id::text,
      16720260912
    )
  );

  select * into v_operation
  from public.classroom_creation_operations
  where operation_id = p_operation_id;

  if v_operation.operation_id is not null then
    if v_operation.subject_user_id <> p_subject_user_id
      or v_operation.request_sha256 <> p_request_sha256
    then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', 'classroom_creation_idempotency_conflict',
        'error', 'Idempotency key was already used for a different classroom request',
        'retryable', false
      );
    end if;

    if v_operation.classroom_id is null then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', 'classroom_creation_result_unavailable',
        'error', 'The original classroom creation result is no longer available',
        'retryable', false
      );
    end if;

    select * into v_classroom
    from public.classrooms
    where id = v_operation.classroom_id
      and teacher_id = p_subject_user_id;

    if v_classroom.id is null then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', 'classroom_creation_result_unavailable',
        'error', 'The original classroom creation result is no longer available',
        'retryable', false
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'status', 201,
      'operation_id', p_operation_id,
      'replayed', true,
      'classroom', to_jsonb(v_classroom)
    );
  end if;

  -- This reuses the already-held transaction-scoped lock and applies the live
  -- entitlement state and active-classroom count immediately before insertion.
  perform public.assert_classroom_creation_allowed_v1(
    p_subject_user_id,
    null,
    clock_timestamp()
  );

  select coalesce(min(position), 1) - 1 into v_position
  from public.classrooms
  where teacher_id = p_subject_user_id
    and archived_at is null;

  insert into public.classrooms (
    teacher_id,
    title,
    class_code,
    term_label,
    theme_color,
    position
  ) values (
    p_subject_user_id,
    p_title,
    p_class_code,
    p_term_label,
    p_theme_color,
    v_position
  )
  returning * into v_classroom;

  insert into public.classroom_creation_operations (
    operation_id,
    subject_user_id,
    request_sha256,
    classroom_id
  ) values (
    p_operation_id,
    p_subject_user_id,
    p_request_sha256,
    v_classroom.id
  );

  return jsonb_build_object(
    'ok', true,
    'status', 201,
    'operation_id', p_operation_id,
    'replayed', false,
    'classroom', to_jsonb(v_classroom)
  );
end;
$$;

revoke all on function public.create_classroom_atomic_v1(
  uuid, uuid, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_classroom_atomic_v1(
  uuid, uuid, text, text, text, text, text
) to service_role;
