import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/100_harden_assignment_ai_grading_claim.sql'),
  'utf8',
)

describe('assignment AI grading claim hardening migration', () => {
  it('replaces the legacy claim with a fixed search path and validated arguments', () => {
    expect(migration).toContain('create or replace function public.claim_assignment_ai_grading_run')
    expect(migration).toContain("set search_path = ''")
    expect(migration).toContain('p_run_id is null')
    expect(migration).toContain('p_lease_token is null')
    expect(migration).toContain('p_lease_seconds < 1')
  })

  it('exposes the security-definer function only to the service role', () => {
    expect(migration).toContain(
      'revoke all on function public.claim_assignment_ai_grading_run(uuid, uuid, integer)',
    )
    expect(migration).toContain('from public, anon, authenticated, service_role')
    expect(migration).toContain(
      'grant execute on function public.claim_assignment_ai_grading_run(uuid, uuid, integer)',
    )
    expect(migration).toContain('to service_role')
    expect(migration).not.toContain('to authenticated')
  })
})
