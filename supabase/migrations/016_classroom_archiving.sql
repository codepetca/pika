-- Add soft-archive support for classrooms

ALTER TABLE classrooms
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_classrooms_teacher_active
  ON classrooms(teacher_id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_classrooms_teacher_archived
  ON classrooms(teacher_id)
  WHERE archived_at IS NOT NULL;
