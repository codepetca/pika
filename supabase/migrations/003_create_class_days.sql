-- Create class_days table
CREATE TABLE IF NOT EXISTS class_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code TEXT NOT NULL,
  date DATE NOT NULL,
  prompt_text TEXT,
  is_class_day BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(course_code, date)
);

-- Create indexes
CREATE INDEX idx_class_days_course_date ON class_days(course_code, date);
CREATE INDEX idx_class_days_date ON class_days(date);

-- Enable Row Level Security
ALTER TABLE class_days ENABLE ROW LEVEL SECURITY;

-- Anyone can read class days
CREATE POLICY "Anyone can read class days" ON class_days
  FOR SELECT
  USING (TRUE);

-- Only allow server-side writes (teachers via API) — block direct inserts from authenticated/anon roles
CREATE POLICY "No direct writes" ON class_days
  FOR INSERT
  WITH CHECK (FALSE);

CREATE POLICY "No direct updates" ON class_days
  FOR UPDATE
  USING (FALSE);