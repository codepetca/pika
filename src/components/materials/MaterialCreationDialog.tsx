'use client'

import { useState } from 'react'
import { Eye } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { Button, ContentDialog, DialogPanel, FormField, Input, SplitButton } from '@/ui'
import { CreationModalShell } from '@/components/creation/CreationModalShell'
import { ContentField, RichTextEditor, RichTextViewer } from '@/components/editor'
import { ScheduleDateTimePicker } from '@/components/ScheduleDateTimePicker'
import { combineScheduleDateTimeToIso, DEFAULT_SCHEDULE_TIME, getDefaultScheduleDateInSchedulingTimezone, getTodayInSchedulingTimezone, isScheduleIsoInFuture, parseScheduleIsoToParts } from '@/lib/scheduling'
import type { TiptapContent } from '@/types'

interface MaterialCreationDialogProps {
  materialKey?: string
  isOpen: boolean
  isExisting?: boolean
  isDraft?: boolean
  releasedAt?: string | null
  readOnly?: boolean
  saving?: boolean
  error?: string | null
  title: string
  content: TiptapContent
  onTitleChange: (title: string) => void
  onContentChange: (content: TiptapContent) => void
  onSave: (asDraft: boolean, scheduledFor?: string | null) => void
  onClose: () => void
  onDelete?: () => void
}

/** Material-owned presentation; callers retain persistence and permission checks. */
export function MaterialCreationDialog(props: MaterialCreationDialogProps) {
  return props.isOpen ? <MaterialEditor key={props.materialKey} {...props} /> : null
}

function MaterialEditor({
  isOpen, isExisting = false, isDraft = true, releasedAt, readOnly = false, saving = false,
  error, title, content, onTitleChange, onContentChange, onSave, onClose, onDelete,
}: MaterialCreationDialogProps) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const isScheduled = !isDraft && !!releasedAt && isScheduleIsoInFuture(releasedAt)
  const [action, setAction] = useState<'post' | 'draft' | 'schedule'>(isScheduled ? 'schedule' : 'post')
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const initialSchedule = releasedAt && isScheduled ? parseScheduleIsoToParts(releasedAt) : null
  const [scheduleDate, setScheduleDate] = useState(initialSchedule?.date ?? getDefaultScheduleDateInSchedulingTimezone())
  const [scheduleTime, setScheduleTime] = useState(initialSchedule?.time ?? DEFAULT_SCHEDULE_TIME)
  const scheduleIso = scheduleDate ? combineScheduleDateTimeToIso(scheduleDate, scheduleTime) : ''
  const validSchedule = !!scheduleIso && isScheduleIsoInFuture(scheduleIso)
  const disabled = saving || readOnly
  const saveDisabled = disabled
  const publishLabel = isScheduled ? 'Post now' : isDraft ? 'Post' : 'Save'
  const primaryLabel = action === 'draft' ? 'Save draft' : action === 'schedule' ? isScheduled ? 'Save schedule' : 'Schedule' : publishLabel

  function save() {
    if (saveDisabled) return
    if (action === 'schedule') { setScheduleOpen(true); return }
    if (action === 'draft') { onSave(true); return }
    if (isScheduled) onSave(false, null)
    else onSave(false)
  }

  return (
    <>
      <CreationModalShell
        isOpen={isOpen}
        onClose={onClose}
        title={isExisting ? 'Material' : 'New Material'}
        titleId="material-modal-title"
        closeLabel="Close material modal"
        closeDisabled={saving}
        maxWidth="!max-w-6xl"
        panelClassName="!p-0"
        contentClassName="!overflow-hidden !p-0"
        tall
      >
        <div className="grid h-full min-h-0 w-full overflow-y-auto lg:grid-cols-3 lg:overflow-hidden">
          <section aria-label="Material details" className="flex flex-col gap-4 p-3 sm:p-4 lg:min-h-0 lg:overflow-y-auto">
            <FormField label="Title" required>
              <Input value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Title" required disabled={disabled} data-modal-initial-focus={!disabled ? '' : undefined} />
            </FormField>
            <Button variant="secondary" size="sm" fullWidth disabled={saving} onClick={() => setPreviewOpen(true)}>
              <Eye className="h-4 w-4" aria-hidden="true" />Preview
            </Button>
            <p role="status" className="text-xs text-text-muted">{isScheduled && releasedAt
              ? `Scheduled for ${formatInTimeZone(releasedAt, 'America/Toronto', 'EEE MMM d, h:mm a')} (Toronto)`
              : isExisting ? isDraft ? 'Draft' : 'Posted' : 'Not posted'}</p>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="shrink-0 lg:mt-auto">
              <SplitButton
                label={saving ? 'Saving…' : primaryLabel}
                variant={action === 'post' && (isDraft || isScheduled) ? 'success' : 'primary'}
                size="md"
                className="w-full shadow-sm"
                disabled={saveDisabled}
                interactionActive={!previewOpen && !scheduleOpen}
                exitMotion="opacity"
                toggleAriaLabel="Choose material action"
                menuPlacement="up"
                primaryButtonProps={{ className: 'flex-1 justify-center font-semibold' }}
                onPrimaryClick={save}
                options={[
                  ...(action !== 'post' ? [{ id: 'post', label: publishLabel, onSelect: () => setAction('post') }] : []),
                  ...(action !== 'draft' ? [{ id: 'draft', label: 'Save draft', onSelect: () => setAction('draft') }] : []),
                  ...(action !== 'schedule' ? [{ id: 'schedule', label: isScheduled ? 'Edit schedule' : 'Schedule', onSelect: () => setAction('schedule') }] : []),
                  ...(onDelete && !readOnly ? [{ id: 'delete', label: 'Delete material', destructive: true, onSelect: onDelete }] : []),
                ]}
              />
            </div>
          </section>
          <section aria-label="Material editor" className="flex min-h-96 flex-col p-3 sm:p-4 lg:col-span-2 lg:min-h-0 lg:overflow-hidden">
            <ContentField label="Content" hideLabel collapseHiddenLabel className="flex min-h-0 flex-1 flex-col">
              <RichTextEditor
                content={content}
                onChange={onContentChange}
                editable={!disabled}
                interactionActive={!previewOpen && !scheduleOpen}
                placeholder="Add links, notes, readings, or instructions…"
                toolbarPreset="markdown-safe"
                aria-label="Material content"
                className="simple-editor-wrapper--fill-height min-h-0 flex-1 overflow-hidden rounded-lg border border-border-strong"
              />
            </ContentField>
          </section>
        </div>
      </CreationModalShell>
      <DialogPanel isOpen={isOpen && scheduleOpen && !disabled} onClose={() => setScheduleOpen(false)} maxWidth="max-w-sm" ariaLabelledBy="material-schedule-title">
        <h3 id="material-schedule-title" className="mb-2 text-sm font-semibold text-text-default">Schedule Release</h3>
        <ScheduleDateTimePicker
          date={scheduleDate} time={scheduleTime} minDate={getTodayInSchedulingTimezone()}
          isFutureValid={validSchedule} onDateChange={setScheduleDate} onTimeChange={setScheduleTime}
          onCancel={() => setScheduleOpen(false)}
          onConfirm={() => { if (!saveDisabled && validSchedule) { setScheduleOpen(false); onSave(false, scheduleIso) } }}
          confirmLabel={isScheduled ? 'Save schedule' : 'Schedule'}
          showHeader={false}
        />
      </DialogPanel>
      <ContentDialog isOpen={isOpen && previewOpen} onClose={() => setPreviewOpen(false)} title="Material preview" maxWidth="!max-w-2xl">
        <div className="mb-4">
          <p className="text-sm font-medium text-text-muted">Material</p>
          <h2 className="mt-1 text-2xl font-semibold text-text-default">{title.trim() || 'Untitled material'}</h2>
        </div>
        <RichTextViewer content={content} />
      </ContentDialog>
    </>
  )
}
