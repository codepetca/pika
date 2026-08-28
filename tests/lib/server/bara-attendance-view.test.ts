import { describe, expect, it } from 'vitest'
import { buildTeacherAttendanceView } from '@/lib/server/bara-attendance-view'

const occurrence = {
  occurrenceRef: 'occurrence_one',
  opensAt: '2026-09-02T12:50:00.000Z',
  sessionStartsAt: '2026-09-02T13:00:00.000Z',
  presentThroughAt: '2026-09-02T13:05:00.000Z',
  closesAt: '2026-09-02T13:50:00.000Z',
  absentAt: '2026-09-02T14:00:00.000Z',
  sessionEndsAt: '2026-09-02T14:00:00.000Z',
}
const students = [
  { studentId: '10000000-0000-4000-8000-000000000001', firstName: 'Ada', lastName: 'Lovelace' },
  { studentId: '20000000-0000-4000-8000-000000000002', firstName: 'Grace', lastName: 'Hopper' },
]

function build(overrides: Partial<Parameters<typeof buildTeacherAttendanceView>[0]> = {}) {
  return buildTeacherAttendanceView({
    classroomId: '30000000-0000-4000-8000-000000000003',
    classDate: '2026-09-02', integration: 'ready', students,
    occurrence, sessionProjection: null, now: '2026-09-02T13:30:00.000Z',
    ...overrides,
  })
}

describe('Pika attendance derivation', () => {
  it('treats the Present cutoff as inclusive and the next instant as Late', () => {
    const result = build({ checkInFacts: [
      {
        studentId: students[0].studentId, checkInRef: 'check_in_boundary', revision: 1,
        acceptedAt: '2026-09-02T13:05:00.000Z', invalidatedAt: null,
        updatedAt: '2026-09-02T13:05:00.000Z',
      },
      {
        studentId: students[1].studentId, checkInRef: 'check_in_after', revision: 1,
        acceptedAt: '2026-09-02T13:05:00.001Z', invalidatedAt: null,
        updatedAt: '2026-09-02T13:05:00.001Z',
      },
    ] })
    expect(result.students.map((student) => student.status)).toEqual(['present', 'late'])
  })

  it('keeps no-scan students Unmarked before the cutoff and makes them Absent at it', () => {
    expect(build({ now: '2026-09-02T13:59:59.999Z' }).students[0].status).toBe('unmarked')
    expect(build({ now: occurrence.absentAt }).students[0].status).toBe('absent')
  })

  it('lets an active teacher override win and Undo reveal the automatic result', () => {
    const fact = {
      studentId: students[0].studentId, checkInRef: 'check_in_late', revision: 1,
      acceptedAt: '2026-09-02T13:10:00.000Z', invalidatedAt: null,
      updatedAt: '2026-09-02T13:10:00.000Z',
    }
    expect(build({
      checkInFacts: [fact],
      statusOverrides: [{
        studentId: students[0].studentId, status: 'present', active: true,
        revision: 2, updatedAt: '2026-09-02T13:15:00.000Z',
      }],
    }).students[0]).toMatchObject({ status: 'present', source: 'staff', hasManualOverride: true })
    expect(build({
      checkInFacts: [fact],
      statusOverrides: [{
        studentId: students[0].studentId, status: null, active: false,
        revision: 3, updatedAt: '2026-09-02T13:16:00.000Z',
      }],
    }).students[0]).toMatchObject({ status: 'late', source: 'student_qr', hasManualOverride: false })
  })

  it('ignores invalidated check-ins while retaining their audit facts', () => {
    const result = build({
      now: occurrence.absentAt,
      checkInFacts: [{
        studentId: students[0].studentId, checkInRef: 'check_in_removed', revision: 2,
        acceptedAt: '2026-09-02T13:01:00.000Z',
        invalidatedAt: '2026-09-02T13:20:00.000Z',
        updatedAt: '2026-09-02T13:20:00.000Z',
      }],
    })
    expect(result.students[0]).toMatchObject({ status: 'absent', checkInRef: null })
  })

  it('does not expose provider references in the browser contract', () => {
    const result = build()
    expect(JSON.stringify(result)).not.toContain('occurrence_one')
    expect(JSON.stringify(result)).not.toContain('participant_')
  })
})
