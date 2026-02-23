-- Add assessment subtype support (quiz vs test) and focus-away telemetry for tests

-- 1) Distinguish regular quizzes from tests
alter table public.quizzes
  add column if not exists assessment_type text not null default 'quiz'
  check (assessment_type in ('quiz', 'test'));

update public.quizzes
set assessment_type = 'quiz'
where assessment_type is null;

create index if not exists idx_quizzes_classroom_assessment_status
  on public.quizzes (classroom_id, assessment_type, status);

-- 2) Focus-away telemetry events for test sessions
create table if not exists public.quiz_focus_events (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  session_id text not null,
  event_type text not null check (event_type in ('away_start', 'away_end', 'route_exit_attempt')),
  occurred_at timestamptz not null default now(),
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_quiz_focus_events_quiz_student
  on public.quiz_focus_events (quiz_id, student_id, occurred_at);

create index if not exists idx_quiz_focus_events_session
  on public.quiz_focus_events (session_id, occurred_at);

alter table public.quiz_focus_events enable row level security;

drop policy if exists "Teachers can view quiz focus events" on public.quiz_focus_events;
create policy "Teachers can view quiz focus events"
  on public.quiz_focus_events for select
  using (
    exists (
      select 1
      from public.quizzes
      join public.classrooms on classrooms.id = quizzes.classroom_id
      where quizzes.id = quiz_focus_events.quiz_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Students can view their own quiz focus events" on public.quiz_focus_events;
create policy "Students can view their own quiz focus events"
  on public.quiz_focus_events for select
  using (student_id = auth.uid());

drop policy if exists "Students can insert their own quiz focus events" on public.quiz_focus_events;
create policy "Students can insert their own quiz focus events"
  on public.quiz_focus_events for insert
  with check (
    student_id = auth.uid()
    and exists (
      select 1
      from public.quizzes
      join public.classroom_enrollments on classroom_enrollments.classroom_id = quizzes.classroom_id
      where quizzes.id = quiz_id
        and classroom_enrollments.student_id = auth.uid()
    )
  );
