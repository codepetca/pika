-- Removal is final: retained rows are cleanup/deny records, not a recovery feature.
-- No data is erased and no purge is scheduled by this migration.

create or replace function public.reject_removed_classroom_enrollment_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.try_lock_classroom_membership_change(new.classroom_id, new.student_id);
  if exists (
    select 1 from public.classroom_roster as roster
    where roster.classroom_id = new.classroom_id
      and roster.removed_at is not null
      and roster.removed_student_id = new.student_id
  ) then
    raise exception using errcode = '55000', message = 'student_class_data_pending_purge';
  end if;
  return new;
end;
$$;

drop trigger reject_removed_classroom_enrollment_insert on public.classroom_enrollments;
create trigger reject_removed_classroom_enrollment_insert
  before insert or update of classroom_id, student_id on public.classroom_enrollments
  for each row execute function public.reject_removed_classroom_enrollment_insert();

create function private.guard_final_student_roster_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.try_lock_classroom_membership_change(new.classroom_id);

  -- A re-add/upsert must not edit or clear the deny record. Whole-class archive
  -- restoration recreates tombstones with INSERT, retaining this same boundary.
  if tg_op = 'UPDATE' and old.removed_at is not null then
    raise exception using errcode = '55000', message = 'student_class_data_pending_purge';
  end if;

  -- The removal transaction and archive replay may write a retained identity.
  if new.removed_at is not null then
    return new;
  end if;

  if exists (
    select 1
    from public.classroom_roster as removed
    join public.users as student on student.id = removed.removed_student_id
    where removed.classroom_id = new.classroom_id
      and removed.removed_at is not null
      and (
        lower(btrim(removed.email)) = lower(btrim(new.email))
        or lower(btrim(student.email)) = lower(btrim(new.email))
      )
  ) then
    raise exception using errcode = '55000', message = 'student_class_data_pending_purge';
  end if;
  return new;
end;
$$;

create trigger guard_final_student_roster_write
  before insert or update on public.classroom_roster
  for each row execute function private.guard_final_student_roster_write();

revoke all on function private.guard_final_student_roster_write()
  from public, anon, authenticated, service_role;

-- Keep the old public signature during rolling app deployment. It no longer
-- restores anything. Old app instances can still add ordinary invitations,
-- while retained identities fail closed (also enforced by the write trigger).
create or replace function public.restore_removed_classroom_students(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_emails text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emails text[];
begin
  select array_agg(distinct lower(btrim(email))) into v_emails
  from unnest(coalesce(p_emails, array[]::text[])) as requested(email)
  where nullif(btrim(email), '') is not null;
  if coalesce(cardinality(v_emails), 0) = 0 or cardinality(v_emails) > 100 then
    raise exception using errcode = '22023', message = 'invalid_roster_restore_request';
  end if;
  perform private.try_lock_classroom_membership_change(p_classroom_id);
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);
  perform 1 from public.classrooms
  where id = p_classroom_id and teacher_id = p_teacher_id and archived_at is null
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'classroom_restore_forbidden';
  end if;
  if exists (
    select 1 from public.classroom_roster as removed
    join public.users as student on student.id = removed.removed_student_id
    where removed.classroom_id = p_classroom_id and removed.removed_at is not null
      and (lower(btrim(removed.email)) = any(v_emails)
        or lower(btrim(student.email)) = any(v_emails))
  ) then
    raise exception using errcode = '55000', message = 'student_class_data_pending_purge';
  end if;
  return jsonb_build_object('requested_count', cardinality(v_emails), 'restored_count', 0);
end;
$$;

revoke all on function public.reject_removed_classroom_enrollment_insert()
  from public, anon, authenticated, service_role;
revoke all on function public.restore_removed_classroom_students(uuid, uuid, text[])
  from public, anon, authenticated;
grant execute on function public.restore_removed_classroom_students(uuid, uuid, text[])
  to service_role;

comment on function public.restore_removed_classroom_students(uuid, uuid, text[]) is
  'Retired compatibility entrypoint. Never restores membership; removed identities require completed class-data purge.';
comment on column public.classroom_roster.removed_at is
  'Final class removal; retained identity blocks readmission until class-data purge removes the deny record.';
comment on column public.classroom_roster.retained_manual_attendance_marks is
  'Enrollment-owned marks retained for data integrity and later purge; not a recovery guarantee.';
comment on column public.classroom_roster.retained_attendance_participant_active is
  'Prior participant state retained for data integrity and later purge; not restored by readmission.';
