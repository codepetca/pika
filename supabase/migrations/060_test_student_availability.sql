-- Add per-student test availability overrides for exam access control.

create table if not exists public.test_student_availability (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  state text not null check (state in ('open', 'closed')),
  updated_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (test_id, student_id)
);

create index if not exists idx_test_student_availability_test_id
  on public.test_student_availability (test_id);

create index if not exists idx_test_student_availability_student_id
  on public.test_student_availability (student_id);

create or replace function public.update_test_student_availability_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_test_student_availability_updated_at on public.test_student_availability;
create trigger update_test_student_availability_updated_at
  before update on public.test_student_availability
  for each row
  execute function public.update_test_student_availability_updated_at();

alter table public.test_student_availability enable row level security;

drop policy if exists "Teachers can view test student availability" on public.test_student_availability;
create policy "Teachers can view test student availability"
  on public.test_student_availability for select
  using (
    exists (
      select 1
      from public.tests
      join public.classrooms on classrooms.id = tests.classroom_id
      where tests.id = test_student_availability.test_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can manage test student availability" on public.test_student_availability;
create policy "Teachers can manage test student availability"
  on public.test_student_availability for all
  using (
    exists (
      select 1
      from public.tests
      join public.classrooms on classrooms.id = tests.classroom_id
      where tests.id = test_student_availability.test_id
        and classrooms.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.tests
      join public.classrooms on classrooms.id = tests.classroom_id
      where tests.id = test_student_availability.test_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Students can view their own test availability" on public.test_student_availability;
create policy "Students can view their own test availability"
  on public.test_student_availability for select
  using (student_id = auth.uid());
