-- Migration 038: Add performance indexes for high-query paths
-- These indexes target the most common query patterns:
--   - Daily attendance lookups (entries by classroom + date)
--   - Student assignment doc lookups (by assignment + student)
--   - Enrollment lookups (by student)
--   - Class day lookups (by classroom + date)

-- Entries: attendance queries filter by (classroom_id, date)
CREATE INDEX IF NOT EXISTS idx_entries_classroom_date
  ON entries (classroom_id, date);

-- Entries: student entry lookups filter by (student_id, classroom_id, date)
CREATE INDEX IF NOT EXISTS idx_entries_student_classroom_date
  ON entries (student_id, classroom_id, date);

-- Assignment docs: submission stats and student doc lookups
CREATE INDEX IF NOT EXISTS idx_assignment_docs_assignment_student
  ON assignment_docs (assignment_id, student_id);

-- Enrollment: student classroom list (used in student/classrooms GET)
CREATE INDEX IF NOT EXISTS idx_classroom_enrollments_student
  ON classroom_enrollments (student_id);

-- Class days: classroom schedule queries
CREATE INDEX IF NOT EXISTS idx_class_days_classroom_date
  ON class_days (classroom_id, date);

-- Assignment doc history: history lookups by doc id (ordered by created_at)
CREATE INDEX IF NOT EXISTS idx_assignment_doc_history_doc_created
  ON assignment_doc_history (assignment_doc_id, created_at DESC);

-- Verification codes: lookup by user_id and purpose for rate limiting
CREATE INDEX IF NOT EXISTS idx_verification_codes_user_purpose
  ON verification_codes (user_id, purpose, created_at DESC);
