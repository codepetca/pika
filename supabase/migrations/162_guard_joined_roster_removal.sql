-- Keep lightweight roster removal invitation-only. Joined students must use the
-- comprehensive student purge so no classroom-scoped data is left behind.

alter function public.remove_classroom_roster_entries_atomic(uuid, uuid[])
  rename to remove_classroom_roster_entries_pre_v162;

alter function public.remove_classroom_roster_entries_pre_v162(uuid, uuid[])
  set schema private;

revoke all on function private.remove_classroom_roster_entries_pre_v162(uuid, uuid[])
  from public, anon, authenticated, service_role;

create function public.remove_classroom_roster_entries_atomic(
  p_classroom_id uuid,
  p_roster_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_ids uuid[] := array[]::uuid[];
begin
  -- The contextual join transaction takes this same lock before it creates an
  -- enrollment, making the joined-state decision atomic with roster removal.
  perform 1
  from public.classrooms as classroom
  where classroom.id = p_classroom_id
  for update;

  with requested as (
    select distinct roster_id
    from unnest(coalesce(p_roster_ids, array[]::uuid[])) as requested(roster_id)
  ),
  target_roster as materialized (
    select roster.id, roster.email
    from public.classroom_roster as roster
    join requested on requested.roster_id = roster.id
    where roster.classroom_id = p_classroom_id
    order by roster.id
    for update of roster
  )
  select coalesce(array_agg(coalesce(binding.student_id, student.id)) filter (
    where coalesce(binding.student_id, student.id) is not null
  ), array[]::uuid[])
  into v_student_ids
  from target_roster as roster
  left join public.classroom_roster_student_bindings as binding
    on binding.roster_id = roster.id
  left join public.users as student
    on lower(btrim(student.email)) = lower(btrim(roster.email))
    and student.role = 'student';

  if exists (
    select 1
    from public.classroom_enrollments as enrollment
    where enrollment.classroom_id = p_classroom_id
      and enrollment.student_id = any(v_student_ids)
  ) then
    raise exception using
      errcode = '55000',
      message = 'joined_students_require_comprehensive_removal';
  end if;

  return private.remove_classroom_roster_entries_pre_v162(
    p_classroom_id,
    p_roster_ids
  );
end;
$$;

revoke all on function public.remove_classroom_roster_entries_atomic(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.remove_classroom_roster_entries_atomic(uuid, uuid[])
  to service_role;

comment on function public.remove_classroom_roster_entries_atomic(uuid, uuid[]) is
  'Atomically removes invitation-only roster rows; joined students require comprehensive purge.';
