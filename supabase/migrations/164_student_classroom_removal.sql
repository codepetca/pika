-- Reversible classroom membership removal. This operation revokes access by
-- deleting the active enrollment while retaining the roster identity, manual
-- attendance marks, academic records, attendance history, and Pal state.

alter table public.classroom_roster
  add column removed_at timestamptz,
  add column removed_student_id uuid references public.users (id) on delete restrict,
  add column removed_enrollment_id uuid,
  add column removed_enrolled_at timestamptz,
  add column retained_manual_attendance_marks jsonb,
  add column retained_attendance_participant_active boolean;

alter table public.classroom_roster
  add constraint classroom_roster_removed_membership_complete check (
    (
      removed_at is null
      and removed_student_id is null
      and removed_enrollment_id is null
      and removed_enrolled_at is null
      and retained_manual_attendance_marks is null
      and retained_attendance_participant_active is null
    )
    or
    (
      removed_at is not null
      and removed_student_id is not null
      and removed_enrollment_id is not null
      and removed_enrolled_at is not null
      and retained_manual_attendance_marks is not null
    )
  ),
  add constraint classroom_roster_retained_manual_attendance_marks_check check (
    retained_manual_attendance_marks is null
    or private.is_valid_manual_attendance_marks(retained_manual_attendance_marks)
  );

create unique index classroom_roster_one_removed_membership_per_student
  on public.classroom_roster (classroom_id, removed_student_id)
  where removed_at is not null;

-- Removed learners retain original Gradebook rows. Both tables already have
-- direct classroom and student references; their application writers validate
-- active enrollment before creating or changing a mark.
alter table public.gradebook_score_overrides
  drop constraint gradebook_score_overrides_classroom_id_student_id_fkey;
alter table public.gradebook_item_scores
  drop constraint gradebook_item_scores_classroom_id_student_id_fkey;

-- A new or changed mark still requires current enrollment. Deleting an
-- enrollment deliberately leaves old values intact, and metadata-only updates
-- (for example disclosure retraction after item changes) remain possible.
create function public.require_gradebook_enrollment_for_mark_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction')
  then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform private.try_lock_classroom_membership_change(
      new.classroom_id,
      new.student_id
    );
    if not exists (
      select 1
      from public.classroom_enrollments as enrollment
      where enrollment.classroom_id = new.classroom_id
        and enrollment.student_id = new.student_id
    ) then
      raise exception using
        errcode = '23503',
        message = 'gradebook_student_not_enrolled';
    end if;
  elsif new.classroom_id is distinct from old.classroom_id
    or new.student_id is distinct from old.student_id
    or new.earned is distinct from old.earned
  then
    perform private.try_lock_classroom_membership_change(
      new.classroom_id,
      new.student_id
    );
    if not exists (
      select 1
      from public.classroom_enrollments as enrollment
      where enrollment.classroom_id = new.classroom_id
        and enrollment.student_id = new.student_id
    ) then
      raise exception using
        errcode = '23503',
        message = 'gradebook_student_not_enrolled';
    end if;
  end if;
  return new;
end;
$$;

create trigger require_gradebook_override_enrollment
  before insert or update on public.gradebook_score_overrides
  for each row execute function public.require_gradebook_enrollment_for_mark_change();
create trigger require_gradebook_item_score_enrollment
  before insert or update on public.gradebook_item_scores
  for each row execute function public.require_gradebook_enrollment_for_mark_change();

revoke all on function public.require_gradebook_enrollment_for_mark_change()
  from public, anon, authenticated, service_role;

-- A removed roster identity is a deny record. Every enrollment insert path,
-- including migration 159's atomic join, passes this trigger. Only the explicit
-- teacher restore RPC below may recreate the preserved enrollment.
create function public.reject_removed_classroom_enrollment_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('pika.classroom_membership_restore', true) = 'on' then
    return new;
  end if;
  if exists (
    select 1
    from public.classroom_roster as roster
    where roster.classroom_id = new.classroom_id
      and roster.removed_at is not null
      and roster.removed_student_id = new.student_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'classroom_membership_removed_teacher_restore_required';
  end if;
  return new;
end;
$$;

create trigger reject_removed_classroom_enrollment_insert
  before insert on public.classroom_enrollments
  for each row execute function public.reject_removed_classroom_enrollment_insert();

revoke all on function public.reject_removed_classroom_enrollment_insert()
  from public, anon, authenticated, service_role;

-- Membership changes take the shared classroom operation lock before any row
-- lock. Student purge takes its subject lock first, so subject/pair acquisition
-- must also be nonblocking: if the opposite side has started, this transaction
-- releases the classroom lock instead of forming a lock-order cycle.
create function private.try_lock_classroom_membership_change(
  p_classroom_id uuid,
  p_student_id uuid default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not pg_try_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || p_classroom_id::text, 0)
  ) then
    raise exception using errcode = '40001', message = 'classroom_operation_busy';
  end if;
  if p_student_id is null then
    return;
  end if;
  if not pg_try_advisory_xact_lock(
    hashtextextended('pika-student-purge-subject:' || p_student_id::text, 0)
  ) or not pg_try_advisory_xact_lock(
    hashtextextended(
      'pika-student-purge:' || p_classroom_id::text || ':' || p_student_id::text,
      0
    )
  ) then
    raise exception using errcode = '40001', message = 'student_operation_busy';
  end if;
end;
$$;

revoke all on function private.try_lock_classroom_membership_change(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.remove_classroom_students_preserving_data(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_roster_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_count integer;
  v_roster_count integer;
  v_removed_count integer := 0;
  v_target record;
  v_enrollment public.classroom_enrollments%rowtype;
  v_student_id uuid;
  v_match_count integer;
  v_attendance_participant_active boolean;
begin
  select count(*)::integer into v_requested_count
  from (
    select distinct roster_id
    from unnest(coalesce(p_roster_ids, array[]::uuid[])) as requested(roster_id)
    where roster_id is not null
  ) as requested;
  if v_requested_count = 0 or v_requested_count > 100 then
    raise exception using errcode = '22023', message = 'invalid_roster_removal_request';
  end if;

  perform private.try_lock_classroom_membership_change(p_classroom_id);
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);

  perform 1
  from public.classrooms as classroom
  where classroom.id = p_classroom_id
    and classroom.teacher_id = p_teacher_id
    and classroom.archived_at is null
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'classroom_removal_forbidden';
  end if;

  perform 1
  from public.classroom_roster as roster
  join (
    select distinct roster_id
    from unnest(p_roster_ids) as requested(roster_id)
    where roster_id is not null
  ) as requested on requested.roster_id = roster.id
  where roster.classroom_id = p_classroom_id
  order by roster.id
  for update of roster;

  select count(*)::integer into v_roster_count
  from public.classroom_roster as roster
  join (
    select distinct roster_id
    from unnest(p_roster_ids) as requested(roster_id)
    where roster_id is not null
  ) as requested on requested.roster_id = roster.id
  where roster.classroom_id = p_classroom_id;
  if v_roster_count <> v_requested_count then
    raise exception using errcode = '22023', message = 'classroom_roster_target_not_found';
  end if;

  for v_target in
    select roster.*, binding.student_id as bound_student_id,
      binding.classroom_id as binding_classroom_id
    from public.classroom_roster as roster
    join (
      select distinct roster_id
      from unnest(p_roster_ids) as requested(roster_id)
      where roster_id is not null
    ) as requested on requested.roster_id = roster.id
    left join public.classroom_roster_student_bindings as binding
      on binding.roster_id = roster.id
    where roster.classroom_id = p_classroom_id
    order by roster.id
  loop
    if v_target.removed_at is not null then
      continue;
    end if;

    if v_target.bound_student_id is not null then
      if v_target.binding_classroom_id is distinct from p_classroom_id then
        raise exception using errcode = '22023', message = 'classroom_roster_binding_ambiguous';
      end if;
      v_student_id := v_target.bound_student_id;
      perform private.try_lock_classroom_membership_change(p_classroom_id, v_student_id);
    else
      select count(*)::integer,
        (array_agg(enrollment.student_id order by enrollment.created_at, enrollment.id))[1]
      into v_match_count, v_student_id
      from public.classroom_enrollments as enrollment
      join public.users as student
        on student.id = enrollment.student_id and student.role = 'student'
      where enrollment.classroom_id = p_classroom_id
        and lower(btrim(student.email)) = lower(btrim(v_target.email));
      if v_match_count = 0 then
        if exists (
          select 1
          from public.classroom_enrollments as enrollment
          where enrollment.classroom_id = p_classroom_id
            and not exists (
              select 1
              from public.classroom_roster_student_bindings as binding
              where binding.classroom_id = enrollment.classroom_id
                and binding.student_id = enrollment.student_id
            )
        ) then
          -- An unbound enrollment may belong to this roster row after an email
          -- change. Refuse to guess rather than leave access active or target
          -- another learner.
          raise exception using
            errcode = '22023',
            message = 'classroom_roster_binding_ambiguous';
        end if;
        -- This is an invitation that has never become a membership. It owns no
        -- classroom work, so removing the allow-list row remains sufficient.
        delete from public.classroom_roster where id = v_target.id;
        v_removed_count := v_removed_count + 1;
        continue;
      elsif v_match_count <> 1 then
        raise exception using errcode = '22023', message = 'classroom_roster_binding_ambiguous';
      end if;
      perform private.try_lock_classroom_membership_change(p_classroom_id, v_student_id);
      insert into public.classroom_roster_student_bindings (
        roster_id, classroom_id, student_id
      ) values (v_target.id, p_classroom_id, v_student_id);
    end if;

    select enrollment.* into v_enrollment
    from public.classroom_enrollments as enrollment
    where enrollment.classroom_id = p_classroom_id
      and enrollment.student_id = v_student_id
    for update;
    if not found then
      raise exception using errcode = '22023', message = 'classroom_roster_binding_ambiguous';
    end if;

    v_attendance_participant_active := null;
    select mapping.active into v_attendance_participant_active
    from public.attendance_participant_mappings as mapping
    where mapping.classroom_id = p_classroom_id
      and mapping.student_id = v_student_id
    for update;

    update public.classroom_roster
    set removed_at = clock_timestamp(),
      removed_student_id = v_student_id,
      removed_enrollment_id = v_enrollment.id,
      removed_enrolled_at = v_enrollment.created_at,
      retained_manual_attendance_marks = v_enrollment.manual_attendance_marks,
      retained_attendance_participant_active = v_attendance_participant_active
    where id = v_target.id;

    delete from public.classroom_enrollments
    where id = v_enrollment.id;

    update public.attendance_participant_mappings
    set active = false, updated_at = clock_timestamp()
    where classroom_id = p_classroom_id
      and student_id = v_student_id
      and v_attendance_participant_active is true
      and active;

    v_removed_count := v_removed_count + 1;
  end loop;

  return jsonb_build_object(
    'requested_count', v_requested_count,
    'removed_count', v_removed_count
  );
end;
$$;

revoke all on function public.remove_classroom_students_preserving_data(uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.remove_classroom_students_preserving_data(uuid, uuid, uuid[])
  to service_role;

create function public.restore_removed_classroom_students(
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
  v_requested_count integer;
  v_restored_count integer := 0;
  v_email text;
  v_user_count integer;
  v_candidate_count integer;
  v_placeholder_count integer;
  v_requested_student_id uuid;
  v_requested_user_role text;
  v_roster public.classroom_roster%rowtype;
  v_placeholder public.classroom_roster%rowtype;
  v_binding public.classroom_roster_student_bindings%rowtype;
begin
  select count(*)::integer into v_requested_count
  from (
    select distinct lower(btrim(email)) as email
    from unnest(coalesce(p_emails, array[]::text[])) as requested(email)
    where nullif(btrim(email), '') is not null
  ) as requested;
  if v_requested_count = 0 or v_requested_count > 100 then
    raise exception using errcode = '22023', message = 'invalid_roster_restore_request';
  end if;

  perform private.try_lock_classroom_membership_change(p_classroom_id);
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);

  perform 1
  from public.classrooms as classroom
  where classroom.id = p_classroom_id
    and classroom.teacher_id = p_teacher_id
    and classroom.archived_at is null
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'classroom_restore_forbidden';
  end if;

  for v_email in
    select distinct lower(btrim(email))
    from unnest(p_emails) as requested(email)
    where nullif(btrim(email), '') is not null
    order by 1
  loop
    select count(*)::integer,
      (array_agg(account.id order by account.id))[1],
      (array_agg(account.role::text order by account.id))[1]
    into v_user_count, v_requested_student_id, v_requested_user_role
    from public.users as account
    where lower(btrim(account.email)) = v_email;
    if v_user_count > 1 then
      raise exception using errcode = '22023', message = 'classroom_roster_restore_identity_ambiguous';
    end if;
    if v_requested_user_role is distinct from 'student' then
      v_requested_student_id := null;
      if v_user_count = 1 and exists (
        select 1
        from public.classroom_roster as roster
        where roster.classroom_id = p_classroom_id
          and roster.removed_at is not null
          and lower(btrim(roster.email)) = v_email
      ) then
        raise exception using errcode = '22023', message = 'classroom_roster_restore_identity_conflict';
      end if;
    end if;

    if v_requested_student_id is not null then
      select count(*)::integer into v_candidate_count
      from public.classroom_roster as roster
      join public.classroom_roster_student_bindings as binding
        on binding.roster_id = roster.id
        and binding.classroom_id = roster.classroom_id
      where roster.classroom_id = p_classroom_id
        and roster.removed_at is not null
        and roster.removed_student_id = binding.student_id
        and binding.student_id = v_requested_student_id;
      if v_candidate_count = 0 and exists (
        select 1
        from public.classroom_roster as roster
        where roster.classroom_id = p_classroom_id
          and roster.removed_at is not null
          and lower(btrim(roster.email)) = v_email
          and roster.removed_student_id is distinct from v_requested_student_id
      ) then
        -- The stored address now belongs to another account. Never restore the
        -- retained identity from an email that has been reassigned.
        raise exception using errcode = '22023', message = 'classroom_roster_restore_identity_conflict';
      end if;
    else
      select count(*)::integer into v_candidate_count
      from public.classroom_roster as roster
      where roster.classroom_id = p_classroom_id
        and roster.removed_at is not null
        and lower(btrim(roster.email)) = v_email;
    end if;
    if v_candidate_count > 1 then
      raise exception using errcode = '22023', message = 'classroom_roster_restore_ambiguous';
    elsif v_candidate_count = 0 then
      continue;
    end if;

    if v_requested_student_id is not null then
      select roster.* into strict v_roster
      from public.classroom_roster as roster
      join public.classroom_roster_student_bindings as binding
        on binding.roster_id = roster.id
        and binding.classroom_id = roster.classroom_id
      where roster.classroom_id = p_classroom_id
        and roster.removed_at is not null
        and roster.removed_student_id = binding.student_id
        and binding.student_id = v_requested_student_id
      for update of roster;
    else
      select roster.* into strict v_roster
      from public.classroom_roster as roster
      where roster.classroom_id = p_classroom_id
        and roster.removed_at is not null
        and lower(btrim(roster.email)) = v_email
      for update;
    end if;

    select binding.* into v_binding
    from public.classroom_roster_student_bindings as binding
    where binding.roster_id = v_roster.id
    for update;
    if not found
      or v_binding.classroom_id is distinct from p_classroom_id
      or v_binding.student_id is distinct from v_roster.removed_student_id
    then
      raise exception using errcode = '22023', message = 'classroom_roster_restore_binding_invalid';
    end if;

    perform private.try_lock_classroom_membership_change(
      p_classroom_id,
      v_roster.removed_student_id
    );

    select count(*)::integer into v_placeholder_count
    from public.classroom_roster as roster
    where roster.classroom_id = p_classroom_id
      and roster.id <> v_roster.id
      and lower(btrim(roster.email)) = v_email;
    if v_placeholder_count > 1 then
      raise exception using errcode = '22023', message = 'classroom_roster_restore_ambiguous';
    elsif v_placeholder_count = 1 then
      if v_requested_student_id is null then
        raise exception using errcode = '22023', message = 'classroom_roster_restore_identity_conflict';
      end if;
      select roster.* into strict v_placeholder
      from public.classroom_roster as roster
      where roster.classroom_id = p_classroom_id
        and roster.id <> v_roster.id
        and lower(btrim(roster.email)) = v_email
      for update;
      if v_placeholder.removed_at is not null
        or exists (
          select 1
          from public.classroom_roster_student_bindings as binding
          where binding.roster_id = v_placeholder.id
        )
      then
        raise exception using errcode = '22023', message = 'classroom_roster_restore_identity_conflict';
      end if;

      delete from public.classroom_roster
      where id = v_placeholder.id;
      update public.classroom_roster
      set email = v_email,
        first_name = v_placeholder.first_name,
        last_name = v_placeholder.last_name,
        student_number = v_placeholder.student_number,
        counselor_email = v_placeholder.counselor_email,
        join_source = v_placeholder.join_source
      where id = v_roster.id
      returning * into v_roster;
    elsif v_requested_student_id is not null
      and lower(btrim(v_roster.email)) is distinct from v_email
    then
      update public.classroom_roster
      set email = v_email
      where id = v_roster.id
      returning * into v_roster;
    end if;

    if exists (
      select 1 from public.classroom_enrollments as enrollment
      where enrollment.classroom_id = p_classroom_id
        and enrollment.student_id = v_roster.removed_student_id
    ) then
      raise exception using errcode = '55000', message = 'classroom_roster_restore_membership_conflict';
    end if;

    perform set_config('pika.classroom_membership_restore', 'on', true);
    insert into public.classroom_enrollments (
      id, classroom_id, student_id, created_at, manual_attendance_marks
    ) values (
      v_roster.removed_enrollment_id,
      p_classroom_id,
      v_roster.removed_student_id,
      v_roster.removed_enrolled_at,
      v_roster.retained_manual_attendance_marks
    );
    perform set_config('pika.classroom_membership_restore', 'off', true);

    update public.attendance_participant_mappings
    set active = v_roster.retained_attendance_participant_active,
      updated_at = clock_timestamp()
    where classroom_id = p_classroom_id
      and student_id = v_roster.removed_student_id
      and v_roster.retained_attendance_participant_active is not null
      and active is distinct from v_roster.retained_attendance_participant_active;

    update public.classroom_roster
    set removed_at = null,
      removed_student_id = null,
      removed_enrollment_id = null,
      removed_enrolled_at = null,
      retained_manual_attendance_marks = null,
      retained_attendance_participant_active = null
    where id = v_roster.id;

    v_restored_count := v_restored_count + 1;
  end loop;

  return jsonb_build_object(
    'requested_count', v_requested_count,
    'restored_count', v_restored_count
  );
end;
$$;

revoke all on function public.restore_removed_classroom_students(uuid, uuid, text[])
  from public, anon, authenticated;
grant execute on function public.restore_removed_classroom_students(uuid, uuid, text[])
  to service_role;

-- Invitation deletion remains separate. Hidden retained rows may never fall
-- through to the legacy destructive remover after their enrollment is gone.
alter function public.remove_classroom_roster_entries_atomic(uuid, uuid[])
  rename to remove_classroom_roster_entries_pre_v164;
alter function public.remove_classroom_roster_entries_pre_v164(uuid, uuid[])
  set schema private;
revoke all on function private.remove_classroom_roster_entries_pre_v164(uuid, uuid[])
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
  v_requested_count integer;
  v_found_count integer;
  v_deleted_count integer;
begin
  select count(distinct roster_id)::integer into v_requested_count
  from unnest(coalesce(p_roster_ids, array[]::uuid[])) as requested(roster_id);
  if v_requested_count = 0 or v_requested_count > 100 then
    raise exception using errcode = '22023', message = 'invalid_roster_removal_request';
  end if;
  perform private.try_lock_classroom_membership_change(p_classroom_id);
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);
  perform 1 from public.classrooms
  where id = p_classroom_id and archived_at is null for update;
  if not found then
    raise exception using errcode = '42501', message = 'classroom_removal_forbidden';
  end if;
  perform 1 from public.classroom_roster
  where classroom_id = p_classroom_id and id = any(p_roster_ids)
  order by id for update;
  get diagnostics v_found_count = row_count;
  if v_found_count <> v_requested_count then
    raise exception 'One or more roster entries not found in classroom';
  end if;
  if exists (
    select 1
    from public.classroom_roster as roster
    where roster.classroom_id = p_classroom_id
      and roster.id = any(coalesce(p_roster_ids, array[]::uuid[]))
      and roster.removed_at is not null
  ) then
    raise exception using
      errcode = '55000',
      message = 'removed_students_require_explicit_restore_or_purge';
  end if;
  if exists (
    select 1 from public.classroom_roster as roster
    where roster.classroom_id = p_classroom_id and roster.id = any(p_roster_ids)
      and (
        exists (select 1 from public.classroom_roster_student_bindings as binding
          where binding.roster_id = roster.id)
        or exists (
          select 1 from public.classroom_enrollments as enrollment
          join public.users as student on student.id = enrollment.student_id
          where enrollment.classroom_id = p_classroom_id
            and lower(btrim(student.email)) = lower(btrim(roster.email))
        )
      )
  ) then
    raise exception using errcode = '55000',
      message = 'joined_students_require_comprehensive_removal';
  end if;

  -- Never delegate to historical cleanup: retained marks deliberately have no
  -- active enrollment. Even an unbound re-add placeholder owns no student data.
  delete from public.classroom_roster
  where classroom_id = p_classroom_id and id = any(p_roster_ids);
  get diagnostics v_deleted_count = row_count;
  return jsonb_build_object(
    'requested_count', v_requested_count,
    'deleted_roster_entries', v_deleted_count,
    'deleted_entries', 0,
    'deleted_assignment_docs', 0,
    'deleted_enrollments', 0,
    'deleted_gradebook_score_overrides', 0,
    'deleted_gradebook_item_scores', 0
  );
end;
$$;

revoke all on function public.remove_classroom_roster_entries_atomic(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.remove_classroom_roster_entries_atomic(uuid, uuid[])
  to service_role;

-- Old archives have no removal-retention fields. Current archives carry them
-- automatically as part of the classroom_roster row.
alter function public.normalize_classroom_archive_restore_row(uuid, text, jsonb)
  rename to normalize_classroom_archive_restore_row_pre_v164;
revoke all on function public.normalize_classroom_archive_restore_row_pre_v164(uuid, text, jsonb)
  from public, anon, authenticated;

create function public.normalize_classroom_archive_restore_row(
  p_operation_id uuid,
  p_table_name text,
  p_row jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  p_row := public.normalize_classroom_archive_restore_row_pre_v164(
    p_operation_id, p_table_name, p_row
  );
  if p_table_name = 'classroom_roster' then
    p_row := p_row || jsonb_build_object(
      'removed_at', coalesce(p_row->'removed_at', 'null'::jsonb),
      'removed_student_id', coalesce(p_row->'removed_student_id', 'null'::jsonb),
      'removed_enrollment_id', coalesce(p_row->'removed_enrollment_id', 'null'::jsonb),
      'removed_enrolled_at', coalesce(p_row->'removed_enrolled_at', 'null'::jsonb),
      'retained_manual_attendance_marks',
        coalesce(p_row->'retained_manual_attendance_marks', 'null'::jsonb),
      'retained_attendance_participant_active',
        coalesce(p_row->'retained_attendance_participant_active', 'null'::jsonb)
    );
  end if;
  return p_row;
end;
$$;

revoke all on function public.normalize_classroom_archive_restore_row(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.normalize_classroom_archive_restore_row(uuid, text, jsonb)
  to service_role;

-- Archive actor remapping must treat the retained learner UUID as identity.
update public.classroom_archive_resource_contract
set actor_columns = array_append(actor_columns, 'removed_student_id')
where table_name = 'classroom_roster'
  and not ('removed_student_id' = any(actor_columns));
update public.classroom_archive_resource_contract_versions
set actor_columns = array_append(actor_columns, 'removed_student_id')
where format_version = 2
  and table_name = 'classroom_roster'
  and not ('removed_student_id' = any(actor_columns));

-- Rebuild stable identity for removed rows during archive restore. Active rows
-- retain the original enrollment-derived behavior.
create or replace function public.bind_classroom_roster_student()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.classroom_id is distinct from old.classroom_id
    and exists (
      select 1 from public.classroom_roster_student_bindings where roster_id = old.id
    )
  then
    raise exception using
      errcode = '55000',
      message = 'roster_student_binding_classroom_immutable';
  end if;
  if new.removed_at is not null then
    insert into public.classroom_roster_student_bindings (
      roster_id, classroom_id, student_id
    ) values (new.id, new.classroom_id, new.removed_student_id)
    on conflict (roster_id) do nothing;
  else
    insert into public.classroom_roster_student_bindings (
      roster_id, classroom_id, student_id
    )
    select new.id, new.classroom_id, enrollment.student_id
    from public.classroom_enrollments as enrollment
    join public.users as student
      on student.id = enrollment.student_id and student.role = 'student'
    where enrollment.classroom_id = new.classroom_id
      and lower(btrim(student.email)) = lower(btrim(new.email))
    order by enrollment.created_at, enrollment.id
    limit 1
    on conflict (roster_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.bind_classroom_roster_student()
  from public, anon, authenticated, service_role;

comment on column public.classroom_roster.removed_at is
  'Non-null when access was revoked without deleting classroom records.';
comment on column public.classroom_roster.retained_manual_attendance_marks is
  'Exact enrollment-owned manual attendance marks retained across reversible removal.';
comment on column public.classroom_roster.retained_attendance_participant_active is
  'Original attendance participant active state retained across reversible removal.';
comment on function public.remove_classroom_students_preserving_data(uuid, uuid, uuid[]) is
  'Revokes joined-student classroom access while preserving records and provider history.';
comment on function public.restore_removed_classroom_students(uuid, uuid, text[]) is
  'Explicitly restores preserved memberships for teacher-added normalized emails.';
