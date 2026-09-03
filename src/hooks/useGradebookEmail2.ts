import { useCallback, useEffect, useRef, useState } from 'react'
import { loadGradebookEmail2, type GradebookEmail2Row } from '@/lib/gradebook-email'

interface Email2Snapshot {
  classroomId: string
  loading: boolean
  rows: GradebookEmail2Row[]
  error: string | null
}

export function useGradebookEmail2(classroomId: string, isActive: boolean) {
  const [snapshot, setSnapshot] = useState<Email2Snapshot | null>(null)
  const requestIdRef = useRef(0)
  const currentClassroomRef = useRef(classroomId)
  currentClassroomRef.current = classroomId

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current
    const isCurrent = () => requestIdRef.current === requestId && currentClassroomRef.current === classroomId
    setSnapshot({ classroomId, loading: true, rows: [], error: null })
    try {
      const rows = await loadGradebookEmail2(classroomId)
      if (isCurrent()) setSnapshot({ classroomId, loading: false, rows, error: null })
    } catch (error) {
      if (isCurrent()) setSnapshot({ classroomId, loading: false, rows: [], error: error instanceof Error ? error.message : 'Could not load Email 2 addresses' })
    }
  }, [classroomId])

  useEffect(() => {
    if (!isActive) return
    void reload()
    return () => { requestIdRef.current += 1 }
  }, [isActive, reload])

  const current = snapshot?.classroomId === classroomId ? snapshot : null
  return { rows: current?.rows ?? [], loading: current?.loading ?? true, error: current?.error ?? null, reload }
}
