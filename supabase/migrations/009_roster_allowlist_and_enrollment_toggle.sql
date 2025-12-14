-- Roster Allow-List + Enrollment Toggle
-- Adds:
--  - classrooms.allow_enrollment (default true)
--  - classroom_roster (teacher-managed allow-list for enrollment)

-- ============================================================
-- STEP 1: Add allow_enrollment to classrooms
-- ============================================================
ALTER TABLE classrooms
  ADD COLUMN IF NOT EXISTS allow_enrollment BOOLEAN NOT NULL DEFAULT TRUE;

-- ============================================================
-- STEP 2: Create classroom_roster allow-list table
-- ============================================================
CREATE TABLE IF NOT EXISTS classroom_roster (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  student_number TEXT,
  first_name TEXT,
  last_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(classroom_id, email)
);

CREATE INDEX IF NOT EXISTS idx_classroom_roster_classroom_id ON classroom_roster(classroom_id);
CREATE INDEX IF NOT EXISTS idx_classroom_roster_email ON classroom_roster(email);

CREATE TRIGGER update_classroom_roster_updated_at
  BEFORE UPDATE ON classroom_roster
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- STEP 3: Backfill classroom_roster from existing enrollments
-- ============================================================
INSERT INTO classroom_roster (classroom_id, email, student_number, first_name, last_name)
SELECT DISTINCT
  e.classroom_id,
  LOWER(u.email) AS email,
  sp.student_number,
  sp.first_name,
  sp.last_name
FROM classroom_enrollments e
JOIN users u ON u.id = e.student_id
LEFT JOIN student_profiles sp ON sp.user_id = u.id
ON CONFLICT (classroom_id, email) DO NOTHING;

-- ============================================================
-- STEP 4: Row Level Security (server-managed only)
-- ============================================================
ALTER TABLE classroom_roster ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to classroom_roster" ON classroom_roster
  FOR ALL
  USING (FALSE);

