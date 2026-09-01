const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export const MAX_ATTENDANCE_SESSION_MINUTES = 12 * 60
export const ATTENDANCE_SESSION_TOO_LONG_MESSAGE = 'Maximum is 12 hours.'

function localTimeMinutes(time: string) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
}

export function attendanceSessionDurationMinutes(
  startsLocal: string,
  endsLocal: string,
  endDayOffset: number,
) {
  if (
    !LOCAL_TIME_PATTERN.test(startsLocal)
    || !LOCAL_TIME_PATTERN.test(endsLocal)
    || (endDayOffset !== 0 && endDayOffset !== 1)
  ) {
    return null
  }

  return localTimeMinutes(endsLocal) - localTimeMinutes(startsLocal) + endDayOffset * 1440
}
