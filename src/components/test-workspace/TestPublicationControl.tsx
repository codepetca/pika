'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronDown } from 'lucide-react'
import { TeacherWorkSurfaceMenuButton } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import { useTestCalendarDate } from '@/hooks/useTestCalendarDate'
import { getTodayInToronto } from '@/lib/timezone'
import { testCalendarDateSchema } from '@/lib/validations/test-calendar-date'
import { Button, DialogPanel, FormField, Input } from '@/ui'
import type { TestAssessment } from '@/types'

interface Props {
  test: TestAssessment
  classroomId: string
  apiBasePath: string
  onPublish?: () => Promise<boolean | void> | void
  onSaved: (test: TestAssessment) => void
  onUnpublish?: () => void
  canUnpublish?: boolean
  allowFutureDate?: boolean
  disabled?: boolean
  fullWidth?: boolean
  menuPlacement?: 'up' | 'down'
  onFlushReady?: (flush: (() => Promise<boolean>) | null) => void
}

/** Test-specific composition shared by the workspace and authoring dialog. */
export function TestPublicationControl({ test, classroomId, apiBasePath, onPublish, onSaved, onUnpublish,
  canUnpublish = false, allowFutureDate = false, disabled = false, fullWidth = false, menuPlacement = 'down', onFlushReady }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [requestError, setRequestError] = useState('')
  const titleId = useId()
  const busyRef = useRef(false)
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const ownerRef = useRef(0)
  const draft = test.status === 'draft'
  const calendarDate = useTestCalendarDate({ test, classroomId, apiBasePath, onSaved })
  const { flush } = calendarDate
  const today = getTodayInToronto()
  const value = calendarDate.savedValue
  const label = value ? format(parseISO(value), value.slice(0, 4) === today.slice(0, 4) ? 'EEE MMM d' : 'EEE MMM d, yyyy') : 'Set test date'
  const error = calendarDate.error || requestError
  const unavailable = disabled || busy || calendarDate.saving
  const validDate = !!date && testCalendarDateSchema.safeParse(date).success
    && (!draft || date >= today) && (allowFutureDate || date <= today)

  useEffect(() => {
    ownerRef.current += 1
    setPickerOpen(false)
    setRequestError('')
    setBusy(false)
    busyRef.current = false
    return () => { ownerRef.current += 1 }
  }, [apiBasePath, classroomId, test.id])

  useEffect(() => {
    onFlushReady?.(flush)
    return () => onFlushReady?.(null)
  }, [flush, onFlushReady])

  function openPicker() {
    setDate(calendarDate.value || today)
    setRequestError('')
    setPickerOpen(true)
  }

  async function saveDate(next: string) {
    if (unavailable || busyRef.current) return
    const owner = ownerRef.current
    busyRef.current = true
    setBusy(true)
    setRequestError('')
    try {
      if (!await calendarDate.save(next) || ownerRef.current !== owner || disabledRef.current) return
      if (draft && onPublish && await onPublish() === false) return
      if (ownerRef.current === owner) setPickerOpen(false)
    } catch (cause) {
      if (ownerRef.current === owner) setRequestError(cause instanceof Error ? cause.message : 'Could not update test publication')
    } finally {
      if (ownerRef.current === owner) { busyRef.current = false; setBusy(false) }
    }
  }

  return (
    <div className={fullWidth ? 'grid w-full' : 'min-w-0'}>
      <TeacherWorkSurfaceMenuButton
        label={<span className="inline-flex min-w-0 items-center gap-1"><span className="truncate">{draft ? busy ? 'Preparing...' : 'Publish' : label}</span><ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" /></span>}
        variant={draft ? 'primary' : 'subtle'}
        disabled={unavailable || (draft && !onPublish)}
        className={fullWidth ? 'w-full' : undefined}
        buttonProps={{ 'aria-label': draft ? 'Publish' : `Test date: ${label}` }}
        menuAriaLabel={draft ? 'Publish test' : 'Test publication'}
        menuPlacement={menuPlacement}
        menuAlign="end"
        items={draft ? [
          { id: 'publish-today', label: 'Publish today', onSelect: () => { void saveDate(getTodayInToronto()) } },
          { id: 'schedule-test', label: 'Schedule test', onSelect: openPicker },
        ] : [
          { id: 'change-date', label: 'Change date', onSelect: openPicker },
          ...(onUnpublish ? [{ id: 'unpublish-test', label: 'Unpublish', onSelect: onUnpublish, disabled: !canUnpublish }] : []),
        ]}
      />
      {error && !pickerOpen ? <p role="alert" className="mt-1 text-sm text-danger">{error}</p> : null}
      <DialogPanel isOpen={pickerOpen} onClose={() => { if (!busy) setPickerOpen(false) }} ariaLabelledBy={titleId} maxWidth="max-w-sm">
        <div className="space-y-4">
          <h2 id={titleId} className="text-lg font-semibold text-text-default">{draft ? 'Schedule test' : 'Change test date'}</h2>
          <p className="text-sm text-text-muted">{draft
            ? 'Students will see this test on Calendar now and in Tests on this date. Access stays closed until you open it.'
            : 'Dates use America/Toronto. Student access is controlled separately.'}</p>
          <FormField label="Test date" error={error || undefined} hint={!draft && !allowFutureDate ? 'Tests with student activity can only move to today or an earlier date.' : undefined}>
            <Input type="date" value={date} min={draft ? today : undefined} max={!allowFutureDate ? today : undefined} disabled={busy} onChange={(event) => setDate(event.currentTarget.value)} />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setPickerOpen(false)}>Cancel</Button>
            <Button loading={busy} disabled={!validDate || disabled} onClick={() => { void saveDate(date) }}>{draft ? 'Schedule' : 'Save date'}</Button>
          </div>
        </div>
      </DialogPanel>
    </div>
  )
}
