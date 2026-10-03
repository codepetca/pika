import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('preserving-removal local proof compatibility', () => {
  it('uses the installed Zod 4 record key/value contract', () => {
    const sdk = readFileSync(resolve('scripts/check-contextual-roster-removal-owner-writes.ts'), 'utf8')
    expect(sdk).not.toContain('z.record(z.unknown())')
    expect(sdk).toContain('z.record(z.string(), z.unknown())')
  })

  it('provisions the exact synthetic purge operation before attendance state exists', () => {
    const sql = readFileSync(resolve('scripts/check-contextual-roster-removal-owner-writes-database.sql'), 'utf8')
    expect(sql.indexOf('insert into public.student_purge_operations')).toBeGreaterThan(0)
    expect(sql.indexOf('insert into public.student_purge_operations'))
      .toBeLessThan(sql.indexOf('insert into public.attendance_participant_mappings'))
    expect(sql).toContain('operation:=f.purge_operation;')
  })

  it('cleans only verified synthetic attendance mappings before deleting a fixture class', () => {
    const sdk = readFileSync(resolve('scripts/check-contextual-roster-removal-owner-writes.ts'), 'utf8')
    expect(sdk.includes('delete from public.attendance_participant_mappings m using removal_mapping_snapshot')).toBe(true)
    expect(sdk.indexOf('delete from public.attendance_participant_mappings m using removal_mapping_snapshot'))
      .toBeLessThan(sdk.indexOf('delete from public.classrooms c using'))
    expect(sdk.includes('disable trigger reject_attendance')).toBe(false)
  })
})
