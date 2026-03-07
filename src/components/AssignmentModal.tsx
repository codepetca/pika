'use client'

import { useEffect, useRef, useState, useCallback, type FormEvent } from 'react'
import type { Assignment, ClassDay, TiptapContent } from '@/types'
import { AssignmentForm } from '@/components/AssignmentForm'
import { Button, ConfirmDialog, DialogPanel } from '@/ui'
import { formatDateInToronto, getTodayInToronto, toTorontoEndOfDayIso, nowInToronto } from '@/lib/timezone'
import { format } from 'date-fns'
import { addDaysToDateString } from '@/lib/date-string'
import { useAssignmentDateValidation } from '@/hooks/useAssignmentDateValidation'
import { ScheduleDateTimePicker } from '@/components/ScheduleDateTimePicker'
import {
  combineScheduleDateTimeToIso,
  DEFAULT_SCHEDULE_TIME,
  getTodayInSchedulingTimezone,
  isScheduleIsoInFuture,
  isVisibleAtNow,
  parseScheduleIsoToParts,
} from '@/lib/scheduling'

const EMPTY_INSTRUCTIONS: TiptapContent = { type: 'doc', content: [] }
const AUTOSAVE_DEBOUNCE_MS = 3000
const AUTOSAVE_MIN_INTERVAL_MS = 10000

interface AssignmentModalProps {
  isOpen: boolean
  classroomId: string
  assignment?: Assignment | null // null/undefined for create mode
  classDays?: ClassDay[]
  onClose: () => void
  onSuccess: (assignment: Assignment) => void
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
  const [showPostNowConfirm, setShowPostNowConfirm] = useState(false)
  const [showRevertToDraftConfirm, setShowRevertToDraftConfirm] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const [showSchedulePicker, setShowSchedulePicker] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState(DEFAULT_SCHEDULE_TIME)

  const defaultDueAt = addDaysToDateString(getTodayInToronto(), 1)
  const { dueAt, error, updateDueDate, setDueAt, setError } = useAssignmentDateValidation(defaultDueAt)

  // Autosave state
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const throttledSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSaveAtRef = useRef<number>(0)
  const lastSavedValuesRef = useRef<{ title: string; instructions: TiptapContent; dueAt: string } | null>(null)
  const pendingValuesRef = useRef<{ title: string; instructions: TiptapContent; dueAt: string } | null>(null)

  const isCreateMode = !assignment

  useEffect(() => {
    if (!isOpen) return

    // Reset state when modal opens
    isInitializedRef.current = false
    setShowPostNowConfirm(false)
    setShowRevertToDraftConfirm(false)
    setShowSchedulePicker(false)
    setReleasing(false)
    setError('')

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
      } else {
        setScheduleDate(getTodayInSchedulingTimezone())
        setScheduleTime(DEFAULT_SCHEDULE_TIME)
      }
      lastSavedValuesRef.current = { title: nextTitle, instructions: nextInstructions, dueAt: nextDueAt }
      setSaveStatus('saved')
    } else {
      // Create mode: immediately create a draft
      setCurrentAssignment(null)
      setTitle('')
      setInstructions(EMPTY_INSTRUCTIONS)
      setDueAt(defaultDueAt)
      setScheduleDate(getTodayInSchedulingTimezone())
      setScheduleTime(DEFAULT_SCHEDULE_TIME)
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
  function getChangedFields(values: { title: string; instructions: TiptapContent; dueAt: string }) {
    const saved = lastSavedValuesRef.current
    if (!saved) return null

    const changes: Record<string, unknown> = {}
    if (values.title !== saved.title) changes.title = values.title
    if (values.dueAt !== saved.dueAt) changes.due_at = toTorontoEndOfDayIso(values.dueAt)
    if (JSON.stringify(values.instructions) !== JSON.stringify(saved.instructions)) {
      changes.rich_instructions = values.instructions
    }

    return Object.keys(changes).length > 0 ? changes : null
  }

  // Create a new assignment
  const createAssignment = useCallback(async (
    values: { title: string; instructions: TiptapContent; dueAt: string }
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
      const initialValues = { title: '', instructions: EMPTY_INSTRUCTIONS, dueAt: defaultDueAt }
      const newAssignment = await createAssignment(initialValues)
      setCreating(false)

      if (newAssignment) {
        setCurrentAssignment(newAssignment)
        setTitle(newAssignment.title)
        setInstructions(newAssignment.rich_instructions ?? EMPTY_INSTRUCTIONS)
        const assignmentDueAt = formatDateInToronto(new Date(newAssignment.due_at))
        setDueAt(assignmentDueAt)
        lastSavedValuesRef.current = { title: newAssignment.title, instructions: newAssignment.rich_instructions ?? EMPTY_INSTRUCTIONS, dueAt: assignmentDueAt }
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
    values: { title: string; instructions: TiptapContent; dueAt: string },
    options?: { closeAfter?: boolean }
  ) => {
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
  }, [currentAssignment, createAssignment, onClose, onSuccess, setError])

  // Schedule a debounced save with minimum interval throttling
  const scheduleSave = useCallback((
    values: { title: string; instructions: TiptapContent; dueAt: string },
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
  function scheduleAutosave(values: { title: string; instructions: TiptapContent; dueAt: string }) {
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
    scheduleAutosave({ title: newTitle, instructions, dueAt })
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
    scheduleAutosave({ title, instructions: newInstructions, dueAt })
  }

  function handleDueAtChange(newDueAt: string) {
    updateDueDate(newDueAt)
    scheduleAutosave({ title, instructions, dueAt: newDueAt })
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
      const valuesToSave = pendingValuesRef.current ?? { title, instructions, dueAt }
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
    await saveChanges({ title, instructions, dueAt }, { closeAfter: true })
    setSaving(false)
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
      const valuesToSave = pendingValuesRef.current ?? { title, instructions, dueAt }
      await saveChanges(valuesToSave, { closeAfter: true })
    } else {
      if (currentAssignment) {
        onSuccess(currentAssignment)
      }
      onClose()
    }
  }

  async function postAssignmentNow() {
    if (releasing) return
    const assignmentToRelease = currentAssignment
    if (!assignmentToRelease) return

    setError('')
    setReleasing(true)

    try {
      await flushPendingChanges()

      const response = assignmentToRelease.is_draft
        ? await fetch(`/api/teacher/assignments/${assignmentToRelease.id}/release`, {
            method: 'POST',
          })
        : await fetch(`/api/teacher/assignments/${assignmentToRelease.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ released_at: null }),
          })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to post assignment')
      }

      const updated = data.assignment as Assignment
      setCurrentAssignment(updated)
      onSuccess(updated)
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to post assignment')
    } finally {
      setReleasing(false)
      setShowPostNowConfirm(false)
    }
  }

  async function scheduleAssignmentRelease() {
    if (releasing) return
    const assignmentToSchedule = currentAssignment
    if (!assignmentToSchedule || !scheduleDate) return

    const releaseIso = combineScheduleDateTimeToIso(scheduleDate, scheduleTime)
    if (!isScheduleIsoInFuture(releaseIso)) {
      setError('Release time must be in the future')
      return
    }

    setError('')
    setReleasing(true)
    try {
      await flushPendingChanges()

      const response = assignmentToSchedule.is_draft
        ? await fetch(`/api/teacher/assignments/${assignmentToSchedule.id}/release`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ release_at: releaseIso }),
          })
        : await fetch(`/api/teacher/assignments/${assignmentToSchedule.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ released_at: releaseIso }),
          })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to schedule assignment')
      }

      const updated = data.assignment as Assignment
      setCurrentAssignment(updated)
      onSuccess(updated)
      setShowSchedulePicker(false)
    } catch (err: any) {
      setError(err.message || 'Failed to schedule assignment')
    } finally {
      setReleasing(false)
    }
  }

  async function revertAssignmentToDraft() {
    if (releasing) return
    const assignmentToUpdate = currentAssignment
    if (!assignmentToUpdate || assignmentToUpdate.is_draft) return

    setError('')
    setReleasing(true)
    try {
      await flushPendingChanges()
      const response = await fetch(`/api/teacher/assignments/${assignmentToUpdate.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_draft: true, released_at: null }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to revert assignment to draft')
      }

      const updated = data.assignment as Assignment
      setCurrentAssignment(updated)
      onSuccess(updated)
      setShowSchedulePicker(false)
      setShowRevertToDraftConfirm(false)
    } catch (err: any) {
      setError(err.message || 'Failed to revert assignment to draft')
    } finally {
      setReleasing(false)
    }
  }

  function openSchedulePicker() {
    if (currentAssignment?.released_at && !isVisibleAtNow(currentAssignment.released_at)) {
      const parsed = parseScheduleIsoToParts(currentAssignment.released_at)
      setScheduleDate(parsed.date)
      setScheduleTime(parsed.time)
    } else {
      setScheduleDate(getTodayInSchedulingTimezone())
      setScheduleTime(DEFAULT_SCHEDULE_TIME)
    }
    setShowSchedulePicker((prev) => !prev)
  }

  // Determine if this is a draft (new or existing draft)
  const isDraft = !currentAssignment || currentAssignment.is_draft
  const isScheduled =
    !!currentAssignment &&
    !currentAssignment.is_draft &&
    !!currentAssignment.released_at &&
    !isVisibleAtNow(currentAssignment.released_at)
  const isLive = !!currentAssignment && !currentAssignment.is_draft && !isScheduled
  const scheduleIso = scheduleDate ? combineScheduleDateTimeToIso(scheduleDate, scheduleTime) : ''
  const isScheduleValid = scheduleIso ? isScheduleIsoInFuture(scheduleIso) : false

  function formatReleaseDate(iso: string): string {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/Toronto',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
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
          {currentAssignment && !creating && (
            <div className="mb-4 rounded-md border border-border bg-surface-2 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    Release
                  </p>
                  {isDraft ? (
                    <p className="text-sm text-text-default">Draft (not visible to students)</p>
                  ) : isScheduled ? (
                    <p className="text-sm text-text-default">
                      Scheduled for {formatReleaseDate(currentAssignment.released_at!)} (America/Toronto)
                    </p>
                  ) : (
                    <p className="text-sm text-text-default">
                      Live for students{currentAssignment.released_at ? ` since ${formatReleaseDate(currentAssignment.released_at)}` : ''}
                    </p>
                  )}
                </div>

                {!isLive && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="success"
                      onClick={() => setShowPostNowConfirm(true)}
                      disabled={releasing || saving}
                    >
                      {releasing ? 'Posting...' : 'Post now'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={openSchedulePicker}
                      disabled={releasing || saving}
                    >
                      {isScheduled ? 'Reschedule' : 'Schedule'}
                    </Button>
                    {isScheduled && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setShowRevertToDraftConfirm(true)}
                        disabled={releasing || saving}
                      >
                        Revert to draft
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {showSchedulePicker && (
                <div className="mt-3">
                  <ScheduleDateTimePicker
                    date={scheduleDate}
                    time={scheduleTime}
                    minDate={getTodayInSchedulingTimezone()}
                    isFutureValid={isScheduleValid}
                    onDateChange={setScheduleDate}
                    onTimeChange={setScheduleTime}
                    onCancel={() => setShowSchedulePicker(false)}
                    onConfirm={scheduleAssignmentRelease}
                    confirmLabel={releasing ? 'Saving...' : isScheduled ? 'Save schedule' : 'Schedule'}
                    title="Release Time (Toronto)"
                  />
                </div>
              )}
            </div>
          )}

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
          />
        </div>
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
