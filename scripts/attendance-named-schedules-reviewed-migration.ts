/** Exact source-only named attendance schedules extension. This seal grants no
 * migration, fixture execution, activation, or database application authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const ATTENDANCE_NAMED_SCHEDULES_REVIEWED_MIGRATION = Object.freeze({
  name: '296_attendance_named_schedules.sql',
  sha256: '8fdefed93d0a1c3c0466e02b90cef0cab4c56fe0ce71476856e20aee01508b83',
})

export function validateAttendanceNamedSchedulesReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert(migration, 'Reviewed attendance named schedules migration absent')
  const seal = ATTENDANCE_NAMED_SCHEDULES_REVIEWED_MIGRATION
  assert.equal(migration.name, seal.name)
  assert.equal(migration.sha256, seal.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
}
