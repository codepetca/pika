-- Create entry_summaries table (cached 1-line summaries for student daily logs)
CREATE TABLE IF NOT EXISTS entry_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entry_id)
);

CREATE INDEX IF NOT EXISTS idx_entry_summaries_entry_id ON entry_summaries(entry_id);

-- Reuse the existing updated_at trigger function created in migration 004.
DROP TRIGGER IF EXISTS update_entry_summaries_updated_at ON entry_summaries;
CREATE TRIGGER update_entry_summaries_updated_at
  BEFORE UPDATE ON entry_summaries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (server-side management only)
ALTER TABLE entry_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct access to entry_summaries" ON entry_summaries;
CREATE POLICY "No direct access to entry_summaries" ON entry_summaries
  FOR ALL
  USING (FALSE);

