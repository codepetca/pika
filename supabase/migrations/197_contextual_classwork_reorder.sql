-- Add dormant, service-only owner boundaries for the two existing classwork
-- reorder operations. Applying this migration changes no rows and activates no
-- route; exact user/Classroom API admission remains independently disabled.

begin;

create function private.lock_classwork_reorder_context_v1(
  p_actor_id uuid,
  p_classroom_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_archived_at timestamptz;
  v_owner_id uuid;
begin
  if p_actor_id is null or p_classroom_id is null then
    raise exception using errcode = '22023', message = 'Invalid classwork reorder request';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || p_classroom_id::text, 0)
  );

  select classroom.teacher_id, classroom.archived_at
  into v_owner_id, v_archived_at
  from public.classrooms as classroom
  where classroom.id = p_classroom_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Classroom not found';
  end if;
  if v_owner_id is distinct from p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;
  if v_archived_at is not null then
    raise exception using errcode = '55000', message = 'classwork_reorder_archived';
  end if;
end;
$function$;

revoke all on function private.lock_classwork_reorder_context_v1(uuid, uuid)
from public, anon, authenticated, service_role;

create function public.reorder_assignments_for_owner_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_assignment_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.lock_classwork_reorder_context_v1(p_actor_id, p_classroom_id);
  perform public.reorder_assignments_preserve_materials(p_classroom_id, p_assignment_ids);

  return jsonb_build_object(
    'ok', true,
    'actor_id', p_actor_id,
    'classroom_id', p_classroom_id
  );
end;
$function$;

create function public.reorder_classwork_items_for_owner_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.lock_classwork_reorder_context_v1(p_actor_id, p_classroom_id);
  perform public.reorder_classwork_items(p_classroom_id, p_items);

  return jsonb_build_object(
    'ok', true,
    'actor_id', p_actor_id,
    'classroom_id', p_classroom_id
  );
end;
$function$;

revoke all on function public.reorder_assignments_for_owner_v1(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.reorder_assignments_for_owner_v1(uuid, uuid, jsonb)
to service_role;

revoke all on function public.reorder_classwork_items_for_owner_v1(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.reorder_classwork_items_for_owner_v1(uuid, uuid, jsonb)
to service_role;

commit;
