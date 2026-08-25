import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/133_attendance_pilot_readiness.sql',
), 'utf8')

describe('attendance pilot readiness migration', () => {
  it('uses one stable aggregate statement and keeps execution service-only', () => {
    expect(migration).toContain('function public.get_attendance_pilot_readiness_v1')
    expect(migration).toContain('language sql\nstable\nsecurity invoker')
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
    expect(migration).not.toMatch(/\b(insert|update|delete|merge|truncate)\b/i)
  })

  it('associates every fully synced count with the configured classroom', () => {
    expect(migration).toContain('mapping.classroom_id = policy.classroom_id')
    expect(migration).toContain("mapping.integration_state = 'active'")
    expect(migration).toContain('mapping.synced_revision >= mapping.source_revision')
    expect(migration).toContain(
      'mapping.schedule_synced_revision >= mapping.schedule_source_revision',
    )
  })
})
