import { useState } from 'react'
import { addDaysToDateString } from '@/lib/date-string'
import { getTodayInToronto } from '@/lib/timezone'

export function useAssignmentDateValidation(initialDate: string) {
  const [dueAt, setDueAt] = useState(initialDate)
  const [error, setError] = useState('')

  function updateDueDate(next: string) {
    const today = getTodayInToronto()
    if (next < today) {
      setError('Warning: Due date is in the past')
    } else {
      setError('')
    }
    setDueAt(next)
  }

  function moveDueDate(days: number) {
    const today = getTodayInToronto()
    const base = dueAt || today
    const next = addDaysToDateString(base, days)
    if (next < today) {
      setError('Warning: Due date is in the past')
    } else {
      setError('')
    }
    setDueAt(next)
  }

  return { dueAt, error, updateDueDate, moveDueDate, setDueAt, setError }
}
