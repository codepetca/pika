import { describe, expect, it } from 'vitest'
import {
  ATTENDANCE_CLASSROOM_DECOMMISSION_REQUIRED,
  classifyAttendanceDecommissionError,
} from '@/lib/server/attendance-decommission'

describe('attendance decommission database errors', () => {
  it('maps the exact destructive-operation fence to a permanent conflict', () => {
    expect(classifyAttendanceDecommissionError({
      code: '55000',
      message: ATTENDANCE_CLASSROOM_DECOMMISSION_REQUIRED,
    })).toEqual({
      code: ATTENDANCE_CLASSROOM_DECOMMISSION_REQUIRED,
      message: 'Attendance must be decommissioned before this classroom can be permanently removed',
      status: 409,
      retryable: false,
    })
  })

  it('does not reinterpret unrelated database failures', () => {
    expect(classifyAttendanceDecommissionError({
      code: '55000',
      message: 'another_prerequisite_failed',
    })).toBeNull()
    expect(classifyAttendanceDecommissionError({
      code: 'XX000',
      message: ATTENDANCE_CLASSROOM_DECOMMISSION_REQUIRED,
    })).toBeNull()
  })
})
