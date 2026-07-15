-- Add revision columns in a short expand migration so table locks commit quickly.

alter table public.test_responses
  add column if not exists revision bigint default 1,
  add column if not exists ai_suggested_score numeric(6,2),
  add column if not exists ai_suggested_feedback text;

alter table public.test_ai_grading_run_items
  add column if not exists response_revision bigint,
  add column if not exists question_grading_snapshot jsonb;
