import { describe, expect, it } from 'vitest'
import {
  studentPurgeImpactSchema,
  studentPurgeStartRequestSchema,
  studentPurgeStatusSchema,
} from '@/lib/validations/student-purge'

const UUID = '11111111-1111-4111-8111-111111111111'
const UUID_2 = '22222222-2222-4222-8222-222222222222'
const HASH = 'a'.repeat(64)

describe('student purge validation', () => {
  it('accepts a complete impact contract', () => {
    expect(studentPurgeImpactSchema.parse({
      classroom_id: UUID,
      classroom_title: 'Period 1',
      student_id: UUID_2,
      student_email: 'student@example.com',
      source_revision: 1,
      storage_inventory_sha256: HASH,
      relational_inventory_sha256: HASH,
      relational_row_count: 10,
      managed_file_count: 2,
      managed_file_bytes: 123,
      archive_count: 1,
      gradex_extract_count: 0,
      resource_counts: { entries: 4 },
      storage_counts: { student_inline_image: 2 },
      conflicting_operation: null,
      deletion_available: false,
      unavailable_reason: 'Individual-student purge is disabled',
    }).student_email).toBe('student@example.com')
  })

  it('requires exact inventory evidence when starting', () => {
    expect(() => studentPurgeStartRequestSchema.parse({
      operation_id: UUID,
      confirmation: 'student@example.com',
      expected_source_revision: 1,
      expected_storage_inventory_sha256: 'not-a-hash',
      expected_relational_inventory_sha256: HASH,
    })).toThrow()
  })

  it('does not expose the student identity in durable status', () => {
    const status = studentPurgeStatusSchema.parse({
      operation_id: UUID,
      classroom_id: UUID_2,
      status: 'completed',
      retryable: false,
      error_code: null,
      attempt_count: 1,
      resource_counts: {},
      storage_object_counts: { deleted: 2 },
      completed_at: '2026-08-11T12:00:00.000Z',
    })
    expect(status).not.toHaveProperty('student_id')
    expect(status).not.toHaveProperty('student_email')
  })
})
