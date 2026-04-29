'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { reconstructAssignmentDocContent } from '@/lib/assignment-doc-history'
import { readCookie, writeCookie } from '@/lib/cookies'
import { TEACHER_GRADE_UPDATED_EVENT, type TeacherGradeUpdatedEventDetail } from '@/lib/events'
import { useDelayedBusy } from '@/hooks/useDelayedBusy'
import type {
  AssignmentDoc,
  AssignmentDocHistoryEntry,
  AssignmentFeedbackEntry,
  AssignmentRepoReviewResult,
  TiptapContent,
} from '@/types'
import type { InspectorSectionId, StudentWorkData } from './types'

type GradeSaveMode = 'draft' | 'graded'

const SECTION_ORDER: InspectorSectionId[] = ['history', 'repo', 'grades', 'comments']
const DEFAULT_EXPANDED_SECTIONS: InspectorSectionId[] = ['grades', 'comments']
const DEFAULT_VISIBLE_SECTIONS: InspectorSectionId[] = SECTION_ORDER
const INSPECTOR_SECTIONS_COOKIE_PREFIX = 'pika_teacher_student_work_sections'
const INSPECTOR_VISIBLE_SECTIONS_COOKIE_PREFIX = 'pika_teacher_student_work_visible_sections'
const GRADE_AUTOSAVE_DELAY_MS = 900
const DRAFT_AUTOSAVED_NOTICE_MS = 2500

function getInspectorSectionsCookieName(classroomId: string) {
  return `${INSPECTOR_SECTIONS_COOKIE_PREFIX}:${classroomId}`
}

function getInspectorVisibleSectionsCookieName(classroomId: string) {
  return `${INSPECTOR_VISIBLE_SECTIONS_COOKIE_PREFIX}:${classroomId}`
}

function parseExpandedSections(rawValue: string | null | undefined): InspectorSectionId[] {
  if (!rawValue) return DEFAULT_EXPANDED_SECTIONS

  const parts = rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (parts.length === 0) return DEFAULT_EXPANDED_SECTIONS

  const valid = new Set<InspectorSectionId>(SECTION_ORDER)
  const nextSections: InspectorSectionId[] = []

  for (const part of parts) {
    if (!valid.has(part as InspectorSectionId)) {
      return DEFAULT_EXPANDED_SECTIONS
    }
    const section = part as InspectorSectionId
    if (!nextSections.includes(section)) {
      nextSections.push(section)
    }
  }

  return SECTION_ORDER.filter((section) => nextSections.includes(section))
}

function serializeExpandedSections(sections: InspectorSectionId[]): string {
  return SECTION_ORDER.filter((section) => sections.includes(section)).join(',')
}

function parseVisibleSections(rawValue: string | null | undefined): InspectorSectionId[] {
  if (rawValue == null) return DEFAULT_VISIBLE_SECTIONS
  if (rawValue.trim() === '') return []

  const parts = rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  const valid = new Set<InspectorSectionId>(SECTION_ORDER)
  const nextSections: InspectorSectionId[] = []

  for (const part of parts) {
    if (!valid.has(part as InspectorSectionId)) {
      return DEFAULT_VISIBLE_SECTIONS
    }
    const section = part as InspectorSectionId
    if (!nextSections.includes(section)) {
      nextSections.push(section)
    }
  }

  return SECTION_ORDER.filter((section) => nextSections.includes(section))
}

function serializeVisibleSections(sections: InspectorSectionId[]): string {
  return SECTION_ORDER.filter((section) => sections.includes(section)).join(',')
}

function mergeFeedbackDraft(baseDraft: string | null | undefined, aiSuggestion: string | null | undefined) {
  const base = (baseDraft ?? '').trim()
  const suggestion = (aiSuggestion ?? '').trim()

  if (!suggestion) return { value: baseDraft ?? '', hasFreshAI: false }
  if (!base) return { value: suggestion, hasFreshAI: true }
  if (base.includes(suggestion)) return { value: baseDraft ?? base, hasFreshAI: false }

  return { value: `${suggestion}\n\n${base}`, hasFreshAI: true }
}

function getInitialGradeSaveMode(doc: AssignmentDoc | null | undefined): GradeSaveMode {
  if (doc?.graded_at) return 'graded'
  return doc?.teacher_feedback_draft_updated_at ? 'draft' : 'graded'
}

function buildGradeSnapshot({
  scoreCompletion,
  scoreThinking,
  scoreWorkflow,
  feedbackDraft,
  mode,
}: {
  scoreCompletion: string
  scoreThinking: string
  scoreWorkflow: string
  feedbackDraft: string
  mode: GradeSaveMode
}) {
  return JSON.stringify({
    scoreCompletion,
    scoreThinking,
    scoreWorkflow,
    feedbackDraft,
    mode,
  })
}

function parseGradeInputs({
  scoreCompletion,
  scoreThinking,
  scoreWorkflow,
}: {
  scoreCompletion: string
  scoreThinking: string
  scoreWorkflow: string
}) {
  const sc = Number(scoreCompletion)
  const st = Number(scoreThinking)
  const sw = Number(scoreWorkflow)
  const values = [sc, st, sw]

  return {
    isValid: values.every((value) => Number.isInteger(value) && value >= 0 && value <= 10),
    scoreCompletion: sc,
    scoreThinking: st,
    scoreWorkflow: sw,
  }
}

function serializeDraftGradeInputs({
  scoreCompletion,
  scoreThinking,
  scoreWorkflow,
}: {
  scoreCompletion: string
  scoreThinking: string
  scoreWorkflow: string
}) {
  const normalize = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 10 ? parsed : null
  }

  return {
    scoreCompletion: normalize(scoreCompletion),
    scoreThinking: normalize(scoreThinking),
    scoreWorkflow: normalize(scoreWorkflow),
  }
}

export interface TeacherStudentWorkController {
  data: StudentWorkData | null
  error: string
  loading: boolean
  showInitialSpinner: boolean
  historyEntries: AssignmentDocHistoryEntry[]
  historyLoading: boolean
  historyError: string
  previewEntry: AssignmentDocHistoryEntry | null
  previewContent: TiptapContent | null
  isPreviewLocked: boolean
  scoreCompletion: string
  scoreThinking: string
  scoreWorkflow: string
  feedbackDraft: string
  hasFreshAIDraft: boolean
  gradeMode: GradeSaveMode
  gradeSaving: boolean
  showDraftAutosavedNotice: boolean
  gradeError: string
  autoGrading: boolean
  feedbackReturning: boolean
  repoAnalyzing: boolean
  feedbackEntries: AssignmentFeedbackEntry[]
  repoReviewResult: AssignmentRepoReviewResult | null
  totalScore: number
  totalPercent: number
  expandedSections: InspectorSectionId[]
  visibleSections: InspectorSectionId[]
  setScoreCompletion: (value: string) => void
  setScoreThinking: (value: string) => void
  setScoreWorkflow: (value: string) => void
  setFeedbackDraft: (value: string) => void
  handlePreviewHover: (entry: AssignmentDocHistoryEntry) => void
  handlePreviewLock: (entry: AssignmentDocHistoryEntry) => void
  handleExitPreview: () => void
  handleHistoryMouseLeave: () => void
  handleAIDraftAcknowledge: () => void
  toggleSection: (section: InspectorSectionId) => void
  collapseAllSections: () => void
  toggleSectionVisibility: (section: InspectorSectionId) => void
  handleAutoGrade: () => Promise<void>
  handleReturnFeedback: () => Promise<void>
  handleSetGradeMode: (mode: GradeSaveMode) => Promise<void>
  handleAnalyzeRepo: () => Promise<void>
}

export function useTeacherStudentWorkController({
  classroomId,
  assignmentId,
  studentId,
  onLoadingStateChange,
}: {
  classroomId: string
  assignmentId: string
  studentId: string
  onLoadingStateChange?: (loading: boolean) => void
}): TeacherStudentWorkController {
  const studentLoadRequestIdRef = useRef(0)
  const historyLoadRequestIdRef = useRef(0)
  const lastSavedGradeSnapshotRef = useRef('')
  const draftAutosavedTimeoutRef = useRef<number | null>(null)
  const [data, setData] = useState<StudentWorkData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [historyEntries, setHistoryEntries] = useState<AssignmentDocHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [previewEntry, setPreviewEntry] = useState<AssignmentDocHistoryEntry | null>(null)
  const [previewContent, setPreviewContent] = useState<TiptapContent | null>(null)
  const [lockedEntryId, setLockedEntryId] = useState<string | null>(null)

  const [scoreCompletion, setScoreCompletion] = useState('')
  const [scoreThinking, setScoreThinking] = useState('')
  const [scoreWorkflow, setScoreWorkflow] = useState('')
  const [feedbackDraft, setFeedbackDraft] = useState('')
  const [hasFreshAIDraft, setHasFreshAIDraft] = useState(false)
  const [gradeMode, setGradeMode] = useState<GradeSaveMode>('graded')
  const [gradeSaving, setGradeSaving] = useState(false)
  const [showDraftAutosavedNotice, setShowDraftAutosavedNotice] = useState(false)
  const [gradeError, setGradeError] = useState('')
  const [autoGrading, setAutoGrading] = useState(false)
  const [feedbackReturning, setFeedbackReturning] = useState(false)
  const [repoAnalyzing, setRepoAnalyzing] = useState(false)
  const [expandedSections, setExpandedSections] = useState<InspectorSectionId[]>(() =>
    parseExpandedSections(readCookie(getInspectorSectionsCookieName(classroomId))),
  )
  const [visibleSections, setVisibleSections] = useState<InspectorSectionId[]>(() =>
    parseVisibleSections(readCookie(getInspectorVisibleSectionsCookieName(classroomId))),
  )
  const showInitialSpinner = useDelayedBusy(loading && !data)

  useEffect(() => {
    setExpandedSections(parseExpandedSections(readCookie(getInspectorSectionsCookieName(classroomId))))
    setVisibleSections(parseVisibleSections(readCookie(getInspectorVisibleSectionsCookieName(classroomId))))
  }, [classroomId])

  const persistExpandedSections = useCallback(
    (sections: InspectorSectionId[]) => {
      writeCookie(
        getInspectorSectionsCookieName(classroomId),
        serializeExpandedSections(sections),
      )
    },
    [classroomId],
  )

  const toggleSection = useCallback(
    (section: InspectorSectionId) => {
      setExpandedSections((current) => {
        const next = current.includes(section)
          ? current.filter((value) => value !== section)
          : SECTION_ORDER.filter((value) => value === section || current.includes(value))
        persistExpandedSections(next)
        return next
      })
    },
    [persistExpandedSections],
  )

  const collapseAllSections = useCallback(() => {
    const next: InspectorSectionId[] = []
    persistExpandedSections(next)
    setExpandedSections(next)
  }, [persistExpandedSections])

  const persistVisibleSections = useCallback(
    (sections: InspectorSectionId[]) => {
      writeCookie(
        getInspectorVisibleSectionsCookieName(classroomId),
        serializeVisibleSections(sections),
      )
    },
    [classroomId],
  )

  const toggleSectionVisibility = useCallback(
    (section: InspectorSectionId) => {
      setVisibleSections((current) => {
        const next = current.includes(section)
          ? current.filter((value) => value !== section)
          : SECTION_ORDER.filter((value) => value === section || current.includes(value))
        persistVisibleSections(next)
        return next
      })
    },
    [persistVisibleSections],
  )

  const clearDraftAutosavedNotice = useCallback(() => {
    if (draftAutosavedTimeoutRef.current) {
      window.clearTimeout(draftAutosavedTimeoutRef.current)
      draftAutosavedTimeoutRef.current = null
    }
    setShowDraftAutosavedNotice(false)
  }, [])

  const flashDraftAutosavedNotice = useCallback(() => {
    if (draftAutosavedTimeoutRef.current) {
      window.clearTimeout(draftAutosavedTimeoutRef.current)
    }
    setShowDraftAutosavedNotice(true)
    draftAutosavedTimeoutRef.current = window.setTimeout(() => {
      draftAutosavedTimeoutRef.current = null
      setShowDraftAutosavedNotice(false)
    }, DRAFT_AUTOSAVED_NOTICE_MS)
  }, [])

  const dispatchGradeUpdated = useCallback(
    (doc: AssignmentDoc | null) => {
      const detail: TeacherGradeUpdatedEventDetail = {
        assignmentId,
        studentId,
        doc,
      }
      window.dispatchEvent(
        new CustomEvent<TeacherGradeUpdatedEventDetail>(TEACHER_GRADE_UPDATED_EVENT, { detail }),
      )
    },
    [assignmentId, studentId],
  )

  const updatePreview = useCallback(
    (entry: AssignmentDocHistoryEntry): boolean => {
      const oldestFirst = [...historyEntries].reverse()
      const reconstructed = reconstructAssignmentDocContent(oldestFirst, entry.id)

      if (!reconstructed) return false

      setPreviewEntry(entry)
      setPreviewContent(reconstructed)
      return true
    },
    [historyEntries],
  )

  const handlePreviewHover = useCallback(
    (entry: AssignmentDocHistoryEntry) => {
      if (lockedEntryId) return
      updatePreview(entry)
    },
    [lockedEntryId, updatePreview],
  )

  const handlePreviewLock = useCallback(
    (entry: AssignmentDocHistoryEntry) => {
      const success = updatePreview(entry)
      if (success) {
        setLockedEntryId(entry.id)
      }
    },
    [updatePreview],
  )

  const handleExitPreview = useCallback(() => {
    setPreviewEntry(null)
    setPreviewContent(null)
    setLockedEntryId(null)
  }, [])

  const handleHistoryMouseLeave = useCallback(() => {
    if (lockedEntryId) return
    handleExitPreview()
  }, [handleExitPreview, lockedEntryId])

  const populateGradeForm = useCallback((doc: AssignmentDoc | null, mergeBaseDraft?: string | null) => {
    clearDraftAutosavedNotice()
    if (!doc) {
      setScoreCompletion('')
      setScoreThinking('')
      setScoreWorkflow('')
      setFeedbackDraft('')
      setHasFreshAIDraft(false)
      setGradeMode('graded')
      lastSavedGradeSnapshotRef.current = buildGradeSnapshot({
        scoreCompletion: '',
        scoreThinking: '',
        scoreWorkflow: '',
        feedbackDraft: '',
        mode: 'graded',
      })
      return
    }

    const nextScoreCompletion = doc.score_completion?.toString() ?? ''
    const nextScoreThinking = doc.score_thinking?.toString() ?? ''
    const nextScoreWorkflow = doc.score_workflow?.toString() ?? ''
    const baseDraft = mergeBaseDraft ?? doc.teacher_feedback_draft ?? doc.feedback ?? ''
    const mergedDraft = mergeFeedbackDraft(baseDraft, doc.ai_feedback_suggestion)

    setScoreCompletion(nextScoreCompletion)
    setScoreThinking(nextScoreThinking)
    setScoreWorkflow(nextScoreWorkflow)
    setFeedbackDraft(mergedDraft.value)
    setHasFreshAIDraft(mergedDraft.hasFreshAI)
    setGradeMode(getInitialGradeSaveMode(doc))
    lastSavedGradeSnapshotRef.current = buildGradeSnapshot({
      scoreCompletion: nextScoreCompletion,
      scoreThinking: nextScoreThinking,
      scoreWorkflow: nextScoreWorkflow,
      feedbackDraft: mergedDraft.value,
      mode: getInitialGradeSaveMode(doc),
    })
  }, [clearDraftAutosavedNotice])

  const loadStudentWork = useCallback(
    async (options?: { mergeFeedbackIntoDraftFrom?: string | null }): Promise<StudentWorkData | null> => {
      const requestId = ++studentLoadRequestIdRef.current
      setLoading(true)
      setError('')
      setGradeError('')
      handleExitPreview()

      try {
        const response = await fetch(`/api/teacher/assignments/${assignmentId}/students/${studentId}`)
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error || 'Failed to load student work')
        }
        if (requestId !== studentLoadRequestIdRef.current) {
          return null
        }

        setData(result)
        populateGradeForm(result.doc, options?.mergeFeedbackIntoDraftFrom)
        return result
      } catch (err: any) {
        if (requestId !== studentLoadRequestIdRef.current) {
          return null
        }
        setError(err.message || 'Failed to load student work')
        return null
      } finally {
        if (requestId === studentLoadRequestIdRef.current) {
          setLoading(false)
        }
      }
    },
    [assignmentId, handleExitPreview, populateGradeForm, studentId],
  )

  useEffect(() => {
    void loadStudentWork()
  }, [loadStudentWork])

  useEffect(() => {
    const requestId = ++historyLoadRequestIdRef.current
    setHistoryLoading(true)
    setHistoryError('')

    async function loadHistory() {
      try {
        const response = await fetch(
          `/api/assignment-docs/${assignmentId}/history?student_id=${studentId}`,
        )
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error || 'Failed to load history')
        }
        if (requestId !== historyLoadRequestIdRef.current) return
        setHistoryEntries(result.history || [])
      } catch (err: any) {
        if (requestId !== historyLoadRequestIdRef.current) return
        setHistoryError(err.message || 'Failed to load history')
      } finally {
        if (requestId === historyLoadRequestIdRef.current) {
          setHistoryLoading(false)
        }
      }
    }

    void loadHistory()
  }, [assignmentId, studentId])

  useEffect(() => {
    onLoadingStateChange?.(loading && !!data)
  }, [data, loading, onLoadingStateChange])

  useEffect(() => {
    return () => {
      if (draftAutosavedTimeoutRef.current) {
        window.clearTimeout(draftAutosavedTimeoutRef.current)
      }
      onLoadingStateChange?.(false)
    }
  }, [onLoadingStateChange])

  const persistGrade = useCallback(
    async (selectedSaveMode: GradeSaveMode, options?: { source?: 'autosave' | 'manual' }) => {
      if (!data) return

      const parsedScores = parseGradeInputs({
        scoreCompletion,
        scoreThinking,
        scoreWorkflow,
      })
      const serializedDraftScores = serializeDraftGradeInputs({
        scoreCompletion,
        scoreThinking,
        scoreWorkflow,
      })
      const isValidForSelectedMode =
        selectedSaveMode === 'draft'
          ? true
          : parsedScores.isValid

      if (!isValidForSelectedMode) {
        if (options?.source !== 'autosave') {
          setGradeError('Scores must be integers 0–10')
        }
        return
      }

      const sc = selectedSaveMode === 'draft' ? serializedDraftScores.scoreCompletion : parsedScores.scoreCompletion
      const st = selectedSaveMode === 'draft' ? serializedDraftScores.scoreThinking : parsedScores.scoreThinking
      const sw = selectedSaveMode === 'draft' ? serializedDraftScores.scoreWorkflow : parsedScores.scoreWorkflow
      const nextSnapshot = buildGradeSnapshot({
        scoreCompletion,
        scoreThinking,
        scoreWorkflow,
        feedbackDraft,
        mode: selectedSaveMode,
      })
      const previousSavedSnapshot = lastSavedGradeSnapshotRef.current

      setGradeSaving(true)
      setGradeError('')
      const previousDoc = data.doc
      const optimisticDoc: AssignmentDoc = {
        ...(previousDoc || {
          id: '',
          assignment_id: assignmentId,
          student_id: studentId,
          content: { type: 'doc', content: [] },
          repo_url: null,
          github_username: null,
          is_submitted: false,
          submitted_at: null,
          viewed_at: null,
          score_completion: null,
          score_thinking: null,
          score_workflow: null,
          feedback: null,
          teacher_feedback_draft: null,
          teacher_feedback_draft_updated_at: null,
          feedback_returned_at: null,
          ai_feedback_suggestion: null,
          ai_feedback_suggested_at: null,
          ai_feedback_model: null,
          teacher_cleared_at: null,
          graded_at: null,
          graded_by: null,
          returned_at: null,
          authenticity_score: null,
          authenticity_flags: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        score_completion: sc,
        score_thinking: st,
        score_workflow: sw,
        teacher_feedback_draft: feedbackDraft,
        teacher_feedback_draft_updated_at: new Date().toISOString(),
        graded_at:
          selectedSaveMode === 'graded'
            ? previousDoc?.graded_at || new Date().toISOString()
            : null,
        graded_by:
          selectedSaveMode === 'graded'
            ? previousDoc?.graded_by || 'teacher'
            : null,
        updated_at: new Date().toISOString(),
      }
      setData((current) => (current ? { ...current, doc: optimisticDoc } : current))

      try {
        const response = await fetch(`/api/teacher/assignments/${assignmentId}/grade`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              student_id: studentId,
              score_completion: sc,
              score_thinking: st,
            score_workflow: sw,
            feedback: feedbackDraft,
            save_mode: selectedSaveMode,
          }),
        })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Failed to save grade')
        lastSavedGradeSnapshotRef.current = nextSnapshot
        setData((current) => (current ? { ...current, doc: result.doc } : current))
        setGradeMode(getInitialGradeSaveMode(result.doc))
        dispatchGradeUpdated(result.doc)
        if (selectedSaveMode === 'draft') {
          flashDraftAutosavedNotice()
        } else {
          clearDraftAutosavedNotice()
        }
      } catch (err: any) {
        lastSavedGradeSnapshotRef.current = previousSavedSnapshot
        setData((current) => (current ? { ...current, doc: previousDoc } : current))
        setGradeError(err.message || 'Failed to save grade')
      } finally {
        setGradeSaving(false)
      }
    },
    [
      assignmentId,
      data,
      dispatchGradeUpdated,
      clearDraftAutosavedNotice,
      feedbackDraft,
      flashDraftAutosavedNotice,
      scoreCompletion,
      scoreThinking,
      scoreWorkflow,
      studentId,
    ],
  )

  useEffect(() => {
    if (!data || gradeSaving) return

    const selectedSaveMode = gradeMode
    const nextSnapshot = buildGradeSnapshot({
      scoreCompletion,
      scoreThinking,
      scoreWorkflow,
      feedbackDraft,
      mode: selectedSaveMode,
    })

    if (nextSnapshot === lastSavedGradeSnapshotRef.current) {
      return
    }

    if (
      selectedSaveMode === 'graded'
      && !parseGradeInputs({
        scoreCompletion,
        scoreThinking,
        scoreWorkflow,
      }).isValid
    ) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void persistGrade(selectedSaveMode, { source: 'autosave' })
    }, GRADE_AUTOSAVE_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [data, feedbackDraft, gradeMode, gradeSaving, persistGrade, scoreCompletion, scoreThinking, scoreWorkflow])

  const updateScoreCompletion = useCallback((value: string) => {
    setGradeError('')
    clearDraftAutosavedNotice()
    setScoreCompletion(value)
  }, [clearDraftAutosavedNotice])

  const updateScoreThinking = useCallback((value: string) => {
    setGradeError('')
    clearDraftAutosavedNotice()
    setScoreThinking(value)
  }, [clearDraftAutosavedNotice])

  const updateScoreWorkflow = useCallback((value: string) => {
    setGradeError('')
    clearDraftAutosavedNotice()
    setScoreWorkflow(value)
  }, [clearDraftAutosavedNotice])

  const updateFeedbackDraft = useCallback((value: string) => {
    setGradeError('')
    clearDraftAutosavedNotice()
    setFeedbackDraft(value)
  }, [clearDraftAutosavedNotice])

  const handleSetGradeMode = useCallback(
    async (selectedSaveMode: GradeSaveMode) => {
      setGradeMode(selectedSaveMode)
      await persistGrade(selectedSaveMode, { source: 'manual' })
    },
    [persistGrade],
  )

  const handleAutoGrade = useCallback(async () => {
    if (!data) return

    setAutoGrading(true)
    setGradeError('')
    try {
      const response = await fetch(`/api/teacher/assignments/${assignmentId}/auto-grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: [studentId] }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Auto-grade failed')
      if (result.errors?.length) {
        setGradeError(result.errors.join(', '))
        return
      }
      if ((result.graded_count ?? 0) === 0) {
        setGradeError('No gradable content found — the submission may be empty')
        return
      }
      const refreshed = await loadStudentWork({
        mergeFeedbackIntoDraftFrom: feedbackDraft.trim() ? feedbackDraft : null,
      })
      dispatchGradeUpdated(refreshed?.doc ?? null)
    } catch (err: any) {
      setGradeError(err.message || 'Auto-grade failed')
    } finally {
      setAutoGrading(false)
    }
  }, [assignmentId, data, dispatchGradeUpdated, feedbackDraft, loadStudentWork, studentId])

  const handleReturnFeedback = useCallback(async () => {
    if (!data) return

    const trimmed = feedbackDraft.trim()
    if (!trimmed) {
      setGradeError('Feedback draft is required before returning feedback')
      return
    }

    setFeedbackReturning(true)
    setGradeError('')
    try {
      const response = await fetch(`/api/teacher/assignments/${assignmentId}/feedback-return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId,
          feedback: trimmed,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Failed to return feedback')

      setData((current) =>
        current
          ? {
              ...current,
              doc: result.doc,
              feedback_entries: [...current.feedback_entries, result.entry],
            }
          : current,
      )
      populateGradeForm(result.doc)
      dispatchGradeUpdated(result.doc)
    } catch (err: any) {
      setGradeError(err.message || 'Failed to return feedback')
    } finally {
      setFeedbackReturning(false)
    }
  }, [
    assignmentId,
    data,
    dispatchGradeUpdated,
    feedbackDraft,
    populateGradeForm,
    studentId,
  ])

  const handleAnalyzeRepo = useCallback(async () => {
    if (!data) return

    setRepoAnalyzing(true)
    setGradeError('')
    try {
      const response = await fetch(`/api/teacher/assignments/${assignmentId}/artifact-repo/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: [studentId] }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Repo analysis failed')
      const refreshed = await loadStudentWork()
      dispatchGradeUpdated(refreshed?.doc ?? null)
      if ((result.analyzed_students ?? 0) === 0 && result.skipped_reasons) {
        const message = Object.entries(result.skipped_reasons as Record<string, number>)
          .map(([reason, count]) => `${count} ${reason}`)
          .join(' ')
        if (message) {
          setGradeError(message)
        }
      }
    } catch (err: any) {
      setGradeError(err.message || 'Repo analysis failed')
    } finally {
      setRepoAnalyzing(false)
    }
  }, [assignmentId, data, dispatchGradeUpdated, loadStudentWork, studentId])

  const feedbackEntries = data?.feedback_entries || []
  const repoReviewResult = data?.repo_target.latest_result || null

  const totalScore = useMemo(() => {
    const sc = Number(scoreCompletion) || 0
    const st = Number(scoreThinking) || 0
    const sw = Number(scoreWorkflow) || 0
    return sc + st + sw
  }, [scoreCompletion, scoreThinking, scoreWorkflow])

  const totalPercent = useMemo(() => Math.round((totalScore / 30) * 100), [totalScore])

  return {
    data,
    error,
    loading,
    showInitialSpinner,
    historyEntries,
    historyLoading,
    historyError,
    previewEntry,
    previewContent,
    isPreviewLocked: lockedEntryId !== null,
    scoreCompletion,
    scoreThinking,
    scoreWorkflow,
    feedbackDraft,
    hasFreshAIDraft,
    gradeMode,
    gradeSaving,
    showDraftAutosavedNotice,
    gradeError,
    autoGrading,
    feedbackReturning,
    repoAnalyzing,
    feedbackEntries,
    repoReviewResult,
    totalScore,
    totalPercent,
    expandedSections,
    visibleSections,
    setScoreCompletion: updateScoreCompletion,
    setScoreThinking: updateScoreThinking,
    setScoreWorkflow: updateScoreWorkflow,
    setFeedbackDraft: updateFeedbackDraft,
    handlePreviewHover,
    handlePreviewLock,
    handleExitPreview,
    handleHistoryMouseLeave,
    handleAIDraftAcknowledge: () => setHasFreshAIDraft(false),
    toggleSection,
    collapseAllSections,
    toggleSectionVisibility,
    handleAutoGrade,
    handleReturnFeedback,
    handleSetGradeMode,
    handleAnalyzeRepo,
  }
}
