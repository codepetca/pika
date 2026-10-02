'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OptimisticAttendanceQueue } from '@/lib/optimistic-attendance'

export function useAttendanceMarkQueue<View, Status>(
  scopeKey: string,
  project: (view: View, studentIds: string[], status: Status) => View,
  matches: (view: View, studentId: string, status: Status) => boolean,
) {
  const queues = useRef(new Map<string, OptimisticAttendanceQueue<View, Status>>())
  const [state, setState] = useState<{
    queue: OptimisticAttendanceQueue<View, Status>
    view: View
    pendingStudentIds: Set<string>
  } | null>(null)
  const queue = useMemo(() => {
    const retained = queues.current.get(scopeKey)
    if (retained) return retained
    const created = new OptimisticAttendanceQueue<View, Status>({
      project, matches,
      onChange: (view, pendingStudentIds) => setState({ queue: created, view, pendingStudentIds }),
    })
    queues.current.set(scopeKey, created)
    return created
  }, [scopeKey, project, matches])

  useEffect(() => {
    const registry = queues.current
    registry.set(scopeKey, queue)
    queue.activate()
    return () => {
      // Navigation detaches presentation, but accepted writes keep their order.
      // Retain outstanding receipts so returning before commit cannot show a stale row.
      queue.deactivate()
      if (queue.pendingStudentIds.size === 0 && !queue.hasUnconfirmedMarks) registry.delete(scopeKey)
    }
  }, [queue, scopeKey])

  const accept = useCallback((view: View, version: number) => queue.accept(view, version), [queue])
  return {
    queue,
    accept,
    view: state?.queue === queue ? state.view : null,
    pendingStudentIds: state?.queue === queue ? state.pendingStudentIds : new Set<string>(),
  }
}
