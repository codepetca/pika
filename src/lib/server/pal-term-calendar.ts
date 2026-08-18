const DAY_MS = 86_400_000
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export const PAL_TERM_TIMEZONE = 'America/Toronto' as const

export type PalTermCalendar = {
  termIdentity: string
  termStartDay: string
  termEndDay: string
  termTimezone: typeof PAL_TERM_TIMEZONE
  termWeekCount: number
  weekStartDay: string
  weekIndex: number
}

function parseCalendarDay(day: string): Date | null {
  if (!ISO_DAY.test(day) || day.startsWith('0000-')) return null
  const date = new Date(`${day}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day
    ? date
    : null
}

function calendarDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addCalendarDays(day: string, amount: number): string {
  const date = parseCalendarDay(day)
  if (!date) throw new Error('Pal term calendar requires a real calendar day')
  return calendarDay(new Date(date.getTime() + amount * DAY_MS))
}

function mondayOnOrBefore(day: string): string {
  const date = parseCalendarDay(day)
  if (!date) throw new Error('Pal term calendar requires a real calendar day')
  const daysSinceMonday = (date.getUTCDay() + 6) % 7
  return addCalendarDays(day, -daysSinceMonday)
}

function termStartsAround(year: number): string[] {
  const starts = new Set<string>()
  for (let candidateYear = year - 1; candidateYear <= year + 1; candidateYear += 1) {
    starts.add(mondayOnOrBefore(`${candidateYear}-02-01`))
    starts.add(mondayOnOrBefore(`${candidateYear}-07-01`))
    starts.add(mondayOnOrBefore(`${candidateYear}-09-01`))
  }
  return [...starts].sort()
}

/**
 * Maps Pika's global Monday-Friday opportunity period onto one stable Toronto
 * term. Boundaries are Monday-aligned around the existing Feb, Jul, and Sep
 * academic ranges so one aggregated learner week can never straddle two Pal
 * terms. Pika sends only this calendar; Pal remains responsible for rewards.
 */
export function palTermCalendarForPeriodStart(periodStart: string): PalTermCalendar {
  const periodDate = parseCalendarDay(periodStart)
  if (!periodDate || periodDate.getUTCDay() !== 1) {
    throw new Error('Pal period start must be a real Monday calendar day')
  }

  const starts = termStartsAround(periodDate.getUTCFullYear())
  const termStartIndex = starts.findLastIndex((start) => start <= periodStart)
  const termStartDay = starts[termStartIndex]
  const nextTermStartDay = starts[termStartIndex + 1]
  if (!termStartDay || !nextTermStartDay) {
    throw new Error('Pal period is outside the supported academic calendar')
  }

  const termStart = parseCalendarDay(termStartDay)!
  const nextTermStart = parseCalendarDay(nextTermStartDay)!
  const termWeekCount = Math.round(
    (nextTermStart.getTime() - termStart.getTime()) / (7 * DAY_MS),
  )
  const weekIndex = Math.round(
    (periodDate.getTime() - termStart.getTime()) / (7 * DAY_MS),
  ) + 1
  if (termWeekCount < 6 || termWeekCount > 24 || weekIndex < 1 || weekIndex > termWeekCount) {
    throw new Error('Pal adaptive term calendar must contain 6-24 weekly periods')
  }

  const termEndDay = addCalendarDays(nextTermStartDay, -1)
  return {
    termIdentity: `pika-term:${termStartDay}:${termEndDay}:${PAL_TERM_TIMEZONE}`,
    termStartDay,
    termEndDay,
    termTimezone: PAL_TERM_TIMEZONE,
    termWeekCount,
    weekStartDay: periodStart,
    weekIndex,
  }
}
