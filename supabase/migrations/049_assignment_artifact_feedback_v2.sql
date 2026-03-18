alter table public.assignment_docs
  add column if not exists teacher_feedback_draft text,
  add column if not exists teacher_feedback_draft_updated_at timestamptz,
  add column if not exists feedback_returned_at timestamptz,
  add column if not exists ai_feedback_suggestion text,
  add column if not exists ai_feedback_suggested_at timestamptz,
  add column if not exists ai_feedback_model text;

create table if not exists public.assignment_feedback_entries (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  entry_kind text not null check (entry_kind in ('teacher_feedback', 'grading_feedback')),
  author_type text not null check (author_type in ('teacher', 'ai')),
  body text not null,
  returned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references public.users (id)
);

create index if not exists idx_assignment_feedback_entries_assignment_student_returned
  on public.assignment_feedback_entries (assignment_id, student_id, returned_at desc);

create table if not exists public.assignment_repo_targets (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  selected_repo_url text,
  repo_owner text,
  repo_name text,
  selection_mode text not null default 'auto'
    check (selection_mode in ('auto', 'teacher_selected', 'teacher_override')),
  validation_status text not null default 'missing'
    check (validation_status in ('missing', 'ambiguous', 'valid', 'invalid', 'private', 'inaccessible')),
  validation_message text,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);

create index if not exists idx_assignment_repo_targets_assignment_repo
  on public.assignment_repo_targets (assignment_id, lower(coalesce(repo_owner, '')), lower(coalesce(repo_name, '')));

alter table public.assignment_repo_review_runs
  add column if not exists repo_owner text,
  add column if not exists repo_name text;

create or replace function public.update_assignment_repo_targets_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_assignment_repo_targets_updated_at on public.assignment_repo_targets;
create trigger update_assignment_repo_targets_updated_at
  before update on public.assignment_repo_targets
  for each row
  execute function public.update_assignment_repo_targets_updated_at();

alter table public.assignment_feedback_entries enable row level security;
alter table public.assignment_repo_targets enable row level security;

drop policy if exists "Teachers can view assignment feedback entries" on public.assignment_feedback_entries;
create policy "Teachers can view assignment feedback entries"
  on public.assignment_feedback_entries for select
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_feedback_entries.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Students can view returned feedback entries" on public.assignment_feedback_entries;
create policy "Students can view returned feedback entries"
  on public.assignment_feedback_entries for select
  using (
    student_id = auth.uid()
  );

drop policy if exists "Teachers can manage assignment feedback entries" on public.assignment_feedback_entries;
create policy "Teachers can manage assignment feedback entries"
  on public.assignment_feedback_entries for all
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_feedback_entries.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_feedback_entries.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can view assignment repo targets" on public.assignment_repo_targets;
create policy "Teachers can view assignment repo targets"
  on public.assignment_repo_targets for select
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_repo_targets.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can manage assignment repo targets" on public.assignment_repo_targets;
create policy "Teachers can manage assignment repo targets"
  on public.assignment_repo_targets for all
  using (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_repo_targets.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.assignments
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignments.id = assignment_repo_targets.assignment_id
        and classrooms.teacher_id = auth.uid()
    )
  );
