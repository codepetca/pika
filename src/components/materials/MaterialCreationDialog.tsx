'use client'

import { useEffect, useRef, useState } from 'react'
import { Eye } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { Button, ContentDialog, DialogPanel, FormField, Input, SaveStatus, SplitButton } from '@/ui'
import { CreationModalContextHeader, CreationModalShell } from '@/components/creation/CreationModalShell'
import { MarkdownAuthoringEditor, RichTextViewer } from '@/components/editor'
import { ScheduleDateTimePicker } from '@/components/ScheduleDateTimePicker'
import { combineScheduleDateTimeToIso, DEFAULT_SCHEDULE_TIME, getDefaultScheduleDateInSchedulingTimezone, getTodayInSchedulingTimezone, isScheduleIsoInFuture, parseScheduleIsoToParts } from '@/lib/scheduling'
import { createMaterialMarkdownContent, getMaterialMarkdownDraft, getMaterialVisualContent } from '@/lib/material-markdown'
import { tiptapToMarkdown } from '@/lib/limited-markdown'
import { uploadMarkdownImage } from '@/lib/markdown-image-upload'
import type { TiptapContent } from '@/types'
import { postDateInputSchema } from '@/lib/validations/post-date'

interface MaterialCreationDialogProps {
  classroomId?: string
  classroomName?: string
  materialKey?: string
  isOpen: boolean
  isExisting?: boolean
  isDraft?: boolean
  postedOn?: string | null
  releasedAt?: string | null
  createdAt?: string
  readOnly?: boolean
  saving?: boolean
  error?: string | null
  title: string
  content: TiptapContent
  onTitleChange: (title: string) => void
  onContentChange: (content: TiptapContent) => void
  onSave: (asDraft: boolean, scheduledFor?: string | null, postedOn?: string) => void
  onClose: () => void
  onDelete?: () => void
}

/** Material-owned presentation; callers retain persistence and permission checks. */
export function MaterialCreationDialog(props: MaterialCreationDialogProps) {
  return props.isOpen ? <MaterialEditor key={props.materialKey} {...props} /> : null
}

function MaterialEditor({
  isOpen, isExisting = false, isDraft = true, releasedAt, createdAt, postedOn, readOnly = false, saving = false,
  classroomId, classroomName, error, title, content, onTitleChange, onContentChange, onSave, onClose, onDelete,
}: MaterialCreationDialogProps) {
  const [mode, setMode] = useState<'visual' | 'markdown'>('visual')
  const [markdown, setMarkdown] = useState(() => getMaterialMarkdownDraft(content).markdown)
  const [conversionWarning, setConversionWarning] = useState<string | null>(null)
  const sourceDraft = getMaterialMarkdownDraft(content)
  const [visualContent, setVisualContent] = useState(() => getMaterialVisualContent(content))
  const emittedContent = useRef<TiptapContent | null>(null)
  useEffect(() => {
    setMarkdown(getMaterialMarkdownDraft(content).markdown)
    if (content !== emittedContent.current) setVisualContent(getMaterialVisualContent(content))
  }, [content])

  function changeMarkdown(next: string, fromVisual = false) {
    setMarkdown(next)
    const document = createMaterialMarkdownContent(next)
    emittedContent.current = document
    if (!fromVisual) setVisualContent(getMaterialVisualContent(document))
    onContentChange(document)
  }

  function changeLegacyContent(next: TiptapContent) {
    // Keep the live document (cursor, undo, and a just-typed space) local while
    // saving Markdown and derived compatibility nodes in the parent draft.
    setVisualContent(next)
    const converted = tiptapToMarkdown(next)
    setConversionWarning(converted.hasLossyConversion ? converted.warnings.join(' ') : null)
    changeMarkdown(converted.markdown, true)
  }

  const [previewOpen, setPreviewOpen] = useState(false)
  const isScheduled = !isDraft && !!releasedAt && isScheduleIsoInFuture(releasedAt)
  const originalPostTimestamp = releasedAt ?? createdAt
  const initialPostDate = postedOn ?? (!isDraft && originalPostTimestamp
    ? formatInTimeZone(originalPostTimestamp, 'America/Toronto', 'yyyy-MM-dd')
    : getTodayInSchedulingTimezone())
  const [postDate, setPostDate] = useState(initialPostDate)
  const validPostDate = postDateInputSchema.safeParse(postDate).success
  const changedPostDate = postDate !== initialPostDate ? postDate : undefined
  const [action, setAction] = useState<'post' | 'draft' | 'schedule' | 'preserve'>(isScheduled ? 'preserve' : 'post')
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const initialSchedule = releasedAt && isScheduled ? parseScheduleIsoToParts(releasedAt) : null
  const [scheduleDate, setScheduleDate] = useState(initialSchedule?.date ?? getDefaultScheduleDateInSchedulingTimezone())
  const [scheduleTime, setScheduleTime] = useState(initialSchedule?.time ?? DEFAULT_SCHEDULE_TIME)
  const scheduleIso = scheduleDate ? combineScheduleDateTimeToIso(scheduleDate, scheduleTime) : ''
  const validSchedule = !!scheduleIso && isScheduleIsoInFuture(scheduleIso)
  const disabled = saving || readOnly
  const saveDisabled = disabled || !validPostDate
  const publishLabel = isScheduled ? 'Post now' : isDraft ? 'Post' : 'Save'
  const primaryLabel = action === 'preserve' ? 'Save' : action === 'draft' ? 'Save draft' : action === 'schedule' ? isScheduled ? 'Save schedule' : 'Schedule' : publishLabel

  function save() {
    if (saveDisabled) return
    if (action === 'schedule') { setScheduleOpen(true); return }
    if (action === 'draft') {
      if (changedPostDate) onSave(true, undefined, changedPostDate)
      else onSave(true)
      return
    }
    if (action === 'post' && isScheduled) {
      if (changedPostDate) onSave(false, null, changedPostDate)
      else onSave(false, null)
    } else if (changedPostDate) onSave(false, undefined, changedPostDate)
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
        <div className="grid h-full min-h-0 w-full auto-rows-max grid-cols-1 overflow-y-auto lg:grid-cols-3 lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
          <CreationModalContextHeader itemType="Material" classroomName={classroomName} spacious />
          <section aria-label="Material details" className="flex min-w-0 flex-col gap-4 bg-surface-2 p-3 sm:p-4 lg:col-start-1 lg:row-start-2 lg:min-h-0 lg:overflow-y-auto">
            <FormField label="Title" required hideLabel collapseHiddenLabel className="modal-title-field">
              <Input value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Title" required disabled={disabled} data-modal-initial-focus={!disabled ? '' : undefined} />
            </FormField>
            <Button variant="secondary" size="sm" fullWidth disabled={saving} onClick={() => setPreviewOpen(true)}>
              <Eye className="h-4 w-4" aria-hidden="true" />Preview
            </Button>
            <p role="status" className="text-xs text-text-muted">{isScheduled && releasedAt
              ? `Scheduled for ${formatInTimeZone(releasedAt, 'America/Toronto', 'EEE MMM d, h:mm a')} (Toronto)`
              : isExisting ? isDraft ? 'Draft' : 'Posted' : 'Not posted'}</p>
            <FormField label="Calendar date (Toronto)" error={!validPostDate ? 'Choose a valid date.' : undefined}
              hint="Places this material on the calendar. Post makes it available now; Schedule delays release.">
              <Input type="date" value={postDate} min="0001-01-01"
                disabled={disabled} onChange={(event) => setPostDate(event.target.value)} />
            </FormField>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="shrink-0 lg:mt-auto">
              <SplitButton
                label={saving ? 'Saving…' : primaryLabel}
                variant={action === 'post' && (isDraft || isScheduled) ? 'success' : 'primary'}
                size="md"
                className="w-full shadow-sm"
                disabled={disabled}
                interactionActive={!previewOpen && !scheduleOpen}
                exitMotion="opacity"
                toggleAriaLabel="Choose material action"
                menuPlacement="up"
                primaryButtonProps={{ className: 'flex-1 justify-center font-semibold', disabled: saveDisabled }}
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
          <section aria-label="Material editor" className="flex min-h-96 min-w-0 flex-col p-3 sm:p-4 lg:col-span-2 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:min-h-0 lg:overflow-hidden">
            {(conversionWarning || (mode === 'markdown' && sourceDraft.hasLossyConversion)) && (
              <p role="status" className="mb-2 rounded-control bg-warning-bg px-3 py-2 text-sm text-warning">
                {conversionWarning || `Editing this Markdown simplifies existing rich formatting. ${sourceDraft.warnings.join(' ')}`}
              </p>
            )}
            <MarkdownAuthoringEditor
              label="Material content"
              mode={mode}
              onModeChange={setMode}
              markdown={markdown}
              onMarkdownChange={changeMarkdown}
              onConversionWarningChange={setConversionWarning}
              visualContent={visualContent}
              imageInline
              onVisualContentChange={changeLegacyContent}
              disabled={disabled}
              editable={!disabled}
              interactionActive={!previewOpen && !scheduleOpen}
              placeholder="Add links, notes, readings, or instructions…"
              fillHeight
              statusContent={<SaveStatus presentation="indicator" status={saving ? 'saving' : 'unsaved'} />}
              imageUpload={classroomId ? (file, signal) => uploadMarkdownImage(classroomId, file, signal) : undefined}
              className="rounded-control border border-border-strong"
            />
          </section>
        </div>
      </CreationModalShell>
      <DialogPanel isOpen={isOpen && scheduleOpen && !disabled} onClose={() => setScheduleOpen(false)} maxWidth="max-w-sm" ariaLabelledBy="material-schedule-title">
        <h3 id="material-schedule-title" className="mb-2 text-sm font-semibold text-text-default">Schedule Release</h3>
        <ScheduleDateTimePicker
          date={scheduleDate} time={scheduleTime} minDate={getTodayInSchedulingTimezone()}
          isFutureValid={validSchedule} onDateChange={setScheduleDate} onTimeChange={setScheduleTime}
          onCancel={() => setScheduleOpen(false)}
          onConfirm={() => { if (!saveDisabled && validSchedule) { setScheduleOpen(false); if (changedPostDate) onSave(false, scheduleIso, changedPostDate); else onSave(false, scheduleIso) } }}
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
