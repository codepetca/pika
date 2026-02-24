-- Add first-class tests domain and focus-away telemetry for test sessions

-- ============================================================================
-- 1) Create tests table (separate from quizzes)
-- ============================================================================
create table if not exists public.tests (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  show_results boolean not null default false,
  position integer not null default 0,
  points_possible numeric(6,2) not null default 100 check (points_possible > 0),
  include_in_final boolean not null default true,
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tests_classroom_id on public.tests (classroom_id);
create index if not exists idx_tests_classroom_status on public.tests (classroom_id, status);

create or replace function public.update_tests_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_tests_updated_at on public.tests;
create trigger update_tests_updated_at
  before update on public.tests
  for each row
  execute function public.update_tests_updated_at();

-- ============================================================================
-- 2) Create test_questions table
-- ============================================================================
create table if not exists public.test_questions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests (id) on delete cascade,
  question_text text not null,
  options jsonb not null,
  correct_option integer check (correct_option is null or correct_option >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_test_questions_test_id on public.test_questions (test_id);

create or replace function public.update_test_questions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_test_questions_updated_at on public.test_questions;
create trigger update_test_questions_updated_at
  before update on public.test_questions
  for each row
  execute function public.update_test_questions_updated_at();

-- ============================================================================
-- 3) Create test_attempts table (draft + submit state)
-- ============================================================================
create table if not exists public.test_attempts (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  responses jsonb not null default '{}'::jsonb,
  is_submitted boolean not null default false,
  submitted_at timestamptz,
  authenticity_score integer,
  authenticity_flags jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (test_id, student_id)
);

create index if not exists idx_test_attempts_test_id on public.test_attempts (test_id);
create index if not exists idx_test_attempts_student_id on public.test_attempts (student_id);
create index if not exists idx_test_attempts_test_student_submitted
  on public.test_attempts (test_id, student_id, is_submitted);

create or replace function public.update_test_attempts_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_test_attempts_updated_at on public.test_attempts;
create trigger update_test_attempts_updated_at
  before update on public.test_attempts
  for each row
  execute function public.update_test_attempts_updated_at();

-- ============================================================================
-- 4) Create test_attempt_history table (patch/snapshot history)
-- ============================================================================
create table if not exists public.test_attempt_history (
  id uuid primary key default gen_random_uuid(),
  test_attempt_id uuid not null references public.test_attempts (id) on delete cascade,
  patch jsonb,
  snapshot jsonb,
  word_count integer not null default 0,
  char_count integer not null default 0,
  paste_word_count integer not null default 0,
  keystroke_count integer not null default 0,
  trigger text not null check (trigger in ('autosave', 'blur', 'submit', 'baseline')),
  created_at timestamptz not null default now()
);

create index if not exists idx_test_attempt_history_attempt_created
  on public.test_attempt_history (test_attempt_id, created_at desc);

-- ============================================================================
-- 5) Create test_responses table (final answers for aggregation)
-- ============================================================================
create table if not exists public.test_responses (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests (id) on delete cascade,
  question_id uuid not null references public.test_questions (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  selected_option integer not null check (selected_option >= 0),
  submitted_at timestamptz not null default now(),
  unique (question_id, student_id)
);

create index if not exists idx_test_responses_test_id on public.test_responses (test_id);
create index if not exists idx_test_responses_student_id on public.test_responses (student_id);

-- ============================================================================
-- 6) Create test_focus_events table
-- ============================================================================
create table if not exists public.test_focus_events (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  session_id text not null,
  event_type text not null check (event_type in ('away_start', 'away_end', 'route_exit_attempt')),
  occurred_at timestamptz not null default now(),
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_test_focus_events_test_student
  on public.test_focus_events (test_id, student_id, occurred_at);

create index if not exists idx_test_focus_events_session
  on public.test_focus_events (session_id, occurred_at);

-- ============================================================================
-- 7) RLS policies for tests
-- ============================================================================
alter table public.tests enable row level security;

drop policy if exists "Teachers can view their classroom tests" on public.tests;
create policy "Teachers can view their classroom tests"
  on public.tests for select
  using (
    exists (
      select 1 from public.classrooms
      where classrooms.id = tests.classroom_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can create tests for their classrooms" on public.tests;
create policy "Teachers can create tests for their classrooms"
  on public.tests for insert
  with check (
    exists (
      select 1 from public.classrooms
      where classrooms.id = classroom_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can update their classroom tests" on public.tests;
create policy "Teachers can update their classroom tests"
  on public.tests for update
  using (
    exists (
      select 1 from public.classrooms
      where classrooms.id = tests.classroom_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can delete their classroom tests" on public.tests;
create policy "Teachers can delete their classroom tests"
  on public.tests for delete
  using (
    exists (
      select 1 from public.classrooms
      where classrooms.id = tests.classroom_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Students can view tests" on public.tests;
create policy "Students can view tests"
  on public.tests for select
  using (
    exists (
      select 1 from public.classroom_enrollments
      where classroom_enrollments.classroom_id = tests.classroom_id
        and classroom_enrollments.student_id = auth.uid()
    )
    and (
      status = 'active'
      or (
        status = 'closed'
        and (
          exists (
            select 1 from public.test_attempts
            where test_attempts.test_id = tests.id
              and test_attempts.student_id = auth.uid()
              and test_attempts.is_submitted = true
          )
          or exists (
            select 1 from public.test_responses
            where test_responses.test_id = tests.id
              and test_responses.student_id = auth.uid()
          )
        )
      )
    )
  );

-- ============================================================================
-- 8) RLS policies for test_questions
-- ============================================================================
alter table public.test_questions enable row level security;

drop policy if exists "Teachers can view test questions" on public.test_questions;
create policy "Teachers can view test questions"
  on public.test_questions for select
  using (
    exists (
      select 1 from public.tests
      join public.classrooms on classrooms.id = tests.classroom_id
      where tests.id = test_questions.test_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can create test questions" on public.test_questions;
create policy "Teachers can create test questions"
  on public.test_questions for insert
  with check (
    exists (
      select 1 from public.tests
      join public.classrooms on classrooms.id = tests.classroom_id
      where tests.id = test_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can update test questions" on public.test_questions;
create policy "Teachers can update test questions"
  on public.test_questions for update
  using (
    exists (
      select 1 from public.tests
      join public.classrooms on classrooms.id = tests.classroom_id
      where tests.id = test_questions.test_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can delete test questions" on public.test_questions;
create policy "Teachers can delete test questions"
  on public.test_questions for delete
  using (
    exists (
      select 1 from public.tests
      join public.classrooms on classrooms.id = tests.classroom_id
      where tests.id = test_questions.test_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Students can view test questions" on public.test_questions;
create policy "Students can view test questions"
  on public.test_questions for select
  using (
    exists (
      select 1 from public.tests
      join public.classroom_enrollments on classroom_enrollments.classroom_id = tests.classroom_id
      where tests.id = test_questions.test_id
        and classroom_enrollments.student_id = auth.uid()
        and (
          tests.status = 'active'
          or (
            tests.status = 'closed'
            and (
              exists (
                select 1 from public.test_attempts
                where test_attempts.test_id = tests.id
                  and test_attempts.student_id = auth.uid()
                  and test_attempts.is_submitted = true
              )
              or exists (
                select 1 from public.test_responses
                where test_responses.test_id = tests.id
                  and test_responses.student_id = auth.uid()
              )
            )
          )
        )
    )
  );

-- ============================================================================
-- 9) RLS policies for test_attempts
-- ============================================================================
alter table public.test_attempts enable row level security;

drop policy if exists "Teachers can view test attempts" on public.test_attempts;
create policy "Teachers can view test attempts"
  on public.test_attempts for select
  using (
    exists (
      select 1
      from public.tests
      join public.classrooms on classrooms.id = tests.classroom_id
      where tests.id = test_attempts.test_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Students can view their own test attempts" on public.test_attempts;
create policy "Students can view their own test attempts"
  on public.test_attempts for select
  using (student_id = auth.uid());

drop policy if exists "Students can create test attempts" on public.test_attempts;
create policy "Students can create test attempts"
  on public.test_attempts for insert
  with check (
    student_id = auth.uid()
    and is_submitted = false
    and submitted_at is null
    and exists (
      select 1
      from public.tests
      join public.classroom_enrollments on classroom_enrollments.classroom_id = tests.classroom_id
      where tests.id = test_id
        and classroom_enrollments.student_id = auth.uid()
        and tests.status = 'active'
    )
  );

drop policy if exists "Students can update their own open test attempts" on public.test_attempts;
create policy "Students can update their own open test attempts"
  on public.test_attempts for update
  using (
    student_id = auth.uid()
    and is_submitted = false
    and exists (
      select 1
      from public.tests
      join public.classroom_enrollments on classroom_enrollments.classroom_id = tests.classroom_id
      where tests.id = test_attempts.test_id
        and classroom_enrollments.student_id = auth.uid()
        and tests.status = 'active'
    )
  )
  with check (
    student_id = auth.uid()
    and is_submitted = false
    and submitted_at is null
    and exists (
      select 1
      from public.tests
      join public.classroom_enrollments on classroom_enrollments.classroom_id = tests.classroom_id
      where tests.id = test_attempts.test_id
        and classroom_enrollments.student_id = auth.uid()
        and tests.status = 'active'
    )
  );

-- ============================================================================
-- 10) RLS policies for test_attempt_history
-- ============================================================================
alter table public.test_attempt_history enable row level security;

drop policy if exists "Teachers can view test attempt history" on public.test_attempt_history;
create policy "Teachers can view test attempt history"
  on public.test_attempt_history for select
  using (
    exists (
      select 1
      from public.test_attempts
      join public.tests on tests.id = test_attempts.test_id
      join public.classrooms on classrooms.id = tests.classroom_id
      where test_attempts.id = test_attempt_history.test_attempt_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Students can view their own test attempt history" on public.test_attempt_history;
create policy "Students can view their own test attempt history"
  on public.test_attempt_history for select
  using (
    exists (
      select 1
      from public.test_attempts
      where test_attempts.id = test_attempt_history.test_attempt_id
        and test_attempts.student_id = auth.uid()
    )
  );

drop policy if exists "Students can insert their own test attempt history" on public.test_attempt_history;
create policy "Students can insert their own test attempt history"
  on public.test_attempt_history for insert
  with check (
    exists (
      select 1
      from public.test_attempts
      join public.tests on tests.id = test_attempts.test_id
      join public.classroom_enrollments on classroom_enrollments.classroom_id = tests.classroom_id
      where test_attempts.id = test_attempt_id
        and test_attempts.student_id = auth.uid()
        and test_attempts.is_submitted = false
        and tests.status = 'active'
        and classroom_enrollments.student_id = auth.uid()
    )
  );

-- ============================================================================
-- 11) RLS policies for test_responses
-- ============================================================================
alter table public.test_responses enable row level security;

drop policy if exists "Teachers can view test responses" on public.test_responses;
create policy "Teachers can view test responses"
  on public.test_responses for select
  using (
    exists (
      select 1 from public.tests
      join public.classrooms on classrooms.id = tests.classroom_id
      where tests.id = test_responses.test_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Students can view their own test responses" on public.test_responses;
create policy "Students can view their own test responses"
  on public.test_responses for select
  using (student_id = auth.uid());

drop policy if exists "Students can create test responses" on public.test_responses;
create policy "Students can create test responses"
  on public.test_responses for insert
  with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.tests
      join public.classroom_enrollments on classroom_enrollments.classroom_id = tests.classroom_id
      where tests.id = test_id
        and classroom_enrollments.student_id = auth.uid()
        and tests.status = 'active'
    )
  );

-- ============================================================================
-- 12) RLS policies for test_focus_events
-- ============================================================================
alter table public.test_focus_events enable row level security;

drop policy if exists "Teachers can view test focus events" on public.test_focus_events;
create policy "Teachers can view test focus events"
  on public.test_focus_events for select
  using (
    exists (
      select 1
      from public.tests
      join public.classrooms on classrooms.id = tests.classroom_id
      where tests.id = test_focus_events.test_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Students can view their own test focus events" on public.test_focus_events;
create policy "Students can view their own test focus events"
  on public.test_focus_events for select
  using (student_id = auth.uid());

drop policy if exists "Students can insert their own test focus events" on public.test_focus_events;
create policy "Students can insert their own test focus events"
  on public.test_focus_events for insert
  with check (
    student_id = auth.uid()
    and exists (
      select 1
      from public.tests
      join public.classroom_enrollments on classroom_enrollments.classroom_id = tests.classroom_id
      where tests.id = test_id
        and classroom_enrollments.student_id = auth.uid()
        and tests.status = 'active'
    )
    and not exists (
      select 1
      from public.test_attempts
      where test_attempts.test_id = test_id
        and test_attempts.student_id = auth.uid()
        and test_attempts.is_submitted = true
    )
    and not exists (
      select 1
      from public.test_responses
      where test_responses.test_id = test_id
        and test_responses.student_id = auth.uid()
    )
  );
