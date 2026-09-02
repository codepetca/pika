import { describe, expect, it } from 'vitest'
import {
  MAX_ATTENDANCE_SESSION_MINUTES,
  attendanceSessionDurationMinutes,
} from '@/lib/attendance-session-duration'

describe('attendance session duration', () => {
  it('measures same-day and overnight sessions against the 12-hour ceiling', () => {
    expect(attendanceSessionDurationMinutes('08:00', '20:00', 0))
      .toBe(MAX_ATTENDANCE_SESSION_MINUTES)
    expect(attendanceSessionDurationMinutes('20:00', '08:00', 1))
      .toBe(MAX_ATTENDANCE_SESSION_MINUTES)
    expect(attendanceSessionDurationMinutes('19:59', '08:00', 1))
      .toBe(MAX_ATTENDANCE_SESSION_MINUTES + 1)
  })

  it('rejects malformed local times instead of inventing a duration', () => {
    expect(attendanceSessionDurationMinutes('', '20:00', 0)).toBeNull()
    expect(attendanceSessionDurationMinutes('08:00', '24:00', 0)).toBeNull()
    expect(attendanceSessionDurationMinutes('08:00', '20:00', 2)).toBeNull()
  })
})
