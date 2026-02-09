'use client'

import { useEffect, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import type { LogSummaryItem } from '@/types'

interface LogSummaryProps {
  classroomId: string
  date: string
}

interface SummaryData {
  items: LogSummaryItem[]
  generated_at: string
}

const TYPE_CONFIG: Record<LogSummaryItem['type'], { label: string; className: string }> = {
  question: { label: 'Question', className: 'bg-info-bg text-info' },
  suggestion: { label: 'Suggestion', className: 'bg-success-bg text-success' },
  concern: { label: 'Concern', className: 'bg-warning-bg text-warning' },
  reflection: { label: 'Reflection', className: 'bg-surface-hover text-text-muted' },
}

export function LogSummary({ classroomId, date }: LogSummaryProps) {
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

  if (summary.items.length === 0) {
    return (
      <div className="p-4">
        <p className="text-sm text-text-muted">
          No notable items found in student logs.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      <ul className="space-y-2">
        {summary.items.map((item, index) => {
          const config = TYPE_CONFIG[item.type] || TYPE_CONFIG.reflection
          return (
            <li key={index} className="flex gap-2 text-sm">
              <span
                className={`inline-flex items-center shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${config.className}`}
              >
                {config.label}
              </span>
              <span className="text-text-default">
                <span className="font-medium">{item.studentName}:</span>{' '}
                {item.text}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-text-muted pt-2 border-t border-border">
        Generated {new Date(summary.generated_at).toLocaleString()}
      </p>
    </div>
  )
}
