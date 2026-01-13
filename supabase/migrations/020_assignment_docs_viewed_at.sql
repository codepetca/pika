-- Migration: Add viewed_at column to assignment_docs for tracking new assignment notifications
-- This column tracks when a student first viewed/opened an assignment

-- Add viewed_at column (nullable - NULL means never viewed)
ALTER TABLE public.assignment_docs
  ADD COLUMN IF NOT EXISTS viewed_at timestamptz;

-- Create index for efficient queries on unviewed assignments by student
CREATE INDEX IF NOT EXISTS idx_assignment_docs_viewed_at
  ON public.assignment_docs (student_id, viewed_at);

-- Documentation comment
COMMENT ON COLUMN public.assignment_docs.viewed_at IS
  'Timestamp when student first viewed this assignment. NULL means never viewed.';
