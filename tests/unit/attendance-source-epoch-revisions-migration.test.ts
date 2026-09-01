import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/144_attendance_source_epoch_revisions.sql'),
  'utf8',
)

describe('attendance source epoch revisions migration', () => {
  it('binds both internal source documents to the entitlement epoch', () => {
    expect(migration).toMatch(
      /create or replace function public\.attendance_roster_source_document_v1\(p_classroom_id uuid\)[\s\S]*?'entitlement_revision', coalesce\(entitlement\.revision, 0\)/,
    )
    expect(migration).toMatch(
      /create or replace function public\.attendance_schedule_source_document_v1\([\s\S]*?'entitlement_revision', coalesce\(entitlement\.revision, 0\)/,
    )
    expect(migration.match(/left join public\.attendance_teacher_entitlements entitlement/g)).toHaveLength(2)
    expect(migration.match(/on entitlement\.teacher_id = classroom\.teacher_id/g)).toHaveLength(2)
  })

  it('keeps the source helpers private and does not change the outbound contract', () => {
    expect(migration).toMatch(
      /revoke all on function public\.attendance_roster_source_document_v1\(uuid\)[\s\S]*?service_role/,
    )
    expect(migration).toMatch(
      /revoke all on function public\.attendance_schedule_source_document_v1\(uuid, date, date\)[\s\S]*?service_role/,
    )
    expect(migration).not.toContain('create table')
    expect(migration).not.toContain('attendance_integration_outbox')
    expect(migration).not.toContain("'message_type'")
    expect(migration).not.toContain("'idempotency_key'")
  })
})
