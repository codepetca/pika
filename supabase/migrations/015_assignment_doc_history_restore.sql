-- Migration: allow restore trigger for assignment_doc_history

alter table public.assignment_doc_history
  drop constraint if exists assignment_doc_history_trigger_check;

alter table public.assignment_doc_history
  add constraint assignment_doc_history_trigger_check
  check (trigger in ('autosave', 'blur', 'submit', 'baseline', 'restore'));
