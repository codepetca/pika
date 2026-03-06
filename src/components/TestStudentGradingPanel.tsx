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
  answer_key?: string | null
}

type TestAnswerDetail = {
  response_id: string
  question_type: 'multiple_choice' | 'open_response'
  selected_option: number | null
  response_text: string | null
  score: number | null
  feedback: string | null
  graded_at: string | null
  ai_grading_basis: 'teacher_key' | 'generated_reference' | null
  ai_reference_answers: string[] | null
  ai_model: string | null
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
  ai_grading_basis: 'teacher_key' | 'generated_reference' | null
  ai_reference_answers: string[] | null
  ai_model: string | null
}

interface SaveState {
  canSave: boolean
  isSaving: boolean
}

interface Props {
  testId: string
  selectedStudentId: string | null
  apiBasePath?: string
  onUpdated?: () => void
  onRegisterSaveHandler?: ((handler: (() => Promise<void>) | null) => void)
  onSaveStateChange?: ((state: SaveState) => void)
}

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function toDraftFromAnswer(answer?: TestAnswerDetail): GradeDraft {
  return {
    score: answer?.score != null ? String(answer.score) : '',
    feedback: answer?.feedback || '',
    ai_grading_basis: answer?.ai_grading_basis ?? null,
    ai_reference_answers: Array.isArray(answer?.ai_reference_answers)
      ? answer.ai_reference_answers
      : null,
    ai_model: answer?.ai_model ?? null,
  }
}

function normalizeDraftForComparison(draft: GradeDraft) {
  return {
    score: draft.score.trim(),
    feedback: draft.feedback.trim(),
    ai_grading_basis: draft.ai_grading_basis,
    ai_reference_answers: draft.ai_reference_answers || null,
    ai_model: draft.ai_model,
  }
}

function makeDraftKey(studentId: string, questionId: string): string {
  return `${studentId}:${questionId}`
}

export function TestStudentGradingPanel({
  testId,
  selectedStudentId,
  apiBasePath = '/api/teacher/tests',
  onUpdated,
  onRegisterSaveHandler,
  onSaveStateChange,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [results, setResults] = useState<TestResultsPayload | null>(null)

  const [gradeDrafts, setGradeDrafts] = useState<Record<string, GradeDraft>>({})
  const [savingAll, setSavingAll] = useState(false)
  const [gradingError, setGradingError] = useState('')
  const [gradingMessage, setGradingMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${apiBasePath}/${testId}/results`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load test results')

      const payload = data as TestResultsPayload
      setResults(payload)

      const nextDrafts: Record<string, GradeDraft> = {}
      const openQuestions = (payload.questions || []).filter(
        (question) => question.question_type === 'open_response'
      )

      for (const student of payload.students || []) {
        for (const question of openQuestions) {
          const answer = student.answers[question.id]
          nextDrafts[makeDraftKey(student.student_id, question.id)] = toDraftFromAnswer(answer)
        }
      }

      setGradeDrafts(nextDrafts)
    } catch (loadError: any) {
      setError(loadError.message || 'Failed to load test results')
    } finally {
      setLoading(false)
    }
  }, [apiBasePath, testId])

  useEffect(() => {
    void load()
  }, [load])

  const selectedStudent = useMemo(() => {
    if (!results || !selectedStudentId) return null
    return results.students.find((student) => student.student_id === selectedStudentId) || null
  }, [results, selectedStudentId])

  const openQuestions = useMemo(
    () => (results?.questions || []).filter((question) => question.question_type === 'open_response'),
    [results]
  )

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedStudent) return false

    for (const question of openQuestions) {
      const draftKey = makeDraftKey(selectedStudent.student_id, question.id)
      const draft = gradeDrafts[draftKey] || toDraftFromAnswer(selectedStudent.answers[question.id])
      const baseline = toDraftFromAnswer(selectedStudent.answers[question.id])

      if (
        JSON.stringify(normalizeDraftForComparison(draft)) !==
        JSON.stringify(normalizeDraftForComparison(baseline))
      ) {
        return true
      }
    }

    return false
  }, [gradeDrafts, openQuestions, selectedStudent])

  const canSave = !!selectedStudent && openQuestions.length > 0 && hasUnsavedChanges

  useEffect(() => {
    onSaveStateChange?.({ canSave, isSaving: savingAll })
  }, [canSave, onSaveStateChange, savingAll])

  function updateDraft(questionId: string, updates: Partial<GradeDraft>) {
    if (!selectedStudent) return
    const draftKey = makeDraftKey(selectedStudent.student_id, questionId)

    setGradeDrafts((prev) => {
      const current = prev[draftKey] || toDraftFromAnswer(selectedStudent.answers[questionId])
      const next: GradeDraft = {
        ...current,
        ...updates,
      }

      if (updates.score !== undefined || updates.feedback !== undefined) {
        next.ai_grading_basis = null
        next.ai_reference_answers = null
        next.ai_model = null
      }

      return {
        ...prev,
        [draftKey]: next,
      }
    })
  }

  const handleSaveAll = useCallback(async () => {
    if (!selectedStudent) return

    const changedGrades: Array<{
      question_id: string
      score: number
      feedback: string
      ai_grading_basis: 'teacher_key' | 'generated_reference' | null
      ai_reference_answers: string[] | null
      ai_model: string | null
    }> = []

    for (let index = 0; index < openQuestions.length; index += 1) {
      const question = openQuestions[index]
      const maxPoints = Number(question.points || 0)
      const draftKey = makeDraftKey(selectedStudent.student_id, question.id)
      const draft = gradeDrafts[draftKey] || toDraftFromAnswer(selectedStudent.answers[question.id])
      const baseline = toDraftFromAnswer(selectedStudent.answers[question.id])

      const normalizedDraft = normalizeDraftForComparison(draft)
      const normalizedBaseline = normalizeDraftForComparison(baseline)
      if (JSON.stringify(normalizedDraft) === JSON.stringify(normalizedBaseline)) {
        continue
      }

      const scoreText = draft.score.trim()
      const feedback = draft.feedback.trim()

      if (!scoreText && !feedback) {
        setGradingError(`Q${index + 1}: Score and feedback are required.`)
        return
      }
      if (!scoreText || !feedback) {
        setGradingError(`Q${index + 1}: Score and feedback are required.`)
        return
      }

      const score = Number(scoreText)
      if (!Number.isFinite(score) || score < 0 || score > maxPoints) {
        setGradingError(`Q${index + 1}: Score must be between 0 and ${maxPoints}.`)
        return
      }

      changedGrades.push({
        question_id: question.id,
        score,
        feedback,
        ai_grading_basis: draft.ai_grading_basis,
        ai_reference_answers:
          draft.ai_grading_basis === 'generated_reference'
            ? (draft.ai_reference_answers ?? [])
            : null,
        ai_model: draft.ai_model,
      })
    }

    if (changedGrades.length === 0) {
      setGradingMessage('No grade changes to save.')
      setGradingError('')
      return
    }

    setGradingError('')
    setGradingMessage('')
    setSavingAll(true)

    try {
      const res = await fetch(`${apiBasePath}/${testId}/students/${selectedStudent.student_id}/grades`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grades: changedGrades }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save grades')

      setGradingMessage('Saved.')
      await load()
      onUpdated?.()
    } catch (saveError: any) {
      setGradingError(saveError.message || 'Failed to save grades')
    } finally {
      setSavingAll(false)
    }
  }, [apiBasePath, gradeDrafts, load, onUpdated, openQuestions, selectedStudent, testId])

  useEffect(() => {
    onRegisterSaveHandler?.(selectedStudent ? handleSaveAll : null)
    return () => {
      onRegisterSaveHandler?.(null)
    }
  }, [handleSaveAll, onRegisterSaveHandler, selectedStudent])

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
                    Answer: {selectedText}
                    {awarded != null ? ` · ${formatPoints(awarded)}/${formatPoints(points)}` : ''}
                  </p>
                </div>
              )
            }

            const draftKey = makeDraftKey(selectedStudent.student_id, question.id)
            const draft = gradeDrafts[draftKey] || toDraftFromAnswer(answer)

            return (
              <div key={question.id} className="rounded-md border border-border bg-surface p-3 space-y-2">
                <p className="text-xs font-medium text-text-default">
                  Q{index + 1} · Open response · {points} pts
                </p>
                <QuestionMarkdown content={question.question_text} />
                <p className="whitespace-pre-wrap text-xs text-text-default bg-surface-2 rounded-md px-2 py-1 min-h-[64px]">
                  {answer?.response_text?.trim() ? answer.response_text : 'No response submitted.'}
                </p>

                {answer?.ai_grading_basis === 'teacher_key' ? (
                  <div className="rounded-md border border-border bg-surface-2 px-2 py-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      AI Context: Teacher answer key
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-text-default">
                      {question.answer_key || 'Answer key was used.'}
                    </p>
                    {answer.ai_model ? (
                      <p className="mt-1 text-[11px] text-text-muted">Model: {answer.ai_model}</p>
                    ) : null}
                  </div>
                ) : null}
                {answer?.ai_grading_basis === 'generated_reference' ? (
                  <div className="rounded-md border border-border bg-surface-2 px-2 py-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      AI Context: Generated reference answers
                    </p>
                    <div className="mt-1 space-y-1">
                      {(answer.ai_reference_answers || []).map((reference, referenceIndex) => (
                        <p key={`${question.id}-reference-${referenceIndex}`} className="text-xs text-text-default">
                          {referenceIndex + 1}. {reference}
                        </p>
                      ))}
                    </div>
                    {answer.ai_model ? (
                      <p className="mt-1 text-[11px] text-text-muted">Model: {answer.ai_model}</p>
                    ) : null}
                  </div>
                ) : null}

                <div className="grid gap-2 md:grid-cols-[120px_minmax(0,1fr)]">
                  <Input
                    type="number"
                    min="0"
                    max={String(points)}
                    step="0.25"
                    value={draft.score}
                    onChange={(event) => updateDraft(question.id, { score: event.target.value })}
                    disabled={savingAll}
                  />
                  <textarea
                    value={draft.feedback}
                    onChange={(event) => updateDraft(question.id, { feedback: event.target.value })}
                    rows={3}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Feedback"
                    disabled={savingAll}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
