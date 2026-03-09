'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Input } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import type { QuizFocusSummary } from '@/types'

interface TestQuestionInfo {
  id: string
  question_text: string
  question_type: 'multiple_choice' | 'open_response'
  options: string[]
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
  answers: Record<string, TestAnswerDetail>
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

interface SaveState {
  canSave: boolean
  isSaving: boolean
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

interface Props {
  testId: string
  selectedStudentId: string | null
  apiBasePath?: string
  refreshToken?: number
  onUpdated?: () => void
  onRegisterSaveHandler?: ((handler: (() => Promise<void>) | null) => void)
  onSaveStateChange?: ((state: SaveState) => void)
}

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

export function TestStudentGradingPanel({
  testId,
  selectedStudentId,
  apiBasePath = '/api/teacher/tests',
  refreshToken = 0,
  onUpdated,
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
  const [gradingMessage, setGradingMessage] = useState('')

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
          if (answer.question_type !== 'open_response' || answer.is_draft || !answer.response_id) continue
          nextDrafts[answer.response_id] = {
            score: answer.score != null ? String(answer.score) : '',
            feedback: answer.feedback || '',
          }
        }
      }
      setGradeDrafts(nextDrafts)
      setPersistedDrafts(nextDrafts)
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

  const selectedOpenResponses = useMemo(() => {
    if (!selectedStudent || !results) return [] as Array<{
      responseId: string
      maxPoints: number
      questionNumber: number
    }>

    return results.questions.flatMap((question, index) => {
      if (question.question_type !== 'open_response') return []
      const answer = selectedStudent.answers[question.id]
      if (!answer || answer.is_draft || !answer.response_id) return []

      return [{
        responseId: answer.response_id,
        maxPoints: Number(question.points || 0),
        questionNumber: index + 1,
      }]
    })
  }, [results, selectedStudent])

  const dirtyResponses = useMemo(() => {
    return selectedOpenResponses.filter((item) =>
      !areDraftsEqual(gradeDrafts[item.responseId], persistedDrafts[item.responseId])
    )
  }, [gradeDrafts, persistedDrafts, selectedOpenResponses])

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
      if (score.kind === 'empty' && feedback.length > 0) {
        return `Q${item.questionNumber}: enter a score or clear feedback`
      }
    }
    return ''
  }, [dirtyResponses, gradeDrafts])

  function updateDraft(responseId: string, updates: Partial<GradeDraft>) {
    setGradeDrafts((prev) => ({
      ...prev,
      [responseId]: {
        score: prev[responseId]?.score ?? '',
        feedback: prev[responseId]?.feedback ?? '',
        ...updates,
      },
    }))
  }

  const saveAllGrades = useCallback(async () => {
    if (!selectedStudent || dirtyResponses.length === 0) return
    if (dirtyValidationError) {
      setGradingError(dirtyValidationError)
      return
    }

    setGradingError('')
    setGradingMessage('')
    setSavingAll(true)
    try {
      for (const item of dirtyResponses) {
        const draft = gradeDrafts[item.responseId]
        const score = parseScore(draft?.score)
        const feedback = normalizeFeedback(draft?.feedback)
        if (score.kind === 'invalid') {
          throw new Error(`Q${item.questionNumber}: score must be a valid number`)
        }
        const payload =
          score.kind === 'empty'
            ? { clear_grade: true }
            : { score: score.value, feedback }

        const res = await fetch(`${apiBasePath}/${testId}/responses/${item.responseId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to save grades')
      }

      setGradingMessage(
        `Saved ${dirtyResponses.length} change${dirtyResponses.length === 1 ? '' : 's'}.`
      )
      await load()
      onUpdated?.()
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
    load,
    onUpdated,
    selectedStudent,
    testId,
  ])

  useEffect(() => {
    onRegisterSaveHandler?.(selectedStudent ? saveAllGrades : null)
    return () => {
      onRegisterSaveHandler?.(null)
    }
  }, [onRegisterSaveHandler, saveAllGrades, selectedStudent])

  useEffect(() => {
    onSaveStateChange?.({
      canSave: !!selectedStudent && dirtyResponses.length > 0 && !dirtyValidationError && !savingAll,
      isSaving: savingAll,
    })
  }, [dirtyResponses.length, dirtyValidationError, onSaveStateChange, savingAll, selectedStudent])

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
      {gradingMessage && (
        <p className="rounded-md bg-success-bg px-3 py-2 text-xs text-success">{gradingMessage}</p>
      )}
      {dirtyValidationError && (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-xs text-danger">{dirtyValidationError}</p>
      )}
      {!dirtyValidationError && dirtyResponses.length > 0 && (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-text-muted">
          {dirtyResponses.length} unsaved change{dirtyResponses.length === 1 ? '' : 's'}. Use Save in the header.
        </p>
      )}

      {!selectedStudent ? (
        <p className="text-sm text-text-muted">Select a student from the grading table to review responses.</p>
      ) : (
        <div className="space-y-4">
          {results.questions.map((question, index) => {
            const answer = selectedStudent.answers[question.id]
            const points = Number(question.points || 0)

            if (question.question_type === 'multiple_choice') {
              const selectedText =
                typeof answer?.selected_option === 'number'
                  ? question.options[answer.selected_option] || '—'
                  : '—'
              const awarded = typeof answer?.score === 'number' ? answer.score : null

              return (
                <div key={question.id} className="rounded-md border border-border bg-surface p-3">
                  <p className="text-xs font-medium text-text-default">
                    Q{index + 1} · Multiple choice · {points} pts
                  </p>
                  <QuestionMarkdown content={question.question_text} className="mt-1" />
                  <p className="mt-2 text-xs text-text-muted">
                    Answer: {selectedText}{answer?.is_draft ? ' (Draft)' : ''}
                    {awarded != null ? ` · ${formatPoints(awarded)}/${formatPoints(points)}` : ''}
                  </p>
                </div>
              )
            }

            return (
              <div key={question.id} className="rounded-md border border-border bg-surface p-3 space-y-2">
                <p className="text-xs font-medium text-text-default">
                  Q{index + 1} · Open response · {points} pts
                </p>
                <QuestionMarkdown content={question.question_text} />
                <p className="whitespace-pre-wrap text-xs text-text-default bg-surface-2 rounded-md px-2 py-1 min-h-[64px]">
                  {answer?.response_text || 'No response'}
                </p>

                {!answer ? (
                  <p className="text-xs text-text-muted">No response submitted.</p>
                ) : answer.is_draft || !answer.response_id ? (
                  <p className="text-xs text-warning">
                    Draft response (autosaved, not submitted). Grading unlocks after submission.
                  </p>
                ) : (
                  <>
                    <div className="grid gap-2 md:grid-cols-[120px_minmax(0,1fr)]">
                      <Input
                        type="number"
                        min="0"
                        max={String(points)}
                        step="0.25"
                        value={gradeDrafts[answer.response_id]?.score ?? ''}
                        onChange={(event) =>
                          updateDraft(answer.response_id!, { score: event.target.value })
                        }
                      />
                      <textarea
                        value={gradeDrafts[answer.response_id]?.feedback ?? ''}
                        onChange={(event) =>
                          updateDraft(answer.response_id!, { feedback: event.target.value })
                        }
                        rows={3}
                        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="Feedback (optional)"
                      />
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
