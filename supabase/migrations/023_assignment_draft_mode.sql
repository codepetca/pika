-- Add draft mode to assignments
-- Assignments start as drafts and can be released (one-way operation)

-- Add is_draft column (default TRUE for new assignments)
ALTER TABLE assignments ADD COLUMN is_draft BOOLEAN NOT NULL DEFAULT TRUE;

-- Add released_at timestamp (NULL for drafts, set when released)
ALTER TABLE assignments ADD COLUMN released_at TIMESTAMPTZ;

-- Backfill existing assignments as released (no disruption to existing data)
UPDATE assignments SET is_draft = FALSE, released_at = created_at;

-- Index for efficient student queries (filter by is_draft = FALSE)
CREATE INDEX idx_assignments_classroom_draft ON assignments(classroom_id, is_draft);
