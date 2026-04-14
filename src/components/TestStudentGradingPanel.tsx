'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import {
  TEACHER_TEST_GRADING_ROW_UPDATED_EVENT,
  type TeacherTestGradingRowUpdatedEventDetail,
} from '@/lib/events'
import type { QuizFocusSummary } from '@/types'

interface TestQuestionInfo {
  id: string
  question_text: string
  question_type: 'multiple_choice' | 'open_response'
  options: string[]
  correct_option: number | null
  points: number
}

type TestAnswerDetail = {
  response_id: string | null
  question_type: 'multiple_choice' | 'open_response'
  selected_option: number | null
  response_text: string | null
  score: number | null
  feedback: string | null
  graded_at: string | null
  is_draft?: boolean
}

type TestAnswersByQuestion = Record<string, TestAnswerDetail>

interface TestStudentRow {
  student_id: string
  name: string | null
  email: string
  status: 'not_started' | 'in_progress' | 'submitted' | 'returned'
  submitted_at: string | null
  last_activity_at: string | null
  points_earned: number
  points_possible: number
  percent: number | null
  graded_open_responses: number
  ungraded_open_responses: number
  answers: TestAnswersByQuestion
  focus_summary: QuizFocusSummary | null
}

interface TestResultsPayload {
  quiz: {
    id: string
    title: string
  }
  questions: TestQuestionInfo[]
  students: TestStudentRow[]
}

interface GradeDraft {
  score: string
  feedback: string
}

interface SplitScoreInputProps {
  ariaLabel: string
  maxPoints: number
  value: string
  disabled?: boolean
  onChange: (value: string) => void
  onBlur: () => void
}

interface SaveState {
  canSave: boolean
  isSaving: boolean
  status: 'idle' | 'unsaved' | 'saving' | 'saved'
}

interface StudentGradingMetrics {
  pointsEarned: number
  pointsPossible: number
  percent: number | null
  gradedOpenResponses: number
  ungradedOpenResponses: number
}

type ParsedScore =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'value'; value: number }

function normalizeFeedback(raw: string | null | undefined): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function parseScore(raw: string | null | undefined): ParsedScore {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (!trimmed) return { kind: 'empty' }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return { kind: 'invalid' }
  return { kind: 'value', value: Math.round(parsed * 100) / 100 }
}

function areDraftsEqual(left: GradeDraft | undefined, right: GradeDraft | undefined): boolean {
  const leftScore = parseScore(left?.score)
  const rightScore = parseScore(right?.score)
  const equalScores =
    leftScore.kind === rightScore.kind &&
    (leftScore.kind !== 'value' || leftScore.value === (rightScore as { value: number }).value)

  return equalScores && normalizeFeedback(left?.feedback) === normalizeFeedback(right?.feedback)
}

function computeStudentGradingMetrics(
  status: TestStudentRow['status'],
  questions: TestQuestionInfo[],
  answers: TestAnswersByQuestion
): StudentGradingMetrics {
  const questionTypeById = new Map(questions.map((question) => [question.id, question.question_type]))
  const pointsPossible = questions.reduce((sum, question) => sum + Number(question.points || 0), 0)

  let pointsEarned = 0
  let gradedOpenResponses = 0
  let ungradedOpenResponses = 0

  for (const [questionId, answer] of Object.entries(answers)) {
    if (typeof answer.score === 'number') {
      pointsEarned += answer.score
    }

    if (questionTypeById.get(questionId) !== 'open_response') continue
    if (answer.is_draft || !answer.response_id) continue

    if (typeof answer.score === 'number') {
      gradedOpenResponses += 1
    } else {
      ungradedOpenResponses += 1
    }
  }

  return {
    pointsEarned,
    pointsPossible,
    percent: status === 'not_started' || pointsPossible <= 0
      ? null
      : (pointsEarned / pointsPossible) * 100,
    gradedOpenResponses,
    ungradedOpenResponses,
  }
}

interface Props {
  testId: string
  selectedStudentId: string | null
  apiBasePath?: string
  refreshToken?: number
  onRegisterSaveHandler?: ((handler: (() => Promise<void>) | null) => void)
  onSaveStateChange?: ((state: SaveState) => void)
}

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function SplitScoreInput({
  ariaLabel,
  maxPoints,
  value,
  disabled = false,
  onChange,
  onBlur,
}: SplitScoreInputProps) {
  return (
    <div
      className={`flex h-9 overflow-hidden rounded-md border border-border ${
        disabled ? 'bg-surface-2' : 'bg-surface focus-within:ring-2 focus-within:ring-primary'
      }`}
    >
      <input
        type="number"
        min="0"
        max={String(maxPoints)}
        step="0.25"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className="min-w-0 flex-1 border-0 bg-transparent px-2 text-center text-sm text-text-default [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:outline-none disabled:cursor-not-allowed"
      />
      <span className="flex min-w-8 items-center justify-center border-l border-border bg-surface-2 px-1.5 text-xs text-text-muted">
        {formatPoints(maxPoints)}
      </span>
    </div>
  )
}

const AUTOSAVE_DELAY_MS = 1200
const GRADE_BOX_HEIGHT_PX = 36

export function TestStudentGradingPanel({
  testId,
  selectedStudentId,
  apiBasePath = '/api/teacher/tests',
  refreshToken = 0,
  onRegisterSaveHandler,
  onSaveStateChange,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [results, setResults] = useState<TestResultsPayload | null>(null)

  const [gradeDrafts, setGradeDrafts] = useState<Record<string, GradeDraft>>({})
  const [persistedDrafts, setPersistedDrafts] = useState<Record<string, GradeDraft>>({})
  const [savingAll, setSavingAll] = useState(false)
  const [gradingError, setGradingError] = useState('')
  const [hasSavedSuccessfully, setHasSavedSuccessfully] = useState(false)
  const feedbackTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${apiBasePath}/${testId}/results`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load test results')

      const payload = data as TestResultsPayload
      setResults(payload)

      const nextDrafts: Record<string, GradeDraft> = {}
      for (const student of payload.students || []) {
        for (const answer of Object.values(student.answers || {})) {
          if (answer.is_draft || !answer.response_id) continue
          nextDrafts[answer.response_id] = {
            score: answer.score != null ? String(answer.score) : '',
            feedback: answer.feedback || '',
          }
        }
      }
      setGradeDrafts(nextDrafts)
      setPersistedDrafts(nextDrafts)
      setHasSavedSuccessfully(false)
      setGradingError('')
    } catch (loadError: any) {
      setError(loadError.message || 'Failed to load test results')
    } finally {
      setLoading(false)
    }
  }, [apiBasePath, testId])

  useEffect(() => {
    void load()
  }, [load, refreshToken])

  const selectedStudent = useMemo(() => {
    if (!results || !selectedStudentId) return null
    return results.students.find((student) => student.student_id === selectedStudentId) || null
  }, [results, selectedStudentId])

  const selectedGradableResponses = useMemo(() => {
    if (!selectedStudent || !results) return [] as Array<{
      responseId: string
      questionId: string
      maxPoints: number
      questionNumber: number
      questionType: 'multiple_choice' | 'open_response'
    }>

    return results.questions.flatMap((question, index) => {
      const answer = selectedStudent.answers[question.id]
      if (!answer || answer.is_draft || !answer.response_id) return []

      return [{
        responseId: answer.response_id,
        questionId: question.id,
        maxPoints: Number(question.points || 0),
        questionNumber: index + 1,
        questionType: question.question_type,
      }]
    })
  }, [results, selectedStudent])

  const dirtyResponses = useMemo(() => {
    return selectedGradableResponses.filter((item) =>
      !areDraftsEqual(gradeDrafts[item.responseId], persistedDrafts[item.responseId])
    )
  }, [gradeDrafts, persistedDrafts, selectedGradableResponses])

  const dirtyValidationError = useMemo(() => {
    for (const item of dirtyResponses) {
      const draft = gradeDrafts[item.responseId]
      const score = parseScore(draft?.score)
      const feedback = normalizeFeedback(draft?.feedback)

      if (score.kind === 'invalid') {
        return `Q${item.questionNumber}: score must be a valid number`
      }
      if (score.kind === 'value' && (score.value < 0 || score.value > item.maxPoints)) {
        return `Q${item.questionNumber}: score must be between 0 and ${item.maxPoints}`
      }
      if (item.questionType === 'open_response' && score.kind === 'empty' && feedback.length > 0) {
        return `Q${item.questionNumber}: enter a score or clear feedback`
      }
    }
    return ''
  }, [dirtyResponses, gradeDrafts])

  function updateDraft(responseId: string, updates: Partial<GradeDraft>) {
    setGradingError('')
    setGradeDrafts((prev) => ({
      ...prev,
      [responseId]: {
        score: prev[responseId]?.score ?? '',
        feedback: prev[responseId]?.feedback ?? '',
        ...updates,
      },
    }))
  }

  function autoResizeFeedbackTextarea(textarea: HTMLTextAreaElement | null) {
    if (!textarea) return
    textarea.style.height = `${GRADE_BOX_HEIGHT_PX}px`
    const measuredHeight = textarea.scrollHeight
    const nextHeight =
      measuredHeight > GRADE_BOX_HEIGHT_PX + 2
        ? measuredHeight
        : GRADE_BOX_HEIGHT_PX
    textarea.style.height = `${nextHeight}px`
  }

  const saveAllGrades = useCallback(async () => {
    if (!selectedStudent || dirtyResponses.length === 0) return
    if (dirtyValidationError) {
      setGradingError(dirtyValidationError)
      return
    }

    setGradingError('')
    setSavingAll(true)
    try {
      const canonicalDraftsByResponseId = new Map<string, GradeDraft>()
      const updatedAnswersByQuestionId = new Map<string, Pick<TestAnswerDetail, 'score' | 'feedback' | 'graded_at'>>()

      for (const item of dirtyResponses) {
        const draft = gradeDrafts[item.responseId]
        const score = parseScore(draft?.score)
        const normalizedFeedback = normalizeFeedback(draft?.feedback)
        if (score.kind === 'invalid') {
          throw new Error(`Q${item.questionNumber}: score must be a valid number`)
        }
        const payload =
          score.kind === 'empty'
            ? { clear_grade: true }
            : item.questionType === 'open_response'
              ? { score: score.value, feedback: normalizedFeedback }
              : { score: score.value }

        const res = await fetch(`${apiBasePath}/${testId}/responses/${item.responseId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to save grades')

        const responseRow = data?.response as
          | { score?: number | null; feedback?: string | null; graded_at?: string | null }
          | undefined
        const savedScore = typeof responseRow?.score === 'number'
          ? responseRow.score
          : score.kind === 'value'
            ? score.value
            : null
        const savedFeedback = typeof responseRow?.feedback === 'string'
          ? responseRow.feedback
          : score.kind === 'empty'
            ? ''
            : item.questionType === 'open_response'
              ? normalizedFeedback
              : ''
        const savedGradedAt = typeof responseRow?.graded_at === 'string'
          ? responseRow.graded_at
          : score.kind === 'empty'
            ? null
            : new Date().toISOString()

        canonicalDraftsByResponseId.set(item.responseId, {
          score: savedScore == null ? '' : String(savedScore),
          feedback: savedFeedback,
        })
        updatedAnswersByQuestionId.set(item.questionId, {
          score: savedScore,
          feedback: item.questionType === 'open_response' ? savedFeedback || null : null,
          graded_at: savedGradedAt,
        })
      }

      if (canonicalDraftsByResponseId.size > 0) {
        setGradeDrafts((prev) => {
          const next = { ...prev }
          for (const [responseId, draft] of canonicalDraftsByResponseId) {
            next[responseId] = draft
          }
          return next
        })
        setPersistedDrafts((prev) => {
          const next = { ...prev }
          for (const [responseId, draft] of canonicalDraftsByResponseId) {
            next[responseId] = draft
          }
          return next
        })
      }

      let rowUpdateDetail: TeacherTestGradingRowUpdatedEventDetail | null = null
      if (updatedAnswersByQuestionId.size > 0 && results) {
        const updatedAnswers: TestAnswersByQuestion = { ...selectedStudent.answers }
        let didUpdate = false
        for (const [questionId, answerUpdate] of updatedAnswersByQuestionId) {
          const current = updatedAnswers[questionId]
          if (!current) continue
          updatedAnswers[questionId] = {
            ...current,
            ...answerUpdate,
          }
          didUpdate = true
        }

        if (didUpdate) {
          const metrics = computeStudentGradingMetrics(selectedStudent.status, results.questions, updatedAnswers)
          rowUpdateDetail = {
            testId,
            studentId: selectedStudent.student_id,
            ...metrics,
          }

          setResults((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              students: prev.students.map((student) => {
                if (student.student_id !== selectedStudent.student_id) return student
                return {
                  ...student,
                  answers: updatedAnswers,
                  points_earned: metrics.pointsEarned,
                  points_possible: metrics.pointsPossible,
                  percent: metrics.percent,
                  graded_open_responses: metrics.gradedOpenResponses,
                  ungraded_open_responses: metrics.ungradedOpenResponses,
                }
              }),
            }
          })
        }
      }

      if (rowUpdateDetail) {
        window.dispatchEvent(
          new CustomEvent<TeacherTestGradingRowUpdatedEventDetail>(
            TEACHER_TEST_GRADING_ROW_UPDATED_EVENT,
            { detail: rowUpdateDetail }
          )
        )
      }
      setHasSavedSuccessfully(true)
    } catch (saveError: any) {
      setGradingError(saveError.message || 'Failed to save grades')
    } finally {
      setSavingAll(false)
    }
  }, [
    apiBasePath,
    dirtyResponses,
    dirtyValidationError,
    gradeDrafts,
    results,
    selectedStudent,
    testId,
  ])

  const flushAutosave = useCallback(() => {
    if (!selectedStudent || savingAll) return
    if (dirtyResponses.length === 0 || dirtyValidationError || gradingError) return
    void saveAllGrades()
  }, [dirtyResponses.length, dirtyValidationError, gradingError, saveAllGrades, savingAll, selectedStudent])

  useEffect(() => {
    if (!selectedStudent || savingAll) return
    if (dirtyResponses.length === 0 || dirtyValidationError || gradingError) return

    const timeoutId = window.setTimeout(() => {
      void saveAllGrades()
    }, AUTOSAVE_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    dirtyResponses,
    dirtyValidationError,
    gradingError,
    saveAllGrades,
    savingAll,
    selectedStudent,
  ])

  useEffect(() => {
    if (!selectedStudent || !results) return
    for (const question of results.questions) {
      if (question.question_type !== 'open_response') continue
      const answer = selectedStudent.answers[question.id]
      if (!answer?.response_id || answer.is_draft) continue
      autoResizeFeedbackTextarea(feedbackTextareaRefs.current[answer.response_id])
    }
  }, [gradeDrafts, results, selectedStudent])

  useEffect(() => {
    onRegisterSaveHandler?.(selectedStudent ? saveAllGrades : null)
    return () => {
      onRegisterSaveHandler?.(null)
    }
  }, [onRegisterSaveHandler, saveAllGrades, selectedStudent])

  useEffect(() => {
    const status: SaveState['status'] = savingAll
      ? 'saving'
      : dirtyResponses.length > 0
        ? 'unsaved'
        : hasSavedSuccessfully
          ? 'saved'
          : 'idle'

    onSaveStateChange?.({
      canSave: !!selectedStudent && dirtyResponses.length > 0 && !dirtyValidationError && !savingAll,
      isSaving: savingAll,
      status,
    })
  }, [
    dirtyResponses.length,
    dirtyValidationError,
    hasSavedSuccessfully,
    onSaveStateChange,
    savingAll,
    selectedStudent,
  ])

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return <div className="p-4 text-sm text-danger">{error}</div>
  }

  if (!results) {
    return <div className="p-4 text-sm text-text-muted">No test data available.</div>
  }

  return (
    <div className="space-y-4 p-4">
      {gradingError && (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-xs text-danger">{gradingError}</p>
      )}
      {dirtyValidationError && (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-xs text-danger">{dirtyValidationError}</p>
      )}
      {!selectedStudent ? (
        <p className="text-sm text-text-muted">Select a student from the grading table to review responses.</p>
      ) : (
        <div className="space-y-4">
          {results.questions.map((question, index) => {
            const answer = selectedStudent.answers[question.id]
            const points = Number(question.points || 0)

            if (question.question_type === 'multiple_choice') {
              const responseId = answer?.response_id || null
              const isGradeEditable = !!responseId && !answer?.is_draft
              const selectedOption =
                typeof answer?.selected_option === 'number' ? answer.selected_option : null
              const selectedText =
                selectedOption != null ? question.options[selectedOption] || '—' : 'No response'
              const correctText =
                typeof question.correct_option === 'number'
                  ? question.options[question.correct_option] || '—'
                  : '—'
              const isIncorrectMultipleChoice =
                selectedOption != null &&
                typeof question.correct_option === 'number' &&
                selectedOption !== question.correct_option

              return (
                <div key={question.id} className="space-y-2 py-1">
                  <p className="inline-flex items-center rounded bg-primary/10 pl-0 pr-2 py-1 text-sm font-bold text-primary">
                    Q{index + 1} MC
                  </p>
                  <QuestionMarkdown content={question.question_text} />
                  <div className="grid grid-cols-[minmax(0,1fr)_76px] items-start gap-2">
                    <div className="space-y-1 text-sm">
                      <div className="rounded-md bg-surface-2 px-3 py-2 text-text-default">
                        <p
                          className={`text-xs font-semibold uppercase tracking-wide ${
                            isIncorrectMultipleChoice ? 'text-warning' : ''
                          }`}
                        >
                          Student answer
                        </p>
                        <p className={`font-medium ${isIncorrectMultipleChoice ? 'text-warning' : ''}`}>
                          {selectedText}
                          {answer?.is_draft ? ' (Draft)' : ''}
                        </p>
                      </div>
                      <div className="rounded-md bg-surface-2 px-3 py-2 text-text-muted">
                        <p className="text-xs font-semibold uppercase tracking-wide">
                          Correct answer
                        </p>
                        <p className="font-medium">{correctText}</p>
                      </div>
                    </div>
                    <SplitScoreInput
                      ariaLabel={`Q${index + 1} score`}
                      maxPoints={points}
                      value={responseId ? (gradeDrafts[responseId]?.score ?? '') : ''}
                      disabled={!isGradeEditable}
                      onChange={(value) => {
                        if (!responseId) return
                        updateDraft(responseId, { score: value })
                      }}
                      onBlur={flushAutosave}
                    />
                  </div>
                  {!answer ? (
                    <p className="text-sm text-text-muted">No response submitted.</p>
                  ) : answer.is_draft || !responseId ? (
                    <p className="text-sm text-warning">
                      Draft response (autosaved, not submitted). Grading unlocks after submission.
                    </p>
                  ) : null}
                </div>
              )
            }

            const responseId = answer?.response_id || null
            const isGradeEditable = !!responseId && !answer?.is_draft

            return (
              <div key={question.id} className="space-y-2 py-1">
                <p className="inline-flex items-center rounded bg-primary/10 pl-0 pr-2 py-1 text-sm font-bold text-primary">
                  Q{index + 1} Open
                </p>
                <QuestionMarkdown content={question.question_text} />
                <p className="whitespace-pre-wrap text-sm text-text-default bg-surface-2 rounded-md px-2 py-2 min-h-[64px]">
                  {answer?.response_text || 'No response'}
                </p>

                {!answer ? (
                  <p className="text-sm text-text-muted">No response submitted.</p>
                ) : answer.is_draft || !responseId ? (
                  <p className="text-sm text-warning">
                    Draft response (autosaved, not submitted). Grading unlocks after submission.
                  </p>
                ) : (
                  <div className="grid gap-2 grid-cols-[minmax(0,1fr)_76px]">
                    <textarea
                      ref={(element) => {
                        feedbackTextareaRefs.current[responseId!] = element
                        autoResizeFeedbackTextarea(element)
                      }}
                      value={gradeDrafts[responseId]?.feedback ?? ''}
                      onChange={(event) =>
                        {
                          updateDraft(responseId!, { feedback: event.target.value })
                          autoResizeFeedbackTextarea(event.currentTarget)
                        }
                      }
                      onBlur={flushAutosave}
                      rows={1}
                      className="h-9 w-full overflow-hidden resize-none rounded-md border border-border bg-surface px-3 py-1 text-base leading-tight text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="Feedback (optional)"
                    />
                    <SplitScoreInput
                      ariaLabel={`Q${index + 1} score`}
                      maxPoints={points}
                      value={gradeDrafts[responseId]?.score ?? ''}
                      onChange={(value) => updateDraft(responseId!, { score: value })}
                      onBlur={flushAutosave}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
