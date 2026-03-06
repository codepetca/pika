-- Persist generated open-response reference answers per question version
-- so auto-grade can reuse them across runs.

alter table public.test_questions
  add column if not exists ai_reference_cache_key text,
  add column if not exists ai_reference_cache_answers jsonb,
  add column if not exists ai_reference_cache_model text,
  add column if not exists ai_reference_cache_generated_at timestamptz;

alter table public.test_questions
  drop constraint if exists test_questions_ai_reference_cache_answers_check;

alter table public.test_questions
  add constraint test_questions_ai_reference_cache_answers_check
  check (
    ai_reference_cache_answers is null
    or jsonb_typeof(ai_reference_cache_answers) = 'array'
  );

alter table public.test_questions
  drop constraint if exists test_questions_ai_reference_cache_open_response_check;

alter table public.test_questions
  add constraint test_questions_ai_reference_cache_open_response_check
  check (
    question_type = 'open_response'
    or (
      ai_reference_cache_key is null
      and ai_reference_cache_answers is null
      and ai_reference_cache_model is null
      and ai_reference_cache_generated_at is null
    )
  );
