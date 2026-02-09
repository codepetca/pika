'use client'

import { useEffect, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import type { LogSummaryActionItem } from '@/types'

interface LogSummaryProps {
  classroomId: string
  date: string
  onStudentClick?: (studentName: string) => void
}

interface SummaryData {
  overview: string
  action_items: LogSummaryActionItem[]
  generated_at: string
}

export function LogSummary({ classroomId, date, onStudentClick }: LogSummaryProps) {
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!date) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function fetchSummary() {
      try {
        const res = await fetch(
          `/api/teacher/log-summary?classroom_id=${classroomId}&date=${date}`
        )
        if (!res.ok) {
          throw new Error('Failed to load summary')
        }
        const data = await res.json()
        if (!cancelled) {
          setSummary(data.summary)
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Error fetching log summary:', err)
          setError('Failed to load summary')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchSummary()
    return () => { cancelled = true }
  }, [classroomId, date])

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-sm text-danger">{error}</p>
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="p-4">
        <p className="text-sm text-text-muted">
          No student logs for this date.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {summary.overview && (
        <p className="text-sm text-text-default leading-relaxed">
          {summary.overview}
        </p>
      )}

      {summary.action_items.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">
            Needs Attention
          </h4>
          <ul className="space-y-1.5">
            {summary.action_items.map((item, index) => {
              // The text starts with the student name — make it clickable
              const startsWithName = item.text.startsWith(item.studentName)
              const restOfText = startsWithName
                ? item.text.slice(item.studentName.length)
                : item.text

              return (
                <li key={index} className="text-sm text-text-default">
                  <span className="text-warning mr-1.5">&#x25CF;</span>
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

      <p className="text-xs text-text-muted pt-2 border-t border-border">
        Generated {new Date(summary.generated_at).toLocaleString()}
      </p>
    </div>
  )
}
