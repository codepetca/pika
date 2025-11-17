-- Create login_codes table
CREATE TABLE IF NOT EXISTS login_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_login_codes_email ON login_codes(email);
CREATE INDEX idx_login_codes_expires_at ON login_codes(expires_at);

-- Enable Row Level Security
ALTER TABLE login_codes ENABLE ROW LEVEL SECURITY;

-- No direct access via RLS (managed server-side only)
CREATE POLICY "No direct access" ON login_codes
  FOR ALL
  USING (FALSE);
