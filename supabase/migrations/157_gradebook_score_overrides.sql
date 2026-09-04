-- Teacher-entered Gradebook marks that take precedence over calculated scores.

create table public.gradebook_score_overrides (
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  assessment_type text not null check (assessment_type in ('assignment', 'test', 'final')),
  assessment_id uuid not null,
  earned numeric(8,1) not null check (earned >= 0),
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (classroom_id, student_id, assessment_type, assessment_id),
  check (assessment_type <> 'final' or assessment_id = classroom_id)
);

create index idx_gradebook_score_overrides_student
  on public.gradebook_score_overrides (student_id);

create or replace function public.update_gradebook_score_overrides_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger update_gradebook_score_overrides_updated_at
  before update on public.gradebook_score_overrides
  for each row execute function public.update_gradebook_score_overrides_updated_at();

alter table public.gradebook_score_overrides enable row level security;

create policy "No direct access to gradebook_score_overrides"
  on public.gradebook_score_overrides
  for all
  using (false)
  with check (false);
