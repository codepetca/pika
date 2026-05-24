-- Atomically remove one or more classroom roster entries and classroom-scoped student data.

create or replace function public.remove_classroom_roster_entries_atomic(
  p_classroom_id uuid,
  p_roster_ids uuid[]
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_requested_count integer := 0;
  v_roster_count integer := 0;
  v_student_ids uuid[] := array[]::uuid[];
  v_assignment_ids uuid[] := array[]::uuid[];
  v_deleted_entries integer := 0;
  v_deleted_assignment_docs integer := 0;
  v_deleted_enrollments integer := 0;
  v_deleted_roster_entries integer := 0;
begin
  with requested as (
    select distinct roster_id
    from unnest(coalesce(p_roster_ids, array[]::uuid[])) as requested(roster_id)
  )
  select count(*) into v_requested_count
  from requested;

  if v_requested_count = 0 then
    return jsonb_build_object(
      'requested_count', 0,
      'deleted_roster_entries', 0,
      'deleted_entries', 0,
      'deleted_assignment_docs', 0,
      'deleted_enrollments', 0
    );
  end if;

  with requested as (
    select distinct roster_id
    from unnest(coalesce(p_roster_ids, array[]::uuid[])) as requested(roster_id)
  ),
  target_roster as materialized (
    select roster.id, lower(trim(roster.email)) as email
    from public.classroom_roster roster
    join requested on requested.roster_id = roster.id
    where roster.classroom_id = p_classroom_id
    for update of roster
  )
  select
    count(*),
    coalesce(array_agg(users.id) filter (where users.id is not null), array[]::uuid[])
  into v_roster_count, v_student_ids
  from target_roster
  left join public.users users
    on lower(trim(users.email)) = target_roster.email;

  if v_roster_count <> v_requested_count then
    raise exception 'One or more roster entries not found in classroom'
      using errcode = '22023';
  end if;

  if coalesce(array_length(v_student_ids, 1), 0) > 0 then
    with deleted_entries as (
      delete from public.entries
      where classroom_id = p_classroom_id
        and student_id = any(v_student_ids)
      returning id
    )
    select count(*) into v_deleted_entries
    from deleted_entries;

    select coalesce(array_agg(id), array[]::uuid[])
    into v_assignment_ids
    from public.assignments
    where classroom_id = p_classroom_id;

    if coalesce(array_length(v_assignment_ids, 1), 0) > 0 then
      with deleted_assignment_docs as (
        delete from public.assignment_docs
        where student_id = any(v_student_ids)
          and assignment_id = any(v_assignment_ids)
        returning id
      )
      select count(*) into v_deleted_assignment_docs
      from deleted_assignment_docs;
    end if;

    with deleted_enrollments as (
      delete from public.classroom_enrollments
      where classroom_id = p_classroom_id
        and student_id = any(v_student_ids)
      returning id
    )
    select count(*) into v_deleted_enrollments
    from deleted_enrollments;
  end if;

  with requested as (
    select distinct roster_id
    from unnest(coalesce(p_roster_ids, array[]::uuid[])) as requested(roster_id)
  ),
  deleted_roster as (
    delete from public.classroom_roster roster
    using requested
    where roster.classroom_id = p_classroom_id
      and roster.id = requested.roster_id
    returning roster.id
  )
  select count(*) into v_deleted_roster_entries
  from deleted_roster;

  return jsonb_build_object(
    'requested_count', v_requested_count,
    'deleted_roster_entries', v_deleted_roster_entries,
    'deleted_entries', v_deleted_entries,
    'deleted_assignment_docs', v_deleted_assignment_docs,
    'deleted_enrollments', v_deleted_enrollments
  );
end;
$$;

revoke all on function public.remove_classroom_roster_entries_atomic(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.remove_classroom_roster_entries_atomic(uuid, uuid[]) to service_role;
