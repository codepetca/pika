'use client'

import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import type { Entry } from '@/types'

interface Props {
  studentId: string
  classroomId: string
}

export function StudentLogHistory({ studentId, classroomId }: Props) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)

    const params = new URLSearchParams({
      classroom_id: classroomId,
      student_id: studentId,
      limit: '10',
    })

    fetch(`/api/teacher/student-history?${params}`, { signal: controller.signal })
      .then(res => res.json())
      .then(data => {
        if (controller.signal.aborted) return
        const fetched: Entry[] = data.entries || []
        setEntries(fetched)
        setHasMore(fetched.length === 10)
      })
      .catch(err => {
        if (err instanceof Error && err.name === 'AbortError') return
        console.error('Error loading student history:', err)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [studentId, classroomId])

  function loadMore() {
    if (entries.length === 0) return
    const oldestDate = entries[entries.length - 1].date
    setLoading(true)

    const controller = new AbortController()

    const params = new URLSearchParams({
      classroom_id: classroomId,
      student_id: studentId,
      before_date: oldestDate,
      limit: '10',
    })

    fetch(`/api/teacher/student-history?${params}`, { signal: controller.signal })
      .then(res => res.json())
      .then(data => {
        const fetched: Entry[] = data.entries || []
        setEntries(prev => [...prev, ...fetched])
        setHasMore(fetched.length === 10)
      })
      .catch(err => {
        if (err instanceof Error && err.name === 'AbortError') return
        console.error('Error loading more history:', err)
      })
      .finally(() => setLoading(false))
  }

  return (
    <div className="p-4 space-y-3">
      {entries.length === 0 && !loading && (
        <p className="text-sm text-text-muted">No entries.</p>
      )}

      {entries.map(entry => (
        <div key={entry.id}>
          <p className="text-xs text-text-muted mb-1">
            {formatDate(entry.date)}
          </p>
          <p className="text-sm text-text-default whitespace-pre-wrap">
            {entry.text}
          </p>
        </div>
      ))}

      {loading && (
        <div className="flex justify-center py-2">
          <Spinner size="sm" />
        </div>
      )}

      {hasMore && !loading && (
        <button
          type="button"
          onClick={loadMore}
          className="text-xs text-primary hover:text-primary-hover"
        >
          Load more
        </button>
      )}
    </div>
  )
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
