-- One-time production correction for PPZ3C Online.
--
-- The classroom was created with September 1, 2026 as its first day, but the
-- official first day is September 8. Fail closed if the classroom identity or
-- the previously inventoried, empty pre-start range has changed.

-- Keep an already-validated browser request from recreating a pre-start class
-- day or Daily entry after this migration commits. These narrow guards apply
-- only to the corrected production classroom.
create function private.guard_ppz3c_online_prestart_write_158()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.classroom_id = '7ed4c2e5-4418-4401-ae47-6c2e464db3ee'::uuid
    and new.date < date '2026-09-08'
  then
    raise exception 'PPZ3C Online date precedes its corrected first class day'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_ppz3c_online_prestart_write_158()
  from public, anon, authenticated, service_role;

create trigger guard_ppz3c_online_class_day_158
before insert or update on public.class_days
for each row execute function private.guard_ppz3c_online_prestart_write_158();

create trigger guard_ppz3c_online_entry_158
before insert or update on public.entries
for each row execute function private.guard_ppz3c_online_prestart_write_158();

create trigger guard_ppz3c_online_lesson_plan_158
before insert or update on public.lesson_plans
for each row execute function private.guard_ppz3c_online_prestart_write_158();

create trigger guard_ppz3c_online_lesson_plan_head_158
before insert or update on public.lesson_plan_mutation_heads
for each row execute function private.guard_ppz3c_online_prestart_write_158();

create function private.apply_ppz3c_online_start_date_correction_158()
returns void
language plpgsql
set search_path = ''
as $migration$
declare
  v_classroom_id constant uuid := '7ed4c2e5-4418-4401-ae47-6c2e464db3ee'::uuid;
  v_teacher_id constant uuid := 'a2440373-e98d-432d-92a2-03701ab7c369'::uuid;
  v_old_start constant date := date '2026-09-01';
  v_new_start constant date := date '2026-09-08';
  v_expected_class_days constant date[] := array[
    date '2026-09-01',
    date '2026-09-02',
    date '2026-09-03',
    date '2026-09-04'
  ];
  v_classroom public.classrooms%rowtype;
  v_actual_class_days date[];
  v_deleted integer;
begin
  select classroom.*
  into v_classroom
  from public.classrooms as classroom
  where classroom.id = v_classroom_id
  for update;

  -- Other environments do not contain this production row. Keep the migration
  -- replayable there. If the inventoried owner exists, however, a missing
  -- classroom is production-shaped drift and must fail closed.
  if not found then
    if exists (select 1 from public.users where id = v_teacher_id) then
      raise exception 'PPZ3C Online target classroom is missing; correction aborted';
    end if;
    return;
  end if;

  if v_classroom.title is distinct from 'PPZ3C Online'
    or v_classroom.teacher_id is distinct from v_teacher_id
    or v_classroom.start_date is distinct from v_old_start
    or v_classroom.end_date is distinct from date '2027-01-31'
    or v_classroom.archived_at is not null
  then
    raise exception 'PPZ3C Online identity or calendar range changed; correction aborted';
  end if;

  select array_agg(day.date order by day.date)
  into v_actual_class_days
  from public.class_days as day
  where day.classroom_id = v_classroom_id
    and day.date >= v_old_start
    and day.date < v_new_start
    and day.is_class_day;

  if v_actual_class_days is distinct from v_expected_class_days
    or exists (
      select 1
      from public.class_days as day
      where day.classroom_id = v_classroom_id
        and day.date >= v_old_start
        and day.date < v_new_start
        and (not day.is_class_day or day.prompt_text is not null)
    )
  then
    raise exception 'PPZ3C Online pre-start class days changed; correction aborted';
  end if;

  if exists (
    select 1 from public.entries
    where classroom_id = v_classroom_id and date >= v_old_start and date < v_new_start
  ) or exists (
    select 1 from public.log_summaries
    where classroom_id = v_classroom_id and date >= v_old_start and date < v_new_start
  ) or exists (
    select 1 from public.lesson_plans
    where classroom_id = v_classroom_id and date >= v_old_start and date < v_new_start
  ) or exists (
    select 1 from public.attendance_occurrence_mappings
    where classroom_id = v_classroom_id and class_date >= v_old_start and class_date < v_new_start
  ) or exists (
    select 1
    from public.classroom_enrollments
    where classroom_id = v_classroom_id
      and manual_attendance_marks ?| array[
        '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
        '2026-09-05', '2026-09-06', '2026-09-07'
      ]
  )
  then
    raise exception 'PPZ3C Online gained pre-start classroom activity; correction aborted';
  end if;

  delete from public.lesson_plan_mutation_heads
  where classroom_id = v_classroom_id
    and date >= v_old_start
    and date < v_new_start;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 2 then
    raise exception 'PPZ3C Online lesson-plan mutation inventory changed; correction aborted';
  end if;

  delete from public.class_days
  where classroom_id = v_classroom_id
    and date = any(v_expected_class_days);
  get diagnostics v_deleted = row_count;
  if v_deleted <> cardinality(v_expected_class_days) then
    raise exception 'PPZ3C Online class-day deletion count changed; correction aborted';
  end if;

  update public.classrooms
  set start_date = v_new_start,
      updated_at = clock_timestamp()
  where id = v_classroom_id
    and start_date = v_old_start;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception 'PPZ3C Online start-date update failed; correction aborted';
  end if;
end;
$migration$;

revoke all on function private.apply_ppz3c_online_start_date_correction_158()
  from public, anon, authenticated, service_role;

select private.apply_ppz3c_online_start_date_correction_158();
