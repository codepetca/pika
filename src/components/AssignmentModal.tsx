'use client'

import { useEffect, useRef, useState, useCallback, type FormEvent } from 'react'
import type { Assignment, ClassDay, TiptapContent } from '@/types'
import { AssignmentForm } from '@/components/AssignmentForm'
import { ConfirmDialog, DialogPanel } from '@/ui'
import { formatDateInToronto, getTodayInToronto, toTorontoEndOfDayIso, nowInToronto } from '@/lib/timezone'
import { format } from 'date-fns'
import { addDaysToDateString } from '@/lib/date-string'
import { useAssignmentDateValidation } from '@/hooks/useAssignmentDateValidation'

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
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false)
  const [releasing, setReleasing] = useState(false)

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
    setShowReleaseConfirm(false)
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
      lastSavedValuesRef.current = { title: nextTitle, instructions: nextInstructions, dueAt: nextDueAt }
      setSaveStatus('saved')
    } else {
      // Create mode: immediately create a draft
      setCurrentAssignment(null)
      setTitle('')
      setInstructions(EMPTY_INSTRUCTIONS)
      setDueAt(defaultDueAt)
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

  async function handleRelease() {
    const assignmentToRelease = currentAssignment
    if (!assignmentToRelease) return

    setError('')
    setReleasing(true)

    try {
      // Save any pending changes before releasing
      await flushPendingChanges()

      // Now release the assignment
      const response = await fetch(`/api/teacher/assignments/${assignmentToRelease.id}/release`, {
        method: 'POST',
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to post assignment')
      }

      onSuccess(data.assignment)
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to post assignment')
    } finally {
      setReleasing(false)
      setShowReleaseConfirm(false)
    }
  }

  // Determine if this is a draft (new or existing draft)
  const isDraft = !currentAssignment || currentAssignment.is_draft

  // Modal title
  const modalTitle = creating
    ? 'Creating Draft...'
    : !currentAssignment
      ? 'New Assignment'
      : currentAssignment.is_draft
        ? 'Edit Draft'
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
            extraAction={isDraft && !creating ? {
              label: releasing ? 'Posting...' : (
                <span className="inline-flex items-center gap-1.5">
                  Post
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                </span>
              ),
              onClick: () => setShowReleaseConfirm(true),
              variant: 'success',
            } : undefined}
          />
        </div>
      </DialogPanel>

      <ConfirmDialog
        isOpen={showReleaseConfirm}
        title="Post assignment to students?"
        description="Once posted, students will be able to see this assignment. This cannot be undone."
        confirmLabel={releasing ? 'Posting...' : 'Post'}
        cancelLabel="Cancel"
        isConfirmDisabled={releasing}
        isCancelDisabled={releasing}
        onCancel={() => setShowReleaseConfirm(false)}
        onConfirm={handleRelease}
      />
    </>
  )
}
