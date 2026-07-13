'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ClassworkContentModalShell,
  ClassworkModalSaveStatus,
  ClassworkModalSplitAction,
  ClassworkModalTopLine,
} from '@/components/classwork/ClassworkContentModal'
import { RichTextEditor } from '@/components/editor'
import { ScheduleDateTimePicker } from '@/components/ScheduleDateTimePicker'
import { useAutosaveQueue } from '@/hooks/useAutosaveQueue'
import {
  DEFAULT_SCHEDULE_TIME,
  combineScheduleDateTimeToIso,
  getTodayInSchedulingTimezone,
  isScheduleIsoInFuture,
  parseScheduleIsoToParts,
} from '@/lib/scheduling'
import {
  GENERATED_MATERIAL_TITLE,
  getDisplayedMaterialTitle,
  isGeneratedMaterialTitle,
} from '@/lib/materials'
import { DialogPanel, FormField, useAppMessage } from '@/ui'
import type { Classroom, ClassworkMaterial, TiptapContent } from '@/types'

type MaterialEditorValues = {
  title: string
  content: TiptapContent
}

type TeacherMaterialModalProps = {
  classroom: Classroom
  material: ClassworkMaterial | null
  isOpen: boolean
  onClose: () => void
  onSaved: (material: ClassworkMaterial) => void
}

const EMPTY_DOC: TiptapContent = { type: 'doc', content: [] }
function areMaterialEditorValuesEqual(left: MaterialEditorValues, right: MaterialEditorValues): boolean {
  return left.title === right.title && JSON.stringify(left.content) === JSON.stringify(right.content)
}

export function TeacherMaterialModal({
  classroom,
  material,
  isOpen,
  onClose,
  onSaved,
}: TeacherMaterialModalProps) {
  const [currentMaterial, setCurrentMaterial] = useState<ClassworkMaterial | null>(material)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState<TiptapContent>(EMPTY_DOC)
  const [saving, setSaving] = useState(false)
  const [creatingDraft, setCreatingDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState(DEFAULT_SCHEDULE_TIME)
  const initializedMaterialKeyRef = useRef<string | null>(null)
  const { showMessage } = useAppMessage()
  const isReadOnly = !!classroom.archived_at
  const isDraft = currentMaterial?.is_draft ?? true
  const isScheduled = !!currentMaterial?.released_at && isScheduleIsoInFuture(currentMaterial.released_at)

  const buildMaterialValues = useCallback((overrides?: Partial<MaterialEditorValues>): MaterialEditorValues => ({
    title,
    content,
    ...overrides,
  }), [content, title])

  const saveMaterialDraft = useCallback(async (values: MaterialEditorValues) => {
    if (!currentMaterial) return values

    const cleanTitle = values.title.trim()
    if (!cleanTitle && !isGeneratedMaterialTitle(currentMaterial.title)) {
      throw new Error('Title is required')
    }

    const update: Record<string, unknown> = {}
    if (cleanTitle && cleanTitle !== currentMaterial.title) update.title = cleanTitle
    if (JSON.stringify(values.content) !== JSON.stringify(currentMaterial.content)) update.content = values.content
    if (Object.keys(update).length === 0) return values

    const response = await fetch(`/api/teacher/classrooms/${classroom.id}/materials/${currentMaterial.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Failed to save material')

    const updatedMaterial = data.material as ClassworkMaterial
    setCurrentMaterial(updatedMaterial)
    onSaved(updatedMaterial)
    return {
      title: getDisplayedMaterialTitle(updatedMaterial),
      content: updatedMaterial.content,
    }
  }, [classroom.id, currentMaterial, onSaved])

  const {
    status: autosaveStatus,
    reset: resetAutosave,
    schedule: scheduleAutosave,
    flush: flushAutosave,
  } = useAutosaveQueue<MaterialEditorValues>({
    disabled: saving || creatingDraft || isReadOnly || !currentMaterial,
    isEqual: areMaterialEditorValuesEqual,
    onSave: saveMaterialDraft,
    onError: setError,
  })

  useEffect(() => {
    if (!isOpen) {
      initializedMaterialKeyRef.current = null
      return
    }

    const initializationKey = material?.id ?? 'new-material'
    if (initializedMaterialKeyRef.current === initializationKey) return
    initializedMaterialKeyRef.current = initializationKey

    setCurrentMaterial(material)
    setTitle(getDisplayedMaterialTitle(material))
    setContent(material?.content || EMPTY_DOC)
    setError(null)
    setShowScheduleModal(false)
    setCreatingDraft(!material && !isReadOnly)
    resetAutosave(material ? {
      title: getDisplayedMaterialTitle(material),
      content: material.content,
    } : null)
    if (material?.released_at && isScheduleIsoInFuture(material.released_at)) {
      const scheduled = parseScheduleIsoToParts(material.released_at)
      setScheduleDate(scheduled.date)
      setScheduleTime(scheduled.time)
    } else {
      setScheduleDate(getTodayInSchedulingTimezone())
      setScheduleTime(DEFAULT_SCHEDULE_TIME)
    }
  }, [isOpen, isReadOnly, material, resetAutosave])

  useEffect(() => {
    if (!creatingDraft || currentMaterial || isReadOnly || !isOpen) return

    async function createMaterialDraft() {
      setError(null)
      try {
        const response = await fetch(`/api/teacher/classrooms/${classroom.id}/materials`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: GENERATED_MATERIAL_TITLE,
            content: EMPTY_DOC,
            is_draft: true,
            released_at: null,
          }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'Failed to create material')

        const draft = data.material as ClassworkMaterial
        setCurrentMaterial(draft)
        setTitle(getDisplayedMaterialTitle(draft))
        setContent(draft.content)
        resetAutosave({ title: getDisplayedMaterialTitle(draft), content: draft.content })
        onSaved(draft)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create material')
        onClose()
      } finally {
        setCreatingDraft(false)
      }
    }

    void createMaterialDraft()
  }, [classroom.id, creatingDraft, currentMaterial, isOpen, isReadOnly, onClose, onSaved, resetAutosave])

  function updateTitle(nextTitle: string) {
    setTitle(nextTitle)
    if (nextTitle.trim() && error === 'Title is required') setError(null)
    scheduleAutosave(buildMaterialValues({ title: nextTitle }))
  }

  function updateContent(nextContent: TiptapContent) {
    setContent(nextContent)
    scheduleAutosave(buildMaterialValues({ content: nextContent }))
  }

  async function publishMaterial(releaseAt?: string | null) {
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError('Title is required')
      return
    }
    if (!currentMaterial || !(await flushAutosave())) return

    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/teacher/classrooms/${classroom.id}/materials/${currentMaterial.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: cleanTitle,
          content,
          is_draft: false,
          released_at: releaseAt ?? undefined,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to save material')

      const updatedMaterial = data.material as ClassworkMaterial
      setCurrentMaterial(updatedMaterial)
      onSaved(updatedMaterial)
      resetAutosave({ title: getDisplayedMaterialTitle(updatedMaterial), content: updatedMaterial.content })
      showMessage({
        text: releaseAt && isScheduleIsoInFuture(releaseAt) ? 'Material scheduled.' : 'Material posted.',
        tone: 'success',
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save material')
    } finally {
      setSaving(false)
    }
  }

  async function handleClose() {
    if (saving || creatingDraft) return
    if (await flushAutosave()) onClose()
  }

  function openScheduleModal() {
    if (currentMaterial?.released_at && isScheduleIsoInFuture(currentMaterial.released_at)) {
      const scheduled = parseScheduleIsoToParts(currentMaterial.released_at)
      setScheduleDate(scheduled.date)
      setScheduleTime(scheduled.time)
    } else {
      setScheduleDate(getTodayInSchedulingTimezone())
      setScheduleTime(DEFAULT_SCHEDULE_TIME)
    }
    setShowScheduleModal(true)
  }

  const busy = saving || creatingDraft || autosaveStatus === 'saving'
  const modalTitle = creatingDraft
    ? 'Creating Draft...'
    : currentMaterial?.is_draft
      ? 'Edit Draft'
      : isScheduled
        ? 'Edit Scheduled Material'
        : 'Material'
  const primaryLabel = saving
    ? isScheduled ? 'Saving...' : 'Posting...'
    : isScheduled ? 'Save schedule' : 'Post Material'

  return (
    <>
      <ClassworkContentModalShell
        isOpen={isOpen}
        onClose={() => { void handleClose() }}
        title={modalTitle}
        titleId="material-modal-title"
        closeLabel="Close material modal"
        closeDisabled={saving || creatingDraft}
        maxWidth="!max-w-4xl"
      >
        <div className="space-y-4">
          <ClassworkModalTopLine
            title={title}
            titlePlaceholder="Reading, link, handout..."
            titleDisabled={saving || creatingDraft || isReadOnly}
            titleStatus={<ClassworkModalSaveStatus status={autosaveStatus} />}
            onTitleChange={updateTitle}
            onTitleBlur={() => { void flushAutosave() }}
            primaryActions={(isDraft || isScheduled) ? (
              <ClassworkModalSplitAction
                label={primaryLabel}
                intent={isScheduled ? 'primary' : 'publish'}
                onPrimaryClick={() => {
                  void publishMaterial(isScheduled
                    ? combineScheduleDateTimeToIso(scheduleDate, scheduleTime)
                    : undefined)
                }}
                disabled={busy || isReadOnly || !currentMaterial}
                toggleAriaLabel="Choose material action"
                options={isScheduled ? [
                  { id: 'schedule', label: 'Schedule...', onSelect: openScheduleModal, disabled: busy || isReadOnly },
                  { id: 'post-now', label: 'Post now', onSelect: () => { void publishMaterial(new Date().toISOString()) }, disabled: busy || isReadOnly },
                ] : [
                  { id: 'schedule', label: 'Schedule...', onSelect: openScheduleModal, disabled: busy || isReadOnly },
                ]}
                primaryButtonProps={{ className: 'min-w-[7.5rem]' }}
              />
            ) : null}
          />

          <FormField label="Content">
            <RichTextEditor
              content={content}
              onChange={updateContent}
              editable={!saving && !creatingDraft && !isReadOnly}
              placeholder="Add links, notes, readings, or instructions..."
            />
          </FormField>

          {error && (
            <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
        </div>
      </ClassworkContentModalShell>

      <DialogPanel
        isOpen={showScheduleModal}
        onClose={() => { if (!saving) setShowScheduleModal(false) }}
        maxWidth="max-w-sm"
        className="p-4"
        ariaLabelledBy="material-schedule-title"
      >
        <h3 id="material-schedule-title" className="mb-2 text-sm font-semibold text-text-default">
          Schedule Material
        </h3>
        <ScheduleDateTimePicker
          date={scheduleDate}
          time={scheduleTime}
          minDate={getTodayInSchedulingTimezone()}
          isFutureValid={!!scheduleDate && isScheduleIsoInFuture(combineScheduleDateTimeToIso(scheduleDate, scheduleTime))}
          onDateChange={setScheduleDate}
          onTimeChange={setScheduleTime}
          onCancel={() => setShowScheduleModal(false)}
          onConfirm={() => { void publishMaterial(combineScheduleDateTimeToIso(scheduleDate, scheduleTime)) }}
          confirmLabel={saving ? 'Scheduling...' : isScheduled ? 'Save schedule' : 'Schedule'}
          dateLabel="Release date"
          timeLabel="Release time"
          showHeader={false}
          showTimezoneLabel={false}
          className="border-0 bg-transparent p-0 shadow-none"
        />
      </DialogPanel>
    </>
  )
}
