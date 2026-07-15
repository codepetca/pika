-- Add unvalidated constraints in a short transaction so DDL locks commit quickly.

alter table public.test_responses
  add constraint test_responses_revision_not_null
  check (revision is not null) not valid;
alter table public.test_responses
  add constraint test_responses_revision_check
  check (revision > 0) not valid;

alter table public.test_ai_grading_run_items
  add constraint test_ai_grading_run_items_response_revision_not_null
  check (response_revision is not null) not valid;
alter table public.test_ai_grading_run_items
  add constraint test_ai_grading_run_items_response_revision_check
  check (response_revision > 0) not valid;

alter table public.test_ai_grading_run_items
  add constraint test_ai_grading_run_items_question_grading_snapshot_check
  check (
    question_grading_snapshot is null
    or jsonb_typeof(question_grading_snapshot) = 'object'
  ) not valid;
