-- Auth Refactor Migration
-- Adds password-based authentication support

-- Add new fields to users table
ALTER TABLE users
  ADD COLUMN email_verified_at TIMESTAMPTZ,
  ADD COLUMN password_hash TEXT;

-- Create verification_codes table for signup and password reset
CREATE TABLE IF NOT EXISTS verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('signup', 'reset_password')),
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for verification_codes
CREATE INDEX idx_verification_codes_user_id ON verification_codes(user_id);
CREATE INDEX idx_verification_codes_expires_at ON verification_codes(expires_at);
CREATE INDEX idx_verification_codes_purpose ON verification_codes(purpose);

-- Enable Row Level Security
ALTER TABLE verification_codes ENABLE ROW LEVEL SECURITY;

-- No direct access via RLS (managed server-side only)
CREATE POLICY "No direct access" ON verification_codes
  FOR ALL
  USING (FALSE);

-- Create sessions table for long-lived sessions
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for sessions
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- Enable Row Level Security
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- No direct access via RLS (managed server-side only)
CREATE POLICY "No direct access" ON sessions
  FOR ALL
  USING (FALSE);
