-- Add teacher answer keys for open-response test questions and
-- audit metadata for AI-assisted grading decisions.

alter table public.test_questions
  add column if not exists answer_key text;

alter table public.test_questions
  drop constraint if exists test_questions_answer_key_check;

alter table public.test_questions
  add constraint test_questions_answer_key_check
  check (question_type = 'open_response' or answer_key is null);

alter table public.test_responses
  add column if not exists ai_grading_basis text,
  add column if not exists ai_reference_answers jsonb,
  add column if not exists ai_model text;

alter table public.test_responses
  drop constraint if exists test_responses_ai_grading_basis_check;

alter table public.test_responses
  add constraint test_responses_ai_grading_basis_check
  check (ai_grading_basis is null or ai_grading_basis in ('teacher_key', 'generated_reference'));

alter table public.test_responses
  drop constraint if exists test_responses_ai_reference_answers_check;

alter table public.test_responses
  add constraint test_responses_ai_reference_answers_check
  check (
    ai_reference_answers is null
    or jsonb_typeof(ai_reference_answers) = 'array'
  );
