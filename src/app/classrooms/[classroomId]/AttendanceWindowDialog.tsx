'use client'

import { useCallback, useEffect, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { CircleHelp } from 'lucide-react'
import { fetchJSON } from '@/lib/request-cache'
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

interface AttendanceWindowPolicy {
  classroomId: string
  timezone: 'America/Toronto'
  opensLocal: string
  closesLocal: string
  closeDayOffset: 0 | 1
  enabled: boolean
  revision: number
  updatedAt: string
}

interface AttendanceWindowDialogProps {
  classroomId: string
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
}

function policyUrl(classroomId: string) {
  const params = new URLSearchParams({ classroom_id: classroomId })
  return `/api/teacher/attendance/policy?${params.toString()}`
}

const POLICY_KEYS = [
  'classroomId',
  'timezone',
  'opensLocal',
  'closesLocal',
  'closeDayOffset',
  'enabled',
  'revision',
  'updatedAt',
].sort()

const CLOSING_DAY_HELP = 'Use next day only for classes that continue past midnight.'
const AUTOMATIC_HOURS_HELP = 'Pika sends concrete Toronto-time windows for scheduled class days. Teachers can still override an active session.'

function isPolicy(value: unknown, expectedClassroomId: string): value is AttendanceWindowPolicy {
  if (!value || typeof value !== 'object') return false
  const policy = value as Record<string, unknown>
  return (
    Object.keys(policy).sort().every((key, index) => key === POLICY_KEYS[index]) &&
    Object.keys(policy).length === POLICY_KEYS.length &&
    policy.classroomId === expectedClassroomId &&
    policy.timezone === 'America/Toronto' &&
    typeof policy.opensLocal === 'string' &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(policy.opensLocal) &&
    typeof policy.closesLocal === 'string' &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(policy.closesLocal) &&
    (policy.closeDayOffset === 0 || policy.closeDayOffset === 1) &&
    typeof policy.enabled === 'boolean' &&
    Number.isSafeInteger(policy.revision) &&
    Number(policy.revision) > 0 &&
    typeof policy.updatedAt === 'string' &&
    Number.isFinite(Date.parse(policy.updatedAt))
  )
}

function parsePolicyResponse(value: unknown, expectedClassroomId: string): AttendanceWindowPolicy | null {
  if (!value || typeof value !== 'object' || !('policy' in value)) {
    throw new Error('Attendance settings are temporarily unavailable')
  }
  const policy = (value as { policy: unknown }).policy
  if (policy === null) return null
  if (!isPolicy(policy, expectedClassroomId)) {
    throw new Error('Attendance settings are temporarily unavailable')
  }
  return policy
}

export function AttendanceWindowDialog({
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
  const [opensLocal, setOpensLocal] = useState('')
  const [closesLocal, setClosesLocal] = useState('')
  const [closeDayOffset, setCloseDayOffset] = useState<0 | 1>(0)
  const [enabled, setEnabled] = useState(true)
  const [expandedHelp, setExpandedHelp] = useState<'closing-day' | 'automatic' | null>(null)

  const loadPolicy = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetchJSON<unknown>(policyUrl(classroomId), {
        errorMessage: 'Attendance settings are temporarily unavailable',
      })
      const policy = parsePolicyResponse(response, classroomId)
      setRevision(policy?.revision ?? null)
      setOpensLocal(policy?.opensLocal ?? '')
      setClosesLocal(policy?.closesLocal ?? '')
      setCloseDayOffset(policy?.closeDayOffset ?? 0)
      setEnabled(policy?.enabled ?? true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Attendance settings are temporarily unavailable')
    } finally {
      setLoading(false)
    }
  }, [classroomId])

  useEffect(() => {
    if (isOpen) {
      setExpandedHelp(null)
      void loadPolicy()
    }
  }, [isOpen, loadPolicy])

  const validationError = !opensLocal || !closesLocal
    ? 'Choose both opening and closing times.'
    : closeDayOffset === 0 && opensLocal >= closesLocal
      ? 'Closing time must be after opening time.'
      : ''

  async function savePolicy() {
    if (saving || validationError) return
    setSaving(true)
    setError('')
    try {
      const response = await fetchJSON<unknown>('/api/teacher/attendance/policy', {
        init: {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classroom_id: classroomId,
            opens_local: opensLocal,
            closes_local: closesLocal,
            close_day_offset: closeDayOffset,
            enabled,
            expected_revision: revision,
          }),
        },
        errorMessage: 'Attendance settings are temporarily unavailable',
      })
      const savedPolicy = parsePolicyResponse(response, classroomId)
      if (!savedPolicy) throw new Error('Attendance settings are temporarily unavailable')
      setRevision(savedPolicy.revision)

      const windowStart = getTodayInToronto()
      const windowEnd = format(addDays(parseISO(windowStart), 90), 'yyyy-MM-dd')
      let scheduleSynced = true
      try {
        await fetchJSON('/api/teacher/attendance/sync', {
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
      } catch {
        scheduleSynced = false
      }

      showMessage({
        text: scheduleSynced
          ? 'Attendance hours saved'
          : 'Hours saved; automatic schedule sync will retry',
        tone: scheduleSynced ? 'success' : 'warning',
      })
      onSaved()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Attendance settings are temporarily unavailable')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ContentDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Attendance hours"
      maxWidth="max-w-md"
      showHeaderClose={!saving}
      showFooterClose={false}
    >
      {loading ? (
        <PageState kind="loading" title="Loading attendance hours" compact />
      ) : error && !opensLocal && !closesLocal ? (
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
            <FormField label="Opens" required>
              <Input
                type="time"
                value={opensLocal}
                disabled={saving}
                onChange={(event) => setOpensLocal(event.target.value)}
              />
            </FormField>
            <FormField label="Closes" required>
              <Input
                type="time"
                value={closesLocal}
                disabled={saving}
                onChange={(event) => setClosesLocal(event.target.value)}
              />
            </FormField>
          </div>

          <div>
            <FormField
              label="Closing day"
              labelAccessory={
                <Tooltip content={CLOSING_DAY_HELP}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-label="About closing day"
                    aria-expanded={expandedHelp === 'closing-day'}
                    aria-controls="closing-day-help"
                    disabled={saving}
                    onClick={() => setExpandedHelp((current) => current === 'closing-day' ? null : 'closing-day')}
                  >
                    <CircleHelp className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </Tooltip>
              }
            >
              <Select
                value={String(closeDayOffset)}
                disabled={saving}
                options={[
                  { value: '0', label: 'Same class day' },
                  { value: '1', label: 'Next day' },
                ]}
                onChange={(event) => setCloseDayOffset(event.target.value === '1' ? 1 : 0)}
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
                  aria-controls="automatic-hours-help"
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

          <p className="text-xs text-text-muted">Timezone: America/Toronto</p>
          {validationError && (opensLocal || closesLocal) ? (
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
              Save hours
            </Button>
          </div>
        </form>
      )}
    </ContentDialog>
  )
}
