\set ON_ERROR_STOP on

begin;

-- Migration replay already covers the absent-target no-op. Remove its narrow
-- guards so this rollback-only fixture can exercise the production branch.
drop trigger guard_ppz3c_online_class_day_158 on public.class_days;
drop trigger guard_ppz3c_online_entry_158 on public.entries;
drop function private.guard_ppz3c_online_prestart_write_158();

insert into public.users
select (jsonb_populate_record(
  null::public.users,
  to_jsonb(source) || jsonb_build_object(
    'id', 'a2440373-e98d-432d-92a2-03701ab7c369',
    'email', 'ppz3c-correction-fixture@example.invalid',
    'workos_user_id', null
  )
)).*
from public.users as source
limit 1;

insert into public.classrooms
select (jsonb_populate_record(
  null::public.classrooms,
  to_jsonb(source) || jsonb_build_object(
    'id', '7ed4c2e5-4418-4401-ae47-6c2e464db3ee',
    'teacher_id', 'a2440373-e98d-432d-92a2-03701ab7c369',
    'title', 'PPZ3C Online',
    'class_code', 'PPZ3C-TEST',
    'actual_site_slug', null,
    'start_date', '2026-09-01',
    'end_date', '2027-01-31',
    'archived_at', null
  )
)).*
from public.classrooms as source
where source.id <> '7ed4c2e5-4418-4401-ae47-6c2e464db3ee'
limit 1;

insert into public.class_days (classroom_id, date, is_class_day, prompt_text)
select
  '7ed4c2e5-4418-4401-ae47-6c2e464db3ee',
  day,
  true,
  null
from unnest(array[
  date '2026-09-01', date '2026-09-02',
  date '2026-09-03', date '2026-09-04'
]) as day;

insert into public.lesson_plan_mutation_heads (
  classroom_id, date, client_id, last_sequence
)
values
  ('7ed4c2e5-4418-4401-ae47-6c2e464db3ee', date '2026-09-01', gen_random_uuid(), 2),
  ('7ed4c2e5-4418-4401-ae47-6c2e464db3ee', date '2026-09-02', gen_random_uuid(), 1);

\ir ../supabase/migrations/158_correct_ppz3c_online_start_date.sql

do $assertions$
begin
  if (select start_date from public.classrooms
      where id = '7ed4c2e5-4418-4401-ae47-6c2e464db3ee')
      is distinct from date '2026-09-08'
    or exists (
      select 1 from public.class_days
      where classroom_id = '7ed4c2e5-4418-4401-ae47-6c2e464db3ee'
        and date < date '2026-09-08'
    )
    or exists (
      select 1 from public.lesson_plan_mutation_heads
      where classroom_id = '7ed4c2e5-4418-4401-ae47-6c2e464db3ee'
        and date < date '2026-09-08'
    )
  then
    raise exception 'PPZ3C correction success-path verification failed';
  end if;

  begin
    insert into public.class_days (classroom_id, date, is_class_day)
    values ('7ed4c2e5-4418-4401-ae47-6c2e464db3ee', date '2026-09-07', true);
    raise exception 'PPZ3C pre-start class-day guard did not reject the write';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.entries (student_id, classroom_id, date, text, on_time)
    values (
      'a2440373-e98d-432d-92a2-03701ab7c369',
      '7ed4c2e5-4418-4401-ae47-6c2e464db3ee',
      date '2026-09-07',
      'must not persist',
      true
    );
    raise exception 'PPZ3C pre-start entry guard did not reject the write';
  exception
    when check_violation then null;
  end;
end;
$assertions$;

rollback;

