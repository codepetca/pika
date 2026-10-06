'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button, cn } from '@/ui'
import type { LogSummaryActionItem } from '@/types'
import { formatLogSummaryItems } from '@/lib/log-summary-presentation'

interface LogSummaryProps {
  classroomId: string
  date: string
  firstNames?: Record<string, string>
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
  firstNames,
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

  return <LogSummaryContent actionItems={summary.action_items} firstNames={firstNames} onStudentClick={onStudentClick} />
}

/** Feature-owned presentation also rendered with deterministic Pattern Lab fixtures. */
export function LogSummaryContent({
  actionItems,
  firstNames,
  onStudentClick,
}: {
  actionItems: LogSummaryActionItem[]
  firstNames?: Record<string, string>
  onStudentClick?: (studentName: string) => void
}) {
  const contentId = useId()
  const textRef = useRef<HTMLSpanElement>(null)
  const clippedActionRef = useRef<HTMLButtonElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const items = formatLogSummaryItems(actionItems, firstNames)
  const conciseSummary = items.length > 0
    ? items.map((item) => `${item.firstName} ${item.detail}`).join(' ')
    : 'Nothing urgent'

  useEffect(() => {
    if (expanded) return
    const text = textRef.current
    if (!text) return
    const measure = () => setOverflows(text.scrollHeight > text.clientHeight + 1)
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(text)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [conciseSummary, expanded, overflows])

  useEffect(() => {
    if (expanded && clippedActionRef.current) {
      clippedActionRef.current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      clippedActionRef.current = null
    }
  }, [expanded])

  const canToggle = overflows || expanded

  return (
    <div className="max-h-[48vh] overflow-y-auto px-3 py-2 text-sm text-text-default" onClick={() => {
      if (canToggle) setExpanded((value) => !value)
    }}>
      <span id={contentId} ref={textRef} data-summary-text className={cn('block min-w-0 break-words leading-5 [overflow-wrap:anywhere]', !expanded && 'line-clamp-2')}>
        {canToggle ? (
          <Button
            variant="ghost"
            aria-label={expanded ? 'Collapse summary' : 'Expand summary'}
            aria-expanded={expanded}
            aria-controls={contentId}
            className="mr-1 inline min-h-0 min-w-0 rounded-sm border-0 p-0 align-baseline text-sm font-semibold leading-5 text-primary hover:bg-transparent"
            onClick={(event) => {
              event.stopPropagation()
              setExpanded((value) => !value)
            }}
          >
            Summary
          </Button>
        ) : <span className="mr-1 font-semibold text-primary">Summary</span>}{' '}
        {items.length > 0 ? items.map((item, index) => (
          <span key={index}>
            {onStudentClick ? (
              <Button
                variant="ghost"
                aria-label={`Go to ${item.studentName} in student table`}
                className="inline min-h-0 min-w-0 rounded-sm border-0 p-0 align-baseline text-sm font-medium leading-5 text-primary underline hover:bg-transparent"
                onFocus={(event) => {
                  const text = textRef.current
                  // Reveal a keyboard-focused action that lies beyond the two-line clamp.
                  if (!expanded && overflows && text) {
                    const actionBounds = event.currentTarget.getBoundingClientRect()
                    const textBounds = text.getBoundingClientRect()
                    if (text.scrollTop === 0 && actionBounds.height > 0 && actionBounds.top >= textBounds.top && actionBounds.bottom <= textBounds.bottom) return
                    clippedActionRef.current = event.currentTarget
                    setExpanded(true)
                  }
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  onStudentClick(item.studentName)
                }}
              >
                {item.firstName}
              </Button>
            ) : item.firstName}
            {' '}{item.detail}{index < items.length - 1 ? ' ' : ''}
          </span>
        )) : 'Nothing urgent'}
      </span>
    </div>
  )
}
