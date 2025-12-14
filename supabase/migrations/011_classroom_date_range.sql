-- Add custom date range fields for classroom calendars.
-- These define the inclusive range shown in the teacher calendar UI.

alter table public.classrooms
  add column if not exists start_date date,
  add column if not exists end_date date;

alter table public.classrooms
  drop constraint if exists classrooms_start_end_date_check;

alter table public.classrooms
  add constraint classrooms_start_end_date_check
  check (
    (start_date is null and end_date is null)
    or (start_date is not null and end_date is not null and start_date <= end_date)
  );

