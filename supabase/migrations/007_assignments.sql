-- Migration: Add assignments and assignment_docs tables for Pika
-- Run this SQL in your Supabase dashboard SQL editor

-- ============================================================================
-- 1. Create profiles view (convenience alias for users table)
-- ============================================================================
-- Note: Foreign keys reference users table directly since FKs can't reference views
create or replace view public.profiles as
select
  id,
  email,
  role,
  email_verified_at,
  created_at
from public.users;

-- ============================================================================
-- 2. Create assignments table
-- ============================================================================
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  title text not null,
  description text not null default '',
  due_at timestamptz not null,
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for faster queries by classroom
create index if not exists idx_assignments_classroom_id on public.assignments (classroom_id);

-- Index for faster queries by due date
create index if not exists idx_assignments_due_at on public.assignments (due_at);

-- Trigger to auto-update updated_at
create or replace function public.update_assignments_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_assignments_updated_at on public.assignments;
create trigger update_assignments_updated_at
  before update on public.assignments
  for each row
  execute function public.update_assignments_updated_at();

-- ============================================================================
-- 3. Create assignment_docs table
-- ============================================================================
create table if not exists public.assignment_docs (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  content text not null default '',
  is_submitted boolean not null default false,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);

-- Index for faster queries by assignment
create index if not exists idx_assignment_docs_assignment_id on public.assignment_docs (assignment_id);

-- Index for faster queries by student
create index if not exists idx_assignment_docs_student_id on public.assignment_docs (student_id);

-- Trigger to auto-update updated_at
create or replace function public.update_assignment_docs_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_assignment_docs_updated_at on public.assignment_docs;
create trigger update_assignment_docs_updated_at
  before update on public.assignment_docs
  for each row
  execute function public.update_assignment_docs_updated_at();

-- ============================================================================
-- 4. RLS Policies for assignments table
-- ============================================================================
alter table public.assignments enable row level security;

-- Teachers can view assignments for their classrooms
create policy "Teachers can view their classroom assignments"
  on public.assignments for select
  using (
    exists (
      select 1 from public.classrooms
      where classrooms.id = assignments.classroom_id
      and classrooms.teacher_id = auth.uid()
    )
  );

-- Teachers can create assignments for their classrooms
create policy "Teachers can create assignments for their classrooms"
  on public.assignments for insert
  with check (
    exists (
      select 1 from public.classrooms
      where classrooms.id = classroom_id
      and classrooms.teacher_id = auth.uid()
    )
  );

-- Teachers can update assignments for their classrooms
create policy "Teachers can update their classroom assignments"
  on public.assignments for update
  using (
    exists (
      select 1 from public.classrooms
      where classrooms.id = assignments.classroom_id
      and classrooms.teacher_id = auth.uid()
    )
  );

-- Teachers can delete assignments for their classrooms
create policy "Teachers can delete their classroom assignments"
  on public.assignments for delete
  using (
    exists (
      select 1 from public.classrooms
      where classrooms.id = assignments.classroom_id
      and classrooms.teacher_id = auth.uid()
    )
  );

-- Students can view assignments for classrooms they're enrolled in
create policy "Students can view assignments for their enrolled classrooms"
  on public.assignments for select
  using (
    exists (
      select 1 from public.classroom_enrollments
      where classroom_enrollments.classroom_id = assignments.classroom_id
      and classroom_enrollments.student_id = auth.uid()
    )
  );

-- ============================================================================
-- 5. RLS Policies for assignment_docs table
-- ============================================================================
alter table public.assignment_docs enable row level security;

-- Students can view their own assignment docs
create policy "Students can view their own assignment docs"
  on public.assignment_docs for select
  using (student_id = auth.uid());

-- Students can create their own assignment docs
create policy "Students can create their own assignment docs"
  on public.assignment_docs for insert
  with check (student_id = auth.uid());

-- Students can update their own assignment docs
create policy "Students can update their own assignment docs"
  on public.assignment_docs for update
  using (student_id = auth.uid());

-- Teachers can view all assignment docs for their classroom assignments
create policy "Teachers can view assignment docs for their classrooms"
  on public.assignment_docs for select
  using (
    exists (
      select 1 from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_docs.assignment_id
      and classrooms.teacher_id = auth.uid()
    )
  );

-- ============================================================================
-- Note: The app uses service role client for most operations, so these RLS
-- policies are primarily for security defense-in-depth. The API routes handle
-- authorization checks before database operations.
-- ============================================================================
