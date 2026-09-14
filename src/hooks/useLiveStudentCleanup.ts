'use client'

import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { liveCleanupDiscoverySchema, type LiveCleanupStatus, type LiveCleanupTarget } from '@/lib/validations/live-student-cleanup'
import { cleanupKey, cleanupRequest, parseCleanupStatus, savedCleanup, saveCleanup, withCleanupLock } from '@/lib/live-student-cleanup-client'

const envelope = z.object({ operation: z.unknown(), enabled: z.boolean().optional() }).strict()
export function useLiveStudentCleanup(classroomId: string, target: LiveCleanupTarget | null, onCompleted: () => void) {
  const [operation, setOperation] = useState<LiveCleanupStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState('')
  const [hasSaved, setHasSaved] = useState(false)
  const epoch = useRef(0)
  const running = useRef(false)
  const notified = useRef<string | null>(null)
  const completed = useRef(onCompleted)
  completed.current = onCompleted
  const identity = target ? cleanupKey(classroomId, target) : ''
  const path = target ? `/api/teacher/classrooms/${classroomId}/students/${target.student_id}/purge/live` : ''

  function accept(status: LiveCleanupStatus) {
    setOperation(status)
    if (status.cleanup_completed && notified.current !== status.operation_id) {
      notified.current = status.operation_id
      completed.current()
    }
  }
  async function refresh() {
    if (!target || running.current) return
    const version = epoch.current
    running.current = true; setBusy(true); setError(''); setReady(false)
    try {
      const saved = savedCleanup(identity)
      setHasSaved(Boolean(saved))
      if (saved) {
        const raw = envelope.parse(await cleanupRequest(`${path}?operation_id=${saved.operation_id}&generation_id=${target.generation_id}`))
        const status = parseCleanupStatus(raw.operation, saved.operation_id)
        if (version !== epoch.current) return
        accept(status); setReady(true)
        // Status reads work while activation is paused. Each POST still rechecks all gates.
        setEnabled(raw.enabled === true)
      } else {
        const discovery = liveCleanupDiscoverySchema.parse(await cleanupRequest(path))
        if (discovery.generation_id !== target.generation_id) throw new Error('This membership changed. Close and refresh the roster.')
        if (version !== epoch.current) return
        if (discovery.operation) {
          saveCleanup(identity, discovery.operation.operation_id)
          accept(discovery.operation)
        }
        setEnabled(discovery.enabled); setReady(true)
      }
    } catch (reason) {
      if (version === epoch.current) setError(reason instanceof z.ZodError ? 'Cleanup status could not be verified.' : reason instanceof Error ? reason.message : 'Could not check cleanup.')
    } finally {
      if (version === epoch.current) { running.current = false; setBusy(false) }
    }
  }
  useEffect(() => {
    epoch.current += 1
    running.current = false
    setOperation(null); setReady(false); setEnabled(false); setError(''); setHasSaved(false)
    void refresh()
    return () => { epoch.current += 1 }
    // The immutable target identity owns this request lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity])

  async function advance(confirmed: boolean) {
    if (!target || running.current || operation?.cleanup_completed || !confirmed) return
    const version = epoch.current
    running.current = true; setBusy(true); setError('')
    try {
      await withCleanupLock(identity, async () => {
        const saved = savedCleanup(identity)
        if (saved && operation && saved.operation_id !== operation.operation_id)
          throw new Error('Saved cleanup identity changed. Close and check progress again.')
        const operationId = operation?.operation_id ?? saved?.operation_id ?? crypto.randomUUID()
        saveCleanup(identity, operationId)
        setHasSaved(true)
        const raw = envelope.parse(await cleanupRequest(path, {
          action: operation ? 'advance' : 'reserve', operation_id: operationId,
          generation_id: target.generation_id, confirmation: 'PURGE LIVE CLASSROOM DATA',
        }))
        const status = parseCleanupStatus(raw.operation, operationId)
        if (version !== epoch.current) return
        accept(status); setReady(true)
        if (raw.enabled !== undefined) setEnabled(raw.enabled)
      })
    } catch (reason) {
      if (version === epoch.current) {
        setError(reason instanceof z.ZodError ? 'Cleanup status could not be verified.' : reason instanceof Error ? reason.message : 'Cleanup could not be verified.')
        setReady(false)
      }
    } finally {
      if (version === epoch.current) { running.current = false; setBusy(false) }
    }
  }
  return { operation, busy, ready, enabled, error, hasSaved, refresh, advance }
}
