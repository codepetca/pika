'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button, Card, PageState } from '@/ui'
import { fetchCachedJSON, invalidateCachedJSON } from '@/lib/request-cache'
import type { ReturnedGradebookItem, ReturnedGradebookItemsResponse } from '@/lib/gradebook-student-items'

type LoadState =
  | { classroomId: string; kind: 'loading' | 'error' }
  | { classroomId: string; kind: 'loaded'; data: ReturnedGradebookItemsResponse }

export function StudentReturnedMarks({ classroomId, isActive = true }: { classroomId: string; isActive?: boolean }) {
  const [state, setState] = useState<LoadState>({ classroomId, kind: 'loading' })
  const requestIdRef = useRef(0)
  const currentClassroomIdRef = useRef(classroomId)
  currentClassroomIdRef.current = classroomId
  const cacheKey = `student-returned-marks:${classroomId}`

  const load = useCallback(async (refresh: boolean) => {
    const requestId = ++requestIdRef.current
    if (refresh) invalidateCachedJSON(cacheKey)
    // Discard stale returned content while checking whether marks were retracted.
    setState({ classroomId, kind: 'loading' })
    try {
      const data = await fetchCachedJSON<ReturnedGradebookItemsResponse>(
        cacheKey,
        `/api/student/classrooms/${classroomId}/gradebook-items`,
        { ttlMs: 20_000, errorMessage: 'Could not load returned marks', init: { cache: 'no-store' } },
      )
      if (requestIdRef.current === requestId && currentClassroomIdRef.current === classroomId) {
        setState({ classroomId, kind: 'loaded', data })
      }
    } catch {
      if (requestIdRef.current === requestId && currentClassroomIdRef.current === classroomId) {
        setState({ classroomId, kind: 'error' })
      }
    }
  }, [cacheKey, classroomId])

  useEffect(() => {
    if (isActive) void load(true)
    return () => { requestIdRef.current += 1 }
  }, [isActive, load])

  const currentState = state.classroomId === classroomId ? state : null
  if (currentState?.kind === 'loaded' && currentState.data.items.length === 0) return null

  if (currentState?.kind === 'loaded') {
    return <StudentReturnedMarksList items={currentState.data.items} />
  }
  return (
    <Card tone="panel" padding="none">
      {!currentState || currentState.kind === 'loading' ? (
        <PageState kind="loading" title="Loading returned marks" headingLevel="h3" compact />
      ) : (
        <PageState
          kind="error"
          title="Returned marks couldn't load"
          description="Try again to see marks your teacher has returned."
          headingLevel="h3"
          compact
          action={<Button onClick={() => void load(true)}>Retry returned marks</Button>}
        />
      )}
    </Card>
  )
}

/** Production presentation owner also rendered with deterministic Pattern Lab fixtures. */
export function StudentReturnedMarksList({ items }: { items: ReturnedGradebookItem[] }) {
  const headingId = useId()
  if (items.length === 0) return null
  return (
    <section aria-labelledby={headingId}>
      <Card tone="panel" padding="none">
        <div className="border-b border-border px-4 py-3">
          <h2 id={headingId} className="text-base font-semibold text-text-default">Returned marks</h2>
        </div>
        <ul aria-label="Returned marks" className="divide-y divide-border">
          {items.map(item => (
            <li key={item.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-text-default">{item.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  {item.categoryName ? <span>{item.categoryName}</span> : null}
                  {!item.included ? (
                    <span className="rounded-badge bg-surface-2 px-2 py-0.5 font-medium text-text-muted">Not counted</span>
                  ) : null}
                </div>
              </div>
              <div className="shrink-0 text-right tabular-nums">
                <p className="text-sm font-semibold text-text-default">{item.percent}%</p>
                <p className="mt-0.5 text-xs text-text-muted">{item.earned} / {item.possible}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}
