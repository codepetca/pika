'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileArchive, Users } from 'lucide-react'
import { Button, ContentDialog, FormField, Input } from '@/ui'
import { fetchJSON } from '@/lib/request-cache'
import { attendanceDecommissionOperationId } from '@/lib/attendance-decommission-operation-id'
import {
  ATTENDANCE_CLASSROOM_DECOMMISSION_REQUIRED_MESSAGE,
  attendanceDecommissionStatusSchema,
  type AttendanceDecommissionStatus,
} from '@/lib/validations/attendance-decommission'
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
  advanced?: boolean
  error?: string
}

type AttendanceResponse = {
  operation?: unknown
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
  const loadGenerationRef = useRef(0)
  const purgeOperationIdRef = useRef<string | null>(null)
  const [impact, setImpact] = useState<ClassroomPurgeImpact | null>(null)
  const [operation, setOperation] = useState<ClassroomPurgeStatus | null>(null)
  const [attendanceOperation, setAttendanceOperation] =
    useState<AttendanceDecommissionStatus | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState('')

  const isConfirmed = confirmation === 'DELETE' || confirmation === classroomTitle
  const deletionStarted = Boolean(attendanceOperation || operation)
  const requiresPurgeConfirmation = !operation
    && (!attendanceOperation || attendanceOperation.attendance_removed)
  const totalFiles = useMemo(
    () => operation
      ? Object.values(operation.storage_object_counts).reduce((total, count) => total + count, 0)
      : impact?.managed_file_count || 0,
    [impact, operation],
  )
  const finishedFiles = operation?.storage_object_counts.deleted || 0

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchPurgeSnapshot = useCallback(async (): Promise<PurgeResponse> => {
    return fetchJSON<PurgeResponse>(`/api/teacher/classrooms/${classroomId}/purge`, {
      init: { cache: 'no-store' },
      errorMessage: 'Could not prepare permanent deletion',
    })
  }, [classroomId])

  const readAttendanceStatus = useCallback(async (): Promise<AttendanceDecommissionStatus | null> => {
    const operationId = await attendanceDecommissionOperationId(classroomId)
    const response = await fetch(
      `/api/teacher/classrooms/${classroomId}/attendance-decommission/${operationId}`,
      { cache: 'no-store' },
    )
    const body = await response.json().catch(() => ({})) as AttendanceResponse
    if (response.status === 404 || (response.ok && !body.operation)) return null
    if (!response.ok) throw new Error(body.error || 'Could not read attendance deletion progress')
    return attendanceDecommissionStatusSchema.parse(body.operation)
  }, [classroomId])

  useEffect(() => {
    if (!isOpen) {
      loadGenerationRef.current += 1
      return
    }
    const generation = loadGenerationRef.current + 1
    loadGenerationRef.current = generation
    setConfirmation('')
    setError('')
    setImpact(null)
    setOperation(null)
    setAttendanceOperation(null)
    purgeOperationIdRef.current = null
    setIsLoading(true)
    Promise.all([
      fetchPurgeSnapshot(),
      readAttendanceStatus().catch(() => null),
    ])
      .then(([body, attendance]) => {
        if (!body.impact) throw new Error(body.error || 'Could not prepare permanent deletion')
        if (!mountedRef.current || loadGenerationRef.current !== generation) return
        setImpact(body.impact)
        setOperation(body.operation || null)
        setAttendanceOperation(attendance)
        if (body.operation) purgeOperationIdRef.current = body.operation.operation_id
      })
      .catch((reason: unknown) => {
        if (!mountedRef.current || loadGenerationRef.current !== generation) return
        setError(reason instanceof Error ? reason.message : 'Could not prepare permanent deletion')
      })
      .finally(() => {
        if (mountedRef.current && loadGenerationRef.current === generation) setIsLoading(false)
      })
  }, [fetchPurgeSnapshot, isOpen, readAttendanceStatus])

  async function beginOrResumeAttendance(): Promise<AttendanceDecommissionStatus> {
    const existing = await readAttendanceStatus()
    if (existing) return existing

    const operationId = await attendanceDecommissionOperationId(classroomId)
    try {
      const response = await fetch(
        `/api/teacher/classrooms/${classroomId}/attendance-decommission`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation_id: operationId, confirmation }),
        },
      )
      const body = await response.json().catch(() => ({})) as AttendanceResponse
      if (!response.ok) throw new Error(body.error || 'Could not start linked attendance deletion')
      return attendanceDecommissionStatusSchema.parse(body.operation)
    } catch (reason) {
      const recovered = await readAttendanceStatus().catch(() => null)
      if (recovered) return recovered
      throw reason
    }
  }

  async function runAttendanceUntilSettled(initial: AttendanceDecommissionStatus) {
    let current = initial
    setAttendanceOperation(current)
    for (let tick = 0; tick < 10_000 && mountedRef.current; tick += 1) {
      if (current.attendance_removed) return current
      const response = await fetch(
        `/api/teacher/classrooms/${classroomId}/attendance-decommission/${current.operation_id}`,
        { method: 'POST' },
      )
      const body = await response.json().catch(() => ({})) as AttendanceResponse
      if (!response.ok) {
        throw new Error(body.error || 'Linked attendance deletion paused before it could finish')
      }
      current = attendanceDecommissionStatusSchema.parse(body.operation)
      if (mountedRef.current) setAttendanceOperation(current)
    }
    throw new Error('Linked attendance deletion is still in progress. Select Continue deletion to resume.')
  }

  async function runUntilSettled(initial: ClassroomPurgeStatus) {
    let current = initial
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
      if (body.advanced === false) {
        throw new Error('Deletion is waiting safely for another request or retry window. Select Continue deletion shortly.')
      }
      if ((current.storage_object_counts.failed || 0) > 0) {
        throw new Error('A storage request failed safely. Progress was saved; select Continue deletion to retry.')
      }
    }
    throw new Error('Permanent deletion is still in progress. Select Continue deletion to resume.')
  }

  async function startPurge(currentImpact: ClassroomPurgeImpact) {
    const operationId = purgeOperationIdRef.current || crypto.randomUUID()
    purgeOperationIdRef.current = operationId
    let current: ClassroomPurgeStatus | null = null
    try {
      const response = await fetch(`/api/teacher/classrooms/${classroomId}/purge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation_id: operationId,
          confirmation,
          expected_source_revision: currentImpact.source_revision,
          expected_storage_inventory_sha256: currentImpact.storage_inventory_sha256,
          expected_operational_inventory_sha256: currentImpact.operational_inventory_sha256,
        }),
      })
      const body = await response.json().catch(() => ({})) as PurgeResponse
      if (!response.ok || !body.operation) {
        if (body.error === ATTENDANCE_CLASSROOM_DECOMMISSION_REQUIRED_MESSAGE) {
          return { attendanceRequired: true as const }
        }
        throw new Error(body.error || 'Could not start permanent deletion')
      }
      current = body.operation
    } catch (reason) {
      current = await fetch(
        `/api/teacher/classrooms/${classroomId}/purge/${operationId}`,
        { cache: 'no-store' },
      ).then(async (response) => {
        const body = await response.json().catch(() => ({})) as PurgeResponse
        return response.ok && body.operation ? body.operation : null
      }).catch(() => null)
      if (!current) throw reason
    }
    setOperation(current)
    await runUntilSettled(current)
    return { attendanceRequired: false as const }
  }

  async function startOrContinue() {
    setIsWorking(true)
    setError('')
    try {
      if (operation) {
        await runUntilSettled(operation)
        return
      }

      if (attendanceOperation) {
        await runAttendanceUntilSettled(attendanceOperation)
        if (!isConfirmed) return
        const refreshed = await fetchPurgeSnapshot()
        if (!refreshed.impact) throw new Error('Could not refresh permanent deletion impact')
        setImpact(refreshed.impact)
        const finalAttempt = await startPurge(refreshed.impact)
        if (finalAttempt.attendanceRequired) {
          throw new Error('Linked attendance removal could not be verified. Progress is saved; select Continue deletion to retry.')
        }
        return
      }

      if (!impact) throw new Error('Could not prepare permanent deletion')
      const firstAttempt = await startPurge(impact)
      if (!firstAttempt.attendanceRequired) return

      const attendance = await beginOrResumeAttendance()
      await runAttendanceUntilSettled(attendance)
      const refreshed = await fetchPurgeSnapshot()
      if (!refreshed.impact) throw new Error('Could not refresh permanent deletion impact')
      setImpact(refreshed.impact)
      const finalAttempt = await startPurge(refreshed.impact)
      if (finalAttempt.attendanceRequired) {
        throw new Error('Linked attendance removal could not be verified. Progress is saved; select Continue deletion to retry.')
      }
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
    setAttendanceOperation(null)
    purgeOperationIdRef.current = null
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
              {(impact.archive_count > 0 || impact.gradex_extract_count > 0
                || impact.interrupted_upload_count > 0) ? (
                  <p className="mt-2 text-xs text-text-muted">
                    Includes {impact.archive_count} classroom archive
                    {impact.archive_count === 1 ? '' : 's'} and {impact.gradex_extract_count} related
                    Gradex extract{impact.gradex_extract_count === 1 ? '' : 's'}
                    {impact.interrupted_upload_count > 0
                      ? `, plus ${impact.interrupted_upload_count} interrupted upload${impact.interrupted_upload_count === 1 ? '' : 's'}`
                      : ''}.
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
          ) : attendanceOperation ? (
            <>
              <div className="rounded-card border border-border bg-surface-2 p-4" aria-live="polite">
                <p className="text-sm font-medium text-text-default">
                  {attendanceOperation.attendance_removed
                    ? 'Linked attendance removed'
                    : attendanceOperation.state === 'remote_deleted'
                      ? 'Removing local attendance records…'
                      : 'Removing linked attendance…'}
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  {attendanceOperation.deleted_count > 0
                    ? `${attendanceOperation.deleted_count} attendance record${attendanceOperation.deleted_count === 1 ? '' : 's'} removed. Progress is saved.`
                    : 'Attendance writes are safely stopped. Progress is saved if you close this window.'}
                </p>
              </div>
              {attendanceOperation.attendance_removed ? (
                <FormField
                  label={`Type “${classroomTitle}” or DELETE to confirm`}
                  htmlFor="classroom-purge-confirmation"
                  hint="Confirm again to finish removing the classroom and its files."
                >
                  <Input
                    id="classroom-purge-confirmation"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="off"
                  />
                </FormField>
              ) : null}
            </>
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
          {impact && !impact.deletion_available ? (
            <p className="rounded-control border border-warning bg-warning-bg px-3 py-2 text-sm text-text-default">
              {impact.unavailable_reason || 'Permanent deletion is not available for this classroom yet.'}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-control border border-danger bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-row justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={isWorking}>
              {deletionStarted ? 'Close' : 'Cancel'}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={startOrContinue}
              loading={isWorking}
              disabled={
                isLoading
                || (impact?.deletion_available === false && !deletionStarted)
                || Boolean(impact?.conflicting_operation)
                || (requiresPurgeConfirmation && !isConfirmed)
                || operation?.status === 'completed'
              }
            >
              {deletionStarted ? 'Continue deletion' : 'Delete permanently'}
            </Button>
          </div>
        </div>
      )}
    </ContentDialog>
  )
}
