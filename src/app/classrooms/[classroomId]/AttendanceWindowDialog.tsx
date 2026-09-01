'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { fetchJSON } from '@/lib/request-cache'
import {
  invalidateTeacherAttendancePolicy,
  isTeacherAttendanceScheduleAcknowledged,
  parseTeacherAttendancePolicy,
  readTeacherAttendancePolicy,
  type TeacherAttendancePolicy,
} from '@/lib/teacher-attendance-policy'
import { getTodayInToronto } from '@/lib/timezone'
import {
  ATTENDANCE_SESSION_TOO_LONG_MESSAGE,
  MAX_ATTENDANCE_SESSION_MINUTES,
  attendanceSessionDurationMinutes,
} from '@/lib/attendance-session-duration'
import {
  Button,
  ContentDialog,
  FormField,
  Input,
  PageState,
  SegmentedControl,
  TableSelectionCheckbox,
  useAppMessage,
} from '@/ui'

interface AttendanceWindowDialogProps {
  classroomId: string
  isOpen: boolean
  onClose: () => void
  onSaved: (policy: TeacherAttendancePolicy, scheduleSynced: boolean) => void
}

function clampMinutes(value: number, maximum: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), maximum)
}

export function AttendanceWindowDialog(props: AttendanceWindowDialogProps) {
  return <AttendanceWindowDialogContent key={props.classroomId} {...props} />
}

function AttendanceWindowDialogContent({
  classroomId,
  isOpen,
  onClose,
  onSaved,
}: AttendanceWindowDialogProps) {
  const { showMessage } = useAppMessage()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState<number | null>(null)
  const [sessionStartsLocal, setSessionStartsLocal] = useState('09:00')
  const [sessionEndsLocal, setSessionEndsLocal] = useState('10:00')
  const [sessionEndDayOffset, setSessionEndDayOffset] = useState<0 | 1>(0)
  const [entryOpensMinutesBefore, setEntryOpensMinutesBefore] = useState(10)
  const [presentGraceMinutes, setPresentGraceMinutes] = useState(5)
  const [entryClosesMinutesBeforeEnd, setEntryClosesMinutesBeforeEnd] = useState(0)
  const [absentMinutesBeforeEnd, setAbsentMinutesBeforeEnd] = useState(0)
  const [enabled, setEnabled] = useState(true)
  const mounted = useRef(true)
  const requestSequence = useRef(0)
  const openRef = useRef(isOpen)
  if (openRef.current !== isOpen) {
    openRef.current = isOpen
    requestSequence.current += 1
  }
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const loadPolicy = useCallback(async () => {
    const request = ++requestSequence.current
    const current = () => mounted.current && openRef.current && requestSequence.current === request
    setLoading(true)
    setSaving(false)
    setError('')
    try {
      invalidateTeacherAttendancePolicy(classroomId)
      const policy = await readTeacherAttendancePolicy(classroomId)
      if (!current()) return
      setRevision(policy?.revision ?? null)
      setSessionStartsLocal(policy?.sessionStartsLocal ?? '09:00')
      setSessionEndsLocal(policy?.sessionEndsLocal ?? '10:00')
      setSessionEndDayOffset(policy?.sessionEndDayOffset ?? 0)
      setEntryOpensMinutesBefore(policy?.entryOpensMinutesBefore ?? 10)
      setPresentGraceMinutes(policy?.presentGraceMinutes ?? 5)
      setEntryClosesMinutesBeforeEnd(policy?.entryClosesMinutesBeforeEnd ?? 0)
      setAbsentMinutesBeforeEnd(policy?.absentMinutesBeforeEnd ?? 0)
      setEnabled(policy?.enabled ?? true)
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : 'Attendance settings are temporarily unavailable')
    } finally {
      if (current()) setLoading(false)
    }
  }, [classroomId])

  useEffect(() => {
    if (isOpen) {
      void loadPolicy()
    }
  }, [isOpen, loadPolicy])

  const duration = attendanceSessionDurationMinutes(
    sessionStartsLocal,
    sessionEndsLocal,
    sessionEndDayOffset,
  ) ?? 0
  const timingRuleMaximum = Math.min(MAX_ATTENDANCE_SESSION_MINUTES, Math.max(0, duration))

  useEffect(() => {
    setPresentGraceMinutes((current) => clampMinutes(current, timingRuleMaximum))
    setEntryClosesMinutesBeforeEnd((current) => clampMinutes(current, timingRuleMaximum))
    setAbsentMinutesBeforeEnd((current) => clampMinutes(current, timingRuleMaximum))
  }, [timingRuleMaximum])
  const sessionDurationError = !sessionStartsLocal || !sessionEndsLocal
    ? 'Choose both session times.'
    : duration <= 0
      ? 'Session end must be after session start.'
      : duration > MAX_ATTENDANCE_SESSION_MINUTES
        ? ATTENDANCE_SESSION_TOO_LONG_MESSAGE
        : ''
  const timingValidationError = sessionDurationError
    ? ''
    : presentGraceMinutes >= duration - entryClosesMinutesBeforeEnd
        ? 'The Present window must end before QR check-in closes.'
        : entryClosesMinutesBeforeEnd < absentMinutesBeforeEnd
          ? 'Students cannot become absent before QR check-in closes.'
          : ''
  const validationError = sessionDurationError || timingValidationError

  async function savePolicy() {
    if (saving || validationError) return
    const request = ++requestSequence.current
    const current = () => mounted.current && openRef.current && requestSequence.current === request
    setSaving(true)
    setError('')
    try {
      const response = await fetchJSON<unknown>('/api/teacher/attendance/policy', {
        init: {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classroom_id: classroomId,
            session_starts_local: sessionStartsLocal,
            session_ends_local: sessionEndsLocal,
            session_end_day_offset: sessionEndDayOffset,
            entry_opens_minutes_before: entryOpensMinutesBefore,
            present_grace_minutes: presentGraceMinutes,
            entry_closes_minutes_before_end: entryClosesMinutesBeforeEnd,
            absent_minutes_before_end: absentMinutesBeforeEnd,
            enabled,
            expected_revision: revision,
          }),
        },
        errorMessage: 'Attendance settings are temporarily unavailable',
      })
      const savedPolicy = parseTeacherAttendancePolicy(response, classroomId)
      if (!savedPolicy) throw new Error('Attendance settings are temporarily unavailable')
      invalidateTeacherAttendancePolicy(classroomId)
      if (current()) setRevision(savedPolicy.revision)

      const windowStart = getTodayInToronto()
      const windowEnd = format(addDays(parseISO(windowStart), 90), 'yyyy-MM-dd')
      let scheduleSynced = true
      try {
        const delivery = await fetchJSON<unknown>('/api/teacher/attendance/sync', {
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              classroom_id: classroomId,
              window_start: windowStart,
              window_end: windowEnd,
            }),
          },
          errorMessage: 'Attendance schedule is temporarily unavailable',
        })
        scheduleSynced = isTeacherAttendanceScheduleAcknowledged(delivery, savedPolicy)
      } catch {
        scheduleSynced = false
      }

      if (!current()) return
      showMessage({
        text: scheduleSynced
          ? 'Attendance timing saved'
          : 'Hours saved; schedule delivery not confirmed',
        tone: scheduleSynced ? 'success' : 'warning',
      })
      onSaved(savedPolicy, scheduleSynced)
      onClose()
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : 'Attendance settings are temporarily unavailable')
    } finally {
      if (current()) setSaving(false)
    }
  }

  return (
    <ContentDialog
      isOpen={isOpen}
      onClose={() => { if (!saving) onClose() }}
      title="Attendance timing"
      maxWidth="max-w-lg"
      showHeaderClose={!saving}
      showFooterClose={false}
    >
      {loading ? (
        <PageState kind="loading" title="Loading attendance hours" compact />
      ) : error && revision === null ? (
        <PageState
          kind="error"
          title="Attendance hours unavailable"
          description={error}
          compact
          action={<Button type="button" onClick={() => void loadPolicy()}>Try again</Button>}
        />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void savePolicy()
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Session starts" required>
              <Input
                type="time"
                value={sessionStartsLocal}
                disabled={saving}
                onChange={(event) => setSessionStartsLocal(event.target.value)}
              />
            </FormField>
            <FormField label="Session ends" required error={sessionDurationError || undefined}>
              <Input
                type="time"
                value={sessionEndsLocal}
                disabled={saving}
                onChange={(event) => setSessionEndsLocal(event.target.value)}
              />
            </FormField>
          </div>

          <div className="rounded-control border border-border bg-surface-2 p-3">
            <p className="text-sm font-medium text-text-default">Timing rules</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="QR opens before start (min)">
                <Input
                  type="number"
                  min={0}
                  max={120}
                  value={entryOpensMinutesBefore}
                  disabled={saving}
                  onChange={(event) => setEntryOpensMinutesBefore(clampMinutes(Number(event.target.value), 120))}
                />
              </FormField>
              <FormField label="Grace period before late (min)">
                <Input
                  type="number"
                  min={0}
                  max={timingRuleMaximum}
                  value={presentGraceMinutes}
                  disabled={saving}
                  onChange={(event) => setPresentGraceMinutes(clampMinutes(Number(event.target.value), timingRuleMaximum))}
                />
              </FormField>
              <FormField label="QR closes before end (min)">
                <Input
                  type="number"
                  min={0}
                  max={timingRuleMaximum}
                  value={entryClosesMinutesBeforeEnd}
                  disabled={saving}
                  onChange={(event) => setEntryClosesMinutesBeforeEnd(clampMinutes(Number(event.target.value), timingRuleMaximum))}
                />
              </FormField>
              <FormField label="Absent before end (min)">
                <Input
                  type="number"
                  min={0}
                  max={timingRuleMaximum}
                  value={absentMinutesBeforeEnd}
                  disabled={saving}
                  onChange={(event) => setAbsentMinutesBeforeEnd(clampMinutes(Number(event.target.value), timingRuleMaximum))}
                />
              </FormField>
            </div>
          </div>

          <FormField label="Session end day">
            <SegmentedControl
              ariaLabel="Session end day"
              value={String(sessionEndDayOffset) as '0' | '1'}
              className="grid w-full grid-cols-2"
              options={[
                { value: '0', label: 'Same class day', tooltip: 'Class end on the same day', className: 'w-full', disabled: saving },
                { value: '1', label: 'Next day', tooltip: 'Class ends the next day after midnight', className: 'w-full', disabled: saving },
              ]}
              onChange={(value) => setSessionEndDayOffset(value === '1' ? 1 : 0)}
            />
          </FormField>

          <label className="flex min-h-control cursor-pointer items-center gap-3 rounded-control border border-border bg-surface-2 px-3 py-2 text-sm font-medium text-text-default">
            <TableSelectionCheckbox
              checked={enabled}
              disabled={saving}
              ariaLabel="Open and close QR attendance automatically"
              onChange={setEnabled}
            />
            <span>Open and close QR attendance automatically</span>
          </label>

          <p className="text-xs text-text-muted">
            Timezone: America/Toronto. Changes apply to future sessions; a session keeps its rules
            once QR entry opens.
          </p>
          {timingValidationError ? (
            <p role="alert" className="text-sm text-danger">{timingValidationError}</p>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-control border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving} disabled={Boolean(validationError)}>
              Save timing
            </Button>
          </div>
        </form>
      )}
    </ContentDialog>
  )
}
