'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { AlertTriangle, CheckCircle2, FileArchive, Users } from 'lucide-react'
import { Button, ContentDialog, FormField, Input } from '@/ui'
import { fetchJSON } from '@/lib/request-cache'
import type { ClassroomPurgeStatus } from '@/lib/validations/classroom-purge'
import type { ColdClassroomPurgeImpact } from '@/lib/validations/cold-classroom-purge'

type Props = {
  classroomId: string
  archiveId: string
  classroomTitle: string
  isOpen: boolean
  onClose: () => void
  onCompleted: () => void
}

type PurgeResponse = {
  impact?: ColdClassroomPurgeImpact
  operation?: ClassroomPurgeStatus | null
  advanced?: boolean
  error?: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatCount(count: number): string {
  return count.toLocaleString('en-CA')
}

function scheduledRetentionLabel(impact: ColdClassroomPurgeImpact): string | null {
  if (impact.retention.mode !== 'scheduled') return null
  if (Date.parse(impact.retention.delete_after) <= Date.now()) return null
  return formatInTimeZone(
    new Date(impact.retention.delete_after),
    'America/Toronto',
    'MMM d, yyyy',
  )
}

export function ColdClassroomPurgeDialog({
  classroomId,
  archiveId,
  classroomTitle,
  isOpen,
  onClose,
  onCompleted,
}: Props) {
  const mountedRef = useRef(true)
  const [impact, setImpact] = useState<ColdClassroomPurgeImpact | null>(null)
  const [operation, setOperation] = useState<ClassroomPurgeStatus | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState('')

  const basePath = `/api/teacher/classrooms/${classroomId}/archives/${archiveId}/purge`
  const isConfirmed = confirmation === 'DELETE STORED ARCHIVE'
    || confirmation === classroomTitle
  const totalFiles = useMemo(
    () => operation
      ? Object.values(operation.storage_object_counts).reduce((total, count) => total + count, 0)
      : impact?.managed_file_count || 0,
    [impact, operation],
  )
  const finishedFiles = operation?.storage_object_counts.deleted || 0
  const retentionOverrideDate = impact ? scheduledRetentionLabel(impact) : null

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
      errorMessage: 'Could not prepare stored classroom deletion',
    })
      .then((body) => {
        if (!body.impact) {
          throw new Error(body.error || 'Could not prepare stored classroom deletion')
        }
        if (!mountedRef.current) return
        setImpact(body.impact)
        setOperation(body.operation || null)
      })
      .catch((reason: unknown) => {
        if (!mountedRef.current) return
        setError(reason instanceof Error
          ? reason.message
          : 'Could not prepare stored classroom deletion')
      })
      .finally(() => { if (mountedRef.current) setIsLoading(false) })
  }, [basePath, isOpen])

  async function runUntilSettled(initial: ClassroomPurgeStatus) {
    let current = initial
    setOperation(current)
    for (let tick = 0; tick < 10_000 && mountedRef.current; tick += 1) {
      if (current.status === 'completed') {
        onCompleted()
        return
      }
      if (current.status === 'failed' && current.retryable === false) {
        throw new Error(
          'Permanent deletion stopped safely with its recovery fence intact. Contact an administrator before changing this stored classroom.',
        )
      }
      const response = await fetch(
        `${basePath}/${current.operation_id}/tick`,
        { method: 'POST' },
      )
      const body = await response.json() as PurgeResponse
      if (!response.ok || !body.operation) {
        throw new Error(body.error || 'Permanent deletion paused before it could finish')
      }
      current = body.operation
      if (mountedRef.current) setOperation(current)
      if (body.advanced === false) {
        throw new Error(
          'Deletion is waiting safely for another request or retry window. Select Continue deletion shortly.',
        )
      }
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
        const response = await fetch(basePath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation_id: crypto.randomUUID(),
            confirmation,
            expected_source_revision: impact?.source_revision,
            expected_storage_inventory_sha256: impact?.storage_inventory_sha256,
            expected_cold_resource_inventory_sha256:
              impact?.cold_resource_inventory_sha256,
          }),
        })
        const body = await response.json() as PurgeResponse
        if (!response.ok || !body.operation) {
          throw new Error(body.error || 'Could not start stored classroom deletion')
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
      title="Delete stored classroom permanently?"
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
              <AlertTriangle
                className="mt-0.5 h-5 w-5 shrink-0 text-danger"
                aria-hidden="true"
              />
              <div>
                <p className="font-semibold text-danger">This cannot be undone.</p>
                <p className="mt-1 text-sm text-text-default">
                  This deletes the stored recovery archive, any other retained classroom
                  archives, Gradex extracts, and every remaining file owned by this classroom.
                </p>
                <p className="mt-2 text-sm text-text-default">
                  You will no longer be able to restore or recover its student work,
                  submissions, tests, grades, attendance and logs, feedback, roster data,
                  or uploads.
                </p>
                <p className="mt-2 text-sm text-text-muted">
                  User accounts, Course Blueprints, other classrooms, and their data are kept.
                </p>
                <p className="mt-2 text-sm text-text-muted">
                  Once deletion starts, it cannot be cancelled. Interrupted work resumes safely.
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
                  <p className="mt-2 text-lg font-semibold text-text-default">
                    {formatCount(impact.student_count)}
                  </p>
                  <p className="text-xs text-text-muted">students</p>
                </div>
                <div className="rounded-control border border-border bg-surface-2 p-2 sm:p-3">
                  <CheckCircle2 className="h-4 w-4 text-text-muted" aria-hidden="true" />
                  <p className="mt-2 text-lg font-semibold text-text-default">
                    {formatCount(impact.cold_resource_count)}
                  </p>
                  <p className="text-xs text-text-muted">stored records</p>
                </div>
                <div className="rounded-control border border-border bg-surface-2 p-2 sm:p-3">
                  <FileArchive className="h-4 w-4 text-text-muted" aria-hidden="true" />
                  <p className="mt-2 text-lg font-semibold text-text-default">
                    {formatCount(impact.managed_file_count)}
                  </p>
                  <p className="text-xs text-text-muted">
                    files · {formatBytes(impact.managed_file_bytes)}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-xs text-text-muted">
                Includes {impact.archive_count} classroom archive
                {impact.archive_count === 1 ? '' : 's'} and {impact.gradex_extract_count} related
                Gradex extract{impact.gradex_extract_count === 1 ? '' : 's'}.
              </p>
              {impact.missing_file_count > 0 ? (
                <p className="mt-2 text-xs text-warning">
                  {impact.missing_file_count} registered file
                  {impact.missing_file_count === 1 ? ' is' : 's are'} already absent from Storage;
                  deletion will reconcile the retained metadata.
                </p>
              ) : null}
            </div>
          ) : null}

          {retentionOverrideDate ? (
            <p className="rounded-control border border-warning bg-warning-bg px-3 py-2 text-sm text-text-default">
              This deletes the stored archive before its scheduled retention date of{' '}
              {retentionOverrideDate}.
            </p>
          ) : null}

          {operation ? (
            <div className="rounded-card border border-border bg-surface-2 p-4" aria-live="polite">
              <p className="text-sm font-medium text-text-default">
                {operation.status === 'completed'
                  ? 'Deletion complete'
                  : `Deleting files ${finishedFiles} of ${totalFiles}…`}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Progress is saved. The recovery archive is deleted last.
              </p>
            </div>
          ) : (
            <FormField
              label={`Type “${classroomTitle}” or DELETE STORED ARCHIVE to confirm`}
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
          {impact && !impact.deletion_available ? (
            <p className="rounded-control border border-warning bg-warning-bg px-3 py-2 text-sm text-text-default">
              {impact.unavailable_reason
                || 'Permanent deletion is not available for this stored classroom yet.'}
            </p>
          ) : null}
          {error ? (
            <p
              className="rounded-control border border-danger bg-danger-bg px-3 py-2 text-sm text-danger"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <div className="flex flex-row justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={isWorking}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={startOrContinue}
              loading={isWorking}
              disabled={
                isLoading
                || impact?.deletion_available === false
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
