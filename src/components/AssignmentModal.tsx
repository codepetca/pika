'use client'

import { useEffect, useRef, useState, useCallback, type FormEvent } from 'react'
import { X } from 'lucide-react'
import type { Assignment, ClassDay, TiptapContent } from '@/types'
import { AssignmentForm } from '@/components/AssignmentForm'
import { ConfirmDialog, DialogPanel, SplitButton } from '@/ui'
import { formatDateInToronto, getTodayInToronto, toTorontoEndOfDayIso, nowInToronto } from '@/lib/timezone'
import { format } from 'date-fns'
import { addDaysToDateString } from '@/lib/date-string'
import { useAssignmentDateValidation } from '@/hooks/useAssignmentDateValidation'
import { ScheduleDateTimePicker } from '@/components/ScheduleDateTimePicker'
import { DEFAULT_SCHEDULE_TIME, getTodayInSchedulingTimezone, isVisibleAtNow, parseScheduleIsoToParts } from '@/lib/scheduling'
import { useAssignmentScheduling, type CreateSubmitAction } from '@/hooks/useAssignmentScheduling'

const EMPTY_INSTRUCTIONS: TiptapContent = { type: 'doc', content: [] }
const AUTOSAVE_DEBOUNCE_MS = 3000
const AUTOSAVE_MIN_INTERVAL_MS = 10000
type AssignmentEditorValues = {
  title: string
  instructions: TiptapContent
  dueAt: string
}

function validateAssignmentValues(values: AssignmentEditorValues): string | null {
  void values
  return null
}

interface AssignmentModalProps {
  isOpen: boolean
  classroomId: string
  assignment?: Assignment | null // null/undefined for create mode
  classDays?: ClassDay[]
  onClose: () => void
  onSuccess: (assignment: Assignment, options?: { closeModal?: boolean }) => void
}

export function AssignmentModal({ isOpen, classroomId, assignment, classDays, onClose, onSuccess }: AssignmentModalProps) {
  const titleInputRef = useRef<HTMLInputElement>(null)
  const isInitializedRef = useRef(false)

  // The current assignment being edited (created on first save in create mode)
  const [currentAssignment, setCurrentAssignment] = useState<Assignment | null>(null)

  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState<TiptapContent>(EMPTY_INSTRUCTIONS)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)

  const defaultDueAt = addDaysToDateString(getTodayInToronto(), 1)
  const { dueAt, error, updateDueDate, setDueAt, setError } = useAssignmentDateValidation(defaultDueAt)

  // Autosave state
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const throttledSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSaveAtRef = useRef<number>(0)
  const lastSavedValuesRef = useRef<AssignmentEditorValues | null>(null)
  const pendingValuesRef = useRef<AssignmentEditorValues | null>(null)

  const isCreateMode = !assignment

  const scheduling = useAssignmentScheduling({
    currentAssignment,
    isCreateMode,
    creating,
    saving,
    flushPendingChanges,
    onAssignmentChange: setCurrentAssignment,
    onSuccess,
    onClose,
    onError: setError,
  })

  const {
    scheduleDate, setScheduleDate,
    scheduleTime, setScheduleTime,
    primaryAction, setPrimaryAction,
    showPostNowConfirm, setShowPostNowConfirm,
    showRevertToDraftConfirm, setShowRevertToDraftConfirm,
    showCreateScheduleModal, setShowCreateScheduleModal,
    releasing,
    isDraft, isScheduled, isLive,
    scheduleIso, isScheduleValid,
    effectivePrimaryAction, primaryLabel, splitOptions,
    resetForAssignment,
    formatReleaseDate,
    postAssignmentNow, scheduleAssignmentRelease,
    revertAssignmentToDraft, clearScheduledRelease,
    openScheduleModalWithSave, handleActionSelection, triggerPrimaryAction,
  } = scheduling

  function toDateTimeLocal(value: string | null | undefined): string {
    if (!value) return ''
    return new Date(value).toISOString().slice(0, 16)
  }

  useEffect(() => {
    if (!isOpen) return

    // Reset state when modal opens
    isInitializedRef.current = false
    setError('')
    resetForAssignment(assignment)

    if (assignment) {
      // Edit mode: populate from existing assignment
      const nextTitle = assignment.title
      const nextInstructions = assignment.rich_instructions ?? EMPTY_INSTRUCTIONS
      const nextDueAt = formatDateInToronto(new Date(assignment.due_at))

      setCurrentAssignment(assignment)
      setTitle(nextTitle)
      setInstructions(nextInstructions)
      setDueAt(nextDueAt)
      if (assignment.released_at && !isVisibleAtNow(assignment.released_at)) {
        const scheduled = parseScheduleIsoToParts(assignment.released_at)
        setScheduleDate(scheduled.date)
        setScheduleTime(scheduled.time)
        setPrimaryAction('schedule')
      } else {
        setScheduleDate(getTodayInSchedulingTimezone())
        setScheduleTime(DEFAULT_SCHEDULE_TIME)
        setPrimaryAction('post')
      }
      lastSavedValuesRef.current = {
        title: nextTitle,
        instructions: nextInstructions,
        dueAt: nextDueAt,
      }
      setSaveStatus('saved')
    } else {
      // Create mode: immediately create a draft
      setCurrentAssignment(null)
      setTitle('')
      setInstructions(EMPTY_INSTRUCTIONS)
      setDueAt(defaultDueAt)
      setScheduleDate(getTodayInSchedulingTimezone())
      setScheduleTime(DEFAULT_SCHEDULE_TIME)
      setPrimaryAction('post')
      lastSavedValuesRef.current = null
      setSaveStatus('saving')
      setCreating(true)
    }

    pendingValuesRef.current = null

    // Focus the title input when modal opens
    setTimeout(() => {
      titleInputRef.current?.focus()
      if (assignment) {
        titleInputRef.current?.select()
      }
    }, 100)

    // Mark as initialized after TipTap has had time to normalize content
    requestAnimationFrame(() => {
      isInitializedRef.current = true
    })

    // Cleanup timeouts on close/change
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
      if (throttledSaveTimeoutRef.current) {
        clearTimeout(throttledSaveTimeoutRef.current)
        throttledSaveTimeoutRef.current = null
      }
    }
  }, [assignment, isOpen, setDueAt, setError, defaultDueAt])

  // Get only the fields that changed compared to last saved values
  const getChangedFields = useCallback((values: AssignmentEditorValues) => {
    const saved = lastSavedValuesRef.current
    if (!saved) return null

    const changes: Record<string, unknown> = {}
    if (values.title !== saved.title) changes.title = values.title
    if (values.dueAt !== saved.dueAt) changes.due_at = toTorontoEndOfDayIso(values.dueAt)
    if (JSON.stringify(values.instructions) !== JSON.stringify(saved.instructions)) {
      changes.rich_instructions = values.instructions
    }

    return Object.keys(changes).length > 0 ? changes : null
  }, [])

  // Create a new assignment
  const createAssignment = useCallback(async (
    values: AssignmentEditorValues
  ): Promise<Assignment | null> => {
    try {
      const response = await fetch('/api/teacher/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroom_id: classroomId,
          title: values.title.trim() || `Untitled (${format(nowInToronto(), 'yyyy-MM-dd HH:mm:ss')})`,
          rich_instructions: values.instructions,
          due_at: toTorontoEndOfDayIso(values.dueAt),
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create assignment')
      }

      if (!data.assignment) {
        throw new Error('Invalid response: missing assignment data')
      }

      return data.assignment
    } catch (err: any) {
      setError(err.message || 'Failed to create assignment')
      return null
    }
  }, [classroomId, setError])

  // Automatically create draft when modal opens in create mode
  useEffect(() => {
    if (!creating) return

    const createDraft = async () => {
      const initialValues: AssignmentEditorValues = {
        title: '',
        instructions: EMPTY_INSTRUCTIONS,
        dueAt: defaultDueAt,
      }
      const newAssignment = await createAssignment(initialValues)
      setCreating(false)

      if (newAssignment) {
        setCurrentAssignment(newAssignment)
        setTitle(newAssignment.title)
        setInstructions(newAssignment.rich_instructions ?? EMPTY_INSTRUCTIONS)
        const assignmentDueAt = formatDateInToronto(new Date(newAssignment.due_at))
        setDueAt(assignmentDueAt)
        lastSavedValuesRef.current = {
          title: newAssignment.title,
          instructions: newAssignment.rich_instructions ?? EMPTY_INSTRUCTIONS,
          dueAt: assignmentDueAt,
        }
        setSaveStatus('saved')

        // Focus and select title after creation
        setTimeout(() => {
          titleInputRef.current?.focus()
          titleInputRef.current?.select()
        }, 100)
      } else {
        // Creation failed - close modal (error is already set by createAssignment)
        onClose()
      }
    }

    void createDraft()
  }, [creating, createAssignment, defaultDueAt, setDueAt, onClose])

  // Save changes to the server (create or update)
  const saveChanges = useCallback(async (
    values: AssignmentEditorValues,
    options?: { closeAfter?: boolean }
  ) => {
    const validationError = validateAssignmentValues(values)
    if (validationError) {
      setError(validationError)
      setSaveStatus('unsaved')
      return
    }

    setSaveStatus('saving')
    lastSaveAtRef.current = Date.now()

    try {
      let savedAssignment: Assignment | null = currentAssignment

      if (!currentAssignment) {
        // Create mode: create the assignment first
        savedAssignment = await createAssignment(values)
        if (!savedAssignment) {
          setSaveStatus('unsaved')
          return
        }
        setCurrentAssignment(savedAssignment)
        lastSavedValuesRef.current = { ...values }
      } else {
        // Edit mode: update existing assignment
        const changedFields = getChangedFields(values)
        if (!changedFields) {
          setSaveStatus('saved')
          if (options?.closeAfter) {
            onSuccess(currentAssignment)
            onClose()
          }
          return
        }

        const response = await fetch(`/api/teacher/assignments/${currentAssignment.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(changedFields),
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'Failed to update assignment')
        }

        if (!data.assignment) {
          throw new Error('Invalid response: missing assignment data')
        }

        savedAssignment = data.assignment
        setCurrentAssignment(savedAssignment)
        lastSavedValuesRef.current = { ...values }
      }

      pendingValuesRef.current = null
      setSaveStatus('saved')

      // Only notify parent and close when explicitly requested (manual save)
      // Autosaves should happen silently in the background
      if (options?.closeAfter) {
        onSuccess(savedAssignment!)
        onClose()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save assignment')
      setSaveStatus('unsaved')
    }
  }, [currentAssignment, createAssignment, getChangedFields, onClose, onSuccess, setError])

  // Schedule a debounced save with minimum interval throttling
  const scheduleSave = useCallback((
    values: AssignmentEditorValues,
    options?: { force?: boolean }
  ) => {
    pendingValuesRef.current = values

    if (throttledSaveTimeoutRef.current) {
      clearTimeout(throttledSaveTimeoutRef.current)
      throttledSaveTimeoutRef.current = null
    }

    const now = Date.now()
    const msSinceLastSave = now - lastSaveAtRef.current

    if (options?.force || msSinceLastSave >= AUTOSAVE_MIN_INTERVAL_MS) {
      void saveChanges(values)
      return
    }

    const waitMs = AUTOSAVE_MIN_INTERVAL_MS - msSinceLastSave
    throttledSaveTimeoutRef.current = setTimeout(() => {
      throttledSaveTimeoutRef.current = null
      const latest = pendingValuesRef.current
      if (latest) {
        void saveChanges(latest)
      }
    }, waitMs)
  }, [saveChanges])

  // Schedule autosave after a debounce period
  function scheduleAutosave(values: AssignmentEditorValues) {
    pendingValuesRef.current = values
    setSaveStatus('unsaved')

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      scheduleSave(values)
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  function handleTitleChange(newTitle: string) {
    setTitle(newTitle)
    scheduleAutosave({
      title: newTitle,
      instructions,
      dueAt,
    })
  }

  function handleInstructionsChange(newInstructions: TiptapContent) {
    if (!isInitializedRef.current) {
      setInstructions(newInstructions)
      if (lastSavedValuesRef.current) {
        lastSavedValuesRef.current.instructions = newInstructions
      }
      return
    }
    setInstructions(newInstructions)
    scheduleAutosave({
      title,
      instructions: newInstructions,
      dueAt,
    })
  }

  function handleDueAtChange(newDueAt: string) {
    updateDueDate(newDueAt)
    scheduleAutosave({
      title,
      instructions,
      dueAt: newDueAt,
    })
  }

  function handlePrevDate() {
    const today = getTodayInToronto()
    const base = dueAt || today
    const newDueAt = addDaysToDateString(base, -1)
    handleDueAtChange(newDueAt)
  }

  function handleNextDate() {
    const today = getTodayInToronto()
    const base = dueAt || today
    const newDueAt = addDaysToDateString(base, 1)
    handleDueAtChange(newDueAt)
  }

  function flushAutosave() {
    if (saveStatus === 'unsaved' && pendingValuesRef.current) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
      scheduleSave(pendingValuesRef.current, { force: true })
    }
  }

  // Helper to clear pending timeouts and save any unsaved changes
  async function flushPendingChanges(): Promise<void> {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    if (throttledSaveTimeoutRef.current) {
      clearTimeout(throttledSaveTimeoutRef.current)
      throttledSaveTimeoutRef.current = null
    }

    if ((saveStatus === 'unsaved' || pendingValuesRef.current) && currentAssignment) {
      const valuesToSave = pendingValuesRef.current ?? {
        title,
        instructions,
        dueAt,
      }
      const validationError = validateAssignmentValues(valuesToSave)
      if (validationError) {
        throw new Error(validationError)
      }
      const changedFields = getChangedFields(valuesToSave)

      if (changedFields) {
        const response = await fetch(`/api/teacher/assignments/${currentAssignment.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(changedFields),
        })
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to save changes')
        }
        lastSavedValuesRef.current = { ...valuesToSave }
      }
      pendingValuesRef.current = null
      setSaveStatus('saved')
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isCreateMode && currentAssignment) {
      await handleTriggerPrimaryAction()
      return
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    if (throttledSaveTimeoutRef.current) {
      clearTimeout(throttledSaveTimeoutRef.current)
      throttledSaveTimeoutRef.current = null
    }
    pendingValuesRef.current = null
    setSaving(true)
    await saveChanges({
      title,
      instructions,
      dueAt,
    }, { closeAfter: true })
    setSaving(false)
  }

  async function saveDraftAndClose() {
    if (saving || releasing) return
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    if (throttledSaveTimeoutRef.current) {
      clearTimeout(throttledSaveTimeoutRef.current)
      throttledSaveTimeoutRef.current = null
    }
    pendingValuesRef.current = null
    setSaving(true)
    await saveChanges({
      title,
      instructions,
      dueAt,
    }, { closeAfter: true })
    setSaving(false)
  }

  // Wrapper: hook handles post/schedule/revert; component handles 'draft' already-a-draft case
  async function handleTriggerPrimaryAction(action: CreateSubmitAction = primaryAction) {
    if (action === 'draft' && currentAssignment?.is_draft) {
      await saveDraftAndClose()
      return
    }
    await triggerPrimaryAction(action)
  }

  async function handleClose() {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    if (throttledSaveTimeoutRef.current) {
      clearTimeout(throttledSaveTimeoutRef.current)
      throttledSaveTimeoutRef.current = null
    }

    // If there are unsaved changes, save before closing
    if (saveStatus === 'unsaved' || pendingValuesRef.current) {
      const valuesToSave = pendingValuesRef.current ?? {
        title,
        instructions,
        dueAt,
      }
      await saveChanges(valuesToSave, { closeAfter: true })
    } else {
      if (currentAssignment) {
        onSuccess(currentAssignment)
      }
      onClose()
    }
  }

  // Modal title
  const modalTitle = creating
    ? 'Creating Draft...'
    : !currentAssignment
      ? 'New Assignment'
      : currentAssignment.is_draft
        ? 'Edit Draft'
        : isScheduled
          ? 'Edit Scheduled Assignment'
          : 'Edit Assignment'
  return (
    <>
      <DialogPanel
        isOpen={isOpen}
        onClose={handleClose}
        maxWidth="w-[min(90vw,56rem)]"
        className="p-6"
        ariaLabelledBy="assignment-modal-title"
      >
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <h2 id="assignment-modal-title" className="text-xl font-bold text-text-default">
            {modalTitle}
          </h2>
          <span
            className={`text-xs ${
              saveStatus === 'saved'
                ? 'text-success'
                : saveStatus === 'saving'
                  ? 'text-text-muted'
                  : 'text-warning'
            }`}
          >
            {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving...' : 'Unsaved'}
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <AssignmentForm
            title={title}
            instructions={instructions}
            dueAt={dueAt}
            classDays={classDays}
            onTitleChange={handleTitleChange}
            onInstructionsChange={handleInstructionsChange}
            onDueAtChange={handleDueAtChange}
            onPrevDate={handlePrevDate}
            onNextDate={handleNextDate}
            onSubmit={handleSubmit}
            submitLabel={saving ? 'Saving...' : saveStatus === 'saved' ? 'Done' : 'Save'}
            disabled={saving || releasing || creating}
            error={error}
            titleInputRef={titleInputRef}
            onBlur={flushAutosave}
            footerContent={
              currentAssignment
                ? (
                    <div className="flex items-center justify-end gap-2">
                      {isScheduled && currentAssignment.released_at && (
                        <div className="inline-flex items-stretch rounded-md border border-warning bg-warning-bg text-warning">
                          <button
                            type="button"
                            onClick={() => {
                              void openScheduleModalWithSave()
                            }}
                            disabled={creating || releasing || saving}
                            className="px-2.5 py-1.5 text-xs font-medium hover:bg-warning-bg disabled:cursor-not-allowed"
                          >
                            {`Scheduled for ${formatReleaseDate(currentAssignment.released_at)}`}
                          </button>
                          <button
                            type="button"
                            aria-label="Clear scheduled release"
                            onClick={() => {
                              void clearScheduledRelease()
                            }}
                            disabled={creating || releasing || saving}
                            className="border-l border-warning px-2 hover:bg-warning-bg disabled:cursor-not-allowed"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                      <SplitButton
                        label={primaryLabel}
                        onPrimaryClick={() => {
                          void handleTriggerPrimaryAction()
                        }}
                        variant={effectivePrimaryAction === 'post' ? 'success' : 'primary'}
                        size="md"
                        disabled={creating || releasing || saving || !currentAssignment}
                        className="shadow-sm"
                        toggleAriaLabel="Choose assignment action"
                        primaryButtonProps={{
                          className: 'w-[9rem] justify-center font-semibold',
                        }}
                        options={splitOptions}
                      />
                    </div>
                  )
                : undefined
            }
          />
        </div>
      </DialogPanel>

      <DialogPanel
        isOpen={showCreateScheduleModal}
        onClose={() => {
          if (releasing) return
          setShowCreateScheduleModal(false)
        }}
        maxWidth="max-w-sm"
        className="p-4"
        ariaLabelledBy="assignment-create-schedule-title"
      >
        <h3 id="assignment-create-schedule-title" className="text-sm font-semibold text-text-default mb-2">
          Schedule Release
        </h3>
        <ScheduleDateTimePicker
          date={scheduleDate}
          time={scheduleTime}
          minDate={getTodayInSchedulingTimezone()}
          isFutureValid={isScheduleValid}
          onDateChange={setScheduleDate}
          onTimeChange={setScheduleTime}
          onCancel={() => setShowCreateScheduleModal(false)}
          onConfirm={() => {
            void scheduleAssignmentRelease({ closeAfter: isScheduled })
          }}
          confirmLabel={releasing ? 'Scheduling...' : isScheduled ? 'Save schedule' : 'Schedule'}
          dateLabel="Date"
          timeLabel="Time"
          showHeader={false}
          showTimezoneLabel={false}
          className="border-0 bg-transparent p-0 shadow-none"
        />
      </DialogPanel>

      <ConfirmDialog
        isOpen={showPostNowConfirm}
        title="Post assignment to students?"
        description="Students will be able to access this assignment immediately. Once live, it cannot be reverted to draft."
        confirmLabel={releasing ? 'Posting...' : 'Post'}
        cancelLabel="Cancel"
        isConfirmDisabled={releasing}
        isCancelDisabled={releasing}
        onCancel={() => setShowPostNowConfirm(false)}
        onConfirm={postAssignmentNow}
      />

      <ConfirmDialog
        isOpen={showRevertToDraftConfirm}
        title="Revert to draft?"
        description="Students will no longer be able to see this assignment until you post or schedule it again."
        confirmLabel={releasing ? 'Reverting...' : 'Revert'}
        cancelLabel="Cancel"
        isConfirmDisabled={releasing}
        isCancelDisabled={releasing}
        onCancel={() => setShowRevertToDraftConfirm(false)}
        onConfirm={revertAssignmentToDraft}
      />
    </>
  )
}
