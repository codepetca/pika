-- One-time production correction for PPZ3C Online.
--
-- The classroom was created with September 1, 2026 as its first day, but the
-- official first day is September 8. Fail closed if the classroom identity or
-- the previously inventoried, empty pre-start range has changed.

do $migration$
declare
  v_classroom_id constant uuid := '7ed4c2e5-4418-4401-ae47-6c2e464db3ee';
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
  -- replayable there; production verification separately asserts the outcome.
  if not found then
    return;
  end if;

  if v_classroom.title is distinct from 'PPZ3C Online'
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
