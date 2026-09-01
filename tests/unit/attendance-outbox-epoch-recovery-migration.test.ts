import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/142_attendance_outbox_epoch_recovery.sql'),
  'utf8',
)

describe('attendance outbox epoch recovery migration', () => {
  it('requires an exact audited operator scope and rotates the epoch atomically', () => {
    expect(migration).toContain('attendance_outbox_epoch_recovery_audit')
    expect(migration).toContain('p_expected_entitlement_revision bigint')
    expect(migration).toContain('p_outbox_ids uuid[]')
    expect(migration).toContain('attendance_outbox_recovery_scope_changed')
    expect(migration).toContain('attendance_outbox_recovery_delivery_active')
    expect(migration).toContain('entitlement_revision is distinct from')
    expect(migration).toContain('outbox.lease_expires_at is null')
    expect(migration).toContain('outbox.message_type not in (\'roster.snapshot\', \'schedule.snapshot\')')
    expect(migration).toContain('public.set_attendance_teacher_entitlement_v1(')
    expect(migration).toContain("set status = 'superseded'")
    expect(migration).toContain("'duplicate', true")
  })

  it('keeps recovery service-role-only and retains immutable audit evidence', () => {
    expect(migration).toMatch(
      /revoke all on table public\.attendance_outbox_epoch_recovery_audit[\s\S]*?public, anon, authenticated, service_role/,
    )
    expect(migration).toMatch(
      /revoke all on function public\.supersede_attendance_outbox_epoch_v1[\s\S]*?from public, anon, authenticated/,
    )
    expect(migration).toMatch(
      /grant execute on function public\.supersede_attendance_outbox_epoch_v1[\s\S]*?to service_role/,
    )
    expect(migration).not.toMatch(/teacher_id uuid[^,\n]*references public\.users/)
  })
})
