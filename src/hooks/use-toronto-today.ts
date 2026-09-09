'use client'

import { useEffect, useState } from 'react'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { getTodayInToronto } from '@/lib/timezone'

const TORONTO_TIMEZONE = 'America/Toronto'

function millisecondsUntilNextTorontoDay(now: Date): number {
  const nextMidnight = toZonedTime(now, TORONTO_TIMEZONE)
  nextMidnight.setDate(nextMidnight.getDate() + 1)
  nextMidnight.setHours(0, 0, 0, 0)
  return Math.max(1, fromZonedTime(nextMidnight, TORONTO_TIMEZONE).getTime() - now.getTime() + 50)
}

export function useTorontoToday(): string {
  const [today, setToday] = useState(getTodayInToronto)

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>

    const scheduleNextDay = () => {
      timeoutId = setTimeout(() => {
        setToday(getTodayInToronto())
        scheduleNextDay()
      }, millisecondsUntilNextTorontoDay(new Date()))
    }

    scheduleNextDay()
    return () => clearTimeout(timeoutId)
  }, [])

  return today
}
