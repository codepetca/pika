-- Log summaries: AI-generated summaries of student logs per classroom per date
CREATE TABLE IF NOT EXISTS log_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id uuid NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  date date NOT NULL,
  summary_items jsonb NOT NULL DEFAULT '[]',
  initials_map jsonb NOT NULL DEFAULT '{}',
  entry_count integer NOT NULL DEFAULT 0,
  entries_updated_at timestamptz,
  model text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(classroom_id, date)
);

CREATE INDEX IF NOT EXISTS idx_log_summaries_classroom_date ON log_summaries(classroom_id, date);

-- Enable Row Level Security (server-side management only)
ALTER TABLE log_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct access to log_summaries" ON log_summaries;
CREATE POLICY "No direct access to log_summaries" ON log_summaries
  FOR ALL
  USING (FALSE);
