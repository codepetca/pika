-- Constraint validation permits normal reads and writes. The final NOT NULL DDL
-- uses the validated checks and is kept last so its stronger lock is brief.

alter table public.test_responses
  validate constraint test_responses_revision_not_null;
alter table public.test_responses
  validate constraint test_responses_revision_check;
alter table public.test_ai_grading_run_items
  validate constraint test_ai_grading_run_items_response_revision_not_null;
alter table public.test_ai_grading_run_items
  validate constraint test_ai_grading_run_items_response_revision_check;
alter table public.test_ai_grading_run_items
  validate constraint test_ai_grading_run_items_question_grading_snapshot_check;

alter table public.test_responses
  alter column revision set not null;
alter table public.test_ai_grading_run_items
  alter column response_revision set not null;

alter table public.test_responses
  drop constraint test_responses_revision_not_null;
alter table public.test_ai_grading_run_items
  drop constraint test_ai_grading_run_items_response_revision_not_null;
