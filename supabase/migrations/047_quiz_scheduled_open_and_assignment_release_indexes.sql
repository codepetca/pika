-- Add scheduled-open support for quizzes and release-time query indexes.

ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS opens_at timestamptz;

-- Backfill legacy rows so active/closed quizzes have an open timestamp.
UPDATE public.quizzes
SET opens_at = created_at
WHERE opens_at IS NULL
  AND status IN ('active', 'closed');

-- Student-visible quiz lookup: active quizzes that have opened.
CREATE INDEX IF NOT EXISTS idx_quizzes_classroom_status_opens_at
  ON public.quizzes (classroom_id, status, opens_at);

-- Student-visible assignment lookup: released and not draft.
CREATE INDEX IF NOT EXISTS idx_assignments_classroom_draft_released
  ON public.assignments (classroom_id, is_draft, released_at);
