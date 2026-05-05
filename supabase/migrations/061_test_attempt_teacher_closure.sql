-- Track teacher/system closure separately from student submission.
alter table if exists public.test_attempts
  add column if not exists closed_for_grading_at timestamptz;

alter table if exists public.test_attempts
  add column if not exists closed_for_grading_by uuid references public.users (id) on delete set null;

create index if not exists idx_test_attempts_test_closed_for_grading
  on public.test_attempts (test_id, closed_for_grading_at);

alter table if exists public.test_attempt_history
  drop constraint if exists test_attempt_history_trigger_check;

alter table if exists public.test_attempt_history
  add constraint test_attempt_history_trigger_check
  check (trigger in ('autosave', 'blur', 'submit', 'baseline', 'teacher_close', 'teacher_unsubmit'));
