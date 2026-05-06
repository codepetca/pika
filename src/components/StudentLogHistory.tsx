'use client'

import { useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { entryHasContent } from '@/lib/attendance'
import { fetchJSONWithCache } from '@/lib/request-cache'
import type { Entry } from '@/types'

interface Props {
  studentId: string
  classroomId: string
  selectedEntry?: Entry | null
  initialEntries?: Entry[]
}

interface StudentHistoryResponse {
  entries: Entry[]
}

const HISTORY_LIMIT = 10
const HISTORY_CACHE_TTL_MS = 60_000
const EMPTY_ENTRIES: Entry[] = []

export function StudentLogHistory({
  studentId,
  classroomId,
  selectedEntry = null,
  initialEntries = EMPTY_ENTRIES,
}: Props) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const previewEntries = useMemo(
    () => normalizeEntries(initialEntries),
    [initialEntries]
  )
  const selectedDisplayEntry = selectedEntry && entryHasContent(selectedEntry)
    ? selectedEntry
    : null
  const selectedEntryId = selectedDisplayEntry?.id ?? null

  useEffect(() => {
    let cancelled = false

    setEntries(previewEntries)
    setHasMore(previewEntries.length === HISTORY_LIMIT)
    setLoading(previewEntries.length === 0)

    const params = new URLSearchParams({
      classroom_id: classroomId,
      student_id: studentId,
      limit: String(HISTORY_LIMIT),
    })
    const cacheKey = `teacher-student-history:${classroomId}:${studentId}:latest:${HISTORY_LIMIT}`

    fetchJSONWithCache<StudentHistoryResponse>(
      cacheKey,
      async () => {
        const res = await fetch(`/api/teacher/student-history?${params}`)
        if (!res.ok) {
          throw new Error('Failed to load student history')
        }
        return res.json()
      },
      HISTORY_CACHE_TTL_MS
    )
      .then(data => {
        if (cancelled) return
        const fetched: Entry[] = data.entries || []
        setEntries(normalizeEntries(fetched))
        setHasMore(fetched.length === HISTORY_LIMIT)
      })
      .catch(err => {
        console.error('Error loading student history:', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [studentId, classroomId, previewEntries])

  function loadMore() {
    if (entries.length === 0) return
    const oldestDate = entries[entries.length - 1].date
    setLoading(true)

    const params = new URLSearchParams({
      classroom_id: classroomId,
      student_id: studentId,
      before_date: oldestDate,
      limit: String(HISTORY_LIMIT),
    })
    const cacheKey = `teacher-student-history:${classroomId}:${studentId}:before:${oldestDate}:${HISTORY_LIMIT}`

    fetchJSONWithCache<StudentHistoryResponse>(
      cacheKey,
      async () => {
        const res = await fetch(`/api/teacher/student-history?${params}`)
        if (!res.ok) {
          throw new Error('Failed to load more history')
        }
        return res.json()
      },
      HISTORY_CACHE_TTL_MS
    )
      .then(data => {
        const fetched: Entry[] = data.entries || []
        setEntries(prev => normalizeEntries([...prev, ...fetched]))
        setHasMore(fetched.length === HISTORY_LIMIT)
      })
      .catch(err => {
        console.error('Error loading more history:', err)
      })
      .finally(() => setLoading(false))
  }

  const historyEntries = selectedEntryId
    ? entries.filter(entry => entry.id !== selectedEntryId)
    : entries
  const isEmpty = !selectedDisplayEntry && historyEntries.length === 0 && !loading

  return (
    <div className="p-4 space-y-3">
      {isEmpty && (
        <p className="text-sm text-text-muted">No entries.</p>
      )}

      {selectedDisplayEntry && (
        <EntryBlock entry={selectedDisplayEntry} label="Selected date" />
      )}

      {historyEntries.map(entry => (
        <EntryBlock key={entry.id} entry={entry} />
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

function EntryBlock({ entry, label }: { entry: Entry; label?: string }) {
  return (
    <div>
      <p className="text-xs text-text-muted mb-1">
        {label ? `${label} - ` : ''}
        {formatDate(entry.date)}
      </p>
      <p className="text-sm text-text-default whitespace-pre-wrap">
        {entry.text}
      </p>
    </div>
  )
}

function dedupeEntries(entries: Entry[]): Entry[] {
  const seen = new Set<string>()
  const deduped: Entry[] = []

  for (const entry of entries) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    deduped.push(entry)
  }

  return deduped
}

function normalizeEntries(entries: Entry[]): Entry[] {
  return sortEntriesNewestFirst(dedupeEntries(entries.filter(entryHasContent)))
}

function sortEntriesNewestFirst(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    const dateCompare = b.date.localeCompare(a.date)
    if (dateCompare !== 0) return dateCompare
    return b.updated_at.localeCompare(a.updated_at)
  })
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
