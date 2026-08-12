'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileArchive, UserRound } from 'lucide-react'
import { Button, ContentDialog, FormField, Input } from '@/ui'
import { fetchJSON } from '@/lib/request-cache'
import type { StudentPurgeImpact, StudentPurgeStatus } from '@/lib/validations/student-purge'

type Props = {
  classroomId: string
  classroomTitle: string
  studentId: string
  studentEmail: string
  studentName: string
  isOpen: boolean
  onClose: () => void
  onCompleted: () => void
}

type PurgeResponse = {
  impact?: StudentPurgeImpact
  operation?: StudentPurgeStatus | null
  advanced?: boolean
  error?: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function StudentPurgeDialog({
  classroomId,
  classroomTitle,
  studentId,
  studentEmail,
  studentName,
  isOpen,
  onClose,
  onCompleted,
}: Props) {
  const mountedRef = useRef(true)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [impact, setImpact] = useState<StudentPurgeImpact | null>(null)
  const [operation, setOperation] = useState<StudentPurgeStatus | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState('')
  const basePath = `/api/teacher/classrooms/${classroomId}/students/${studentId}/purge`
  const totalFiles = useMemo(
    () => operation
      ? Object.values(operation.storage_object_counts).reduce((sum, count) => sum + count, 0)
      : impact?.managed_file_count || 0,
    [impact, operation],
  )
  const finishedFiles = operation?.storage_object_counts.deleted || 0

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    setConfirmation('')
    setError('')
    setIsLoading(true)
    fetchJSON<PurgeResponse>(basePath, {
      init: { cache: 'no-store' },
      errorMessage: 'Could not prepare student data deletion',
    })
      .then((body) => {
        if (!body.impact) throw new Error(body.error || 'Could not prepare student data deletion')
        if (!mountedRef.current) return
        setImpact(body.impact)
        setOperation(body.operation || null)
      })
      .catch((reason: unknown) => {
        if (!mountedRef.current) return
        setError(reason instanceof Error ? reason.message : 'Could not prepare student data deletion')
      })
      .finally(() => { if (mountedRef.current) setIsLoading(false) })
  }, [basePath, isOpen])

  useEffect(() => {
    if (!operation) return
    const scrollContainer = contentRef.current?.parentElement
    if (scrollContainer) scrollContainer.scrollTop = 0
  }, [error, operation])

  async function runUntilSettled(initial: StudentPurgeStatus) {
    let current = initial
    setOperation(current)
    for (let tick = 0; tick < 10_000 && mountedRef.current; tick += 1) {
      if (current.status === 'completed') {
        onCompleted()
        return
      }
      if (current.status === 'failed' && current.retryable === false) {
        throw new Error('Deletion stopped safely. No relational records were removed.')
      }
      const response = await fetch(`${basePath}/${current.operation_id}/tick`, { method: 'POST' })
      const body = await response.json() as PurgeResponse
      if (!response.ok || !body.operation) {
        throw new Error(body.error || 'Deletion paused before it could finish')
      }
      current = body.operation
      if (mountedRef.current) setOperation(current)
      if (body.advanced === false) {
        throw new Error('Deletion is waiting safely. Select Continue deletion shortly.')
      }
      if ((current.storage_object_counts.failed || 0) > 0) {
        throw new Error('A storage request failed safely. Progress was saved; select Continue deletion to retry.')
      }
    }
    throw new Error('Deletion is still in progress. Select Continue deletion to resume.')
  }

  async function startOrContinue() {
    setIsWorking(true)
    setError('')
    try {
      let current = operation
      if (!current) {
        const response = await fetch(basePath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation_id: crypto.randomUUID(),
            confirmation,
            expected_source_revision: impact?.source_revision,
            expected_storage_inventory_sha256: impact?.storage_inventory_sha256,
            expected_relational_inventory_sha256: impact?.relational_inventory_sha256,
          }),
        })
        const body = await response.json() as PurgeResponse
        if (!response.ok || !body.operation) throw new Error(body.error || 'Could not start deletion')
        current = body.operation
      }
      await runUntilSettled(current)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Deletion paused')
    } finally {
      if (mountedRef.current) setIsWorking(false)
    }
  }

  function close() {
    if (isWorking) return
    setImpact(null)
    setOperation(null)
    setError('')
    onClose()
  }

  return (
    <ContentDialog
      isOpen={isOpen}
      onClose={close}
      title="Purge this student’s classroom data?"
      subtitle={`${studentName} · ${classroomTitle}`}
      maxWidth="max-w-xl"
      showHeaderClose={!isWorking}
      showFooterClose={false}
    >
      {isLoading ? (
        <div className="py-10 text-center text-sm text-text-muted">Calculating what will be removed…</div>
      ) : (
        <div ref={contentRef} className="space-y-5">
          <div className="rounded-card border border-danger bg-danger-bg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
              <div>
                <p className="font-semibold text-danger">This cannot be undone.</p>
                <p className="mt-1 text-sm text-text-default">
                  This permanently removes this student’s submissions, tests, grades, attendance,
                  logs, feedback, roster records, and uploaded files from this classroom.
                </p>
                <p className="mt-2 text-sm text-text-muted">
                  Their user account and data in other classrooms are kept. Retained archive copies
                  and Gradex extracts for this classroom are also removed because they may contain this data.
                </p>
              </div>
            </div>
          </div>

          {impact ? (
            <div>
              <h4 className="text-sm font-semibold text-text-default">Deletion impact</h4>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <div className="rounded-control border border-border bg-surface-2 p-2 sm:p-3">
                  <UserRound className="h-4 w-4 text-text-muted" aria-hidden="true" />
                  <p className="mt-2 text-lg font-semibold text-text-default">1</p>
                  <p className="text-xs text-text-muted">student</p>
                </div>
                <div className="rounded-control border border-border bg-surface-2 p-2 sm:p-3">
                  <CheckCircle2 className="h-4 w-4 text-text-muted" aria-hidden="true" />
                  <p className="mt-2 text-lg font-semibold text-text-default">{impact.relational_row_count}</p>
                  <p className="text-xs text-text-muted">records</p>
                </div>
                <div className="rounded-control border border-border bg-surface-2 p-2 sm:p-3">
                  <FileArchive className="h-4 w-4 text-text-muted" aria-hidden="true" />
                  <p className="mt-2 text-lg font-semibold text-text-default">{impact.managed_file_count}</p>
                  <p className="text-xs text-text-muted">files · {formatBytes(impact.managed_file_bytes)}</p>
                </div>
              </div>
              {(impact.archive_count > 0 || impact.gradex_extract_count > 0) ? (
                <p className="mt-2 text-xs text-text-muted">
                  Also removes {impact.archive_count} retained classroom archive{impact.archive_count === 1 ? '' : 's'}
                  {' '}and {impact.gradex_extract_count} Gradex extract{impact.gradex_extract_count === 1 ? '' : 's'}.
                </p>
              ) : null}
            </div>
          ) : null}

          {operation ? (
            <div className="rounded-card border border-border bg-surface-2 p-4" aria-live="polite">
              <p className="text-sm font-medium text-text-default">
                {operation.status === 'completed' ? 'Deletion complete' : `Deleting files ${finishedFiles} of ${totalFiles}…`}
              </p>
              <p className="mt-1 text-xs text-text-muted">Progress is saved. Failed requests can be retried safely.</p>
            </div>
          ) : (
            <FormField label={`Type “${studentEmail}” to confirm`} hint="The email address is case-sensitive.">
              <Input value={confirmation} autoComplete="off" onChange={(event) => setConfirmation(event.target.value)} disabled={isWorking} />
            </FormField>
          )}

          {impact?.conflicting_operation ? (
            <p className="rounded-control border border-warning bg-warning-bg px-3 py-2 text-sm text-text-default">
              Finish the active classroom operation before purging this student.
            </p>
          ) : null}
          {impact && !impact.deletion_available ? (
            <p className="rounded-control border border-warning bg-warning-bg px-3 py-2 text-sm text-text-default">
              {impact.unavailable_reason || 'Student data deletion is not available yet.'}
            </p>
          ) : null}
          {error ? <p className="rounded-control border border-danger bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">{error}</p> : null}

          <div className="flex flex-row justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={isWorking}>Cancel</Button>
            <Button
              type="button"
              variant="danger"
              onClick={startOrContinue}
              loading={isWorking}
              disabled={
                isLoading
                || impact?.deletion_available === false
                || Boolean(impact?.conflicting_operation)
                || (!operation && confirmation !== studentEmail)
                || operation?.status === 'completed'
              }
            >
              {operation ? 'Continue deletion' : 'Purge classroom data'}
            </Button>
          </div>
        </div>
      )}
    </ContentDialog>
  )
}
