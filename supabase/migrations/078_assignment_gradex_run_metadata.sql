alter table public.assignment_ai_grading_runs
  add column if not exists gradex_run_id text,
  add column if not exists gradex_status text,
  add column if not exists gradex_submitted_at timestamptz,
  add column if not exists gradex_last_polled_at timestamptz;

create index if not exists idx_assignment_ai_grading_runs_gradex_run_id
  on public.assignment_ai_grading_runs (gradex_run_id)
  where gradex_run_id is not null;
