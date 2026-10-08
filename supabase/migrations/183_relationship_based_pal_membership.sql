-- A classroom relationship, not the account's legacy global role, determines
-- whether an active enrollment has membership-scoped Pal identity. This closes
-- the first-view signal gap for teacher-valued accounts that join another class.

begin;

create or replace function public.resolve_pal_membership(
  p_student_id uuid,
  p_classroom_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reference text;
begin
  if not coalesce((
    select settings.enabled
    from private.pal_membership_settings as settings
    where settings.singleton
  ), false) then
    return jsonb_build_object('status', 'disabled');
  end if;

  perform private.try_lock_classroom_membership_change(
    p_classroom_id,
    p_student_id
  );

  if exists (
    select 1
    from public.student_purge_fences as fence
    where fence.classroom_id = p_classroom_id
      and fence.student_id = p_student_id
  ) or exists (
    select 1
    from public.classroom_purge_fences as fence
    where fence.classroom_id = p_classroom_id
  ) or exists (
    select 1
    from public.cold_classroom_purge_fences as fence
    where fence.classroom_id = p_classroom_id
  ) or exists (
    select 1
    from public.classroom_roster as roster
    where roster.classroom_id = p_classroom_id
      and roster.removed_student_id = p_student_id
      and roster.removed_at is not null
  ) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select identity.pal_reference
  into v_reference
  from public.classroom_enrollments as enrollment
  join public.classrooms as classroom
    on classroom.id = enrollment.classroom_id
  join private.pal_membership_generations as identity
    on identity.generation_id = enrollment.id
    and identity.scope_digest = private.pal_membership_scope(
      enrollment.classroom_id,
      enrollment.student_id
    )
  where enrollment.classroom_id = p_classroom_id
    and enrollment.student_id = p_student_id
    and classroom.archived_at is null
    and identity.state = 'active';

  if v_reference is null then
    return jsonb_build_object('status', 'forbidden');
  end if;

  return jsonb_build_object(
    'status', 'active',
    'learner_id', v_reference
  );
end;
$function$;

revoke all on function public.resolve_pal_membership(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_pal_membership(uuid, uuid)
  to service_role;

comment on function public.resolve_pal_membership(uuid, uuid) is
  'Resolves Pal identity from an exact active classroom enrollment generation regardless of the account legacy role.';

commit;
