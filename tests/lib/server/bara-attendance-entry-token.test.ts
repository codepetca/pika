import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AttendanceEntryTokenError,
  deriveStudentAttendanceMembershipOccurrenceBinding,
  deriveStudentAttendanceOccurrenceBinding,
  openAttendanceEntryToken,
  sealAttendanceEntryToken,
} from '@/lib/server/bara-attendance-entry-token'

const secret = 'entry-token-secret-that-is-long-enough-for-tests'
const payload = {
  classroomId: '20000000-0000-4000-8000-000000000002',
  rosterRef: 'roster_one',
  occurrenceRef: 'occurrence_one',
  checkInToken: 'check_in_token_1234567890',
  expiresAt: '2026-09-02T13:20:00.000Z',
}

describe('Pika attendance entry tokens', () => {
  it('seals Bara references into an opaque Pika token and opens it exactly', () => {
    const token = sealAttendanceEntryToken(payload, {
      secret,
      iv: Buffer.alloc(12, 7),
    })

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token).not.toContain(payload.occurrenceRef)
    expect(token).not.toContain(payload.checkInToken)
    expect(openAttendanceEntryToken(token, {
      secret,
      now: Date.parse('2026-09-02T13:00:00Z'),
    })).toEqual(payload)
  })

  it('rejects tampering and expiry without exposing the sealed values', () => {
    const token = sealAttendanceEntryToken(payload, { secret })
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`

    expect(() => openAttendanceEntryToken(tampered, { secret }))
      .toThrowError(new AttendanceEntryTokenError('invalid'))
    expect(() => openAttendanceEntryToken(token, {
      secret,
      now: Date.parse(payload.expiresAt),
    })).toThrowError(new AttendanceEntryTokenError('expired'))
  })

  it('derives a student-scoped non-reversible occurrence binding', () => {
    const binding = deriveStudentAttendanceOccurrenceBinding({
      studentId: '30000000-0000-4000-8000-000000000001',
      occurrenceRef: payload.occurrenceRef,
      secret,
    })

    expect(binding).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(binding).toBe('uYq8Ib4MK9qFG4OiEP3avs8TYtsac3i1')
    expect(binding).not.toContain(payload.occurrenceRef)
    expect(deriveStudentAttendanceOccurrenceBinding({
      studentId: '30000000-0000-4000-8000-000000000001',
      occurrenceRef: payload.occurrenceRef,
      secret,
    })).toBe(binding)
    expect(deriveStudentAttendanceOccurrenceBinding({
      studentId: '30000000-0000-4000-8000-000000000002',
      occurrenceRef: payload.occurrenceRef,
      secret,
    })).not.toBe(binding)
  })
})

describe('student attendance membership occurrence bindings', () => {
  const membership = {
    studentId: '30000000-0000-4000-8000-000000000001',
    classroomId: payload.classroomId,
    generationId: '40000000-0000-4000-8000-000000000001',
    participantRef: 'participant_11111111111111111111111111111111',
    occurrenceRef: payload.occurrenceRef,
    secret,
  }

  afterEach(() => vi.unstubAllEnvs())

  it('derives a stable opaque binding for the complete exact membership scope', () => {
    const binding = deriveStudentAttendanceMembershipOccurrenceBinding(membership)

    expect(binding).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(binding).toBe('CI4s4mEgqTuYwSQu-GKjb1m6zDpO3EYF')
    expect(deriveStudentAttendanceMembershipOccurrenceBinding({ ...membership })).toBe(binding)
    expect(binding).not.toContain(membership.participantRef)
    expect(binding).not.toContain(membership.occurrenceRef)
  })

  it('separates every scope field and the entry secret', () => {
    const alternatives = [
      { studentId: '30000000-0000-4000-8000-000000000002' },
      { classroomId: '20000000-0000-4000-8000-000000000003' },
      { generationId: '40000000-0000-4000-8000-000000000002' },
      { participantRef: 'participant_22222222222222222222222222222222' },
      { occurrenceRef: 'occurrence_two' },
      { secret: 'another-entry-token-secret-long-enough-for-tests' },
    ]
    const bindings = [membership, ...alternatives.map(alternative => ({ ...membership, ...alternative }))]
      .map(input => deriveStudentAttendanceMembershipOccurrenceBinding(input))

    expect(new Set(bindings).size).toBe(bindings.length)
  })

  it('uses a separate domain from the legacy student occurrence binding', () => {
    expect(deriveStudentAttendanceMembershipOccurrenceBinding(membership))
      .not.toBe(deriveStudentAttendanceOccurrenceBinding(membership))
  })

  it.each(['studentId', 'classroomId', 'generationId'] as const)(
    'rejects a malformed or unbounded %s',
    field => {
      for (const value of ['', 'not-a-uuid', `${membership[field]}\0`, 'a'.repeat(129)]) {
        expect(() => deriveStudentAttendanceMembershipOccurrenceBinding({ ...membership, [field]: value }))
          .toThrowError(new AttendanceEntryTokenError('invalid'))
      }
    },
  )

  it.each([
    '',
    'participant_one',
    'participant_' + '1'.repeat(31),
    'participant_' + '1'.repeat(33),
    'participant_' + 'A'.repeat(32),
    'participant_' + 'g'.repeat(32),
    'other_' + '1'.repeat(32),
    'participant_' + '1'.repeat(32) + '\0',
  ])('rejects malformed participant ref %j', participantRef => {
    expect(() => deriveStudentAttendanceMembershipOccurrenceBinding({ ...membership, participantRef }))
      .toThrowError(new AttendanceEntryTokenError('invalid'))
  })

  it.each(['', 'a'.repeat(129), 'occurrence one', 'occurrence/one', 'occurrence\0one', 'occurrence_é'])(
    'rejects malformed or unbounded occurrence ref %j',
    occurrenceRef => {
      expect(() => deriveStudentAttendanceMembershipOccurrenceBinding({ ...membership, occurrenceRef }))
        .toThrowError(new AttendanceEntryTokenError('invalid'))
    },
  )

  it.each(['a', 'a'.repeat(128), 'occurrence_AZ09._~-'])(
    'accepts bounded occurrence ref %j',
    occurrenceRef => {
      expect(deriveStudentAttendanceMembershipOccurrenceBinding({ ...membership, occurrenceRef }))
        .toMatch(/^[A-Za-z0-9_-]{32}$/)
    },
  )

  it('uses the existing entry secret when no explicit secret is provided', () => {
    vi.stubEnv('BARA_ATTENDANCE_ENTRY_TOKEN_SECRET', secret)

    expect(deriveStudentAttendanceMembershipOccurrenceBinding({ ...membership, secret: undefined }))
      .toBe(deriveStudentAttendanceMembershipOccurrenceBinding(membership))
  })

  it('fails closed when the entry secret is missing or too short', () => {
    vi.stubEnv('BARA_ATTENDANCE_ENTRY_TOKEN_SECRET', undefined)

    for (const invalidSecret of [undefined, '', 'x'.repeat(31)]) {
      expect(() => deriveStudentAttendanceMembershipOccurrenceBinding({ ...membership, secret: invalidSecret }))
        .toThrowError(new AttendanceEntryTokenError('not_configured'))
    }
  })
})
