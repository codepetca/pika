export function addDaysToDateString(dateString: string, deltaDays: number): string {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(dateString)) {
    throw new Error(`Invalid date string: ${dateString}`)
  }

  const base = new Date(`${dateString}T00:00:00.000Z`)
  if (Number.isNaN(base.getTime())) {
    throw new Error(`Invalid date string: ${dateString}`)
  }

  base.setUTCDate(base.getUTCDate() + deltaDays)
  return base.toISOString().slice(0, 10)
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function dateStringToUtcMs(dateString: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utcMs = Date.UTC(year, month - 1, day)
  const date = new Date(utcMs)

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? utcMs
    : null
}

export function getPastRelativeDateLabel(dateString: string, todayDateString: string): string | null {
  const dateMs = dateStringToUtcMs(dateString)
  const todayMs = dateStringToUtcMs(todayDateString)
  if (dateMs === null || todayMs === null) return null

  const daysAgo = Math.round((todayMs - dateMs) / MS_PER_DAY)
  if (daysAgo < 0) return null
  if (daysAgo === 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  if (daysAgo < 7) return `${daysAgo} days ago`

  if (daysAgo < 30) {
    const weeksAgo = Math.floor(daysAgo / 7)
    return weeksAgo === 1 ? 'a week ago' : `${weeksAgo} weeks ago`
  }

  if (daysAgo < 365) {
    const monthsAgo = Math.floor(daysAgo / 30)
    return `${monthsAgo} month${monthsAgo === 1 ? '' : 's'} ago`
  }

  const yearsAgo = Math.floor(daysAgo / 365)
  return `${yearsAgo} year${yearsAgo === 1 ? '' : 's'} ago`
}
