-- Migration: Add quizzes feature for Pika
-- Creates tables for quizzes, quiz_questions, and quiz_responses

-- ============================================================================
-- 1. Create quizzes table (container)
-- ============================================================================
create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  show_results boolean not null default false,
  position integer not null default 0,
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for quizzes
create index if not exists idx_quizzes_classroom_id on public.quizzes (classroom_id);
create index if not exists idx_quizzes_classroom_status on public.quizzes (classroom_id, status);

-- Updated_at trigger for quizzes
create or replace function public.update_quizzes_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_quizzes_updated_at on public.quizzes;
create trigger update_quizzes_updated_at
  before update on public.quizzes
  for each row
  execute function public.update_quizzes_updated_at();

-- ============================================================================
-- 2. Create quiz_questions table
-- ============================================================================
create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  question_text text not null,
  options jsonb not null, -- ["Option A", "Option B", ...]
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for quiz_questions
create index if not exists idx_quiz_questions_quiz_id on public.quiz_questions (quiz_id);

-- Updated_at trigger for quiz_questions
create or replace function public.update_quiz_questions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_quiz_questions_updated_at on public.quiz_questions;
create trigger update_quiz_questions_updated_at
  before update on public.quiz_questions
  for each row
  execute function public.update_quiz_questions_updated_at();

-- ============================================================================
-- 3. Create quiz_responses table
-- ============================================================================
create table if not exists public.quiz_responses (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  question_id uuid not null references public.quiz_questions (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  selected_option integer not null check (selected_option >= 0),
  submitted_at timestamptz not null default now(),
  unique (question_id, student_id)
);

-- Indexes for quiz_responses
create index if not exists idx_quiz_responses_quiz_id on public.quiz_responses (quiz_id);
create index if not exists idx_quiz_responses_student_id on public.quiz_responses (student_id);

-- ============================================================================
-- 4. RLS Policies for quizzes table
-- ============================================================================
alter table public.quizzes enable row level security;

-- Teachers can view quizzes for their classrooms
create policy "Teachers can view their classroom quizzes"
  on public.quizzes for select
  using (
    exists (
      select 1 from public.classrooms
      where classrooms.id = quizzes.classroom_id
      and classrooms.teacher_id = auth.uid()
    )
  );

-- Teachers can create quizzes for their classrooms
create policy "Teachers can create quizzes for their classrooms"
  on public.quizzes for insert
  with check (
    exists (
      select 1 from public.classrooms
      where classrooms.id = classroom_id
      and classrooms.teacher_id = auth.uid()
    )
  );

-- Teachers can update quizzes for their classrooms
create policy "Teachers can update their classroom quizzes"
  on public.quizzes for update
  using (
    exists (
      select 1 from public.classrooms
      where classrooms.id = quizzes.classroom_id
      and classrooms.teacher_id = auth.uid()
    )
  );

-- Teachers can delete quizzes for their classrooms
create policy "Teachers can delete their classroom quizzes"
  on public.quizzes for delete
  using (
    exists (
      select 1 from public.classrooms
      where classrooms.id = quizzes.classroom_id
      and classrooms.teacher_id = auth.uid()
    )
  );

-- Students can view active quizzes OR closed quizzes they responded to
create policy "Students can view quizzes"
  on public.quizzes for select
  using (
    exists (
      select 1 from public.classroom_enrollments
      where classroom_enrollments.classroom_id = quizzes.classroom_id
      and classroom_enrollments.student_id = auth.uid()
    )
    and (
      status = 'active'
      or (status = 'closed' and exists (
        select 1 from public.quiz_responses
        where quiz_responses.quiz_id = quizzes.id
        and quiz_responses.student_id = auth.uid()
      ))
    )
  );

-- ============================================================================
-- 5. RLS Policies for quiz_questions table
-- ============================================================================
alter table public.quiz_questions enable row level security;

-- Teachers can view questions for their classroom quizzes
create policy "Teachers can view quiz questions"
  on public.quiz_questions for select
  using (
    exists (
      select 1 from public.quizzes
      join public.classrooms on classrooms.id = quizzes.classroom_id
      where quizzes.id = quiz_questions.quiz_id
      and classrooms.teacher_id = auth.uid()
    )
  );

-- Teachers can create questions for their classroom quizzes
create policy "Teachers can create quiz questions"
  on public.quiz_questions for insert
  with check (
    exists (
      select 1 from public.quizzes
      join public.classrooms on classrooms.id = quizzes.classroom_id
      where quizzes.id = quiz_id
      and classrooms.teacher_id = auth.uid()
    )
  );

-- Teachers can update questions for their classroom quizzes
create policy "Teachers can update quiz questions"
  on public.quiz_questions for update
  using (
    exists (
      select 1 from public.quizzes
      join public.classrooms on classrooms.id = quizzes.classroom_id
      where quizzes.id = quiz_questions.quiz_id
      and classrooms.teacher_id = auth.uid()
    )
  );

-- Teachers can delete questions for their classroom quizzes
create policy "Teachers can delete quiz questions"
  on public.quiz_questions for delete
  using (
    exists (
      select 1 from public.quizzes
      join public.classrooms on classrooms.id = quizzes.classroom_id
      where quizzes.id = quiz_questions.quiz_id
      and classrooms.teacher_id = auth.uid()
    )
  );

-- Students can view questions for quizzes they can see
create policy "Students can view quiz questions"
  on public.quiz_questions for select
  using (
    exists (
      select 1 from public.quizzes
      join public.classroom_enrollments on classroom_enrollments.classroom_id = quizzes.classroom_id
      where quizzes.id = quiz_questions.quiz_id
      and classroom_enrollments.student_id = auth.uid()
      and (
        quizzes.status = 'active'
        or (quizzes.status = 'closed' and exists (
          select 1 from public.quiz_responses
          where quiz_responses.quiz_id = quizzes.id
          and quiz_responses.student_id = auth.uid()
        ))
      )
    )
  );

-- ============================================================================
-- 6. RLS Policies for quiz_responses table
-- ============================================================================
alter table public.quiz_responses enable row level security;

-- Teachers can view all responses for their classroom quizzes
create policy "Teachers can view quiz responses"
  on public.quiz_responses for select
  using (
    exists (
      select 1 from public.quizzes
      join public.classrooms on classrooms.id = quizzes.classroom_id
      where quizzes.id = quiz_responses.quiz_id
      and classrooms.teacher_id = auth.uid()
    )
  );

-- Students can view their own responses
create policy "Students can view their own quiz responses"
  on public.quiz_responses for select
  using (student_id = auth.uid());

-- Students can create their own responses (to active quizzes only)
create policy "Students can create quiz responses"
  on public.quiz_responses for insert
  with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.quizzes
      join public.classroom_enrollments on classroom_enrollments.classroom_id = quizzes.classroom_id
      where quizzes.id = quiz_id
      and classroom_enrollments.student_id = auth.uid()
      and quizzes.status = 'active'
    )
  );

-- ============================================================================
-- Note: The app uses service role client for most operations, so these RLS
-- policies are primarily for security defense-in-depth. The API routes handle
-- authorization checks before database operations.
-- ============================================================================
