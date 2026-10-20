'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button, Card, PageState } from '@/ui'
import { fetchJSON } from '@/lib/request-cache'
import type { ReturnedGradebookItem, ReturnedGradebookItemsResponse } from '@/lib/gradebook-student-items'

type LoadState =
  | { classroomId: string; kind: 'loading' | 'error' }
  | { classroomId: string; kind: 'loaded'; data: ReturnedGradebookItemsResponse }

export function StudentReturnedMarks({ classroomId, isActive = true }: { classroomId: string; isActive?: boolean }) {
  const [state, setState] = useState<LoadState>({ classroomId, kind: 'loading' })
  const requestIdRef = useRef(0)
  const pendingReadRef = useRef<{ classroomId: string; promise: Promise<ReturnedGradebookItemsResponse> } | null>(null)
  const currentClassroomIdRef = useRef(classroomId)
  currentClassroomIdRef.current = classroomId
  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current
    // Discard stale content while checking whether marks changed or were cleared.
    setState({ classroomId, kind: 'loading' })
    try {
      if (pendingReadRef.current?.classroomId !== classroomId) {
        const promise: Promise<ReturnedGradebookItemsResponse> = fetchJSON<ReturnedGradebookItemsResponse>(
          `/api/student/classrooms/${classroomId}/gradebook-items`,
          { errorMessage: 'Could not load Gradebook marks', init: { cache: 'no-store' } },
        ).finally(() => {
          if (pendingReadRef.current?.promise === promise) pendingReadRef.current = null
        })
        pendingReadRef.current = { classroomId, promise }
      }
      const data = await pendingReadRef.current.promise
      if (requestIdRef.current === requestId && currentClassroomIdRef.current === classroomId) {
        setState({ classroomId, kind: 'loaded', data })
      }
    } catch {
      if (requestIdRef.current === requestId && currentClassroomIdRef.current === classroomId) {
        setState({ classroomId, kind: 'error' })
      }
    }
  }, [classroomId])

  useEffect(() => {
    if (pendingReadRef.current?.classroomId !== classroomId || !isActive) pendingReadRef.current = null
    if (isActive) void load()
    // StrictMode replays cleanup/setup for this same active owner. Keep its
    // unfinished read; real deactivation, classroom change and remount are fresh.
    return () => { requestIdRef.current += 1 }
  }, [classroomId, isActive, load])

  const currentState = state.classroomId === classroomId ? state : null
  if (currentState?.kind === 'loaded' && currentState.data.items.length === 0) return null

  if (currentState?.kind === 'loaded') {
    return <StudentReturnedMarksList items={currentState.data.items} compactZeroWeightAssessments={currentState.data.compactZeroWeightAssessments} />
  }
  return (
    <Card tone="panel" padding="none">
      {!currentState || currentState.kind === 'loading' ? (
        <PageState kind="loading" title="Loading Gradebook marks" headingLevel="h3" compact />
      ) : (
        <PageState
          kind="error"
          title="Gradebook marks couldn't load"
          description="Try again to see marks your teacher entered in Gradebook."
          headingLevel="h3"
          compact
          action={<Button onClick={() => void load()}>Retry Gradebook marks</Button>}
        />
      )}
    </Card>
  )
}

/** Production presentation owner also rendered with deterministic Pattern Lab fixtures. */
export function StudentReturnedMarksList({
  items,
  compactZeroWeightAssessments = true,
}: { items: ReturnedGradebookItem[]; compactZeroWeightAssessments?: boolean }) {
  const headingId = useId()
  if (items.length === 0) return null
  return (
    <section aria-labelledby={headingId}>
      <Card tone="panel" padding="none">
        <div className="border-b border-border px-4 py-3">
          <h2 id={headingId} className="text-base font-semibold text-text-default">Gradebook marks</h2>
        </div>
        <ul aria-label="Gradebook marks" className="divide-y divide-border">
          {items.map(item => {
            const compact = compactZeroWeightAssessments && item.isZeroWeight === true
            const details = [item.title, item.categoryName, !item.included ? 'Not counted' : null].filter(Boolean).join(' · ')
            return (
              <li key={item.id} title={compact ? details : undefined}
                className={`flex min-h-11 items-center justify-between px-4 ${compact ? 'gap-2 py-1' : 'gap-4 py-3'}`}>
                {compact ? (
                  <>
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm text-text-muted">{item.title}</p>
                      <span className="shrink-0 text-xs text-text-muted">0 weight</span>
                      <span className="sr-only">{item.categoryName ? `${item.categoryName}. ` : ''}Not counted.</span>
                    </div>
                    <div className="flex shrink-0 items-baseline gap-2 text-right tabular-nums text-text-muted">
                      <span className="text-sm">{item.percent}%</span>
                      <span className="text-xs">{item.earned} / {item.possible}</span>
                    </div>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </li>
            )
          })}
        </ul>
      </Card>
    </section>
  )
}
