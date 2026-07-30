'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileArchive, Users } from 'lucide-react'
import { Button, ContentDialog, FormField, Input } from '@/ui'
import type {
  ClassroomPurgeImpact,
  ClassroomPurgeStatus,
} from '@/lib/validations/classroom-purge'

type Props = {
  classroomId: string
  classroomTitle: string
  isOpen: boolean
  onClose: () => void
  onCompleted: () => void
}

type PurgeResponse = {
  impact?: ClassroomPurgeImpact
  operation?: ClassroomPurgeStatus | null
  error?: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ClassroomPurgeDialog({
  classroomId,
  classroomTitle,
  isOpen,
  onClose,
  onCompleted,
}: Props) {
  const mountedRef = useRef(true)
  const [impact, setImpact] = useState<ClassroomPurgeImpact | null>(null)
  const [operation, setOperation] = useState<ClassroomPurgeStatus | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState('')

  const isConfirmed = confirmation === 'DELETE' || confirmation === classroomTitle
  const totalFiles = useMemo(
    () => operation
      ? Object.values(operation.storage_object_counts).reduce(
          (total, count) => total + count,
          0,
        )
      : impact?.managed_file_count || 0,
    [impact, operation],
  )
  const finishedFiles = operation
    ? (operation.storage_object_counts.deleted || 0)
      + (operation.storage_object_counts.preserved || 0)
    : 0

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    setConfirmation('')
    setError('')
    setIsLoading(true)
    fetch(`/api/teacher/classrooms/${classroomId}/purge`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json() as PurgeResponse
        if (!response.ok || !body.impact) {
          throw new Error(body.error || 'Could not prepare permanent deletion')
        }
        if (!mountedRef.current) return
        setImpact(body.impact)
        setOperation(body.operation || null)
      })
      .catch((reason: unknown) => {
        if (!mountedRef.current) return
        setError(reason instanceof Error ? reason.message : 'Could not prepare permanent deletion')
      })
      .finally(() => {
        if (mountedRef.current) setIsLoading(false)
      })
  }, [classroomId, isOpen])

  async function runUntilSettled(initialOperation: ClassroomPurgeStatus) {
    let current = initialOperation
    setOperation(current)
    for (let tick = 0; tick < 10_000 && mountedRef.current; tick += 1) {
      if (current.status === 'completed') {
        onCompleted()
        return
      }
      if (current.status === 'failed' && current.retryable === false) {
        throw new Error('Permanent deletion stopped safely. No database rows were removed.')
      }
      const response = await fetch(
        `/api/teacher/classrooms/${classroomId}/purge/${current.operation_id}/tick`,
        { method: 'POST' },
      )
      const body = await response.json() as PurgeResponse
      if (!response.ok || !body.operation) {
        throw new Error(body.error || 'Permanent deletion paused before it could finish')
      }
      current = body.operation
      if (mountedRef.current) setOperation(current)
      if ((current.storage_object_counts.failed || 0) > 0) {
        throw new Error(
          'A storage request failed safely. Progress was saved; select Continue deletion to retry.',
        )
      }
    }
    throw new Error('Permanent deletion is still in progress. Select Continue deletion to resume.')
  }

  async function startOrContinue() {
    setIsWorking(true)
    setError('')
    try {
      let current = operation
      if (!current) {
        const response = await fetch(`/api/teacher/classrooms/${classroomId}/purge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation_id: crypto.randomUUID(),
            confirmation,
          }),
        })
        const body = await response.json() as PurgeResponse
        if (!response.ok || !body.operation) {
          throw new Error(body.error || 'Could not start permanent deletion')
        }
        current = body.operation
      }
      await runUntilSettled(current)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Permanent deletion paused')
    } finally {
      if (mountedRef.current) setIsWorking(false)
    }
  }

  const close = () => {
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
      title="Delete classroom permanently?"
      subtitle={classroomTitle}
      maxWidth="max-w-xl"
      showHeaderClose={!isWorking}
      showFooterClose={false}
    >
      {isLoading ? (
        <div className="py-10 text-center text-sm text-text-muted">
          Calculating what will be removed…
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-card border border-danger bg-danger-bg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
              <div>
                <p className="font-semibold text-danger">This cannot be undone.</p>
                <p className="mt-1 text-sm text-text-default">
                  This permanently removes all student work, submissions, tests, grades,
                  attendance and logs, feedback, roster data, and uploads from this classroom.
                </p>
                <p className="mt-2 text-sm text-text-muted">
                  The reusable Course Blueprint and user accounts are kept.
                </p>
              </div>
            </div>
          </div>

          {impact ? (
            <div>
              <h4 className="text-sm font-semibold text-text-default">Deletion impact</h4>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <div className="rounded-control border border-border bg-surface-2 p-2 sm:p-3">
                  <Users className="h-4 w-4 text-text-muted" aria-hidden="true" />
                  <p className="mt-2 text-lg font-semibold text-text-default">{impact.student_count}</p>
                  <p className="text-xs text-text-muted">students</p>
                </div>
                <div className="rounded-control border border-border bg-surface-2 p-2 sm:p-3">
                  <CheckCircle2 className="h-4 w-4 text-text-muted" aria-hidden="true" />
                  <p className="mt-2 text-lg font-semibold text-text-default">
                    {impact.relational_row_count}
                  </p>
                  <p className="text-xs text-text-muted">database records</p>
                </div>
                <div className="rounded-control border border-border bg-surface-2 p-2 sm:p-3">
                  <FileArchive className="h-4 w-4 text-text-muted" aria-hidden="true" />
                  <p className="mt-2 text-lg font-semibold text-text-default">
                    {impact.managed_file_count}
                  </p>
                  <p className="text-xs text-text-muted">
                    files · {formatBytes(impact.managed_file_bytes)}
                  </p>
                </div>
              </div>
              {(impact.archive_count > 0 || impact.gradex_extract_count > 0) ? (
                <p className="mt-2 text-xs text-text-muted">
                  Includes {impact.archive_count} classroom archive
                  {impact.archive_count === 1 ? '' : 's'} and {impact.gradex_extract_count} related
                  Gradex extract{impact.gradex_extract_count === 1 ? '' : 's'}.
                </p>
              ) : null}
            </div>
          ) : null}

          {operation ? (
            <div className="rounded-card border border-border bg-surface-2 p-4" aria-live="polite">
              <p className="text-sm font-medium text-text-default">
                {operation.status === 'completed'
                  ? 'Deletion complete'
                  : `Deleting files ${finishedFiles} of ${totalFiles}…`}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Progress is saved. If a request fails, you can safely continue.
              </p>
            </div>
          ) : (
            <FormField
              label={`Type “${classroomTitle}” or DELETE to confirm`}
              hint="The classroom name is case-sensitive."
            >
              <Input
                value={confirmation}
                autoComplete="off"
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={isWorking}
              />
            </FormField>
          )}

          {impact?.conflicting_operation ? (
            <p className="rounded-control border border-warning bg-warning-bg px-3 py-2 text-sm text-text-default">
              Finish the active classroom operation before deleting permanently.
            </p>
          ) : null}
          {error ? (
            <p className="rounded-control border border-danger bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={close}
              disabled={isWorking}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={startOrContinue}
              loading={isWorking}
              disabled={
                isLoading
                || Boolean(impact?.conflicting_operation)
                || (!operation && !isConfirmed)
                || operation?.status === 'completed'
              }
            >
              {operation ? 'Continue deletion' : 'Delete permanently'}
            </Button>
          </div>
        </div>
      )}
    </ContentDialog>
  )
}
