-- Migration: Add assignment_doc_history table for JSON Patch tracking

create table if not exists public.assignment_doc_history (
  id uuid primary key default gen_random_uuid(),
  assignment_doc_id uuid not null references public.assignment_docs (id) on delete cascade,
  patch jsonb,
  snapshot jsonb,
  word_count int not null,
  char_count int not null,
  trigger text not null
    check (trigger in ('autosave', 'blur', 'submit', 'baseline')),
  created_at timestamptz not null default now()
);

create index if not exists idx_assignment_doc_history_lookup
  on public.assignment_doc_history (assignment_doc_id, created_at desc);

create index if not exists idx_assignment_doc_history_cleanup
  on public.assignment_doc_history (created_at);

alter table public.assignment_doc_history enable row level security;

create policy "Students can view their own assignment doc history"
  on public.assignment_doc_history for select
  using (
    exists (
      select 1
      from public.assignment_docs
      where assignment_docs.id = assignment_doc_history.assignment_doc_id
        and assignment_docs.student_id = auth.uid()
    )
  );

create policy "Teachers can view assignment doc history for their classrooms"
  on public.assignment_doc_history for select
  using (
    exists (
      select 1
      from public.assignment_docs
      join public.assignments on assignments.id = assignment_docs.assignment_id
      join public.classrooms on classrooms.id = assignments.classroom_id
      where assignment_docs.id = assignment_doc_history.assignment_doc_id
        and classrooms.teacher_id = auth.uid()
    )
  );
