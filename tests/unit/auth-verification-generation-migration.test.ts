import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/246_auth_verification_generation_fence.sql', 'utf8')
const harness = readFileSync('scripts/check-auth-verification-generation-database.sh', 'utf8')

describe('authentication verification generation migration', () => {
  it('assigns a monotonic per-user and purpose generation', () => {
    expect(migration).toContain('add column verification_generation bigint')
    expect(migration).toContain('partition by user_id, purpose')
    expect(migration).toContain('verification_codes_user_purpose_generation_unique')
    expect(migration).toContain('coalesce(max(verification_generation), 0) + 1')
  })

  it('serializes every state transition on the same user row', () => {
    for (const name of [
      'issue_auth_verification_code_v1',
      'finalize_auth_verification_attempt_v1',
      'consume_signup_password_handoff_v1',
      'consume_latest_password_reset_and_revoke_sessions_v1',
    ]) {
      const body = migration.slice(migration.indexOf(`function public.${name}`))
      expect(body.slice(0, body.indexOf('$function$;', 12))).toMatch(/from public\.users[\s\S]*for update;/)
    }
  })

  it('rechecks the exact latest generation in finalization and both password writes', () => {
    expect(migration.match(/verification_generation = \(\s*select max\(latest\.verification_generation\)/g)).toHaveLength(4)
    expect(migration).toContain('v_code.verification_generation is distinct from p_candidate_generation')
    expect(migration).toContain('v_code.expires_at <= v_now')
    expect(migration).toContain('v_code.attempts >= p_max_attempts')
    expect(migration).toContain('auth_credential_version is distinct from p_expected_credential_version')
  })

  it('invalidates old codes and minted handoffs when issuing a new generation', () => {
    expect(migration).toMatch(/update public\.verification_codes[\s\S]*set used_at = coalesce\(used_at, v_now\)[\s\S]*handoff_consumed_at/)
  })

  it('exposes only service-role RPC execution', () => {
    expect(migration).toContain('revoke all on table public.verification_codes from public, anon, authenticated, service_role;')
    expect(migration).not.toMatch(/grant execute[\s\S]*to (anon|authenticated)/)
    expect(migration.match(/to service_role;/g)?.length).toBeGreaterThanOrEqual(7)
  })

  it('ships a guarded two-session harness for stale comparison, stale handoff, and attempt limits', () => {
    expect(harness).toContain('Refusing to source the authentication generation database harness.')
    expect(harness).toContain('--execute-local-contract')
    expect(harness).toContain('Read-only preflight precedes every fixture mutation.')
    expect(harness).toContain('Refusing to overwrite an existing authentication generation fixture identity.')
    expect(harness).toContain('finalize_pid=$!')
    expect(harness).toContain('issue_pid=$!')
    expect(harness).toContain('Finalization barrier was not observed.')
    expect(harness).toContain('Issuance was not observed waiting behind finalization.')
    expect(harness).toContain('A superseded code minted a handoff.')
    expect(harness).toContain('A handoff minted before a resend remained current.')
    expect(harness).toContain('Wrong attempts exceeded the atomic limit.')
  })
})
