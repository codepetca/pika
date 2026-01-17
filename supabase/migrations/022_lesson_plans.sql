-- Migration: Add lesson_plans table and visibility setting
-- Purpose: Support calendar-based lesson planning for teachers

-- Create lesson_plans table
create table lesson_plans (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references classrooms(id) on delete cascade,
  date date not null,
  content jsonb not null default '{"type":"doc","content":[]}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (classroom_id, date)
);

-- Index for efficient date range queries
create index lesson_plans_classroom_date_idx on lesson_plans(classroom_id, date);

-- Add visibility setting to classrooms table
-- Values: 'current_week' (default), 'one_week_ahead', 'all'
alter table classrooms add column lesson_plan_visibility text not null default 'current_week'
  check (lesson_plan_visibility in ('current_week', 'one_week_ahead', 'all'));

-- RLS policies
alter table lesson_plans enable row level security;

-- Teachers can manage lesson plans for their own classrooms
create policy "Teachers can manage lesson plans for their classrooms"
  on lesson_plans for all
  using (
    exists (
      select 1 from classrooms
      where classrooms.id = lesson_plans.classroom_id
      and classrooms.teacher_id = auth.uid()
    )
  );

-- Students can view lesson plans for classrooms they're enrolled in
create policy "Students can view lesson plans for enrolled classrooms"
  on lesson_plans for select
  using (
    exists (
      select 1 from classroom_enrollments
      where classroom_enrollments.classroom_id = lesson_plans.classroom_id
      and classroom_enrollments.student_id = auth.uid()
    )
  );
