-- Drop legacy passwordless artifacts (login_codes) and unused sessions table

-- Drop legacy login_codes table (passwordless codes)
DROP POLICY IF EXISTS "No direct access" ON login_codes;
DROP TABLE IF EXISTS login_codes;

-- Drop unused sessions table (iron-session is used for app sessions)
DROP POLICY IF EXISTS "No direct access" ON sessions;
DROP TABLE IF EXISTS sessions;
