'use client'

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { entryHasContent } from '@/lib/attendance'
import { fetchCachedJSON } from '@/lib/request-cache'
import type { Entry } from '@/types'
import { Button, PageState } from '@/ui'

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

export function StudentLogHistory(props: Props) {
  const scope = `${props.classroomId}:${props.studentId}`

  return <StudentLogHistoryState key={scope} {...props} />
}

function StudentLogHistoryState({
  studentId,
  classroomId,
  selectedDate = null,
  selectedEntry = null,
  initialEntries = EMPTY_ENTRIES,
}: Props) {
  const previewEntries = useMemo(
    () => normalizeEntries(initialEntries),
    [initialEntries]
  )
  const [entries, setEntries] = useState<Entry[]>(previewEntries)
  const [loading, setLoading] = useState(previewEntries.length === 0)
  const [error, setError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [requestVersion, setRequestVersion] = useState(0)
  const [hasMore, setHasMore] = useState(previewEntries.length === HISTORY_LIMIT)
  const selectedBlockRef = useRef<HTMLDivElement | null>(null)
  const activeScopeRef = useRef(`${classroomId}:${studentId}`)
  const loadMoreRequestIdRef = useRef(0)
  activeScopeRef.current = `${classroomId}:${studentId}`
  const selectedDisplayEntry = selectedEntry && entryHasContent(selectedEntry)
    ? selectedEntry
    : null
  const selectedDateToHighlight = selectedDisplayEntry?.date ?? selectedDate ?? null

  useEffect(() => {
    let cancelled = false
    loadMoreRequestIdRef.current += 1

    setEntries(previewEntries)
    setHasMore(previewEntries.length === HISTORY_LIMIT)
    setLoading(previewEntries.length === 0)
    setError(null)
    setLoadMoreError(null)

    const params = new URLSearchParams({
      classroom_id: classroomId,
      student_id: studentId,
      limit: String(HISTORY_LIMIT),
    })
    const cacheKey = `teacher-student-history:${classroomId}:${studentId}:latest:${HISTORY_LIMIT}`

    fetchCachedJSON<StudentHistoryResponse>(
      cacheKey,
      `/api/teacher/student-history?${params}`,
      { errorMessage: 'Failed to load student history', ttlMs: HISTORY_CACHE_TTL_MS },
    )
      .then(data => {
        if (cancelled) return
        const fetched: Entry[] = data.entries || []
        setEntries(normalizeEntries(fetched))
        setHasMore(fetched.length === HISTORY_LIMIT)
      })
      .catch(err => {
        if (cancelled) return
        console.error('Error loading student history:', err)
        setError('The student\'s log history could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [studentId, classroomId, previewEntries, requestVersion])

  function retryHistory() {
    setError(null)
    setLoading(entries.length === 0)
    setRequestVersion((version) => version + 1)
  }

  function loadMore() {
    if (entries.length === 0) return
    const requestScope = `${classroomId}:${studentId}`
    const requestId = loadMoreRequestIdRef.current + 1
    loadMoreRequestIdRef.current = requestId
    const isCurrentRequest = () => (
      activeScopeRef.current === requestScope && loadMoreRequestIdRef.current === requestId
    )
    const oldestDate = entries[entries.length - 1].date
    setLoading(true)
    setLoadMoreError(null)

    const params = new URLSearchParams({
      classroom_id: classroomId,
      student_id: studentId,
      before_date: oldestDate,
      limit: String(HISTORY_LIMIT),
    })
    const cacheKey = `teacher-student-history:${classroomId}:${studentId}:before:${oldestDate}:${HISTORY_LIMIT}`

    fetchCachedJSON<StudentHistoryResponse>(
      cacheKey,
      `/api/teacher/student-history?${params}`,
      { errorMessage: 'Failed to load more history', ttlMs: HISTORY_CACHE_TTL_MS },
    )
      .then(data => {
        if (!isCurrentRequest()) return
        const fetched: Entry[] = data.entries || []
        setEntries(prev => normalizeEntries([...prev, ...fetched]))
        setHasMore(fetched.length === HISTORY_LIMIT)
      })
      .catch(err => {
        if (!isCurrentRequest()) return
        console.error('Error loading more history:', err)
        setLoadMoreError('Older history could not be loaded.')
      })
      .finally(() => {
        if (isCurrentRequest()) setLoading(false)
      })
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
  const isEmpty = !selectedDateToHighlight && displayItems.length === 0 && !loading && !error

  useEffect(() => {
    if (!selectedDateToHighlight) return
    selectedBlockRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [studentId, classroomId, selectedDateToHighlight, displayItems.length])

  return (
    <div className="p-4 space-y-3">
      {error && (
        <PageState
          kind="error"
          title="History unavailable"
          description={error}
          compact
          action={(
            <Button type="button" size="sm" onClick={retryHistory}>
              Try again
            </Button>
          )}
        />
      )}

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

      {hasMore && !loading && !loadMoreError && (
        <button
          type="button"
          onClick={loadMore}
          className="text-xs text-primary hover:text-primary-hover"
        >
          Load more
        </button>
      )}

      {loadMoreError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-danger bg-danger-bg px-3 py-2">
          <p className="text-sm text-danger">{loadMoreError}</p>
          <Button type="button" size="sm" variant="secondary" onClick={loadMore}>
            Try again
          </Button>
        </div>
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
