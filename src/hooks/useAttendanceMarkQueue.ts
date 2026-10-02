'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { OptimisticAttendanceQueue } from '@/lib/optimistic-attendance'

export function useAttendanceMarkQueue<View, Status>(
  scopeKey: string,
  project: (view: View, studentIds: string[], status: Status) => View,
  matches: (view: View, studentId: string, status: Status) => boolean,
) {
  const [state, setState] = useState<{
    queue: OptimisticAttendanceQueue<View, Status>
    view: View
    pendingStudentIds: Set<string>
  } | null>(null)
  const queue = useMemo(() => new OptimisticAttendanceQueue<View, Status>({
    project, matches,
    onChange: (view, pendingStudentIds) => setState({ queue, view, pendingStudentIds }),
    // scopeKey intentionally creates a new queue for each classroom/date activation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [scopeKey, project, matches])

  useEffect(() => {
    queue.activate()
    return () => queue.dispose()
  }, [queue])

  const accept = useCallback((view: View, version: number) => queue.accept(view, version), [queue])
  return {
    queue,
    accept,
    view: state?.queue === queue ? state.view : null,
    pendingStudentIds: state?.queue === queue ? state.pendingStudentIds : new Set<string>(),
  }
}
