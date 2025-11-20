-- Classrooms Refactor Migration
-- This migration introduces multi-classroom support

-- ============================================================
-- STEP 1: Delete existing data from class_days and entries
-- ============================================================
DELETE FROM entries;
DELETE FROM class_days;

-- ============================================================
-- STEP 2: Create new tables
-- ============================================================

-- Create classrooms table
CREATE TABLE IF NOT EXISTS classrooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  class_code TEXT NOT NULL,
  term_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for classrooms
CREATE INDEX idx_classrooms_teacher_id ON classrooms(teacher_id);
CREATE INDEX idx_classrooms_class_code ON classrooms(class_code);

-- Create trigger to update updated_at for classrooms
CREATE TRIGGER update_classrooms_updated_at
  BEFORE UPDATE ON classrooms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create student_profiles table
CREATE TABLE IF NOT EXISTS student_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_number TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Create index for student_profiles
CREATE INDEX idx_student_profiles_user_id ON student_profiles(user_id);
CREATE INDEX idx_student_profiles_student_number ON student_profiles(student_number);

-- Create classroom_enrollments table
CREATE TABLE IF NOT EXISTS classroom_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(classroom_id, student_id)
);

-- Create indexes for classroom_enrollments
CREATE INDEX idx_classroom_enrollments_classroom_id ON classroom_enrollments(classroom_id);
CREATE INDEX idx_classroom_enrollments_student_id ON classroom_enrollments(student_id);

-- ============================================================
-- STEP 3: Modify existing tables to use classroom_id
-- ============================================================

-- Drop old constraints and indexes from class_days
DROP INDEX IF EXISTS idx_class_days_course_date;
ALTER TABLE class_days DROP CONSTRAINT IF EXISTS class_days_course_code_date_key;

-- Add classroom_id to class_days and drop course_code
ALTER TABLE class_days
  ADD COLUMN classroom_id UUID REFERENCES classrooms(id) ON DELETE CASCADE;

ALTER TABLE class_days
  DROP COLUMN course_code;

-- Make classroom_id NOT NULL after adding it
ALTER TABLE class_days
  ALTER COLUMN classroom_id SET NOT NULL;

-- Add new unique constraint and index
ALTER TABLE class_days
  ADD CONSTRAINT class_days_classroom_date_unique UNIQUE(classroom_id, date);

CREATE INDEX idx_class_days_classroom_date ON class_days(classroom_id, date);

-- Drop old constraints and indexes from entries
DROP INDEX IF EXISTS idx_entries_course_date;
ALTER TABLE entries DROP CONSTRAINT IF EXISTS entries_student_id_course_code_date_key;

-- Add classroom_id to entries and drop course_code
ALTER TABLE entries
  ADD COLUMN classroom_id UUID REFERENCES classrooms(id) ON DELETE CASCADE;

ALTER TABLE entries
  DROP COLUMN course_code;

-- Make classroom_id NOT NULL after adding it
ALTER TABLE entries
  ALTER COLUMN classroom_id SET NOT NULL;

-- Add new unique constraint and index
ALTER TABLE entries
  ADD CONSTRAINT entries_student_classroom_date_unique UNIQUE(student_id, classroom_id, date);

CREATE INDEX idx_entries_classroom_date ON entries(classroom_id, date);

-- ============================================================
-- STEP 4: Update Row Level Security policies
-- ============================================================

-- Enable RLS on new tables
ALTER TABLE classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_enrollments ENABLE ROW LEVEL SECURITY;

-- Classrooms policies (server-side management only)
CREATE POLICY "No direct access to classrooms" ON classrooms
  FOR ALL
  USING (FALSE);

-- Student profiles policies (server-side management only)
CREATE POLICY "No direct access to student_profiles" ON student_profiles
  FOR ALL
  USING (FALSE);

-- Classroom enrollments policies (server-side management only)
CREATE POLICY "No direct access to enrollments" ON classroom_enrollments
  FOR ALL
  USING (FALSE);
