export const ATTENDANCE_CLASSROOM_DECOMMISSION_REQUIRED =
  'attendance_classroom_decommission_required' as const

export interface AttendanceDecommissionFailure {
  code: typeof ATTENDANCE_CLASSROOM_DECOMMISSION_REQUIRED
  message: string
  status: 409
  retryable: false
}

export function classifyAttendanceDecommissionError(error: {
  code?: string
  message?: string
} | null): AttendanceDecommissionFailure | null {
  if (
    error?.code !== '55000'
    || error.message !== ATTENDANCE_CLASSROOM_DECOMMISSION_REQUIRED
  ) {
    return null
  }

  return {
    code: ATTENDANCE_CLASSROOM_DECOMMISSION_REQUIRED,
    message: 'Attendance must be decommissioned before this classroom can be permanently removed',
    status: 409,
    retryable: false,
  }
}
