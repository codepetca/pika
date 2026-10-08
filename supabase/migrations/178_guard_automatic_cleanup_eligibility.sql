-- Enqueue only removals whose exact membership generation was captured for
-- provider cleanup after activation. Historical and partially provisioned
-- memberships remain removable, but they never enter the automatic queue.
begin;
set local lock_timeout = '5s';

create or replace function private.enqueue_removed_student_cleanup()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_settings private.student_provider_cleanup_settings;
  v_teacher_id uuid;
  v_scope text;
begin
  if old.removed_at is not null or new.removed_at is null
    or new.removed_student_id is null or new.removed_enrollment_id is null then
    return new;
  end if;

  select teacher_id into v_teacher_id
  from public.classrooms
  where id=new.classroom_id;
  if v_teacher_id is null then return new; end if;

  -- Serialize queue enrollment with operator gate/cutoff changes. A removal
  -- that obtains this lock first commits under the active boundary;
  -- an operator update that wins first is observed before any job is created.
  select * into v_settings
  from private.student_provider_cleanup_settings
  where singleton
  for update;
  if not coalesce(v_settings.enabled,false)
    or not coalesce(v_settings.live_enabled,false)
    or not coalesce(v_settings.automatic_enabled,false)
    or v_settings.eligible_after is null
    or new.removed_at<v_settings.eligible_after then
    return new;
  end if;

  v_scope:=private.pal_membership_scope(new.classroom_id,new.removed_student_id);
  if not exists(
    select 1
    from private.attendance_membership_generations attendance
    join private.pal_membership_generations membership
      on membership.generation_id=attendance.generation_id
      and attendance.generation_id=new.removed_enrollment_id
      and attendance.scope_digest=v_scope
      and membership.scope_digest=v_scope
      and membership.state in ('active','removed')
    join public.attendance_participant_mappings participant
      on participant.participant_ref=attendance.participant_ref
      and participant.classroom_id=new.classroom_id
      and participant.student_id=new.removed_student_id
      and participant.active
    join public.attendance_roster_mappings roster
      on roster.classroom_id=new.classroom_id
    join public.attendance_principal_mappings actor
      on actor.user_id=v_teacher_id
  ) then
    return new;
  end if;

  insert into private.removed_student_cleanup_jobs(
    operation_id,teacher_id,classroom_id,student_id,generation_id)
  values(gen_random_uuid(),v_teacher_id,new.classroom_id,new.removed_student_id,new.removed_enrollment_id)
  on conflict(generation_id) do nothing;
  perform private.kick_removed_student_cleanup('removal');
  return new;
end;
$$;
revoke all on function private.enqueue_removed_student_cleanup()
  from public,anon,authenticated,service_role;

comment on function private.enqueue_removed_student_cleanup() is
  'Queues only post-activation removals with exact immutable Pal and attendance membership evidence; legacy or partial memberships fail closed without blocking roster removal.';

commit;
