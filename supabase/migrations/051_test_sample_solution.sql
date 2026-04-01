-- Add optional sample solutions for open-response test questions.

alter table public.test_questions
  add column if not exists sample_solution text;

alter table public.test_questions
  drop constraint if exists test_questions_sample_solution_check;

alter table public.test_questions
  add constraint test_questions_sample_solution_check
  check (question_type = 'open_response' or sample_solution is null);
