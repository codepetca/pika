'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button, cn } from '@/ui'
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
      <div className="flex min-h-11 items-center justify-center px-3 py-2">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-3 py-2">
        <p className="text-sm text-danger">{error}</p>
      </div>
    )
  }

  if (!summary) {
    const message = summaryStatus === 'pending'
      ? 'Summary will be available after the nightly run.'
      : summaryStatus === 'unavailable'
        ? 'Summary is not available for this date.'
        : 'No student logs for this date.'

    return (
      <div className="px-3 py-2">
        <p className="text-sm text-text-muted">
          {message}
        </p>
      </div>
    )
  }

  return <LogSummaryContent actionItems={summary.action_items} onStudentClick={onStudentClick} />
}

/** Feature-owned presentation also rendered with deterministic Pattern Lab fixtures. */
export function LogSummaryContent({
  actionItems: items,
  onStudentClick,
}: {
  actionItems: LogSummaryActionItem[]
  onStudentClick?: (studentName: string) => void
}) {
  const contentId = useId()
  const [expanded, setExpanded] = useState(false)
  const conciseSummary = items.length > 0 ? items.map((item) => item.text).join(' ') : 'Nothing urgent'

  return (
    <div className="max-h-[48vh] overflow-y-auto" onClick={() => setExpanded((value) => !value)}>
      <Button
        variant="ghost"
        aria-expanded={expanded}
        aria-controls={contentId}
        className="w-full justify-start rounded-lg border-0 px-3 py-2 text-left text-sm font-normal text-text-default"
        onClick={(event) => {
          event.stopPropagation()
          setExpanded((value) => !value)
        }}
      >
        <span data-summary-text className={cn('min-w-0 break-words leading-5 [overflow-wrap:anywhere]', !expanded && 'line-clamp-3')}>
          <span className="font-semibold">Summary: </span>
          {expanded && items.length > 0 ? <span className="sr-only">Collapse summary</span> : conciseSummary}
        </span>
      </Button>
      <div id={contentId} hidden={!expanded}>
        {items.length > 0 && (
          <ul aria-label="Class log follow-ups" className="px-3 pb-2 text-sm leading-5 text-text-default">
            {items.map((item, index) => {
              const startsWithName = item.text.startsWith(item.studentName)
              return (
                <li key={index} className="break-words [overflow-wrap:anywhere]">
                  {startsWithName && onStudentClick ? (
                    <>
                      <Button
                        variant="ghost"
                        className="-ml-2 border-0 px-2 py-1 font-medium text-primary hover:underline"
                        onClick={(event) => {
                          event.stopPropagation()
                          onStudentClick(item.studentName)
                        }}
                      >
                        {item.studentName}
                      </Button>
                      {item.text.slice(item.studentName.length)}
                    </>
                  ) : item.text}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
