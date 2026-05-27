'use client'

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { entryHasContent } from '@/lib/attendance'
import { fetchJSONWithCache } from '@/lib/request-cache'
import type { Entry } from '@/types'

interface Props {
  studentId: string
  classroomId: string
  selectedDate?: string | null
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
  selectedDate = null,
  selectedEntry = null,
  initialEntries = EMPTY_ENTRIES,
}: Props) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const selectedBlockRef = useRef<HTMLDivElement | null>(null)
  const previewEntries = useMemo(
    () => normalizeEntries(initialEntries),
    [initialEntries]
  )
  const selectedDisplayEntry = selectedEntry && entryHasContent(selectedEntry)
    ? selectedEntry
    : null
  const selectedDateToHighlight = selectedDisplayEntry?.date ?? selectedDate ?? null

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

  const historyEntries = useMemo(() => {
    const sourceEntries = selectedDisplayEntry
      ? [...entries, selectedDisplayEntry]
      : entries
    return normalizeEntries(sourceEntries)
  }, [entries, selectedDisplayEntry])
  const displayItems = useMemo(
    () => buildDisplayItems(historyEntries, selectedDateToHighlight, !selectedDisplayEntry),
    [historyEntries, selectedDateToHighlight, selectedDisplayEntry]
  )
  const isEmpty = !selectedDateToHighlight && displayItems.length === 0 && !loading

  useEffect(() => {
    if (!selectedDateToHighlight) return
    selectedBlockRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [studentId, classroomId, selectedDateToHighlight, displayItems.length])

  return (
    <div className="p-4 space-y-3">
      {isEmpty && (
        <p className="text-sm text-text-muted">No entries.</p>
      )}

      {displayItems.map(item => (
        <EntryBlock
          key={item.kind === 'entry' ? item.entry.id : `selected-empty:${item.date}`}
          ref={item.isSelected ? selectedBlockRef : undefined}
          date={item.date}
          text={item.kind === 'entry' ? item.entry.text : 'No log for this date.'}
          isSelected={item.isSelected}
          isEmpty={item.kind === 'empty-selected'}
        />
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

type DisplayItem =
  | { kind: 'entry'; entry: Entry; date: string; isSelected: boolean }
  | { kind: 'empty-selected'; date: string; isSelected: true }

const EntryBlock = forwardRef<HTMLDivElement, {
  date: string
  text: string
  isSelected: boolean
  isEmpty: boolean
}>(function EntryBlock({ date, text, isSelected, isEmpty }, ref) {
  return (
    <div
      ref={ref}
      aria-current={isSelected ? 'date' : undefined}
      className={[
        isSelected
          ? 'rounded-md border border-primary bg-info-bg px-3 py-2'
          : '',
      ].join(' ')}
    >
      <p className={[
        'mb-1 text-xs',
        isSelected ? 'font-semibold text-text-default' : 'text-text-muted',
      ].join(' ')}
      >
        {formatDate(date)}
      </p>
      <p className={[
        'text-sm whitespace-pre-wrap',
        isEmpty ? 'text-text-muted italic' : 'text-text-default',
      ].join(' ')}
      >
        {text}
      </p>
    </div>
  )
})

function buildDisplayItems(
  entries: Entry[],
  selectedDate: string | null,
  shouldShowEmptySelectedDate: boolean
): DisplayItem[] {
  const items: DisplayItem[] = entries.map(entry => ({
    kind: 'entry',
    entry,
    date: entry.date,
    isSelected: selectedDate === entry.date,
  }))

  if (
    selectedDate &&
    shouldShowEmptySelectedDate &&
    !items.some(item => item.date === selectedDate)
  ) {
    items.push({
      kind: 'empty-selected',
      date: selectedDate,
      isSelected: true,
    })
  }

  return items.sort(compareDisplayItemsNewestFirst)
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

function compareDisplayItemsNewestFirst(a: DisplayItem, b: DisplayItem): number {
  const dateCompare = b.date.localeCompare(a.date)
  if (dateCompare !== 0) return dateCompare

  if (a.kind === 'entry' && b.kind === 'entry') {
    return b.entry.updated_at.localeCompare(a.entry.updated_at)
  }

  if (a.kind === 'empty-selected' && b.kind === 'entry') return -1
  if (a.kind === 'entry' && b.kind === 'empty-selected') return 1
  return 0
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
