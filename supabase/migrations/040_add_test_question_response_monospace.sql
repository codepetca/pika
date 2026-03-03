-- Add per-question rendering preference for open-response test answers.
alter table public.test_questions
  add column if not exists response_monospace boolean not null default false;
