const MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'America/Toronto',
})

function parseClassroomDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day, 12))

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null
  }

  return date
}

export function formatClassroomDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): string | null {
  if (!startDate || !endDate) return null

  const start = parseClassroomDate(startDate)
  const end = parseClassroomDate(endDate)
  if (!start || !end) return null

  return `${MONTH_YEAR_FORMATTER.format(start)} - ${MONTH_YEAR_FORMATTER.format(end)}`
}
