-- Prevent a request for Classroom A from locking an Assignment that is bound
-- to Classroom B. Keep migration 198's batch implementation private and place
-- a tenant-scoped authorization and lock wrapper at the public RPC boundary.

begin;

alter function public.save_assignments_bulk_for_owner_v1(uuid, uuid, jsonb)
set schema private;
alter function private.save_assignments_bulk_for_owner_v1(uuid, uuid, jsonb)
rename to save_assignments_bulk_unscoped_v1;

revoke all on function private.save_assignments_bulk_unscoped_v1(uuid, uuid, jsonb)
from public, anon, authenticated, service_role;

create function public.save_assignments_bulk_for_owner_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_assignments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_archived_at timestamptz;
  v_assignment_id uuid;
  v_existing_ids uuid[] := array[]::uuid[];
  v_errors jsonb;
  v_owner_id uuid;
begin
  -- Let the established implementation preserve its exact invalid-input
  -- errors. It validates and rejects these shapes before acquiring locks.
  if p_actor_id is null
    or p_classroom_id is null
    or p_assignments is null
    or jsonb_typeof(p_assignments) <> 'array'
    or jsonb_array_length(p_assignments) > 50
  then
    return private.save_assignments_bulk_unscoped_v1(
      p_actor_id,
      p_classroom_id,
      p_assignments
    );
  end if;

  begin
    select coalesce(array_agg(distinct requested.assignment_id order by requested.assignment_id), array[]::uuid[])
    into v_existing_ids
    from (
      select (item.value->>'id')::uuid as assignment_id
      from jsonb_array_elements(p_assignments) as item(value)
      where item.value ? 'id'
        and item.value->'id' <> 'null'::jsonb
    ) as requested;
  exception when invalid_text_representation then
    return private.save_assignments_bulk_unscoped_v1(
      p_actor_id,
      p_classroom_id,
      p_assignments
    );
  end;

  -- This first read is deliberately unlocked. It prevents stale exact-pair
  -- configuration from receiving Assignment-existence evidence. Authority is
  -- rechecked under the shared Classroom fence below before any write.
  select classroom.teacher_id, classroom.archived_at
  into v_owner_id, v_archived_at
  from public.classrooms as classroom
  where classroom.id = p_classroom_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Classroom not found';
  end if;
  if v_owner_id is distinct from p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;
  if v_archived_at is not null then
    raise exception using errcode = '55000', message = 'assignment_bulk_archived';
  end if;

  -- Reject missing or foreign IDs before acquiring any request-supplied
  -- Assignment namespace. Preserve duplicate errors and input ordering.
  select jsonb_agg(
    to_jsonb(format('Assignment ID not found: %s', item.value->>'id'))
    order by item.ordinality
  )
  into v_errors
  from jsonb_array_elements(p_assignments) with ordinality as item(value, ordinality)
  where item.value ? 'id'
    and item.value->'id' <> 'null'::jsonb
    and not exists (
      select 1
      from public.assignments as assignment
      where assignment.id = (item.value->>'id')::uuid
        and assignment.classroom_id = p_classroom_id
    );

  if v_errors is not null then
    return jsonb_build_object('ok', false, 'status', 400, 'errors', v_errors);
  end if;

  foreach v_assignment_id in array v_existing_ids loop
    perform pg_advisory_xact_lock(
      hashtextextended('assignment_submission:' || v_assignment_id::text, 0)
    );
  end loop;

  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || p_classroom_id::text, 0)
  );

  select classroom.teacher_id, classroom.archived_at
  into v_owner_id, v_archived_at
  from public.classrooms as classroom
  where classroom.id = p_classroom_id
  for update;

  if not found then
    raise exception using errcode = '40001', message = 'Classroom binding changed';
  end if;
  if v_owner_id is distinct from p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;
  if v_archived_at is not null then
    raise exception using errcode = '55000', message = 'assignment_bulk_archived';
  end if;

  -- The Classroom predicate is part of the locking query, so a row that moved
  -- after preflight is not locked in its new tenant. Recheck the full binding
  -- before entering migration 198's implementation.
  perform 1
  from public.assignments as assignment
  where assignment.id = any(v_existing_ids)
    and assignment.classroom_id = p_classroom_id
  order by assignment.id
  for update;

  select jsonb_agg(
    to_jsonb(format('Assignment ID not found: %s', item.value->>'id'))
    order by item.ordinality
  )
  into v_errors
  from jsonb_array_elements(p_assignments) with ordinality as item(value, ordinality)
  where item.value ? 'id'
    and item.value->'id' <> 'null'::jsonb
    and not exists (
      select 1
      from public.assignments as assignment
      where assignment.id = (item.value->>'id')::uuid
        and assignment.classroom_id = p_classroom_id
    );

  if v_errors is not null then
    return jsonb_build_object('ok', false, 'status', 400, 'errors', v_errors);
  end if;

  return private.save_assignments_bulk_unscoped_v1(
    p_actor_id,
    p_classroom_id,
    p_assignments
  );
end;
$function$;

revoke all on function public.save_assignments_bulk_for_owner_v1(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.save_assignments_bulk_for_owner_v1(uuid, uuid, jsonb)
to service_role;

comment on function private.save_assignments_bulk_unscoped_v1(uuid, uuid, jsonb) is
  'Migration 198 implementation; callable only through the tenant-scoped public wrapper.';
comment on function public.save_assignments_bulk_for_owner_v1(uuid, uuid, jsonb) is
  'Preflights tenant scope, locks only bound Assignments, and delegates the atomic markdown Assignment batch.';

commit;
