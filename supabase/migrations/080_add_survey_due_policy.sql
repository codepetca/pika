ALTER TABLE public.surveys
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS due_policy text NOT NULL DEFAULT 'soft';

ALTER TABLE public.surveys
  DROP CONSTRAINT IF EXISTS surveys_due_policy_check;

ALTER TABLE public.surveys
  ADD CONSTRAINT surveys_due_policy_check
  CHECK (due_policy IN ('soft', 'hard'));
