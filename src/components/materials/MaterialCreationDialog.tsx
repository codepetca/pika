'use client'

import { useRef, useState } from 'react'
import { Eye, X } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { Button, ContentDialog, DialogPanel, FormField, Input, SegmentedControl, SplitButton } from '@/ui'
import { useMaterialMarkdownDraft } from '@/hooks/use-material-markdown-draft'
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
  const markdown = useMaterialMarkdownDraft(content, disabled)
  const markdownSourceRef = useRef<HTMLTextAreaElement>(null)
  const saveDisabled = disabled || markdown.dirty
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
        showCloseButton={false}
        tall
      >
        <div className="grid h-full min-h-0 w-full overflow-y-auto lg:grid-cols-3 lg:overflow-hidden">
          <section aria-label="Material details" className="flex flex-col gap-4 p-3 sm:p-4 lg:min-h-0 lg:overflow-y-auto">
            <FormField label="Title" required labelAccessory={
              <Button variant="ghost" size="sm" className="h-11 w-11 p-0" aria-label="Close material modal" title="Close" disabled={saving} onClick={onClose}>
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            }>
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
          <section aria-label="Material editor" className="flex min-h-96 flex-col gap-3 p-3 sm:p-4 lg:col-span-2 lg:min-h-0 lg:overflow-hidden">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
              <SegmentedControl
                ariaLabel="Material editor mode"
                value={markdown.mode}
                onChange={markdown.changeMode}
                options={[
                  { value: 'visual', label: 'Visual', disabled: saving || markdown.dirty },
                  { value: 'markdown', label: 'Markdown', disabled: saving },
                ]}
              />
              {markdown.dirty && <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" disabled={saving} onClick={() => { markdown.reset(); markdownSourceRef.current?.focus() }}>Discard Markdown</Button>
                <Button disabled={!markdown.canApply} onClick={() => { markdown.apply(onContentChange); markdownSourceRef.current?.focus() }}>Apply Markdown</Button>
              </div>}
            </div>
            {markdown.dirty && <p role="status" className="text-sm text-warning">Markdown edits not applied</p>}
            {markdown.applied && <p role="status" className="text-sm text-success">Markdown applied to editor. Save or post to update the material.</p>}
            {markdown.mode === 'markdown' && markdown.warnings.length > 0 && <div className="shrink-0 rounded-md border border-warning bg-warning-bg p-3 text-sm text-warning">
              <p>{markdown.warnings.join(' ')} Applying Markdown replaces the current rich content. Review the preview first.</p>
              {markdown.dirty && <label className="mt-2 flex min-h-control cursor-pointer items-center gap-2">
                <input type="checkbox" className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" checked={markdown.acknowledged} disabled={disabled} onChange={(event) => markdown.setAcknowledged(event.target.checked)} />
                Apply with simplified formatting
              </label>}
            </div>}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {markdown.mode === 'markdown' ? <FormField label="Material Markdown" className="flex h-full min-h-64 flex-col">
                <textarea
                  ref={markdownSourceRef}
                  value={markdown.markdown}
                  readOnly={disabled}
                  onChange={(event) => markdown.changeMarkdown(event.target.value)}
                  spellCheck={false}
                  className="min-h-64 w-full flex-1 rounded-control border border-border-strong bg-surface p-3 font-mono text-sm text-text-default focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </FormField> : (
              <ContentField label="Content" className="flex min-h-64 h-full flex-col">
                <RichTextEditor
                  content={content}
                  onChange={onContentChange}
                  editable={!disabled}
                  placeholder="Add links, notes, readings, or instructions…"
                  toolbarPreset="compact"
                  aria-label="Material content"
                  className="simple-editor-wrapper--fill-height min-h-0 flex-1 overflow-hidden rounded-lg border border-border-strong"
                />
              </ContentField>
              )}
            </div>
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
        {markdown.dirty ? <div className="grid gap-4 sm:grid-cols-2">
          <section aria-label="Current material content"><h3 className="mb-2 text-sm font-semibold">Current</h3><RichTextViewer content={content} /></section>
          <section aria-label="Proposed material content"><h3 className="mb-2 text-sm font-semibold">Proposed</h3><RichTextViewer content={markdown.previewContent} /></section>
        </div> : <RichTextViewer content={content} />}
      </ContentDialog>
    </>
  )
}
