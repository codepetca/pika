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
const INSPECTOR_SECTIONS_COOKIE_PREFIX = 'pika_teacher_student_work_sections'

function getInspectorSectionsCookieName(classroomId: string) {
  return `${INSPECTOR_SECTIONS_COOKIE_PREFIX}:${classroomId}`
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

function mergeFeedbackDraft(baseDraft: string | null | undefined, aiSuggestion: string | null | undefined) {
  const base = (baseDraft ?? '').trim()
  const suggestion = (aiSuggestion ?? '').trim()

  if (!suggestion) return { value: baseDraft ?? '', hasFreshAI: false }
  if (!base) return { value: suggestion, hasFreshAI: true }
  if (base.includes(suggestion)) return { value: baseDraft ?? base, hasFreshAI: false }

  return { value: `${suggestion}\n\n${base}`, hasFreshAI: true }
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
  gradeSaving: boolean
  gradeError: string
  autoGrading: boolean
  feedbackReturning: boolean
  repoAnalyzing: boolean
  feedbackEntries: AssignmentFeedbackEntry[]
  repoReviewResult: AssignmentRepoReviewResult | null
  totalScore: number
  totalPercent: number
  expandedSections: InspectorSectionId[]
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
  handleAutoGrade: () => Promise<void>
  handleReturnFeedback: () => Promise<void>
  handleSaveGrade: (mode: GradeSaveMode) => Promise<void>
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
  const [gradeSaving, setGradeSaving] = useState(false)
  const [gradeError, setGradeError] = useState('')
  const [autoGrading, setAutoGrading] = useState(false)
  const [feedbackReturning, setFeedbackReturning] = useState(false)
  const [repoAnalyzing, setRepoAnalyzing] = useState(false)
  const [expandedSections, setExpandedSections] = useState<InspectorSectionId[]>(() =>
    parseExpandedSections(readCookie(getInspectorSectionsCookieName(classroomId))),
  )
  const showInitialSpinner = useDelayedBusy(loading && !data)

  useEffect(() => {
    setExpandedSections(parseExpandedSections(readCookie(getInspectorSectionsCookieName(classroomId))))
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
    if (!doc) {
      setScoreCompletion('')
      setScoreThinking('')
      setScoreWorkflow('')
      setFeedbackDraft('')
      setHasFreshAIDraft(false)
      return
    }

    setScoreCompletion(doc.score_completion?.toString() ?? '')
    setScoreThinking(doc.score_thinking?.toString() ?? '')
    setScoreWorkflow(doc.score_workflow?.toString() ?? '')

    const baseDraft = mergeBaseDraft ?? doc.teacher_feedback_draft ?? doc.feedback ?? ''
    const mergedDraft = mergeFeedbackDraft(baseDraft, doc.ai_feedback_suggestion)
    setFeedbackDraft(mergedDraft.value)
    setHasFreshAIDraft(mergedDraft.hasFreshAI)
  }, [])

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
      onLoadingStateChange?.(false)
    }
  }, [onLoadingStateChange])

  const handleSaveGrade = useCallback(
    async (selectedSaveMode: GradeSaveMode) => {
      if (!data) return

      const sc = Number(scoreCompletion)
      const st = Number(scoreThinking)
      const sw = Number(scoreWorkflow)

      if ([sc, st, sw].some((value) => !Number.isInteger(value) || value < 0 || value > 10)) {
        setGradeError('Scores must be integers 0–10')
        return
      }

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
        setData((current) => (current ? { ...current, doc: result.doc } : current))
        dispatchGradeUpdated(result.doc)
      } catch (err: any) {
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
      feedbackDraft,
      scoreCompletion,
      scoreThinking,
      scoreWorkflow,
      studentId,
    ],
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
      if (result.graded_count === 0) {
        setGradeError('No gradable content found — the submission may be empty')
        return
      }
      const refreshed = await loadStudentWork({ mergeFeedbackIntoDraftFrom: feedbackDraft })
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
    gradeSaving,
    gradeError,
    autoGrading,
    feedbackReturning,
    repoAnalyzing,
    feedbackEntries,
    repoReviewResult,
    totalScore,
    totalPercent,
    expandedSections,
    setScoreCompletion,
    setScoreThinking,
    setScoreWorkflow,
    setFeedbackDraft,
    handlePreviewHover,
    handlePreviewLock,
    handleExitPreview,
    handleHistoryMouseLeave,
    handleAIDraftAcknowledge: () => setHasFreshAIDraft(false),
    toggleSection,
    handleAutoGrade,
    handleReturnFeedback,
    handleSaveGrade,
    handleAnalyzeRepo,
  }
}
