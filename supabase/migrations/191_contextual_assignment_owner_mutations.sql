-- Add dormant, service-only transactional boundaries for existing-assignment
-- owner mutations. Applying this migration changes no rows and activates no
-- route; exact user/assignment API admission remains independently disabled.

begin;

create function private.lock_assignment_owner_mutation_context_v1(
  p_actor_id uuid,
  p_assignment_id uuid
)
returns public.assignments
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_initial_classroom_id uuid;
  v_assignment public.assignments%rowtype;
  v_archived_at timestamptz;
  v_owner_id uuid;
begin
  if p_actor_id is null or p_assignment_id is null then
    raise exception using errcode = '22023', message = 'Invalid assignment owner mutation request';
  end if;

  -- Match requirement, learner save, submit, restore, and artifact mutations
  -- before taking the broader Classroom operation fence.
  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || p_assignment_id::text, 0)
  );

  -- This unlocked read discovers only the advisory-lock namespace. The
  -- assignment/Classroom binding is read again under row locks below.
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

  select assignment.*
  into v_assignment
  from public.assignments as assignment
  join public.classrooms as classroom on classroom.id = assignment.classroom_id
  where assignment.id = p_assignment_id
  for update of classroom, assignment;

  if not found
    or v_assignment.classroom_id is distinct from v_initial_classroom_id
  then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;

  select classroom.teacher_id, classroom.archived_at
  into v_owner_id, v_archived_at
  from public.classrooms as classroom
  where classroom.id = v_assignment.classroom_id;

  if not found then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;
  if v_owner_id is distinct from p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;
  if v_archived_at is not null or v_assignment.blueprint_archived_at is not null then
    raise exception using errcode = '55000', message = 'Classroom is archived';
  end if;

  return v_assignment;
end;
$function$;

create function public.update_assignment_for_owner_v1(
  p_actor_id uuid,
  p_assignment_id uuid,
  p_updates jsonb,
  p_requirements jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_assignment public.assignments%rowtype;
  v_effective_due_at timestamptz;
  v_effective_is_draft boolean;
  v_effective_released_at timestamptz;
  v_existing_live boolean;
  v_now timestamptz;
  v_requirements jsonb;
  v_result jsonb;
begin
  if p_updates is null
    or jsonb_typeof(p_updates) <> 'object'
    or (p_requirements is not null and jsonb_typeof(p_requirements) <> 'array')
    or exists (
      select 1
      from jsonb_object_keys(p_updates) as key(name)
      where key.name <> all (array[
        'title', 'instructions_markdown', 'description', 'rich_instructions',
        'due_at', 'is_draft', 'released_at'
      ]::text[])
    )
  then
    raise exception using errcode = '22023', message = 'Invalid assignment owner update request';
  end if;

  v_assignment := private.lock_assignment_owner_mutation_context_v1(
    p_actor_id,
    p_assignment_id
  );
  v_now := clock_timestamp();

  v_existing_live := not v_assignment.is_draft
    and (v_assignment.released_at is null or v_assignment.released_at <= v_now);

  if v_existing_live
    and p_updates ? 'is_draft'
    and (p_updates->>'is_draft')::boolean
  then
    return jsonb_build_object(
      'ok', false, 'status', 400, 'error_code', 'assignment_already_live',
      'error', 'Cannot revert an already released assignment to draft'
    );
  end if;
  if v_existing_live and p_updates ? 'released_at' then
    return jsonb_build_object(
      'ok', false, 'status', 400, 'error_code', 'assignment_already_live',
      'error', 'Cannot reschedule an already released assignment'
    );
  end if;

  v_effective_due_at := case
    when p_updates ? 'due_at' then (p_updates->>'due_at')::timestamptz
    else v_assignment.due_at
  end;
  v_effective_is_draft := case
    when p_updates ? 'is_draft' then (p_updates->>'is_draft')::boolean
    else v_assignment.is_draft
  end;
  v_effective_released_at := case
    when not (p_updates ? 'released_at') then v_assignment.released_at
    when p_updates->'released_at' = 'null'::jsonb then null
    else (p_updates->>'released_at')::timestamptz
  end;

  if not v_effective_is_draft
    and v_effective_released_at > v_now
    and v_effective_due_at < v_effective_released_at
  then
    return jsonb_build_object(
      'ok', false, 'status', 400, 'error_code', 'assignment_release_after_due',
      'error', 'Scheduled release must be on or before the due date.'
    );
  end if;

  if p_requirements is not null then
    v_result := public.update_assignment_with_submission_requirements_atomic(
      p_assignment_id,
      p_updates,
      p_requirements
    );
    return v_result;
  end if;

  update public.assignments
  set title = case when p_updates ? 'title' then p_updates->>'title' else title end,
    instructions_markdown = case
      when p_updates ? 'instructions_markdown' then p_updates->>'instructions_markdown'
      else instructions_markdown
    end,
    description = case
      when p_updates ? 'description' then p_updates->>'description'
      else description
    end,
    rich_instructions = case
      when p_updates ? 'rich_instructions' then p_updates->'rich_instructions'
      else rich_instructions
    end,
    due_at = case
      when p_updates ? 'due_at' then (p_updates->>'due_at')::timestamptz
      else due_at
    end,
    is_draft = case
      when p_updates ? 'is_draft' then (p_updates->>'is_draft')::boolean
      else is_draft
    end,
    released_at = case
      when not (p_updates ? 'released_at') then released_at
      when p_updates->'released_at' = 'null'::jsonb then null
      else (p_updates->>'released_at')::timestamptz
    end
  where id = p_assignment_id
  returning * into v_assignment;

  select coalesce(
    jsonb_agg(to_jsonb(requirement) order by requirement.position, requirement.created_at, requirement.id),
    '[]'::jsonb
  )
  into v_requirements
  from public.assignment_submission_requirements as requirement
  where requirement.assignment_id = p_assignment_id;

  return jsonb_build_object(
    'ok', true,
    'assignment', to_jsonb(v_assignment),
    'submission_requirements', v_requirements
  );
end;
$function$;

create function public.release_assignment_for_owner_v1(
  p_actor_id uuid,
  p_assignment_id uuid,
  p_released_at timestamptz,
  p_scheduled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_assignment public.assignments%rowtype;
  v_now timestamptz;
begin
  if p_released_at is null or p_scheduled is null then
    raise exception using errcode = '22023', message = 'Invalid assignment release request';
  end if;

  v_assignment := private.lock_assignment_owner_mutation_context_v1(
    p_actor_id,
    p_assignment_id
  );
  v_now := clock_timestamp();

  if not v_assignment.is_draft then
    return jsonb_build_object(
      'ok', false, 'status', 400, 'error_code', 'assignment_already_released',
      'error', 'Assignment is already released'
    );
  end if;
  if p_scheduled and p_released_at <= v_now then
    return jsonb_build_object(
      'ok', false, 'status', 400, 'error_code', 'assignment_release_not_future',
      'error', 'Release date must be in the future'
    );
  end if;
  if p_scheduled and v_assignment.due_at < p_released_at then
    return jsonb_build_object(
      'ok', false, 'status', 400, 'error_code', 'assignment_release_after_due',
      'error', 'Scheduled release must be on or before the due date.'
    );
  end if;

  update public.assignments
  set is_draft = false,
    released_at = p_released_at
  where id = p_assignment_id
  returning * into v_assignment;

  return jsonb_build_object('ok', true, 'assignment', to_jsonb(v_assignment));
end;
$function$;

create function public.delete_assignment_for_owner_v1(
  p_actor_id uuid,
  p_assignment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_assignment public.assignments%rowtype;
begin
  v_assignment := private.lock_assignment_owner_mutation_context_v1(
    p_actor_id,
    p_assignment_id
  );

  delete from public.assignments
  where id = p_assignment_id;

  return jsonb_build_object(
    'ok', true,
    'classroom_id', v_assignment.classroom_id,
    'deleted', true
  );
end;
$function$;

create function public.discard_pristine_assignment_draft_for_owner_v1(
  p_actor_id uuid,
  p_assignment_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'Invalid assignment discard request';
  end if;

  perform private.lock_assignment_owner_mutation_context_v1(
    p_actor_id,
    p_assignment_id
  );

  return public.discard_pristine_assignment_draft_atomic(
    p_assignment_id,
    p_actor_id,
    p_expected_updated_at
  );
end;
$function$;

revoke all on function private.lock_assignment_owner_mutation_context_v1(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.update_assignment_for_owner_v1(uuid, uuid, jsonb, jsonb)
from public, anon, authenticated;
revoke all on function public.release_assignment_for_owner_v1(uuid, uuid, timestamptz, boolean)
from public, anon, authenticated;
revoke all on function public.delete_assignment_for_owner_v1(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.discard_pristine_assignment_draft_for_owner_v1(uuid, uuid, timestamptz)
from public, anon, authenticated;

grant execute on function public.update_assignment_for_owner_v1(uuid, uuid, jsonb, jsonb)
to service_role;
grant execute on function public.release_assignment_for_owner_v1(uuid, uuid, timestamptz, boolean)
to service_role;
grant execute on function public.delete_assignment_for_owner_v1(uuid, uuid)
to service_role;
grant execute on function public.discard_pristine_assignment_draft_for_owner_v1(uuid, uuid, timestamptz)
to service_role;

comment on function private.lock_assignment_owner_mutation_context_v1(uuid, uuid) is
  'Locks an active Assignment and Classroom and authorizes the exact current owner.';
comment on function public.update_assignment_for_owner_v1(uuid, uuid, jsonb, jsonb) is
  'Atomically authorizes the current Classroom owner and updates an existing Assignment.';
comment on function public.release_assignment_for_owner_v1(uuid, uuid, timestamptz, boolean) is
  'Atomically authorizes the current Classroom owner and releases an Assignment.';
comment on function public.delete_assignment_for_owner_v1(uuid, uuid) is
  'Atomically authorizes the current Classroom owner and deletes an Assignment.';
comment on function public.discard_pristine_assignment_draft_for_owner_v1(uuid, uuid, timestamptz) is
  'Atomically authorizes the current Classroom owner before discarding an untouched Assignment draft.';

commit;
