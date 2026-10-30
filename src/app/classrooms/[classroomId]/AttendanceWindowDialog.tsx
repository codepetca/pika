'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { fetchJSON } from '@/lib/request-cache'
import { Plus, Settings2 } from 'lucide-react'
import {
  invalidateTeacherAttendancePolicy,
  isTeacherAttendanceScheduleAcknowledged,
  formatTeacherAttendancePolicyHours,
  parseTeacherAttendancePolicy,
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
  IconButton,
  Input,
  PageState,
  SegmentedControl,
  TableSelectionCheckbox,
  useAppMessage,
} from '@/ui'

interface AttendanceWindowDialogProps {
  classroomId: string
  date: string
  isOpen: boolean
  onClose: () => void
  onSaved: (policy: TeacherAttendancePolicy, scheduleSynced: boolean) => void
}

type Schedule = { id: string | null; name: string; policy: TeacherAttendancePolicy | null }
type ScheduleResponse = { schedules: Schedule[]; selectedId: string | null }

const NUMBER_INPUT_CLASS = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

function clampMinutes(value: number, maximum: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), maximum)
}

function readClampedMinutes(input: HTMLInputElement, maximum: number) {
  const value = clampMinutes(Number(input.value), maximum)
  input.value = String(value)
  return value
}

export function AttendanceWindowDialog(props: AttendanceWindowDialogProps) {
  return <AttendanceWindowDialogContent key={props.classroomId} {...props} />
}

function AttendanceWindowDialogContent({
  classroomId,
  date,
  isOpen,
  onClose,
  onSaved,
}: AttendanceWindowDialogProps) {
  const { showMessage } = useAppMessage()
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [appliedId, setAppliedId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null)
  const [name, setName] = useState('')
  const [pendingDelivery, setPendingDelivery] = useState<{ policy: TeacherAttendancePolicy; regular: boolean } | null>(null)
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
  const dateRef = useRef(date)
  if (dateRef.current !== date) { dateRef.current = date; requestSequence.current += 1 }
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
      const params = new URLSearchParams({ classroom_id: classroomId, date })
      const result = await fetchJSON<ScheduleResponse>(`/api/teacher/attendance/schedules?${params}`, {
        errorMessage: 'Attendance schedules are temporarily unavailable',
      })
      if (!current()) return
      if (!Array.isArray(result.schedules) || !result.schedules.every((schedule) =>
        (schedule.id === null || typeof schedule.id === 'string') && typeof schedule.name === 'string' &&
        (schedule.policy === null || parseTeacherAttendancePolicy({ policy: schedule.policy }, classroomId) !== null),
      )) throw new Error('Attendance schedules are temporarily unavailable')
      setSchedules(result.schedules.length ? result.schedules : [{ id: null, name: 'Regular schedule', policy: null }])
      setSelectedId(result.selectedId)
      setAppliedId(result.selectedId)
      setRevision(result.schedules.find((schedule) => schedule.id === null)?.policy?.revision ?? null)
      setEditing(null)
      setPendingDelivery(null)
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : 'Attendance settings are temporarily unavailable')
    } finally {
      if (current()) setLoading(false)
    }
  }, [classroomId, date])

  useEffect(() => {
    if (isOpen && date) {
      void loadPolicy()
    }
  }, [isOpen, date, loadPolicy])

  function editSchedule(schedule: Schedule | 'new') {
    const policy = schedule === 'new' ? schedules.find((item) => item.id === null)?.policy : schedule.policy
    setName(schedule === 'new' ? '' : schedule.name)
    setSessionStartsLocal(policy?.sessionStartsLocal ?? '09:00')
    setSessionEndsLocal(policy?.sessionEndsLocal ?? '10:00')
    setSessionEndDayOffset(policy?.sessionEndDayOffset ?? 0)
    setEntryOpensMinutesBefore(policy?.entryOpensMinutesBefore ?? 10)
    setPresentGraceMinutes(policy?.presentGraceMinutes ?? 5)
    setEntryClosesMinutesBeforeEnd(policy?.entryClosesMinutesBeforeEnd ?? 0)
    setAbsentMinutesBeforeEnd(policy?.absentMinutesBeforeEnd ?? 0)
    setEnabled(policy?.enabled ?? true)
    setError('')
    setPendingDelivery(null)
    setEditing(schedule)
  }

  async function syncSchedule(policy: TeacherAttendancePolicy, selectionOnly = false) {
    const today = getTodayInToronto()
    const end = format(addDays(parseISO(today), 90), 'yyyy-MM-dd')
    const send = async (windowStart: string, windowEnd: string) => fetchJSON<unknown>('/api/teacher/attendance/sync', {
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroom_id: classroomId, window_start: windowStart, window_end: windowEnd }),
      },
      errorMessage: 'Attendance schedule delivery is temporarily unavailable',
    })
    if (selectionOnly) return isTeacherAttendanceScheduleAcknowledged(await send(date, date), policy)
    const regular = isTeacherAttendanceScheduleAcknowledged(await send(today, end), policy)
    if (date >= today && date <= end) return regular
    const selected = isTeacherAttendanceScheduleAcknowledged(await send(date, date), policy)
    return regular && selected
  }

  async function applySchedule() {
    if (saving) return
    const selected = schedules.find((schedule) => schedule.id === selectedId)
    if (!selected?.policy) { setError('Set up attendance timing before applying a schedule.'); return }
    const request = ++requestSequence.current
    const current = () => mounted.current && openRef.current && requestSequence.current === request
    setSaving(true)
    setError('')
    try {
      const result = selectedId === appliedId ? null : await fetchJSON<{ revision: number }>('/api/teacher/attendance/schedules', {
        init: { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classroom_id: classroomId, date, schedule_id: selectedId, expected_revision: revision }) },
        errorMessage: 'Could not select attendance schedule',
      })
      if (current() && result) { setRevision(result.revision); setAppliedId(selectedId) }
      let synced = false
      try { synced = await syncSchedule(selected.policy, true) } catch { /* Report the unconfirmed delivery below. */ }
      if (!current()) return
      invalidateTeacherAttendancePolicy(classroomId)
      if (!synced) {
        setError('Schedule saved, but delivery was not confirmed. Try again.')
        return
      }
      showMessage({ text: 'Attendance schedule applied', tone: 'success' })
      onSaved(schedules.find((schedule) => schedule.id === null)?.policy ?? selected.policy, true)
      onClose()
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : 'Could not select attendance schedule')
    } finally { if (current()) setSaving(false) }
  }

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
    if (saving || validationError || !editing || (editing !== 'new' && editing.id !== null && !name.trim()) || (editing === 'new' && !name.trim())) return
    const request = ++requestSequence.current
    const current = () => mounted.current && openRef.current && requestSequence.current === request
    setSaving(true)
    setError('')
    try {
      if (pendingDelivery) {
        let synced = false
        try { synced = await syncSchedule(pendingDelivery.policy) } catch { /* Keep the saved timing available for retry. */ }
        if (!current()) return
        if (!synced) { setError('Timing saved, but schedule delivery was not confirmed.'); return }
        if (pendingDelivery.regular) onSaved(pendingDelivery.policy, true)
        showMessage({ text: 'Attendance timing saved', tone: 'success' })
        await loadPolicy()
        return
      }
      const fields = {
        session_starts_local: sessionStartsLocal, session_ends_local: sessionEndsLocal,
        session_end_day_offset: sessionEndDayOffset, entry_opens_minutes_before: entryOpensMinutesBefore,
        present_grace_minutes: presentGraceMinutes, entry_closes_minutes_before_end: entryClosesMinutesBeforeEnd,
        absent_minutes_before_end: absentMinutesBeforeEnd, enabled,
      }
      if (editing !== 'new' && editing.id === null) {
        const response = await fetchJSON<unknown>('/api/teacher/attendance/policy', {
          init: { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classroom_id: classroomId, ...fields, expected_revision: revision }) },
          errorMessage: 'Attendance settings are temporarily unavailable',
        })
        const policy = parseTeacherAttendancePolicy(response, classroomId)
        if (!policy) throw new Error('Attendance settings are temporarily unavailable')
        invalidateTeacherAttendancePolicy(classroomId)
        if (current()) {
          setRevision(policy.revision)
          setSchedules((items) => items.map((item) => item.id === null ? { ...item, policy } : item))
          setPendingDelivery({ policy, regular: true })
        }
        let synced = false
        try { synced = await syncSchedule(policy) } catch { /* Preserve the saved timing and report delivery failure. */ }
        if (!current()) return
        onSaved(policy, synced)
        if (!synced) { setError('Timing saved, but schedule delivery was not confirmed.'); return }
      } else {
        const base = editing === 'new' ? schedules.find((item) => item.id === null)?.policy : editing.policy
        if (!base) throw new Error('Set up regular attendance timing first.')
        const policy = { ...base, sessionStartsLocal, sessionEndsLocal, sessionEndDayOffset, entryOpensMinutesBefore, presentGraceMinutes, entryClosesMinutesBeforeEnd, absentMinutesBeforeEnd, enabled }
        const result = await fetchJSON<{ id: string; revision: number }>('/api/teacher/attendance/schedules', {
          init: { method: editing === 'new' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classroom_id: classroomId, ...(editing === 'new' ? {} : { id: editing.id }), name: name.trim(), policy, expected_revision: revision }) },
          errorMessage: 'Could not save attendance schedule',
        })
        if (current()) {
          const saved = { id: result.id, name: name.trim(), policy }
          setRevision(result.revision)
          setSchedules((items) => [...items.filter((item) => item.id !== saved.id), saved])
          setEditing(saved)
          setPendingDelivery({ policy, regular: false })
        }
        let synced = false
        try { synced = await syncSchedule(policy) } catch { /* Report unconfirmed delivery. */ }
        if (!current()) return
        if (!synced) { setError('Timing saved, but schedule delivery was not confirmed.'); return }
      }
      if (!current()) return
      showMessage({ text: 'Attendance timing saved', tone: 'success' })
      await loadPolicy()
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : 'Attendance settings are temporarily unavailable')
    } finally { if (current()) setSaving(false) }
  }

  return (
    <ContentDialog
      isOpen={isOpen}
      onClose={() => { if (!saving) onClose() }}
      title={editing ? (editing === 'new' ? 'Add schedule' : `Edit ${editing.name}`) : 'Attendance schedules'}
      maxWidth="max-w-lg"
      showHeaderClose={!saving}
      showFooterClose={false}
    >
      {loading ? (
        <PageState kind="loading" title="Loading attendance hours" compact />
      ) : error && schedules.length === 0 ? (
        <PageState
          kind="error"
          title="Attendance hours unavailable"
          description={error}
          compact
          action={<Button type="button" onClick={() => void loadPolicy()}>Try again</Button>}
        />
      ) : !editing ? (
        <div className="space-y-4">
          <p className="text-sm text-text-muted">Choose the attendance schedule for {date ? format(parseISO(date), 'EEEE, MMMM d') : 'the selected date'}.</p>
          <fieldset className="space-y-2">
            <legend className="sr-only">Attendance schedule</legend>
            {schedules.map((schedule) => (
              <div key={schedule.id ?? 'regular'} className={`flex items-center gap-2 rounded-control border p-3 ${selectedId === schedule.id ? 'border-primary bg-surface' : 'border-border bg-surface-2'}`}>
                <label className="flex min-h-control flex-1 cursor-pointer items-center gap-3">
                  <input type="radio" name="attendance-schedule" checked={selectedId === schedule.id} disabled={saving} onChange={() => setSelectedId(schedule.id)} />
                  <span><span className="block text-sm font-medium text-text-default">{schedule.name}{schedule.id === null ? ' · Default' : ''}</span><span className="block text-sm text-text-muted">{schedule.policy ? formatTeacherAttendancePolicyHours(schedule.policy) : 'Set up timing'}</span></span>
                </label>
                <IconButton type="button" variant="ghost" label={`Edit ${schedule.name} settings`} icon={Settings2} disabled={saving} onClick={() => editSchedule(schedule)} />
              </div>
            ))}
          </fieldset>
          <Button type="button" variant="secondary" disabled={saving} onClick={() => editSchedule('new')}><Plus className="h-4 w-4" aria-hidden="true" /> Add schedule</Button>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
            <Button type="button" variant="primary" loading={saving} onClick={() => void applySchedule()}>Apply schedule</Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void savePolicy()
          }}
        >
          <fieldset disabled={Boolean(pendingDelivery)} className="space-y-4">
          {editing === 'new' || editing.id !== null ? (
            <FormField label="Schedule name" required><Input value={name} disabled={saving} onChange={(event) => setName(event.target.value)} /></FormField>
          ) : null}
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
                  className={NUMBER_INPUT_CLASS}
                  disabled={saving}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setEntryOpensMinutesBefore(readClampedMinutes(event.currentTarget, 120))}
                />
              </FormField>
              <FormField label="Grace period before late (min)">
                <Input
                  type="number"
                  min={0}
                  max={timingRuleMaximum}
                  value={presentGraceMinutes}
                  className={NUMBER_INPUT_CLASS}
                  disabled={saving}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setPresentGraceMinutes(readClampedMinutes(event.currentTarget, timingRuleMaximum))}
                />
              </FormField>
              <FormField label="QR closes before end (min)">
                <Input
                  type="number"
                  min={0}
                  max={timingRuleMaximum}
                  value={entryClosesMinutesBeforeEnd}
                  className={NUMBER_INPUT_CLASS}
                  disabled={saving}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setEntryClosesMinutesBeforeEnd(readClampedMinutes(event.currentTarget, timingRuleMaximum))}
                />
              </FormField>
              <FormField label="Absent before end (min)">
                <Input
                  type="number"
                  min={0}
                  max={timingRuleMaximum}
                  value={absentMinutesBeforeEnd}
                  className={NUMBER_INPUT_CLASS}
                  disabled={saving}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setAbsentMinutesBeforeEnd(readClampedMinutes(event.currentTarget, timingRuleMaximum))}
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

          {editing !== 'new' && editing.id === null ? <label className="flex min-h-control cursor-pointer items-center gap-3 rounded-control border border-border bg-surface-2 px-3 py-2 text-sm font-medium text-text-default">
            <TableSelectionCheckbox
              checked={enabled}
              disabled={saving}
              ariaLabel="Open and close QR attendance automatically"
              onChange={setEnabled}
            />
            <span>Open and close QR attendance automatically</span>
          </label> : null}

          <p className="text-xs text-text-muted">
            Timezone: America/Toronto. Changes apply to future sessions; a session keeps its rules
            once QR entry opens.
          </p>
          {timingValidationError ? (
            <p role="alert" className="text-sm text-danger">{timingValidationError}</p>
          ) : null}
          </fieldset>
          {error ? (
            <p role="alert" className="rounded-control border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={saving} onClick={() => { setEditing(null); setPendingDelivery(null); setError('') }}>Back</Button>
            <Button type="submit" variant="primary" loading={saving} disabled={Boolean(validationError) || ((editing === 'new' || editing.id !== null) && !name.trim())}>
              {pendingDelivery ? 'Retry delivery' : 'Save timing'}
            </Button>
          </div>
        </form>
      )}
    </ContentDialog>
  )
}
