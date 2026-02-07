-- Add authenticity scoring columns to assignment_docs
ALTER TABLE assignment_docs
  ADD COLUMN authenticity_score smallint CHECK (authenticity_score >= 0 AND authenticity_score <= 100),
  ADD COLUMN authenticity_flags jsonb;
