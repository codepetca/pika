-- Migration 039: Login lockout persistence
-- Moves login lockout tracking from in-memory to database
-- so that lockout state survives serverless function restarts.

CREATE TABLE IF NOT EXISTS login_attempts (
  email       TEXT PRIMARY KEY,
  count       INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-cleanup: delete stale rows older than 1 hour
-- (can be called from a cron or on every lookup)
CREATE OR REPLACE FUNCTION cleanup_expired_login_attempts()
RETURNS void AS $$
BEGIN
  DELETE FROM login_attempts
  WHERE (locked_until IS NOT NULL AND locked_until < now())
     OR (locked_until IS NULL AND updated_at < now() - INTERVAL '1 hour');
END;
$$ LANGUAGE plpgsql;
