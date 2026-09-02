-- Pika-owned attendance for classrooms that do not use Bara QR check-in.
--
-- Settings live on classrooms and per-student date marks live on existing
-- enrollment rows so the current classroom archive contract preserves them
-- without changing the immutable archive-v2 resource graph.

alter table public.attendance_window_policies
  alter column entry_closes_minutes_before_end set default 0;

-- The UI contract narrows the early-open lead to two hours. Normalize policies
-- that were valid under the previous 12-hour bound before tightening storage.
update public.attendance_window_policies
set entry_opens_minutes_before = 120
where entry_opens_minutes_before > 120;

alter table public.attendance_window_policies
  drop constraint attendance_window_policies_entry_opens_minutes_before_check,
  add constraint attendance_window_policies_entry_opens_minutes_before_check
    check (entry_opens_minutes_before between 0 and 120);

do $$
begin
  if exists (
    select 1
    from public.attendance_window_policies
    where (closes_local - opens_local) + close_day_offset * interval '1 day'
      <= interval '0 seconds'
      or (closes_local - opens_local) + close_day_offset * interval '1 day'
      > interval '12 hours'
  ) then
    raise exception 'Existing attendance session exceeds the 12-hour maximum';
  end if;
end;
$$;

alter table public.attendance_window_policies
  add constraint attendance_window_policy_duration_check
  check (
    (closes_local - opens_local) + close_day_offset * interval '1 day'
      > interval '0 seconds'
    and (closes_local - opens_local) + close_day_offset * interval '1 day'
      <= interval '12 hours'
  );

alter table public.classrooms
  add column manual_attendance_source_mode text not null default 'manual',
  add column manual_attendance_session_starts_local time,
  add column manual_attendance_session_ends_local time,
  add column manual_attendance_revision bigint not null default 1,
  add constraint classrooms_manual_attendance_source_mode_check
    check (manual_attendance_source_mode in ('log', 'manual')),
  add constraint classrooms_manual_attendance_time_pair_check
    check (
      (manual_attendance_session_starts_local is null)
      = (manual_attendance_session_ends_local is null)
    ),
  add constraint classrooms_manual_attendance_duration_check
    check (
      manual_attendance_session_starts_local is null
      or (
        manual_attendance_session_ends_local > manual_attendance_session_starts_local
        and manual_attendance_session_ends_local - manual_attendance_session_starts_local
          <= interval '12 hours'
      )
    ),
  add constraint classrooms_manual_attendance_revision_check
    check (manual_attendance_revision > 0);

create or replace function private.is_valid_manual_attendance_marks(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'object'
    and not exists (
      select 1
      from jsonb_each_text(value) mark
      where mark.key !~ '^\d{4}-\d{2}-\d{2}$'
        or mark.value not in ('present', 'late', 'absent')
    );
$$;

alter table public.classroom_enrollments
  add column manual_attendance_marks jsonb not null default '{}'::jsonb,
  add constraint classroom_enrollments_manual_attendance_marks_check
    check (private.is_valid_manual_attendance_marks(manual_attendance_marks));

-- Archives created before migration 150 do not contain the new fields. Extend
-- the current adapter chain so defaults added by earlier migrations (including
-- gradebook_category_id from migration 147) remain intact.
alter function public.normalize_classroom_archive_restore_row(uuid, text, jsonb)
  rename to normalize_classroom_archive_restore_row_v147;

revoke all on function public.normalize_classroom_archive_restore_row_v147(uuid, text, jsonb)
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
  p_row := public.normalize_classroom_archive_restore_row_v147(
    p_operation_id,
    p_table_name,
    p_row
  );

  if p_table_name = 'classrooms' then
    if not (p_row ? 'manual_attendance_source_mode') then
      p_row := p_row || jsonb_build_object('manual_attendance_source_mode', 'manual');
    end if;
    if not (p_row ? 'manual_attendance_session_starts_local') then
      p_row := p_row || jsonb_build_object('manual_attendance_session_starts_local', null);
    end if;
    if not (p_row ? 'manual_attendance_session_ends_local') then
      p_row := p_row || jsonb_build_object('manual_attendance_session_ends_local', null);
    end if;
    if not (p_row ? 'manual_attendance_revision') then
      p_row := p_row || jsonb_build_object('manual_attendance_revision', 1);
    end if;
  end if;

  if p_table_name = 'classroom_enrollments' then
    if not (p_row ? 'manual_attendance_marks') then
      p_row := p_row || jsonb_build_object('manual_attendance_marks', '{}'::jsonb);
    end if;
  end if;

  return p_row;
end;
$$;

revoke all on function public.normalize_classroom_archive_restore_row(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.normalize_classroom_archive_restore_row(uuid, text, jsonb)
  to service_role;

create or replace function public.set_pika_manual_attendance_settings(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_expected_revision bigint,
  p_source_mode text,
  p_session_starts_local time,
  p_session_ends_local time
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom public.classrooms%rowtype;
begin
  if p_expected_revision is null
    or p_expected_revision <= 0
    or p_source_mode is null
    or p_source_mode not in ('log', 'manual')
    or ((p_session_starts_local is null) <> (p_session_ends_local is null))
    or (
      p_session_starts_local is not null
      and (
        p_session_ends_local <= p_session_starts_local
        or p_session_ends_local - p_session_starts_local > interval '12 hours'
      )
    )
  then
    raise exception 'Invalid manual attendance settings' using errcode = '23514';
  end if;

  update public.classrooms
  set
    manual_attendance_source_mode = p_source_mode,
    manual_attendance_session_starts_local = p_session_starts_local,
    manual_attendance_session_ends_local = p_session_ends_local,
    manual_attendance_revision = manual_attendance_revision + 1,
    updated_at = clock_timestamp()
  where id = p_classroom_id
    and teacher_id = p_teacher_id
    and archived_at is null
    and manual_attendance_revision = p_expected_revision
  returning * into v_classroom;

  if v_classroom.id is null then
    if exists (
      select 1
      from public.classrooms
      where id = p_classroom_id
        and teacher_id = p_teacher_id
        and archived_at is null
    ) then
      raise exception 'Manual attendance settings changed; refresh and try again'
        using errcode = '40001';
    end if;
    raise exception 'Teacher does not own classroom' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'source_mode', v_classroom.manual_attendance_source_mode,
    'session_starts_local', v_classroom.manual_attendance_session_starts_local,
    'session_ends_local', v_classroom.manual_attendance_session_ends_local,
    'revision', v_classroom.manual_attendance_revision
  );
end;
$$;

create or replace function public.set_pika_manual_attendance_marks(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_class_date date,
  p_student_ids uuid[],
  p_status text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
  v_classroom_id uuid;
  v_class_day_id uuid;
begin
  if cardinality(p_student_ids) is null
    or cardinality(p_student_ids) = 0
    or p_class_date is null
    or p_status is null
    or p_status not in ('automatic', 'present', 'late', 'absent')
  then
    raise exception 'Invalid manual attendance marks' using errcode = '23514';
  end if;
  if (select count(distinct student_id) from unnest(p_student_ids) student_id)
    <> cardinality(p_student_ids)
  then
    raise exception 'Duplicate students in manual attendance request'
      using errcode = '23514';
  end if;
  select id into v_classroom_id
  from public.classrooms
  where id = p_classroom_id
    and teacher_id = p_teacher_id
    and archived_at is null
  for update;
  if v_classroom_id is null then
    raise exception 'Teacher does not own classroom' using errcode = '42501';
  end if;

  select id into v_class_day_id
  from public.class_days
  where classroom_id = p_classroom_id
    and date = p_class_date
    and is_class_day
  for update;
  if v_class_day_id is null then
    raise exception 'Attendance date is not an active class day'
      using errcode = '23514';
  end if;

  update public.classroom_enrollments
  set manual_attendance_marks = case
    when p_status = 'automatic'
      then manual_attendance_marks - p_class_date::text
    else jsonb_set(
      manual_attendance_marks,
      array[p_class_date::text],
      to_jsonb(p_status),
      true
    )
  end
  where classroom_id = p_classroom_id
    and student_id = any(p_student_ids);
  get diagnostics v_updated = row_count;

  if v_updated <> cardinality(p_student_ids) then
    raise exception 'Classroom roster changed during attendance update'
      using errcode = '23503';
  end if;
  return v_updated;
end;
$$;

revoke all on function public.set_pika_manual_attendance_settings(
  uuid, uuid, bigint, text, time, time
) from public, anon, authenticated;
grant execute on function public.set_pika_manual_attendance_settings(
  uuid, uuid, bigint, text, time, time
) to service_role;

revoke all on function public.set_pika_manual_attendance_marks(
  uuid, uuid, date, uuid[], text
) from public, anon, authenticated;
grant execute on function public.set_pika_manual_attendance_marks(
  uuid, uuid, date, uuid[], text
) to service_role;

comment on column public.classrooms.manual_attendance_source_mode is
  'Pika manual-attendance baseline: explicit marking or Present from a completed daily log.';
comment on column public.classroom_enrollments.manual_attendance_marks is
  'Teacher overrides keyed by Toronto class date; deleting a key restores the configured baseline.';
