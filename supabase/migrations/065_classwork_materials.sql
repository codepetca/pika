-- Add ungraded classwork materials.
-- Materials are posted beside assignments but do not create submissions,
-- grades, or assignment docs.

create table if not exists public.classwork_materials (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  title text not null,
  content jsonb not null default '{"type":"doc","content":[]}'::jsonb,
  is_draft boolean not null default true,
  released_at timestamptz,
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_classwork_materials_classroom_created
  on public.classwork_materials (classroom_id, created_at desc);

create index if not exists idx_classwork_materials_student_visible
  on public.classwork_materials (classroom_id, is_draft, released_at desc);

create or replace function public.update_classwork_materials_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_classwork_materials_updated_at on public.classwork_materials;
create trigger update_classwork_materials_updated_at
  before update on public.classwork_materials
  for each row
  execute function public.update_classwork_materials_updated_at();

alter table public.classwork_materials enable row level security;

drop policy if exists "Teachers can manage classwork materials" on public.classwork_materials;
create policy "Teachers can manage classwork materials"
  on public.classwork_materials for all
  using (
    exists (
      select 1
      from public.classrooms
      where classrooms.id = classwork_materials.classroom_id
        and classrooms.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.classrooms
      where classrooms.id = classwork_materials.classroom_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Students can view published classwork materials" on public.classwork_materials;
create policy "Students can view published classwork materials"
  on public.classwork_materials for select
  using (
    not is_draft
    and exists (
      select 1
      from public.classroom_enrollments
      where classroom_enrollments.classroom_id = classwork_materials.classroom_id
        and classroom_enrollments.student_id = auth.uid()
    )
  );
