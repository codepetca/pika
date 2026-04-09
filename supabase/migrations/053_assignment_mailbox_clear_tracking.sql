alter table public.assignment_docs
  add column if not exists teacher_cleared_at timestamptz;

update public.assignment_docs
set teacher_cleared_at = returned_at
where teacher_cleared_at is null
  and returned_at is not null;

create index if not exists idx_assignment_docs_assignment_teacher_cleared
  on public.assignment_docs (assignment_id, teacher_cleared_at);
