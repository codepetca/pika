export const ASSIGNMENT_SCHEDULE_DUE_DATE_ERROR = 'Scheduled release must be on or before the due date.'

type DateLike = Date | string | null | undefined

function toValidTime(value: DateLike): number | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  return Number.isNaN(time) ? null : time
}

export function isScheduledReleaseOnOrBeforeDueDate(releaseAt: DateLike, dueAt: DateLike): boolean {
  const releaseTime = toValidTime(releaseAt)
  const dueTime = toValidTime(dueAt)

  if (releaseTime === null || dueTime === null) return true

  return releaseTime <= dueTime
}

export function getScheduledReleaseDueDateError(releaseAt: DateLike, dueAt: DateLike): string | null {
  return isScheduledReleaseOnOrBeforeDueDate(releaseAt, dueAt)
    ? null
    : ASSIGNMENT_SCHEDULE_DUE_DATE_ERROR
}
