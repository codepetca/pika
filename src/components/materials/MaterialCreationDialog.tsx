'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Eye } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { Button, ContentDialog, DialogPanel, FormField, Input, SaveStatus, SplitButton, type SaveStatusState } from '@/ui'
import { AuthoringModeControl } from '@/components/creation/AuthoringModeControl'
import { CreationModalContextLabel, CreationModalShell } from '@/components/creation/CreationModalShell'
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
  recoveryVersion?: string
  isOpen: boolean
  isExisting?: boolean
  isDraft?: boolean
  postedOn?: string | null
  releasedAt?: string | null
  createdAt?: string
  readOnly?: boolean
  saving?: boolean
  error?: string | null
  notice?: string | null
  title: string
  content: TiptapContent
  onTitleChange: (title: string) => void
  onContentChange: (content: TiptapContent) => void
  onSave: (asDraft: boolean, scheduledFor?: string | null, postedOn?: string) => void
  onClose: () => void
  onDelete?: () => void
  autosave?: boolean
  saveStatus?: SaveStatusState
  onPostDateChange?: (date: string) => void
  onRetry?: () => void
  onDiscardSavedEdits?: () => void
}

/** Material-owned presentation; callers retain persistence and permission checks. */
export function MaterialCreationDialog(props: MaterialCreationDialogProps) {
  return props.isOpen ? <MaterialEditor key={props.materialKey} {...props} /> : null
}

function MaterialEditor({
  isOpen, isExisting = false, isDraft = true, releasedAt, createdAt, postedOn, readOnly = false, saving = false,
  classroomId, classroomName, materialKey, recoveryVersion, error, notice, title, content, onTitleChange, onContentChange, onSave, onClose, onDelete, autosave = false, saveStatus, onPostDateChange, onRetry, onDiscardSavedEdits,
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
    persistChange({ content: document })
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
  useEffect(() => { if (autosave && postedOn) setPostDate(postedOn) }, [autosave, postedOn])
  const validPostDate = postDateInputSchema.safeParse(postDate).success
  const [action, setAction] = useState<'post' | 'draft' | 'schedule' | 'preserve'>(isScheduled ? 'preserve' : 'post')
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const initialSchedule = releasedAt && isScheduled ? parseScheduleIsoToParts(releasedAt) : null
  const [scheduleDate, setScheduleDate] = useState(initialSchedule?.date ?? getDefaultScheduleDateInSchedulingTimezone())
  const [scheduleTime, setScheduleTime] = useState(initialSchedule?.time ?? DEFAULT_SCHEDULE_TIME)
  const scheduleIso = scheduleDate ? combineScheduleDateTimeToIso(scheduleDate, scheduleTime) : ''
  const validSchedule = !!scheduleIso && isScheduleIsoInFuture(scheduleIso)
  const recoveryKey = `pika:material-recovery:${materialKey}`
  const baseVersion = useRef(recoveryVersion).current
  const recoveryOwner = useRef(crypto.randomUUID()).current
  const baseline = useRef(JSON.stringify({ title, content, postDate: initialPostDate, action: isScheduled ? 'preserve' : 'post', scheduleDate: initialSchedule?.date ?? getDefaultScheduleDateInSchedulingTimezone(), scheduleTime: initialSchedule?.time ?? DEFAULT_SCHEDULE_TIME }))
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [recoveryProblem, setRecoveryProblem] = useState<string | null>(null)
  const [staleRecovery, setStaleRecovery] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const current = JSON.stringify({ title, content, postDate, action, scheduleDate, scheduleTime })
  const dirty = current !== baseline.current
  const currentRef = useRef(JSON.parse(current))
  currentRef.current = JSON.parse(current)

  function persistChange(patch: Record<string, unknown>) {
    const next = { ...currentRef.current, ...patch }
    currentRef.current = next
    if (!recoveryReady || readOnly || staleRecovery || !materialKey) return
    try {
      if (JSON.stringify(next) === baseline.current) sessionStorage.removeItem(recoveryKey)
      else sessionStorage.setItem(recoveryKey, JSON.stringify({ version: baseVersion, owner: recoveryOwner, ...next }))
    } catch {
      setRecoveryProblem('Local recovery is unavailable. Save your changes before closing.')
    }
  }

  useEffect(() => {
    if (readOnly || !materialKey) { setRecoveryReady(true); return }
    try {
      const raw = sessionStorage.getItem(recoveryKey)
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved.version !== baseVersion) {
          setStaleRecovery(true)
          setRecoveryProblem('A previous local edit was made against an older version. It was not restored to avoid overwriting newer changes.')
        } else if (typeof saved.title === 'string' && saved.content && typeof saved.postDate === 'string' && ['post', 'draft', 'schedule', 'preserve'].includes(saved.action) && typeof saved.scheduleDate === 'string' && typeof saved.scheduleTime === 'string') {
          onTitleChange(saved.title)
          onContentChange(saved.content)
          setPostDate(saved.postDate)
          setAction(saved.action)
          setScheduleDate(saved.scheduleDate)
          setScheduleTime(saved.scheduleTime)
        }
      }
    } catch {
      setRecoveryProblem('Local recovery is unavailable. Save your changes before closing.')
    }
    setRecoveryReady(true)
    // Restore once for this mounted material; the parent keys the editor by material.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    if (!recoveryReady || readOnly || staleRecovery || !materialKey) return
    try {
      if (dirty) sessionStorage.setItem(recoveryKey, JSON.stringify({ version: baseVersion, owner: recoveryOwner, ...JSON.parse(current) }))
      else sessionStorage.removeItem(recoveryKey)
    } catch {
      setRecoveryProblem('Local recovery is unavailable. Save your changes before closing.')
    }
  }, [current, dirty, readOnly, recoveryKey, recoveryReady, baseVersion, recoveryOwner, staleRecovery, materialKey])

  function discardRecovery() {
    try { sessionStorage.removeItem(recoveryKey) } catch { /* Storage may be unavailable. */ }
  }

  function requestClose() {
    if (autosave) onClose()
    else if (dirty && !readOnly) setCloseOpen(true)
    else onClose()
  }
  const disabled = saving || readOnly
  const saveDisabled = disabled || !validPostDate
  const publishLabel = isScheduled ? 'Post now' : isDraft ? 'Post' : autosave ? 'Apply changes' : 'Save'
  const primaryLabel = action === 'preserve' ? autosave ? 'Apply changes' : 'Save' : action === 'draft' ? 'Save draft' : action === 'schedule' ? isScheduled ? 'Save schedule' : 'Schedule' : publishLabel

  function save() {
    if (saveDisabled) return
    if (action === 'schedule') { setScheduleOpen(true); return }
    if (action === 'draft') { onSave(true, undefined, postDate); return }
    onSave(false, action === 'post' && isScheduled ? null : undefined, postDate)
  }

  return (
    <>
      <CreationModalShell
        isOpen={isOpen}
        onClose={requestClose}
        title={isExisting ? 'Material' : 'New Material'}
        titleId="material-modal-title"
        closeLabel="Close material modal"
        closeDisabled={saving}
        maxWidth="!max-w-6xl"
        panelClassName="!p-0"
        contentClassName="!overflow-hidden !p-0"
        tall
      >
        <div className="grid h-full min-h-0 w-full auto-rows-max grid-cols-1 overflow-y-auto lg:grid-cols-3 lg:grid-rows-1 lg:overflow-hidden">
          <section aria-label="Material details" className="flex min-w-0 flex-col gap-4 bg-surface-2 p-3 sm:p-4 lg:col-start-1 lg:row-start-1 lg:min-h-0 lg:overflow-y-auto">
            <CreationModalContextLabel itemType="Material" classroomName={classroomName} />
            <FormField label="Title" required hideLabel collapseHiddenLabel className="modal-title-field">
              <Input value={title} onChange={(event) => { persistChange({ title: event.target.value }); onTitleChange(event.target.value) }} placeholder="Title" required disabled={disabled} data-modal-initial-focus={!disabled ? '' : undefined} />
            </FormField>
            <AuthoringModeControl ariaLabel="Material content editing mode" value={mode === 'visual' ? 'write' : 'markdown'} onChange={(next) => setMode(next === 'write' ? 'visual' : 'markdown')} writeDisabled={disabled || previewOpen || scheduleOpen} markdownDisabled={disabled || previewOpen || scheduleOpen} />
            <Button variant="secondary" size="sm" fullWidth disabled={saving} onClick={() => setPreviewOpen(true)}>
              <Eye className="h-4 w-4" aria-hidden="true" />Preview
            </Button>
            <p role="status" className="text-xs text-text-muted">{isScheduled && releasedAt
              ? `Scheduled for ${formatInTimeZone(releasedAt, 'America/Toronto', 'EEE MMM d, h:mm a')} (Toronto)`
              : isExisting ? isDraft ? 'Draft' : 'Posted' : 'Not posted'}</p>
            <FormField label="Calendar date (Toronto)" error={!validPostDate ? 'Choose a valid date.' : undefined}>
              <Input type="date" value={postDate} min="0001-01-01"
                disabled={disabled} onChange={(event) => { persistChange({ postDate: event.target.value }); setPostDate(event.target.value); onPostDateChange?.(event.target.value) }} />
            </FormField>
            {recoveryProblem && <p role="status" className="text-sm text-warning">{recoveryProblem} {staleRecovery && <Button variant="secondary" size="sm" onClick={() => { discardRecovery(); setStaleRecovery(false); setRecoveryProblem(null) }}>Discard previous local edit</Button>}</p>}
            {notice && <p role="status" className="text-sm text-warning">{notice}</p>}
            {onDiscardSavedEdits && <div role="status" className="text-sm text-warning">The posted material changed since these edits were saved. You can review the saved edits or discard them to return to the current material. <Button variant="secondary" size="sm" disabled={saving} onClick={onDiscardSavedEdits}>Discard saved edits</Button></div>}
            {error && <div role="alert" className="text-sm text-danger">{error} {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>}</div>}
            <div className="shrink-0 lg:mt-auto">
              <SplitButton
                label={saving ? 'Saving…' : primaryLabel}
                variant="primary"
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
                  ...(autosave && isScheduled && action !== 'preserve' ? [{ id: 'preserve', label: 'Apply changes', onSelect: () => setAction('preserve') }] : []),
                  ...(action !== 'post' ? [{ id: 'post', label: publishLabel, onSelect: () => { persistChange({ action: 'post' }); setAction('post') } }] : []),
                  ...(!autosave && action !== 'draft' ? [{ id: 'draft', label: 'Save draft', onSelect: () => { persistChange({ action: 'draft' }); setAction('draft') } }] : []),
                  ...(action !== 'schedule' ? [{ id: 'schedule', label: isScheduled ? 'Edit schedule' : 'Schedule', onSelect: () => { persistChange({ action: 'schedule' }); setAction('schedule') } }] : []),
                  ...(onDelete && !readOnly ? [{ id: 'delete', label: 'Delete material', destructive: true, onSelect: onDelete }] : []),
                ]}
              />
            </div>
          </section>
          <section aria-label="Material editor" className="flex min-h-96 min-w-0 flex-col p-3 sm:p-4 lg:col-span-2 lg:col-start-2 lg:row-start-1 lg:min-h-0 lg:overflow-hidden">
            {(conversionWarning || (mode === 'markdown' && sourceDraft.hasLossyConversion)) && (
              <p role="status" className="mb-2 rounded-control bg-warning-bg px-3 py-2 text-sm text-warning">
                {conversionWarning || `Editing this Markdown simplifies existing rich formatting. ${sourceDraft.warnings.join(' ')}`}
              </p>
            )}
            <MarkdownAuthoringEditor
              label="Material content"
              mode={mode}
              showModeControl={false}
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
              statusContent={<SaveStatus presentation="indicator" status={saveStatus ?? (saving ? 'saving' : 'unsaved')} />}
              imageUpload={classroomId ? (file, signal) => uploadMarkdownImage(classroomId, file, signal) : undefined}
              className="rounded-control border border-border-strong"
            />
          </section>
        </div>
      </CreationModalShell>
      <ContentDialog isOpen={closeOpen} onClose={() => setCloseOpen(false)} title="Unsaved changes" maxWidth="!max-w-md" showFooterClose={false}>
        <p className="text-sm text-text-muted">Local changes are kept in this tab, including after a refresh. Save a draft to keep them beyond this tab.</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setCloseOpen(false)}>Keep editing</Button>
          <Button variant="secondary" disabled={!!recoveryProblem || !materialKey} onClick={onClose}>Close and keep local changes</Button>
          <Button variant="secondary" onClick={() => { discardRecovery(); onClose() }}>Discard changes</Button>
          <Button variant="primary" disabled={saving || !validPostDate} onClick={() => { setCloseOpen(false); onSave(isExisting ? isDraft : true, undefined, postDate) }}>{isExisting && !isDraft ? 'Save changes' : 'Save draft'}</Button>
        </div>
      </ContentDialog>
      <DialogPanel isOpen={isOpen && scheduleOpen && !disabled} onClose={() => setScheduleOpen(false)} maxWidth="max-w-sm" ariaLabelledBy="material-schedule-title">
        <h3 id="material-schedule-title" className="mb-2 text-sm font-semibold text-text-default">Schedule Release</h3>
        <ScheduleDateTimePicker
          date={scheduleDate} time={scheduleTime} minDate={getTodayInSchedulingTimezone()}
          isFutureValid={validSchedule} onDateChange={(value) => { persistChange({ scheduleDate: value }); setScheduleDate(value) }} onTimeChange={(value) => { persistChange({ scheduleTime: value }); setScheduleTime(value) }}
          onCancel={() => setScheduleOpen(false)}
          onConfirm={() => { if (!saveDisabled && validSchedule) { setScheduleOpen(false); onSave(false, scheduleIso, postDate) } }}
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
