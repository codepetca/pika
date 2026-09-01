import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/148_auth_session_and_rate_limit_hardening.sql',
)

describe('authentication session and rate-limit migration', () => {
  const migration = readFileSync(migrationPath, 'utf8')

  it('stores only hashed opaque sessions with bounded source and expiry contracts', () => {
    expect(migration).toContain('create table public.auth_sessions')
    expect(migration).toContain("check (token_hash ~ '^[0-9a-f]{64}$')")
    expect(migration).toContain("check (auth_source in ('password', 'workos'))")
    expect(migration).toContain('check (expires_at > created_at)')
    expect(migration).toContain('references public.users(id) on delete cascade')
  })

  it('keeps session and throttle records inaccessible to browser roles', () => {
    expect(migration).toContain('alter table public.auth_sessions enable row level security;')
    expect(migration).toContain('alter table public.auth_rate_limits enable row level security;')
    expect(migration).toContain(
      'revoke all on table public.auth_sessions from public, anon, authenticated;',
    )
    expect(migration).toContain(
      'revoke all on function public.consume_auth_rate_limit(text, text, integer, integer)',
    )
    expect(migration).toContain('to service_role;')
  })

  it('serializes rolling limit decisions and returns a bounded retry interval', () => {
    expect(migration).toContain('for update;')
    expect(migration).toContain('cardinality(v_recent_attempts) >= p_max_attempts')
    expect(migration).toContain("'retry_after_seconds', v_retry_after_seconds")
    expect(migration).toContain('make_interval(secs => p_window_seconds)')
    expect(migration).toContain("where updated_at < v_now - interval '1 day';")
  })

  it('consumes reset handoff, updates the password, and revokes every session atomically', () => {
    expect(migration).toContain('create function public.consume_password_reset_and_revoke_sessions')
    expect(migration).toContain('set handoff_consumed_at = v_now')
    expect(migration).toContain('set password_hash = p_password_hash')
    expect(migration).toContain('delete from public.auth_sessions where user_id = p_user_id;')
  })
})
