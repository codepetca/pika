-- Add teacher assessment draft storage for autosave + json patch workflows.

create table if not exists public.assessment_drafts (
  id uuid primary key default gen_random_uuid(),
  assessment_type text not null check (assessment_type in ('quiz', 'test')),
  assessment_id uuid not null,
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  content jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version >= 1),
  created_by uuid not null references public.users (id),
  updated_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_type, assessment_id)
);

create index if not exists idx_assessment_drafts_classroom_type
  on public.assessment_drafts (classroom_id, assessment_type);

create or replace function public.update_assessment_drafts_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_assessment_drafts_updated_at on public.assessment_drafts;
create trigger update_assessment_drafts_updated_at
  before update on public.assessment_drafts
  for each row
  execute function public.update_assessment_drafts_updated_at();

alter table public.assessment_drafts enable row level security;

drop policy if exists "Teachers can view assessment drafts" on public.assessment_drafts;
create policy "Teachers can view assessment drafts"
  on public.assessment_drafts for select
  using (
    exists (
      select 1 from public.classrooms
      where classrooms.id = assessment_drafts.classroom_id
      and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can create assessment drafts" on public.assessment_drafts;
create policy "Teachers can create assessment drafts"
  on public.assessment_drafts for insert
  with check (
    exists (
      select 1 from public.classrooms
      where classrooms.id = classroom_id
      and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can update assessment drafts" on public.assessment_drafts;
create policy "Teachers can update assessment drafts"
  on public.assessment_drafts for update
  using (
    exists (
      select 1 from public.classrooms
      where classrooms.id = assessment_drafts.classroom_id
      and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can delete assessment drafts" on public.assessment_drafts;
create policy "Teachers can delete assessment drafts"
  on public.assessment_drafts for delete
  using (
    exists (
      select 1 from public.classrooms
      where classrooms.id = assessment_drafts.classroom_id
      and classrooms.teacher_id = auth.uid()
    )
  );
