'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { Assignment, ClassDay } from '@/types'
import { AssignmentForm } from '@/components/AssignmentForm'
import { AssignmentSubmissionRequirementsEditor } from '@/components/AssignmentSubmissionRequirementsEditor'
import { CreationModalShell } from '@/components/creation/CreationModalShell'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import type { AssignmentSubmissionRequirementDraft } from '@/lib/assignment-submission-requirements'
import { getRelativeDueDate } from '@/lib/assignment-relative-date'
import { ConfirmDialog, ContentDialog, DialogPanel, SplitButton } from '@/ui'
import { formatDateInToronto, getTodayInToronto, toTorontoEndOfDayIso, nowInToronto } from '@/lib/timezone'
import { format, isValid, parse } from 'date-fns'
import { addDaysToDateString } from '@/lib/date-string'
import { useAssignmentDateValidation } from '@/hooks/useAssignmentDateValidation'
import { ScheduleDateTimePicker } from '@/components/ScheduleDateTimePicker'
import { DEFAULT_SCHEDULE_TIME, getDefaultScheduleDateInSchedulingTimezone, getTodayInSchedulingTimezone, parseScheduleIsoToParts } from '@/lib/scheduling'
import { useAssignmentScheduling, type CreateSubmitAction } from '@/hooks/useAssignmentScheduling'
import { getFutureScheduledReleaseDueDateError } from '@/lib/assignment-schedule-validation'
import { isAssignmentScheduledForFuture } from '@/lib/assignments'

const AUTOSAVE_DEBOUNCE_MS = 3000
const AUTOSAVE_MIN_INTERVAL_MS = 10000
type AssignmentEditorValues = {
  title: string
  instructionsMarkdown: string
  dueAt: string
  submissionRequirements: AssignmentSubmissionRequirementDraft[]
}

function getDisplayedAssignmentTitle(title: string): string {
  return /^Untitled(?:\b|\s*\()/.test(title)
    ? ''
    : title
}

function getAssignmentRequirementDrafts(assignment: Assignment | null | undefined): AssignmentSubmissionRequirementDraft[] {
  return (assignment?.submission_requirements || []).map((requirement) => ({
    id: requirement.id,
    type: requirement.type,
    label: requirement.label,
    instructions: requirement.instructions,
    required: requirement.required,
    position: requirement.position,
    validation_policy_json: requirement.validation_policy_json,
  }))
}

function serializeRequirementDrafts(requirements: AssignmentSubmissionRequirementDraft[]): string {
  return JSON.stringify(requirements.map((requirement, index) => ({
    id: requirement.id ?? null,
    type: requirement.type,
    label: requirement.label?.trim() || '',
    instructions: requirement.instructions?.trim() || '',
    required: requirement.required !== false,
    position: index,
    validation_policy_json: requirement.validation_policy_json ?? {},
  })))
}

function areAssignmentEditorValuesEqual(a: AssignmentEditorValues, b: AssignmentEditorValues): boolean {
  return a.title === b.title
    && a.instructionsMarkdown === b.instructionsMarkdown
    && a.dueAt === b.dueAt
    && serializeRequirementDrafts(a.submissionRequirements) === serializeRequirementDrafts(b.submissionRequirements)
}

function validateAssignmentValues(values: AssignmentEditorValues): string | null {
  if (!values.dueAt) return 'Due date is required.'

  const parsedDueAt = parse(values.dueAt, 'yyyy-MM-dd', new Date())
  if (!isValid(parsedDueAt) || format(parsedDueAt, 'yyyy-MM-dd') !== values.dueAt) {
    return 'Enter a valid due date.'
  }

  return null
}

const RELEASE_TITLE_ERROR = 'Add a title before posting or scheduling this assignment.'

function getScheduledAssignmentDueDateValidationMessage(
  assignment: Assignment | null,
  dueAt: string
): string | null {
  if (!assignment || assignment.is_draft || !assignment.released_at || !dueAt) return null

  try {
    return getFutureScheduledReleaseDueDateError({
      releaseAt: assignment.released_at,
      dueAt: toTorontoEndOfDayIso(dueAt),
    })
  } catch {
    return null
  }
}

function validateAssignmentEditorValues(
  values: AssignmentEditorValues,
  assignment: Assignment | null
): string | null {
  return validateAssignmentValues(values)
    ?? getScheduledAssignmentDueDateValidationMessage(assignment, values.dueAt)
}

function getScheduleDueDateValidationMessage(scheduleIso: string, dueAt: string, isScheduleValid: boolean): string | null {
  if (!scheduleIso || !dueAt || !isScheduleValid) return null

  try {
    return getFutureScheduledReleaseDueDateError({
      releaseAt: scheduleIso,
      dueAt: toTorontoEndOfDayIso(dueAt),
    })
  } catch {
    return null
  }
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
  const instructionsHistoryRef = useRef<string[]>([])
  const instructionsHistoryIndexRef = useRef(-1)
  const isApplyingInstructionsHistoryRef = useRef(false)

  // The current assignment being edited (created on first save in create mode)
  const [currentAssignment, setCurrentAssignment] = useState<Assignment | null>(null)

  const [title, setTitle] = useState('')
  const [instructionsMarkdown, setInstructionsMarkdown] = useState('')
  const [markdownWarning, setMarkdownWarning] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showInstructionsPreview, setShowInstructionsPreview] = useState(false)
  const [submissionRequirements, setSubmissionRequirements] = useState<AssignmentSubmissionRequirementDraft[]>([])

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

  const buildEditorValues = useCallback((overrides?: Partial<AssignmentEditorValues>): AssignmentEditorValues => ({
    title,
    instructionsMarkdown,
    dueAt,
    submissionRequirements,
    ...overrides,
  }), [dueAt, instructionsMarkdown, submissionRequirements, title])

  const resetInstructionsHistory = useCallback((value: string) => {
    instructionsHistoryRef.current = [value]
    instructionsHistoryIndexRef.current = 0
    isApplyingInstructionsHistoryRef.current = false
  }, [])

  const pushInstructionsHistory = useCallback((value: string) => {
    if (isApplyingInstructionsHistoryRef.current) return

    const history = instructionsHistoryRef.current
    const currentIndex = instructionsHistoryIndexRef.current
    const currentValue = currentIndex >= 0 ? history[currentIndex] : undefined

    if (currentValue === value) return

    const nextHistory = currentIndex >= 0
      ? history.slice(0, currentIndex + 1)
      : []
    nextHistory.push(value)
    instructionsHistoryRef.current = nextHistory
    instructionsHistoryIndexRef.current = nextHistory.length - 1
  }, [])

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

  useEffect(() => {
    if (!isOpen) {
      setShowInstructionsPreview(false)
      return
    }

    // Reset state when modal opens
    setError('')
    resetForAssignment(assignment)

    if (assignment) {
      // Edit mode: populate from existing assignment
      const nextTitle = getDisplayedAssignmentTitle(assignment.title)
      const resolvedInstructions = getAssignmentInstructionsMarkdown(assignment)
      const nextInstructionsMarkdown = resolvedInstructions.markdown
      const nextDueAt = formatDateInToronto(new Date(assignment.due_at))
      const nextRequirements = getAssignmentRequirementDrafts(assignment)

      setCurrentAssignment(assignment)
      setTitle(nextTitle)
      setInstructionsMarkdown(nextInstructionsMarkdown)
      setSubmissionRequirements(nextRequirements)
      resetInstructionsHistory(nextInstructionsMarkdown)
      setMarkdownWarning(
        resolvedInstructions.hasLossyConversion
          ? resolvedInstructions.warnings.join(' ')
          : null
      )
      setDueAt(nextDueAt)
      if (assignment.released_at && isAssignmentScheduledForFuture(assignment)) {
        const scheduled = parseScheduleIsoToParts(assignment.released_at)
        setScheduleDate(scheduled.date)
        setScheduleTime(scheduled.time)
        setPrimaryAction('schedule')
      } else {
        setScheduleDate(getDefaultScheduleDateInSchedulingTimezone())
        setScheduleTime(DEFAULT_SCHEDULE_TIME)
        setPrimaryAction('post')
      }
      lastSavedValuesRef.current = {
        title: nextTitle,
        instructionsMarkdown: nextInstructionsMarkdown,
        dueAt: nextDueAt,
        submissionRequirements: nextRequirements,
      }
      setSaveStatus('saved')
    } else {
      // Create mode: immediately create a draft
      setCurrentAssignment(null)
      setTitle('')
      setInstructionsMarkdown('')
      setSubmissionRequirements([])
      resetInstructionsHistory('')
      setMarkdownWarning(null)
      setDueAt(defaultDueAt)
      setScheduleDate(getDefaultScheduleDateInSchedulingTimezone())
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
  }, [
    assignment,
    defaultDueAt,
    isOpen,
    resetForAssignment,
    resetInstructionsHistory,
    setDueAt,
    setError,
    setPrimaryAction,
    setScheduleDate,
    setScheduleTime,
  ])

  // Get only the fields that changed compared to last saved values
  const getChangedFields = useCallback((values: AssignmentEditorValues) => {
    const saved = lastSavedValuesRef.current
    if (!saved) return null

    const changes: Record<string, unknown> = {}
    if (values.title !== saved.title) changes.title = values.title
    if (values.dueAt !== saved.dueAt) changes.due_at = toTorontoEndOfDayIso(values.dueAt)
    if (values.instructionsMarkdown !== saved.instructionsMarkdown) {
      changes.instructions_markdown = values.instructionsMarkdown
    }
    if (serializeRequirementDrafts(values.submissionRequirements) !== serializeRequirementDrafts(saved.submissionRequirements)) {
      changes.submission_requirements = values.submissionRequirements
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
          instructions_markdown: values.instructionsMarkdown,
          due_at: toTorontoEndOfDayIso(values.dueAt),
          submission_requirements: values.submissionRequirements,
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
      const initialValues = { title: '', instructionsMarkdown: '', dueAt: defaultDueAt, submissionRequirements: [] }
      const newAssignment = await createAssignment(initialValues)
      setCreating(false)

      if (newAssignment) {
        const resolvedInstructions = getAssignmentInstructionsMarkdown(newAssignment)
        const nextTitle = getDisplayedAssignmentTitle(newAssignment.title)
        const nextRequirements = getAssignmentRequirementDrafts(newAssignment)
        setCurrentAssignment(newAssignment)
        setTitle(nextTitle)
        setInstructionsMarkdown(resolvedInstructions.markdown)
        setSubmissionRequirements(nextRequirements)
        resetInstructionsHistory(resolvedInstructions.markdown)
        setMarkdownWarning(
          resolvedInstructions.hasLossyConversion
            ? resolvedInstructions.warnings.join(' ')
            : null
        )
        const assignmentDueAt = formatDateInToronto(new Date(newAssignment.due_at))
        setDueAt(assignmentDueAt)
        lastSavedValuesRef.current = {
          title: nextTitle,
          instructionsMarkdown: resolvedInstructions.markdown,
          dueAt: assignmentDueAt,
          submissionRequirements: nextRequirements,
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
  }, [creating, createAssignment, defaultDueAt, onClose, resetInstructionsHistory, setDueAt])

  // Save changes to the server (create or update)
  const saveChanges = useCallback(async (
    values: AssignmentEditorValues,
    options?: { closeAfter?: boolean }
  ) => {
    const validationError = validateAssignmentEditorValues(values, currentAssignment)
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

        const updatedAssignment = data.assignment as Assignment
        savedAssignment = updatedAssignment
        const latestPendingValues = pendingValuesRef.current
        if (latestPendingValues && !areAssignmentEditorValuesEqual(latestPendingValues, values)) {
          return
        }

        const resolvedInstructions = getAssignmentInstructionsMarkdown(updatedAssignment)
        const updatedRequirements = getAssignmentRequirementDrafts(updatedAssignment)
        setCurrentAssignment(updatedAssignment)
        setSubmissionRequirements(updatedRequirements)
        setMarkdownWarning(
          resolvedInstructions.hasLossyConversion
            ? resolvedInstructions.warnings.join(' ')
            : null
        )
        lastSavedValuesRef.current = {
          title: values.title,
          instructionsMarkdown: resolvedInstructions.markdown,
          dueAt: values.dueAt,
          submissionRequirements: updatedRequirements,
        }
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

  const scheduleAutosave = useCallback((values: AssignmentEditorValues) => {
    pendingValuesRef.current = values
    setSaveStatus('unsaved')

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      scheduleSave(values)
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [scheduleSave])

  const applyInstructionsHistoryValue = useCallback((value: string) => {
    isApplyingInstructionsHistoryRef.current = true
    setInstructionsMarkdown(value)
    setMarkdownWarning(null)
    scheduleAutosave(buildEditorValues({ instructionsMarkdown: value }))
    requestAnimationFrame(() => {
      isApplyingInstructionsHistoryRef.current = false
    })
  }, [buildEditorValues, scheduleAutosave])

  function handleTitleChange(newTitle: string) {
    setTitle(newTitle)
    if (newTitle.trim() && error === RELEASE_TITLE_ERROR) {
      setError('')
    }
    scheduleAutosave(buildEditorValues({ title: newTitle }))
  }

  function handleInstructionsMarkdownChange(newInstructionsMarkdown: string) {
    setInstructionsMarkdown(newInstructionsMarkdown)
    pushInstructionsHistory(newInstructionsMarkdown)
    setMarkdownWarning(null)
    scheduleAutosave(buildEditorValues({ instructionsMarkdown: newInstructionsMarkdown }))
  }

  function handleInstructionsUndo() {
    const nextIndex = instructionsHistoryIndexRef.current - 1
    if (nextIndex < 0) return
    instructionsHistoryIndexRef.current = nextIndex
    applyInstructionsHistoryValue(instructionsHistoryRef.current[nextIndex] ?? '')
  }

  function handleInstructionsRedo() {
    const nextIndex = instructionsHistoryIndexRef.current + 1
    if (nextIndex >= instructionsHistoryRef.current.length) return
    instructionsHistoryIndexRef.current = nextIndex
    applyInstructionsHistoryValue(instructionsHistoryRef.current[nextIndex] ?? '')
  }

  function handleDueAtChange(newDueAt: string) {
    updateDueDate(newDueAt)
    const validationError = validateAssignmentEditorValues(
      buildEditorValues({ dueAt: newDueAt }),
      currentAssignment
    )
    if (validationError) {
      setError(validationError)
    }
    scheduleAutosave(buildEditorValues({ dueAt: newDueAt }))
  }

  function handleSubmissionRequirementsChange(nextRequirements: AssignmentSubmissionRequirementDraft[]) {
    setSubmissionRequirements(nextRequirements)
    scheduleAutosave(buildEditorValues({ submissionRequirements: nextRequirements }))
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
      const valuesToSave = pendingValuesRef.current ?? buildEditorValues()
      const validationError = validateAssignmentEditorValues(valuesToSave, currentAssignment)
      if (validationError) {
        setError(validationError)
        setSaveStatus('unsaved')
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
    await saveChanges(buildEditorValues(), { closeAfter: true })
    setSaving(false)
  }

  function ensureTitleBeforeRelease(): boolean {
    if (title.trim()) return true

    setError(RELEASE_TITLE_ERROR)
    titleInputRef.current?.focus()
    return false
  }

  // Wrapper: hook handles post/schedule/revert; component handles 'draft' already-a-draft case
  async function handleTriggerPrimaryAction(action: CreateSubmitAction = primaryAction) {
    if (action === 'draft' && currentAssignment?.is_draft) {
      await saveDraftAndClose()
      return
    }

    if ((action === 'post' || action === 'schedule') && !ensureTitleBeforeRelease()) {
      return
    }

    await triggerPrimaryAction(action)
  }

  function handleSplitActionSelection(action: CreateSubmitAction) {
    if ((action === 'post' || action === 'schedule') && !ensureTitleBeforeRelease()) {
      return
    }
    handleActionSelection(action)
  }

  async function handleClose() {
    setShowInstructionsPreview(false)

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
      const valuesToSave = pendingValuesRef.current ?? buildEditorValues()
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
  const relativeDueDate = getRelativeDueDate(dueAt, classDays)
  const scheduleContextLabel = relativeDueDate ? `Due ${relativeDueDate.text}` : null
  const scheduleContextTone = relativeDueDate
    ? relativeDueDate.isPast
      ? 'warning'
      : 'primary'
    : 'muted'
  const scheduleDueDateValidationMessage = getScheduleDueDateValidationMessage(scheduleIso, dueAt, isScheduleValid)
  const previewSubtitle = isLive ? title.trim() || undefined : undefined
  const saveStatusContent = (
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
  )

  return (
    <>
      <CreationModalShell
        isOpen={isOpen}
        onClose={() => {
          if (showInstructionsPreview) {
            setShowInstructionsPreview(false)
            return
          }
          void handleClose()
        }}
        title={modalTitle}
        titleId="assignment-modal-title"
        closeLabel="Close assignment modal"
        closeDisabled={saving || releasing}
      >
        <AssignmentForm
          title={title}
          instructionsMarkdown={instructionsMarkdown}
          dueAt={dueAt}
          classDays={classDays}
          onTitleChange={handleTitleChange}
          onInstructionsMarkdownChange={handleInstructionsMarkdownChange}
          onInstructionsUndo={handleInstructionsUndo}
          onInstructionsRedo={handleInstructionsRedo}
          onDueAtChange={handleDueAtChange}
          onPreviewInstructions={() => setShowInstructionsPreview(true)}
          disabled={saving || releasing || creating}
          error={error}
          titleInputRef={titleInputRef}
          onBlur={flushAutosave}
          markdownWarning={markdownWarning}
          canUndoInstructions={instructionsHistoryIndexRef.current > 0}
          canRedoInstructions={instructionsHistoryIndexRef.current < instructionsHistoryRef.current.length - 1}
          extraFields={(
            <AssignmentSubmissionRequirementsEditor
              requirements={submissionRequirements}
              onChange={handleSubmissionRequirementsChange}
              disabled={saving || releasing || creating}
            />
          )}
          statusContent={(
            <span className="inline-flex items-center gap-2">
              {saveStatusContent}
              {currentAssignment && isScheduled && currentAssignment.released_at && (
                <span className="text-xs font-medium text-warning">
                  {formatReleaseDate(currentAssignment.released_at)}
                </span>
              )}
            </span>
          )}
          topRowActions={
            currentAssignment && !isLive ? (
              <div className="flex items-end">
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
                  menuPlacement="down"
                  primaryButtonProps={{
                    className: 'w-[3.5rem] justify-center font-semibold sm:w-[5.75rem]',
                  }}
                  options={splitOptions.map((option) => ({
                    ...option,
                    onSelect: () => handleSplitActionSelection(option.id as CreateSubmitAction),
                  }))}
                />
              </div>
            ) : null
          }
        />
      </CreationModalShell>

      <ContentDialog
        isOpen={isOpen && showInstructionsPreview}
        onClose={() => setShowInstructionsPreview(false)}
        title="Instructions"
        subtitle={previewSubtitle}
        maxWidth="!max-w-2xl"
        showFooterClose={false}
      >
        <LimitedMarkdown
          content={instructionsMarkdown}
          emptyPlaceholder={<div className="text-sm text-text-muted">No assignment details provided.</div>}
        />
      </ContentDialog>

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
          validationMessage={scheduleDueDateValidationMessage}
          onDateChange={setScheduleDate}
          onTimeChange={setScheduleTime}
          onCancel={
            isScheduled
              ? () => {
                  void clearScheduledRelease()
                }
              : undefined
          }
          onConfirm={() => {
            if (!ensureTitleBeforeRelease()) return
            void scheduleAssignmentRelease({ closeAfter: isScheduled })
          }}
          confirmLabel={releasing ? 'Scheduling...' : isScheduled ? 'Save schedule' : 'Schedule'}
          cancelLabel="Cancel schedule"
          cancelVariant="danger"
          dateLabel="Date"
          timeLabel="Time"
          showHeader={false}
          showTimezoneLabel={false}
          contextLabel={scheduleContextLabel}
          contextTone={scheduleContextTone}
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
        onConfirm={() => {
          if (!ensureTitleBeforeRelease()) return
          void postAssignmentNow()
        }}
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
