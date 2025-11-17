-- Create entries table
CREATE TABLE IF NOT EXISTS entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_code TEXT NOT NULL,
  date DATE NOT NULL,
  text TEXT NOT NULL,
  minutes_reported INTEGER,
  mood TEXT CHECK (mood IN ('😊', '🙂', '😐', '😟', '😢')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  on_time BOOLEAN NOT NULL,
  UNIQUE(student_id, course_code, date)
);

-- Create indexes
CREATE INDEX idx_entries_student_id ON entries(student_id);
CREATE INDEX idx_entries_course_date ON entries(course_code, date);
CREATE INDEX idx_entries_date ON entries(date);

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_entries_updated_at
  BEFORE UPDATE ON entries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;

-- Students can read their own entries
CREATE POLICY "Students can read own entries" ON entries
  FOR SELECT
  USING (auth.uid()::text = student_id::text);

-- Managed server-side via API (no direct writes)
DROP POLICY IF EXISTS "No direct writes" ON entries;

CREATE POLICY "No direct writes" ON entries
  FOR INSERT
  WITH CHECK (FALSE);

CREATE POLICY "No direct updates" ON entries
  FOR UPDATE
  USING (FALSE);
