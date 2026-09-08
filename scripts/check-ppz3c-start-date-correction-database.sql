\set ON_ERROR_STOP on

begin;

-- Migration replay already covers the absent-target no-op. Remove its narrow
-- guards so this rollback-only fixture can exercise the production branch.
drop trigger guard_ppz3c_online_class_day_158 on public.class_days;
drop trigger guard_ppz3c_online_entry_158 on public.entries;
drop function private.guard_ppz3c_online_prestart_write_158();
drop function if exists private.apply_ppz3c_online_start_date_correction_158();

-- Exact migration replay with neither production identity present must no-op.
\ir ../supabase/migrations/158_correct_ppz3c_online_start_date.sql

insert into public.users (id, email, role)
values (
  'a2440373-e98d-432d-92a2-03701ab7c369',
  'ppz3c-correction-owner@example.invalid',
  'teacher'
);

do $missing_target$
begin
  begin
    perform private.apply_ppz3c_online_start_date_correction_158();
    raise exception 'Expected the missing-target guard to reject the fixture';
  exception
    when raise_exception then
      if sqlerrm <> 'PPZ3C Online target classroom is missing; correction aborted' then
        raise;
      end if;
  end;
end;
$missing_target$;

insert into public.users (id, email, role)
values (
  '10000000-0000-4000-8000-000000000158',
  'ppz3c-correction-wrong-owner@example.invalid',
  'teacher'
);

insert into public.classrooms (
  id, teacher_id, title, class_code, start_date, end_date
)
values (
  '7ed4c2e5-4418-4401-ae47-6c2e464db3ee',
  '10000000-0000-4000-8000-000000000158',
  'PPZ3C Online',
  'PPZ3C-TEST',
  date '2026-09-01',
  date '2027-01-31'
);

do $owner_drift$
begin
  begin
    perform private.apply_ppz3c_online_start_date_correction_158();
    raise exception 'Expected the owner guard to reject the fixture';
  exception
    when raise_exception then
      if sqlerrm <> 'PPZ3C Online identity or calendar range changed; correction aborted' then
        raise;
      end if;
  end;
end;
$owner_drift$;

update public.classrooms
set teacher_id = 'a2440373-e98d-432d-92a2-03701ab7c369'
where id = '7ed4c2e5-4418-4401-ae47-6c2e464db3ee';

alter table public.class_days disable trigger guard_ppz3c_online_class_day_158;

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

alter table public.class_days enable trigger guard_ppz3c_online_class_day_158;

insert into public.lesson_plan_mutation_heads (
  classroom_id, date, client_id, last_sequence
)
values
  ('7ed4c2e5-4418-4401-ae47-6c2e464db3ee', date '2026-09-01', gen_random_uuid(), 2),
  ('7ed4c2e5-4418-4401-ae47-6c2e464db3ee', date '2026-09-02', gen_random_uuid(), 1);

select private.apply_ppz3c_online_start_date_correction_158();

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
