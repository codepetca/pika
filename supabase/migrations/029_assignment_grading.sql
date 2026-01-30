-- Add grading columns to assignment_docs
ALTER TABLE assignment_docs
  ADD COLUMN score_completion smallint CHECK (score_completion >= 0 AND score_completion <= 10),
  ADD COLUMN score_thinking   smallint CHECK (score_thinking   >= 0 AND score_thinking   <= 10),
  ADD COLUMN score_workflow   smallint CHECK (score_workflow   >= 0 AND score_workflow   <= 10),
  ADD COLUMN feedback         text,
  ADD COLUMN graded_at        timestamptz,
  ADD COLUMN graded_by        text,
  ADD COLUMN returned_at      timestamptz;
