'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { CircleHelp } from 'lucide-react'
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
  Button,
  ContentDialog,
  FormField,
  Input,
  PageState,
  Select,
  TableSelectionCheckbox,
  Tooltip,
  useAppMessage,
} from '@/ui'

interface AttendanceWindowDialogProps {
  classroomId: string
  isOpen: boolean
  onClose: () => void
  onSaved: (policy: TeacherAttendancePolicy, scheduleSynced: boolean) => void
}

const CLOSING_DAY_HELP = 'Use next day only for classes that continue past midnight.'
const AUTOMATIC_HOURS_HELP = 'Pika sends concrete Toronto-time windows for scheduled class days. Teachers can still override an active session.'

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
  const [entryClosesMinutesBeforeEnd, setEntryClosesMinutesBeforeEnd] = useState(10)
  const [absentMinutesBeforeEnd, setAbsentMinutesBeforeEnd] = useState(0)
  const [enabled, setEnabled] = useState(true)
  const [expandedHelp, setExpandedHelp] = useState<'closing-day' | 'automatic' | null>(null)
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
      setEntryClosesMinutesBeforeEnd(policy?.entryClosesMinutesBeforeEnd ?? 10)
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
      setExpandedHelp(null)
      void loadPolicy()
    }
  }, [isOpen, loadPolicy])

  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  const duration = minutes(sessionEndsLocal) - minutes(sessionStartsLocal)
    + sessionEndDayOffset * 1440
  const validationError = !sessionStartsLocal || !sessionEndsLocal
    ? 'Choose both session times.'
    : duration <= 0
      ? 'Session end must be after session start.'
      : presentGraceMinutes >= duration - entryClosesMinutesBeforeEnd
        ? 'The Present window must end before QR check-in closes.'
        : entryClosesMinutesBeforeEnd < absentMinutesBeforeEnd
          ? 'Students cannot become absent before QR check-in closes.'
          : ''

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
      onClose={onClose}
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
            <FormField label="Session ends" required>
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
                  max={720}
                  value={entryOpensMinutesBefore}
                  disabled={saving}
                  onChange={(event) => setEntryOpensMinutesBefore(Number(event.target.value))}
                />
              </FormField>
              <FormField label="Present grace after start (min)">
                <Input
                  type="number"
                  min={0}
                  max={720}
                  value={presentGraceMinutes}
                  disabled={saving}
                  onChange={(event) => setPresentGraceMinutes(Number(event.target.value))}
                />
              </FormField>
              <FormField label="QR closes before end (min)">
                <Input
                  type="number"
                  min={0}
                  max={720}
                  value={entryClosesMinutesBeforeEnd}
                  disabled={saving}
                  onChange={(event) => setEntryClosesMinutesBeforeEnd(Number(event.target.value))}
                />
              </FormField>
              <FormField label="Absent before end (min)">
                <Input
                  type="number"
                  min={0}
                  max={720}
                  value={absentMinutesBeforeEnd}
                  disabled={saving}
                  onChange={(event) => setAbsentMinutesBeforeEnd(Number(event.target.value))}
                />
              </FormField>
            </div>
            <p className="mt-3 text-xs text-text-muted">
              A scan at the Present cutoff is Present. Later accepted scans are Late. Students
              without a scan become Absent at the Absent cutoff.
            </p>
          </div>

          <div>
            <FormField
              label="Session end day"
              labelAccessory={
                <Tooltip content={CLOSING_DAY_HELP}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-label="About closing day"
                    aria-expanded={expandedHelp === 'closing-day'}
                    aria-controls={expandedHelp === 'closing-day' ? 'closing-day-help' : undefined}
                    disabled={saving}
                    onClick={() => setExpandedHelp((current) => current === 'closing-day' ? null : 'closing-day')}
                  >
                    <CircleHelp className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </Tooltip>
              }
            >
              <Select
                value={String(sessionEndDayOffset)}
                disabled={saving}
                options={[
                  { value: '0', label: 'Same class day' },
                  { value: '1', label: 'Next day' },
                ]}
                onChange={(event) => setSessionEndDayOffset(event.target.value === '1' ? 1 : 0)}
              />
            </FormField>
            {expandedHelp === 'closing-day' ? (
              <p id="closing-day-help" className="mt-1 text-sm text-text-muted">{CLOSING_DAY_HELP}</p>
            ) : null}
          </div>

          <div>
            <div className="flex items-center gap-2 rounded-control border border-border bg-surface-2 px-3 py-2 text-sm text-text-default">
              <label className="flex min-h-control flex-1 cursor-pointer items-center gap-3 font-medium">
                <TableSelectionCheckbox
                  checked={enabled}
                  disabled={saving}
                  ariaLabel="Open and close automatically"
                  onChange={setEnabled}
                />
                <span>Open and close automatically</span>
              </label>
              <Tooltip content={AUTOMATIC_HOURS_HELP}>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label="About automatic attendance hours"
                  aria-expanded={expandedHelp === 'automatic'}
                  aria-controls={expandedHelp === 'automatic' ? 'automatic-hours-help' : undefined}
                  disabled={saving}
                  onClick={() => setExpandedHelp((current) => current === 'automatic' ? null : 'automatic')}
                >
                  <CircleHelp className="h-4 w-4" aria-hidden="true" />
                </Button>
              </Tooltip>
            </div>
            {expandedHelp === 'automatic' ? (
              <p id="automatic-hours-help" className="mt-1 text-sm text-text-muted">{AUTOMATIC_HOURS_HELP}</p>
            ) : null}
          </div>

          <p className="text-xs text-text-muted">
            Timezone: America/Toronto. Changes apply to future sessions; a session keeps its rules
            once QR entry opens.
          </p>
          {validationError && (sessionStartsLocal || sessionEndsLocal) ? (
            <p role="alert" className="text-sm text-danger">{validationError}</p>
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
