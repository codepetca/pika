-- Migration: Add RLS to classroom_resources table
-- Purpose: Secure classroom resources - teachers can manage, students can read

-- Enable Row Level Security
ALTER TABLE classroom_resources ENABLE ROW LEVEL SECURITY;

-- Teachers can manage resources for their own classrooms
CREATE POLICY "Teachers can manage resources for their classrooms"
  ON classroom_resources FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM classrooms
      WHERE classrooms.id = classroom_resources.classroom_id
      AND classrooms.teacher_id = auth.uid()
    )
  );

-- Students can view resources for classrooms they're enrolled in
CREATE POLICY "Students can view resources for enrolled classrooms"
  ON classroom_resources FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM classroom_enrollments
      WHERE classroom_enrollments.classroom_id = classroom_resources.classroom_id
      AND classroom_enrollments.student_id = auth.uid()
    )
  );
