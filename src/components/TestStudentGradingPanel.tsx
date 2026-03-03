'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input } from '@/ui'
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
  response_id: string
  question_type: 'multiple_choice' | 'open_response'
  selected_option: number | null
  response_text: string | null
  score: number | null
  feedback: string | null
  graded_at: string | null
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

interface Props {
  testId: string
  selectedStudentId: string | null
  apiBasePath?: string
  onUpdated?: () => void
}

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

export function TestStudentGradingPanel({
  testId,
  selectedStudentId,
  apiBasePath = '/api/teacher/tests',
  onUpdated,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [results, setResults] = useState<TestResultsPayload | null>(null)

  const [gradeDrafts, setGradeDrafts] = useState<Record<string, GradeDraft>>({})
  const [savingResponseId, setSavingResponseId] = useState<string | null>(null)
  const [suggestingResponseId, setSuggestingResponseId] = useState<string | null>(null)
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
      for (const student of payload.students || []) {
        for (const answer of Object.values(student.answers || {})) {
          if (answer.question_type !== 'open_response') continue
          nextDrafts[answer.response_id] = {
            score: answer.score != null ? String(answer.score) : '',
            feedback: answer.feedback || '',
          }
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

  async function handleSuggestGrade(responseId: string) {
    setGradingError('')
    setGradingMessage('')
    setSuggestingResponseId(responseId)
    try {
      const res = await fetch(`${apiBasePath}/${testId}/responses/${responseId}/ai-suggest`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to generate AI suggestion')

      updateDraft(responseId, {
        score: data.suggestion?.score != null ? String(data.suggestion.score) : '',
        feedback: data.suggestion?.feedback || '',
      })
      setGradingMessage('AI suggestion loaded. Review before saving.')
    } catch (suggestError: any) {
      setGradingError(suggestError.message || 'Failed to generate AI suggestion')
    } finally {
      setSuggestingResponseId(null)
    }
  }

  async function handleSaveGrade(responseId: string, maxPoints: number) {
    const draft = gradeDrafts[responseId]
    if (!draft) return

    const score = Number(draft.score)
    if (!Number.isFinite(score) || score < 0 || score > maxPoints) {
      setGradingError(`Score must be between 0 and ${maxPoints}`)
      return
    }
    if (!draft.feedback.trim()) {
      setGradingError('Feedback is required')
      return
    }

    setGradingError('')
    setGradingMessage('')
    setSavingResponseId(responseId)
    try {
      const res = await fetch(`${apiBasePath}/${testId}/responses/${responseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score,
          feedback: draft.feedback.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save grade')

      setGradingMessage('Grade saved.')
      await load()
      onUpdated?.()
    } catch (saveError: any) {
      setGradingError(saveError.message || 'Failed to save grade')
    } finally {
      setSavingResponseId(null)
    }
  }

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
                          updateDraft(answer.response_id, { score: event.target.value })
                        }
                      />
                      <textarea
                        value={gradeDrafts[answer.response_id]?.feedback ?? ''}
                        onChange={(event) =>
                          updateDraft(answer.response_id, { feedback: event.target.value })
                        }
                        rows={3}
                        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-default focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="Feedback"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={suggestingResponseId === answer.response_id}
                        onClick={() => handleSuggestGrade(answer.response_id)}
                      >
                        {suggestingResponseId === answer.response_id ? 'Suggesting...' : 'AI Suggest'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        disabled={savingResponseId === answer.response_id}
                        onClick={() => handleSaveGrade(answer.response_id, points)}
                      >
                        {savingResponseId === answer.response_id ? 'Saving...' : 'Save Grade'}
                      </Button>
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
