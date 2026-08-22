import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/129_bara_attendance_canary_scope.sql'),
  'utf8',
)

describe('Bara attendance canary migration', () => {
  it('scopes worker leases, health, reconciliation, schedules, and ingress', () => {
    for (const functionName of [
      'list_attendance_sync_targets_v2',
      'list_attendance_reconciliation_targets_v2',
      'claim_attendance_outbox_batch_v2',
      'attendance_outbox_health_v2',
      'apply_attendance_event_for_classroom_v1',
    ]) expect(migration).toContain(`function public.${functionName}`)

    expect(migration).toContain('candidate.classroom_id = p_classroom_id')
    expect(migration).toContain('classroom.teacher_id = p_teacher_id')
    expect(migration).toContain('classroom.archived_at is null')
    expect(migration).toContain('for share')
    expect(migration).toContain('for update of candidate skip locked')
    expect(migration).toContain("errcode = '55000', message = 'attendance_canary_not_active'")
    expect(migration).toContain('return public.apply_attendance_event_v1')
  })

  it('exposes scoped functions only to the service role', () => {
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration.match(/to service_role;/g)?.length).toBe(5)
  })
})
