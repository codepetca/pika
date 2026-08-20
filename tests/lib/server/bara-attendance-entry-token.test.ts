import { describe, expect, it } from 'vitest'
import {
  AttendanceEntryTokenError,
  openAttendanceEntryToken,
  sealAttendanceEntryToken,
} from '@/lib/server/bara-attendance-entry-token'

const secret = 'entry-token-secret-that-is-long-enough-for-tests'
const payload = {
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
})
