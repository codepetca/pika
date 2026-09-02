'use client'

import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { formatRelativeDateTimeInToronto } from '@/lib/timezone'
import type { LogSummaryActionItem } from '@/types'

interface LogSummaryProps {
  classroomId: string
  date: string
  onStudentClick?: (studentName: string) => void
  onAvailabilityChange?: (available: boolean) => void
}

interface SummaryData {
  overview: string
  action_items: LogSummaryActionItem[]
  generated_at: string
}

type SummaryStatus = 'ready' | 'pending' | 'no_entries' | 'unavailable'

export function LogSummary({
  classroomId,
  date,
  onStudentClick,
  onAvailabilityChange,
}: LogSummaryProps) {
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [summaryStatus, setSummaryStatus] = useState<SummaryStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const currentClassroomIdRef = useRef(classroomId)
  const currentDateRef = useRef(date)
  currentClassroomIdRef.current = classroomId
  currentDateRef.current = date

  useEffect(() => {
    if (!date) {
      requestIdRef.current += 1
      setSummary(null)
      setSummaryStatus(null)
      setError(null)
      setLoading(false)
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError(null)
    setSummary(null)
    setSummaryStatus(null)

    function isCurrentRequest() {
      return (
        requestIdRef.current === requestId &&
        currentClassroomIdRef.current === classroomId &&
        currentDateRef.current === date
      )
    }

    async function fetchSummary() {
      try {
        const res = await fetch(
          `/api/teacher/log-summary?classroom_id=${classroomId}&date=${date}`
        )
        if (!res.ok) {
          throw new Error('Failed to load summary')
        }
        const data = await res.json()
        if (!isCurrentRequest()) return
        setSummary(data.summary)
        setSummaryStatus(data.summary_status || (data.summary ? 'ready' : null))
      } catch (err) {
        if (!isCurrentRequest()) return
        console.error('Error fetching log summary:', err)
        setError('Failed to load summary')
      } finally {
        if (!isCurrentRequest()) return
        setLoading(false)
      }
    }

    fetchSummary()
    return () => {
      if (requestIdRef.current === requestId) {
        requestIdRef.current += 1
      }
    }
  }, [classroomId, date])

  const hasGeneratedSummary = summaryStatus === 'ready' && summary !== null

  useEffect(() => {
    onAvailabilityChange?.(hasGeneratedSummary)
  }, [hasGeneratedSummary, onAvailabilityChange])

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-3 pb-4 pt-2">
        <p className="text-sm text-danger">{error}</p>
      </div>
    )
  }

  if (!summary) {
    const message = summaryStatus === 'pending'
      ? 'Summary will be available after the nightly run.'
      : summaryStatus === 'unavailable'
        ? 'A high-priority automated summary is not available for this date.'
        : 'No student logs for this date.'

    return (
      <div className="px-3 pb-4 pt-2">
        <p className="text-sm text-text-muted">
          {message}
        </p>
      </div>
    )
  }

  if (!summary.overview && summary.action_items.length === 0) {
    return (
      <div className="px-3 pb-4 pt-2">
        <p className="text-sm text-text-muted">
          No notable items found in student logs.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3 px-3 pb-4 pt-2">
      {summary.overview && (
        <p className="text-sm text-text-default leading-relaxed">
          {summary.overview}
        </p>
      )}

      {summary.action_items.length > 0 && (
        <div>
          <ul aria-label="Class log follow-ups" className="space-y-1.5">
            {summary.action_items.map((item, index) => {
              // The text starts with the student name — make it clickable
              const startsWithName = item.text.startsWith(item.studentName)
              const restOfText = startsWithName
                ? item.text.slice(item.studentName.length)
                : item.text

              return (
                <li key={index} className="text-sm text-text-default">
                  <span aria-hidden="true" className="text-warning mr-1.5">&#x25CF;</span>
                  {startsWithName && onStudentClick ? (
                    <>
                      <button
                        type="button"
                        className="font-medium text-primary hover:underline"
                        onClick={() => onStudentClick(item.studentName)}
                      >
                        {item.studentName}
                      </button>
                      {restOfText}
                    </>
                  ) : (
                    item.text
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <p className="pt-2 text-xs text-text-muted">
        {formatRelativeDateTimeInToronto(summary.generated_at)}
      </p>
    </div>
  )
}
