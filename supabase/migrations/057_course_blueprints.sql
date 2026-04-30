-- Reusable teacher-owned course blueprints for classroom bootstrapping.

create table if not exists public.course_blueprints (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.users (id) on delete cascade,
  title text not null,
  subject text not null default '',
  grade_level text not null default '',
  course_code text not null default '',
  term_template text not null default '',
  overview_markdown text not null default '',
  outline_markdown text not null default '',
  resources_markdown text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_blueprint_assignments (
  id uuid primary key default gen_random_uuid(),
  course_blueprint_id uuid not null references public.course_blueprints (id) on delete cascade,
  title text not null,
  instructions_markdown text not null default '',
  default_due_days integer not null default 0,
  default_due_time text not null default '23:59',
  points_possible integer,
  include_in_final boolean not null default true,
  is_draft boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_blueprint_assessments (
  id uuid primary key default gen_random_uuid(),
  course_blueprint_id uuid not null references public.course_blueprints (id) on delete cascade,
  assessment_type text not null check (assessment_type in ('quiz', 'test')),
  title text not null,
  content jsonb not null default '{}'::jsonb,
  documents jsonb not null default '[]'::jsonb,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_blueprint_lesson_templates (
  id uuid primary key default gen_random_uuid(),
  course_blueprint_id uuid not null references public.course_blueprints (id) on delete cascade,
  title text not null default '',
  content_markdown text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_course_blueprints_teacher_position
  on public.course_blueprints (teacher_id, position, updated_at desc);

create index if not exists idx_course_blueprint_assignments_blueprint_position
  on public.course_blueprint_assignments (course_blueprint_id, position);

create index if not exists idx_course_blueprint_assessments_blueprint_position
  on public.course_blueprint_assessments (course_blueprint_id, assessment_type, position);

create index if not exists idx_course_blueprint_lesson_templates_blueprint_position
  on public.course_blueprint_lesson_templates (course_blueprint_id, position);

create or replace function public.update_course_blueprints_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_course_blueprints_updated_at on public.course_blueprints;
create trigger update_course_blueprints_updated_at
  before update on public.course_blueprints
  for each row
  execute function public.update_course_blueprints_updated_at();

drop trigger if exists update_course_blueprint_assignments_updated_at on public.course_blueprint_assignments;
create trigger update_course_blueprint_assignments_updated_at
  before update on public.course_blueprint_assignments
  for each row
  execute function public.update_course_blueprints_updated_at();

drop trigger if exists update_course_blueprint_assessments_updated_at on public.course_blueprint_assessments;
create trigger update_course_blueprint_assessments_updated_at
  before update on public.course_blueprint_assessments
  for each row
  execute function public.update_course_blueprints_updated_at();

drop trigger if exists update_course_blueprint_lesson_templates_updated_at on public.course_blueprint_lesson_templates;
create trigger update_course_blueprint_lesson_templates_updated_at
  before update on public.course_blueprint_lesson_templates
  for each row
  execute function public.update_course_blueprints_updated_at();

alter table public.course_blueprints enable row level security;
alter table public.course_blueprint_assignments enable row level security;
alter table public.course_blueprint_assessments enable row level security;
alter table public.course_blueprint_lesson_templates enable row level security;

drop policy if exists "Teachers can manage their course blueprints" on public.course_blueprints;
create policy "Teachers can manage their course blueprints"
  on public.course_blueprints for all
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

drop policy if exists "Teachers can manage blueprint assignments" on public.course_blueprint_assignments;
create policy "Teachers can manage blueprint assignments"
  on public.course_blueprint_assignments for all
  using (
    exists (
      select 1 from public.course_blueprints
      where course_blueprints.id = course_blueprint_assignments.course_blueprint_id
        and course_blueprints.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.course_blueprints
      where course_blueprints.id = course_blueprint_assignments.course_blueprint_id
        and course_blueprints.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can manage blueprint assessments" on public.course_blueprint_assessments;
create policy "Teachers can manage blueprint assessments"
  on public.course_blueprint_assessments for all
  using (
    exists (
      select 1 from public.course_blueprints
      where course_blueprints.id = course_blueprint_assessments.course_blueprint_id
        and course_blueprints.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.course_blueprints
      where course_blueprints.id = course_blueprint_assessments.course_blueprint_id
        and course_blueprints.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can manage blueprint lesson templates" on public.course_blueprint_lesson_templates;
create policy "Teachers can manage blueprint lesson templates"
  on public.course_blueprint_lesson_templates for all
  using (
    exists (
      select 1 from public.course_blueprints
      where course_blueprints.id = course_blueprint_lesson_templates.course_blueprint_id
        and course_blueprints.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.course_blueprints
      where course_blueprints.id = course_blueprint_lesson_templates.course_blueprint_id
        and course_blueprints.teacher_id = auth.uid()
    )
  );
