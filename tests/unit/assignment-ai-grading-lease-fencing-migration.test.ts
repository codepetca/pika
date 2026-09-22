import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/202_assignment_ai_grading_lease_fencing.sql'),
  'utf8',
)

describe('assignment AI grading lease fencing migration', () => {
  it('checks both the run and item lease before mutation or finalization', () => {
    expect(migration).toContain('run.lease_token is distinct from p_lease_token')
    expect(migration).toContain('run.lease_expires_at <= clock_timestamp()')
    expect(migration).toContain('item.run_id = v_run.id')
    expect(migration).toContain("item.status in ('queued', 'processing')")
    expect(migration).toContain('finalize_assignment_ai_grading_item_with_provenance_lease_v1')
  })

  it('keeps every mutation service-only with a fixed search path', () => {
    expect(migration.match(/security definer/g)).toHaveLength(3)
    expect(migration.match(/set search_path = ''/g)).toHaveLength(3)
    expect(migration).toContain('from public, anon, authenticated, service_role')
    expect(migration).toContain('to service_role')
  })
})
