'use client'

import { createContext, useContext, useEffect, useInsertionEffect, useRef, useState, useCallback, type ComponentProps } from 'react'
import { X } from 'lucide-react'
import type { Assignment, ClassDay } from '@/types'
import { AssignmentForm } from '@/components/AssignmentForm'
import { AssignmentSubmissionRequirementsEditor } from '@/components/AssignmentSubmissionRequirementsEditor'
import { CreationModalShell } from '@/components/creation/CreationModalShell'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import type { AssignmentSubmissionRequirementDraft } from '@/lib/assignment-submission-requirements'
import { getRelativeDueDate } from '@/lib/assignment-relative-date'
import { Button, ConfirmDialog, ContentDialog, DialogPanel, SaveStatus, SplitButton } from '@/ui'
import { ClassroomBlueprintDraftSource } from '@/components/ClassroomBlueprintDraftSource'
import { formatDateInToronto, getTodayInToronto, toTorontoEndOfDayIso, nowInToronto } from '@/lib/timezone'
import { format, isValid, parse } from 'date-fns'
import { addDaysToDateString } from '@/lib/date-string'
import { useAssignmentDateValidation } from '@/hooks/useAssignmentDateValidation'
import { ScheduleDateTimePicker } from '@/components/ScheduleDateTimePicker'
import { DEFAULT_SCHEDULE_TIME, getDefaultScheduleDateInSchedulingTimezone, getTodayInSchedulingTimezone, parseScheduleIsoToParts } from '@/lib/scheduling'
import { useAssignmentScheduling, type CreateSubmitAction } from '@/hooks/useAssignmentScheduling'
import { getFutureScheduledReleaseDueDateError } from '@/lib/assignment-schedule-validation'
import { isAssignmentScheduledForFuture } from '@/lib/assignments'

// This provider stays outside ModalLayer's outgoing presentation snapshot.
// Retained body props remain visual snapshots; context retires live descendants.
const AssignmentInteractionContext = createContext({ active: false, requirementsOwner: 0, publishInputOwner: () => () => {} })

type AssignmentEditorBodyProps = ComponentProps<typeof AssignmentForm> & {
  sourceClassroomId: string
  sourceArtifactId: string | undefined
  requirements: AssignmentSubmissionRequirementDraft[]
  onRequirementsChange: (next: AssignmentSubmissionRequirementDraft[]) => void
  requirementsDisabled: boolean
}

function AssignmentEditorBody({
  sourceClassroomId,
  sourceArtifactId,
  requirements,
  onRequirementsChange,
  requirementsDisabled,
  ...formProps
}: AssignmentEditorBodyProps) {
  const { active, requirementsOwner, publishInputOwner } = useContext(AssignmentInteractionContext)
  // Publish from inside the retained body: its insertion phase precedes the
  // ancestor ModalLayer's layout cleanup/focus return, even on physical removal.
  useInsertionEffect(publishInputOwner, [publishInputOwner])
  return (
    <AssignmentForm
      {...formProps}
      interactionActive={active}
      extraFields={(
        <div className="space-y-3">
          <ClassroomBlueprintDraftSource
            classroomId={sourceClassroomId}
            target="assignments"
            artifactId={sourceArtifactId}
            isOpen={active}
            retainOnClose
          />
          {/* External owner refresh retires its drag without remounting Tiptap. */}
          <AssignmentSubmissionRequirementsEditor
            key={requirementsOwner}
            requirements={requirements}
            onChange={onRequirementsChange}
            disabled={requirementsDisabled}
            interactionActive={active}
          />
        </div>
      )}
    />
  )
}

function AssignmentActionButton({ interactionActive = true, ...props }: ComponentProps<typeof SplitButton>) {
  const { active } = useContext(AssignmentInteractionContext)
  return <SplitButton {...props} interactionActive={active && interactionActive} />
}

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
  instructionsMode?: 'visual' | 'markdown'
  classDays?: ClassDay[]
  onClose: () => void
  onSuccess: (assignment: Assignment, options?: { closeModal?: boolean }) => void
}

export function AssignmentModal({ isOpen, classroomId, assignment, instructionsMode = 'visual', classDays, onClose, onSuccess }: AssignmentModalProps) {
  // Only a new logical open retires the old body's local editor/menu/history state.
  const [bodyLifetime, setBodyLifetime] = useState({ open: isOpen, key: 0 })
  if (bodyLifetime.open !== isOpen) {
    // Own-component derived state rolls back with an abandoned concurrent render.
    setBodyLifetime({ open: isOpen, key: bodyLifetime.key + (isOpen ? 1 : 0) })
  }
  const [requirementsOwner, setRequirementsOwner] = useState({ classroomId, assignment, generation: 0 })
  if (requirementsOwner.classroomId !== classroomId || requirementsOwner.assignment !== assignment) {
    // External refresh retires nested interaction owners. Abandoned renders
    // must not turn the legacy business session counter into a physical remount.
    setRequirementsOwner({ classroomId, assignment, generation: requirementsOwner.generation + 1 })
  }
  const committedInputOwnerRef = useRef({ isOpen, classroomId, assignment, lifetime: bodyLifetime.key })
  const publishInputOwner = useCallback(() => {
    const owner = { isOpen, classroomId, assignment, lifetime: bodyLifetime.key }
    committedInputOwnerRef.current = owner
    return () => {
      if (committedInputOwnerRef.current === owner) {
        committedInputOwnerRef.current = { ...owner, isOpen: false }
      }
    }
  }, [isOpen, classroomId, assignment, bodyLifetime.key])
  const titleInputRef = useRef<HTMLInputElement>(null)
  const titleFocusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorSessionRef = useRef(0)
  const editorOwnerRef = useRef({ isOpen, classroomId, assignment })
  if (editorOwnerRef.current.isOpen !== isOpen
    || editorOwnerRef.current.classroomId !== classroomId
    || editorOwnerRef.current.assignment !== assignment) {
    editorOwnerRef.current = { isOpen, classroomId, assignment }
    editorSessionRef.current += 1
  }
  const ownsSession = useCallback((session: number) => editorSessionRef.current === session, [])
  const createStartedSessionRef = useRef<number | null>(null)
  const titleFocusAllowedRef = useRef(false)

  const cancelTitleFocus = useCallback(() => {
    if (titleFocusTimeoutRef.current !== null) {
      clearTimeout(titleFocusTimeoutRef.current)
      titleFocusTimeoutRef.current = null
    }
  }, [])

  const scheduleTitleFocus = useCallback((session: number, select: boolean) => {
    if (editorSessionRef.current !== session || !titleFocusAllowedRef.current) return
    cancelTitleFocus()
    titleFocusTimeoutRef.current = setTimeout(() => {
      if (editorSessionRef.current !== session || !titleFocusAllowedRef.current) return
      titleFocusTimeoutRef.current = null
      titleInputRef.current?.focus()
      if (select) titleInputRef.current?.select()
    }, 100)
  }, [cancelTitleFocus])

  // The current assignment being edited (created on first save in create mode)
  const [currentAssignment, setCurrentAssignment] = useState<Assignment | null>(null)

  const [title, setTitle] = useState('')
  const [instructionsMarkdown, setInstructionsMarkdown] = useState('')
  const [markdownWarning, setMarkdownWarning] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [showInstructionsPreview, setShowInstructionsPreview] = useState(false)
  titleFocusAllowedRef.current = isOpen && !showInstructionsPreview
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
  const initialCreateValuesRef = useRef<AssignmentEditorValues | null>(null)
  const activeSaveRef = useRef<{
    session: number
    values: AssignmentEditorValues
    savedValues: AssignmentEditorValues | null
    promise: Promise<Assignment | null>
  } | null>(null)

  const isCreateMode = !assignment

  const buildEditorValues = useCallback((overrides?: Partial<AssignmentEditorValues>): AssignmentEditorValues => ({
    title,
    instructionsMarkdown,
    dueAt,
    submissionRequirements,
    ...overrides,
  }), [dueAt, instructionsMarkdown, submissionRequirements, title])

  const scheduling = useAssignmentScheduling({
    editorSessionRef,
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
    const session = ++editorSessionRef.current
    cancelTitleFocus()
    setShowInstructionsPreview(false)
    setSaving(false)
    setCreating(false)
    setDiscarding(false)
    activeSaveRef.current = null
    pendingValuesRef.current = null
    lastSaveAtRef.current = 0
    resetForAssignment(assignment)
    if (!isOpen) {
      return
    }

    // Reset state when modal opens
    setError('')

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
      initialCreateValuesRef.current = null
      setSaveStatus('saved')
    } else {
      // Create mode: immediately create a draft
      setCurrentAssignment(null)
      setTitle('')
      setInstructionsMarkdown('')
      setSubmissionRequirements([])
      setMarkdownWarning(null)
      setDueAt(defaultDueAt)
      setScheduleDate(getDefaultScheduleDateInSchedulingTimezone())
      setScheduleTime(DEFAULT_SCHEDULE_TIME)
      setPrimaryAction('post')
      const initialValues = {
        title: '',
        instructionsMarkdown: '',
        dueAt: defaultDueAt,
        submissionRequirements: [],
      }
      initialCreateValuesRef.current = initialValues
      lastSavedValuesRef.current = null
      setSaveStatus('saving')
      setCreating(true)
    }

    pendingValuesRef.current = null

    // Focus the title input when modal opens
    scheduleTitleFocus(session, !!assignment)

    // Cleanup timeouts on close/change
    return () => {
      if (editorSessionRef.current === session) editorSessionRef.current += 1
      cancelTitleFocus()
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
    classroomId,
    cancelTitleFocus,
    defaultDueAt,
    isOpen,
    resetForAssignment,
    scheduleTitleFocus,
    setDueAt,
    setError,
    setPrimaryAction,
    setScheduleDate,
    setScheduleTime,
  ])

  // Get only the fields that changed compared to last saved values
  const getChangedFields = useCallback((values: AssignmentEditorValues, saved = lastSavedValuesRef.current) => {
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
    values: AssignmentEditorValues,
    session: number
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
      if (ownsSession(session)) setError(err.message || 'Failed to create assignment')
      return null
    }
  }, [classroomId, ownsSession, setError])

  // Automatically create draft when modal opens in create mode
  useEffect(() => {
    if (!isOpen || assignment || !creating) return
    const session = editorSessionRef.current
    if (createStartedSessionRef.current === session) return
    createStartedSessionRef.current = session

    const createDraft = async () => {
      const initialValues = { title: '', instructionsMarkdown: '', dueAt: defaultDueAt, submissionRequirements: [] }
      const newAssignment = await createAssignment(initialValues, session)
      if (!ownsSession(session)) return
      setCreating(false)

      if (newAssignment) {
        const resolvedInstructions = getAssignmentInstructionsMarkdown(newAssignment)
        const nextTitle = getDisplayedAssignmentTitle(newAssignment.title)
        const nextRequirements = getAssignmentRequirementDrafts(newAssignment)
        setCurrentAssignment(newAssignment)
        setTitle(nextTitle)
        setInstructionsMarkdown(resolvedInstructions.markdown)
        setSubmissionRequirements(nextRequirements)
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
        initialCreateValuesRef.current = {
          title: nextTitle,
          instructionsMarkdown: resolvedInstructions.markdown,
          dueAt: assignmentDueAt,
          submissionRequirements: nextRequirements,
        }
        setSaveStatus('saved')

        // Focus and select title after creation
        scheduleTitleFocus(session, true)
      } else {
        // Creation failed - close modal (error is already set by createAssignment)
        onClose()
      }
    }

    void createDraft()
  }, [assignment, classroomId, creating, createAssignment, defaultDueAt, isOpen, onClose, ownsSession, scheduleTitleFocus, setDueAt])

  // Save changes to the server (create or update)
  const saveChanges = useCallback(async (
    values: AssignmentEditorValues,
    options?: { closeAfter?: boolean },
    owner?: { session: number; savedValues: AssignmentEditorValues | null }
  ): Promise<Assignment | null> => {
    const session = owner?.session ?? editorSessionRef.current
    const validationError = validateAssignmentEditorValues(values, currentAssignment)
    if (validationError) {
      if (ownsSession(session)) {
        setError(validationError)
        setSaveStatus('unsaved')
      }
      return null
    }

    if (ownsSession(session)) {
      setSaveStatus('saving')
      lastSaveAtRef.current = Date.now()
    }

    try {
      let savedAssignment: Assignment | null = currentAssignment

      if (!currentAssignment) {
        // Create mode: create the assignment first
        savedAssignment = await createAssignment(values, session)
        if (!ownsSession(session)) {
          if (savedAssignment && options?.closeAfter) onSuccess(savedAssignment, { closeModal: false })
          return savedAssignment
        }
        if (!savedAssignment) {
          setSaveStatus('unsaved')
          return null
        }
        setCurrentAssignment(savedAssignment)
        lastSavedValuesRef.current = { ...values }
      } else {
        // Edit mode: update existing assignment
        const changedFields = owner ? getChangedFields(values, owner.savedValues) : getChangedFields(values)
        if (!changedFields) {
          if (ownsSession(session)) setSaveStatus('saved')
          if (options?.closeAfter) {
            if (ownsSession(session)) {
              onSuccess(currentAssignment)
              onClose()
            } else {
              onSuccess(currentAssignment, { closeModal: false })
            }
          }
          return currentAssignment
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
        if (!ownsSession(session)) {
          if (options?.closeAfter) onSuccess(updatedAssignment, { closeModal: false })
          return updatedAssignment
        }
        const latestPendingValues = pendingValuesRef.current
        if (latestPendingValues && !areAssignmentEditorValuesEqual(latestPendingValues, values)) {
          return savedAssignment
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
      return savedAssignment
    } catch (err: any) {
      if (ownsSession(session)) {
        setError(err.message || 'Failed to save assignment')
        setSaveStatus('unsaved')
      }
      return null
    }
  }, [currentAssignment, createAssignment, getChangedFields, onClose, onSuccess, ownsSession, setError])

  const startSaveChanges = useCallback((
    values: AssignmentEditorValues,
    options?: { closeAfter?: boolean },
    savedValues: AssignmentEditorValues | null = lastSavedValuesRef.current
  ) => {
    const session = editorSessionRef.current
    const previousSave = activeSaveRef.current
    // Blur flushes must account for the write already in flight, including reverts.
    const promise: Promise<Assignment | null> = previousSave?.session === session
      ? previousSave.promise.then((savedAssignment) => {
          activeSave.savedValues = savedAssignment ? previousSave.values : previousSave.savedValues
          return saveChanges(values, options, { session, savedValues: activeSave.savedValues })
        })
      : saveChanges(values, options, { session, savedValues })
    const activeSave = { session, values, savedValues, promise }
    activeSaveRef.current = activeSave
    void promise.finally(() => {
      if (activeSaveRef.current === activeSave) {
        activeSaveRef.current = null
      }
    })
    return promise
  }, [saveChanges])

  const scheduleSave = useCallback((
    values: AssignmentEditorValues,
    options?: { force?: boolean }
  ) => {
    const session = editorSessionRef.current
    pendingValuesRef.current = values

    if (throttledSaveTimeoutRef.current) {
      clearTimeout(throttledSaveTimeoutRef.current)
      throttledSaveTimeoutRef.current = null
    }

    const now = Date.now()
    const msSinceLastSave = now - lastSaveAtRef.current

    if (options?.force || msSinceLastSave >= AUTOSAVE_MIN_INTERVAL_MS) {
      void startSaveChanges(values)
      return
    }

    const waitMs = AUTOSAVE_MIN_INTERVAL_MS - msSinceLastSave
    throttledSaveTimeoutRef.current = setTimeout(() => {
      if (!ownsSession(session)) return
      throttledSaveTimeoutRef.current = null
      const latest = pendingValuesRef.current
      if (latest) {
        void startSaveChanges(latest)
      }
    }, waitMs)
  }, [ownsSession, startSaveChanges])

  const scheduleAutosave = useCallback((values: AssignmentEditorValues) => {
    const session = editorSessionRef.current
    pendingValuesRef.current = values
    setSaveStatus('unsaved')

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      if (!ownsSession(session)) return
      saveTimeoutRef.current = null
      scheduleSave(values)
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [ownsSession, scheduleSave])

  function handleTitleChange(newTitle: string) {
    setTitle(newTitle)
    if (newTitle.trim() && error === RELEASE_TITLE_ERROR) {
      setError('')
    }
    scheduleAutosave(buildEditorValues({ title: newTitle }))
  }

  function handleInstructionsMarkdownChange(newInstructionsMarkdown: string) {
    setInstructionsMarkdown(newInstructionsMarkdown)
    scheduleAutosave(buildEditorValues({ instructionsMarkdown: newInstructionsMarkdown }))
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
    const session = editorSessionRef.current
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
        if (!ownsSession(session)) return
        const latestPendingValues = pendingValuesRef.current
        if (latestPendingValues && !areAssignmentEditorValuesEqual(latestPendingValues, valuesToSave)) return
        lastSavedValuesRef.current = { ...valuesToSave }
      }
      pendingValuesRef.current = null
      setSaveStatus('saved')
    }
  }

  async function saveDraftAndClose() {
    if (saving || releasing) return
    const session = editorSessionRef.current
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    if (throttledSaveTimeoutRef.current) {
      clearTimeout(throttledSaveTimeoutRef.current)
      throttledSaveTimeoutRef.current = null
    }
    setSaving(true)
    let valuesToSave = pendingValuesRef.current ?? buildEditorValues()
    let savedValues = lastSavedValuesRef.current
    const activeSave = activeSaveRef.current
    if (activeSave && activeSave.session === session) {
      const savedAssignment = await activeSave.promise
      if (!ownsSession(session)) {
        if (savedAssignment && areAssignmentEditorValuesEqual(activeSave.values, valuesToSave)) {
          onSuccess(savedAssignment, { closeModal: false })
        } else {
          // A completed autosave may have persisted values the manual save reverted.
          await saveChanges(valuesToSave, { closeAfter: true }, {
            session,
            savedValues: savedAssignment ? activeSave.values : activeSave.savedValues,
          })
        }
        return
      }
      const latestValues = pendingValuesRef.current ?? buildEditorValues()
      if (
        savedAssignment
        && areAssignmentEditorValuesEqual(activeSave.values, latestValues)
      ) {
        pendingValuesRef.current = null
        onSuccess(savedAssignment)
        onClose()
        setSaving(false)
        return
      }
      // The response may leave newer input untouched, so carry its persisted baseline.
      savedValues = savedAssignment ? activeSave.values : activeSave.savedValues
      valuesToSave = latestValues
    }

    pendingValuesRef.current = null
    await startSaveChanges(valuesToSave, { closeAfter: true }, savedValues)
    if (ownsSession(session)) setSaving(false)
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
    if (creating || saving || releasing || discarding) return
    const session = editorSessionRef.current

    setShowInstructionsPreview(false)

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    if (throttledSaveTimeoutRef.current) {
      clearTimeout(throttledSaveTimeoutRef.current)
      throttledSaveTimeoutRef.current = null
    }

    const valuesToClose = pendingValuesRef.current ?? buildEditorValues()
    const initialCreateValues = initialCreateValuesRef.current
    if (
      isCreateMode
      && currentAssignment
      && initialCreateValues
      && areAssignmentEditorValuesEqual(valuesToClose, initialCreateValues)
    ) {
      setDiscarding(true)
      try {
        const response = await fetch(`/api/teacher/assignments/${currentAssignment.id}/discard-pristine`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expected_updated_at: currentAssignment.updated_at }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(data.error || 'Failed to discard empty assignment')
        }
        if (data.discarded) {
          if (ownsSession(session)) onClose()
        } else {
          const preservedAssignment = data.assignment ?? currentAssignment
          if (ownsSession(session)) {
            onSuccess(preservedAssignment)
            onClose()
          } else {
            onSuccess(preservedAssignment, { closeModal: false })
          }
        }
      } catch (closeError: any) {
        if (ownsSession(session)) setError(closeError?.message || 'Failed to discard empty assignment')
      } finally {
        if (ownsSession(session)) setDiscarding(false)
      }
      return
    }

    // If there are unsaved changes, save before closing
    if (saveStatus === 'unsaved' || pendingValuesRef.current) {
      await saveChanges(valuesToClose, { closeAfter: true })
    } else {
      if (currentAssignment) {
        onSuccess(currentAssignment)
      }
      onClose()
    }
  }

  // Guard captured inputs against the committed body, not speculative renders.
  // Initiated save/release/discard continuations keep their existing ownership rules.
  const inputLifetime = bodyLifetime.key
  function activeInput<Args extends unknown[]>(callback: (...args: Args) => void) {
    return (...args: Args) => {
      const owner = committedInputOwnerRef.current
      if (!owner.isOpen || owner.classroomId !== classroomId || owner.assignment !== assignment
        || owner.lifetime !== inputLifetime) return
      callback(...args)
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

  return (
    <AssignmentInteractionContext.Provider value={{ active: isOpen, requirementsOwner: requirementsOwner.generation, publishInputOwner }}>
      <CreationModalShell
        isOpen={isOpen}
        exitMotion="opacity"
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
        closeDisabled={creating || saving || releasing || discarding}
        showCloseButton={false}
        maxWidth="!max-w-6xl"
        panelClassName="!p-0"
        tall
        contentClassName="!overflow-hidden !p-0"
      >
        <AssignmentEditorBody
          key={bodyLifetime.key}
          sourceClassroomId={classroomId}
          sourceArtifactId={assignment?.id}
          requirements={submissionRequirements}
          onRequirementsChange={activeInput(handleSubmissionRequirementsChange)}
          requirementsDisabled={saving || releasing || creating}
          fillHeight
          desktopSplit
          title={title}
          instructionsMarkdown={instructionsMarkdown}
          instructionsMode={instructionsMode}
          dueAt={dueAt}
          classDays={classDays}
          onTitleChange={activeInput(handleTitleChange)}
          onInstructionsMarkdownChange={activeInput(handleInstructionsMarkdownChange)}
          onInstructionsConversionWarningChange={activeInput(setMarkdownWarning)}
          onDueAtChange={activeInput(handleDueAtChange)}
          onPreviewInstructions={activeInput(() => {
            cancelTitleFocus()
            setShowInstructionsPreview(true)
          })}
          titleAccessory={(
            <div className="flex items-center gap-1">
              <SaveStatus status={saveStatus} className={saveStatus === 'saved' ? 'text-text-muted' : undefined} />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Close assignment modal"
                title="Close"
                disabled={creating || saving || releasing || discarding}
                onClick={() => void handleClose()}
                className="h-11 w-11 p-0"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          )}
          disabled={saving || releasing || creating}
          error={error}
          titleInputRef={titleInputRef}
          onBlur={activeInput(flushAutosave)}
          markdownWarning={markdownWarning}
          statusContent={currentAssignment && isScheduled && currentAssignment.released_at ? (
            <span className="text-xs font-medium text-warning">
              {formatReleaseDate(currentAssignment.released_at)}
            </span>
          ) : undefined}
          topRowActions={
            currentAssignment && !isLive ? (
              <div className="flex w-full items-end">
                <AssignmentActionButton
                  key={requirementsOwner.generation}
                  exitMotion="opacity"
                  interactionActive={!showInstructionsPreview && !showCreateScheduleModal && !showPostNowConfirm && !showRevertToDraftConfirm}
                  label={primaryLabel}
                  onPrimaryClick={() => {
                    void handleTriggerPrimaryAction()
                  }}
                  variant={effectivePrimaryAction === 'post' ? 'success' : 'primary'}
                  size="md"
                  disabled={creating || releasing || saving || !currentAssignment}
                  className="w-full shadow-sm"
                  toggleAriaLabel="Choose assignment action"
                  menuPlacement="up"
                  primaryButtonProps={{
                    className: 'flex-1 justify-center font-semibold',
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
        exitMotion="opacity"
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
        isOpen={isOpen && showCreateScheduleModal}
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
        isOpen={isOpen && showPostNowConfirm}
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
        isOpen={isOpen && showRevertToDraftConfirm}
        title="Revert to draft?"
        description="Students will no longer be able to see this assignment until you post or schedule it again."
        confirmLabel={releasing ? 'Reverting...' : 'Revert'}
        cancelLabel="Cancel"
        isConfirmDisabled={releasing}
        isCancelDisabled={releasing}
        onCancel={() => setShowRevertToDraftConfirm(false)}
        onConfirm={revertAssignmentToDraft}
      />
    </AssignmentInteractionContext.Provider>
  )
}
