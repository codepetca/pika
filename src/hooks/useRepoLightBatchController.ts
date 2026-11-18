'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { executeRepoLightBatch, type RepoLightBatchProgress, type RepoLightBatchResult, type RepoLightBatchStudent } from '@/lib/repolight-batch'

type Student = RepoLightBatchStudent & { name: string }
type State = {
  owner: string
  open: boolean
  running: boolean
  progress: RepoLightBatchProgress | null
  results: RepoLightBatchResult[]
  names: Record<string, string>
}

function emptyState(owner: string): State {
  return { owner, open: false, running: false, progress: null, results: [], names: {} }
}

/** Own one repository batch for exactly one classroom and assignment. */
export function useRepoLightBatchController({ classroomId, assignmentId, onComplete, onError }: {
  classroomId: string
  assignmentId: string | null
  onComplete: () => void
  onError: (message: string) => void
}) {
  const owner = JSON.stringify([classroomId, assignmentId])
  const [state, setState] = useState(() => emptyState(owner))
  const active = useRef<AbortController | null>(null)
  const callbacks = useRef({ onComplete, onError })
  callbacks.current = { onComplete, onError }

  // Layout cleanup retires the prior owner before async completions can update the committed view.
  useLayoutEffect(() => {
    setState(previous => previous.owner === owner ? previous : emptyState(owner))
    return () => {
      const previous = active.current
      active.current = null
      previous?.abort()
    }
  }, [owner])

  const visible = state.owner === owner ? state : emptyState(owner)

  async function start(students: Student[]) {
    if (!assignmentId || students.length === 0 || active.current) return
    const controller = new AbortController()
    active.current = controller
    setState({ owner, open: true, running: true, progress: null, results: [], names: Object.fromEntries(students.map(student => [student.studentId, student.name])) })
    try {
      const results = await executeRepoLightBatch({
        assignmentId,
        students: students.map(({ studentId, expectedDocUpdatedAt }) => ({ studentId, expectedDocUpdatedAt })),
        signal: controller.signal,
        onProgress: progress => {
          if (active.current !== controller) return
          setState(previous => previous.owner !== owner ? previous : {
            ...previous,
            progress,
            results: progress.result ? [...previous.results, progress.result] : previous.results,
          })
        },
      })
      if (active.current === controller) setState(previous => previous.owner === owner ? { ...previous, results } : previous)
    } catch (caught) {
      if (active.current === controller) callbacks.current.onError(caught instanceof Error ? caught.message : 'Repository analysis could not start.')
    } finally {
      if (active.current === controller) {
        active.current = null
        setState(previous => previous.owner === owner ? { ...previous, running: false } : previous)
        callbacks.current.onComplete()
      }
    }
  }

  return {
    ...visible,
    start,
    stop: () => active.current?.abort(),
    close: () => setState(previous => previous.owner === owner && !previous.running ? { ...previous, open: false } : previous),
  }
}
