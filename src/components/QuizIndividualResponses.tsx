'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { Button, Input } from '@/ui'
import type { QuizFocusSummary } from '@/types'

interface QuestionInfo {
  id: string
  question_text: string
  question_type?: 'multiple_choice' | 'open_response'
  points?: number
  correct_option?: number | null
  options: string[]
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

interface Responder {
  student_id: string
  name: string | null
  email: string
  answers: Record<string, number | TestAnswerDetail>
  focus_summary: QuizFocusSummary | null
}

interface Props {
  quizId: string
  apiBasePath?: string
  assessmentType?: 'quiz' | 'test'
  onUpdated?: () => void
}

interface GradeDraft {
  score: string
  feedback: string
}

interface TestStats {
  open_questions_count?: number
  graded_open_responses?: number
  ungraded_open_responses?: number
  grading_finalized?: boolean
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function toTestAnswerDetail(answer: number | TestAnswerDetail | undefined): TestAnswerDetail | null {
  if (!answer || typeof answer === 'number') return null
  return answer
}

export function QuizIndividualResponses({
  quizId,
  apiBasePath = '/api/teacher/quizzes',
  assessmentType = 'quiz',
  onUpdated,
}: Props) {
  const isTestsView = assessmentType === 'test'
  const [responders, setResponders] = useState<Responder[]>([])
  const [questions, setQuestions] = useState<QuestionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null)
  const [stats, setStats] = useState<TestStats | null>(null)
  const [gradeDrafts, setGradeDrafts] = useState<Record<string, GradeDraft>>({})
  const [savingResponseId, setSavingResponseId] = useState<string | null>(null)
  const [suggestingResponseId, setSuggestingResponseId] = useState<string | null>(null)
  const [gradingError, setGradingError] = useState('')
  const [gradingMessage, setGradingMessage] = useState('')
  const [finalizing, setFinalizing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${apiBasePath}/${quizId}/results`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')

      const nextResponders = data.responders || []
      setResponders(nextResponders)
      setQuestions(data.questions || [])
      setStats((data.stats as TestStats | null) || null)

      if (isTestsView) {
        const nextDrafts: Record<string, GradeDraft> = {}
        for (const student of nextResponders as Responder[]) {
          for (const answer of Object.values(student.answers || {})) {
            const detail = toTestAnswerDetail(answer)
            if (!detail || detail.question_type !== 'open_response') continue
            nextDrafts[detail.response_id] = {
              score: detail.score != null ? String(detail.score) : '',
              feedback: detail.feedback || '',
            }
          }
        }
        setGradeDrafts(nextDrafts)
      }
    } catch (loadError: any) {
      setError(loadError.message || 'Failed to load responses')
    } finally {
      setLoading(false)
    }
  }, [apiBasePath, isTestsView, quizId])

  useEffect(() => {
    void load()
  }, [load])

  const questionById = useMemo(
    () => new Map(questions.map((question) => [question.id, question])),
    [questions]
  )

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

  async function handleSuggestGrade(
    responseId: string
  ) {
    setGradingError('')
    setGradingMessage('')
    setSuggestingResponseId(responseId)
    try {
      const res = await fetch(`${apiBasePath}/${quizId}/responses/${responseId}/ai-suggest`, {
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
    }
    finally {
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
      const res = await fetch(`${apiBasePath}/${quizId}/responses/${responseId}`, {
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

  async function handleFinalizeGrading() {
    setFinalizing(true)
    setGradingError('')
    setGradingMessage('')
    try {
      const res = await fetch(`${apiBasePath}/${quizId}/grading/finalize`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to finalize grading')

      setGradingMessage('Grading finalized. Students can now view scored open responses.')
      await load()
      onUpdated?.()
    } catch (finalizeError: any) {
      setGradingError(finalizeError.message || 'Failed to finalize grading')
    } finally {
      setFinalizing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-danger">{error}</p>
  }

  if (responders.length === 0) {
    return <p className="text-sm text-text-muted">No responses yet.</p>
  }

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-text-default">
        Individual Responses ({responders.length})
      </h4>
      {isTestsView && (
        <div className="rounded-md border border-border bg-surface-2 p-3 text-xs text-text-muted space-y-2">
          <p>
            Open responses graded: {stats?.graded_open_responses ?? 0}
            {' / '}
            {(stats?.graded_open_responses ?? 0) + (stats?.ungraded_open_responses ?? 0)}
          </p>
          <div className="flex items-center justify-between gap-2">
            <span>
              {stats?.grading_finalized
                ? 'Grading finalized.'
                : 'Grading not finalized.'}
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={finalizing}
              onClick={handleFinalizeGrading}
            >
              {finalizing ? 'Finalizing...' : 'Finalize Grading'}
            </Button>
          </div>
        </div>
      )}
      {gradingError && (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-xs text-danger">{gradingError}</p>
      )}
      {gradingMessage && (
        <p className="rounded-md bg-success-bg px-3 py-2 text-xs text-success">{gradingMessage}</p>
      )}
      <ul className="space-y-1">
        {responders.map((student) => (
          <li key={student.student_id}>
            <button
              type="button"
              onClick={() =>
                setExpandedStudent(
                  expandedStudent === student.student_id ? null : student.student_id
                )
              }
              className="w-full text-left text-sm text-text-muted hover:text-text-default transition-colors"
            >
              {student.name || student.email.split('@')[0]}
              <span className="ml-1 text-xs">
                {expandedStudent === student.student_id ? '▾' : '▸'}
              </span>
            </button>
            {student.focus_summary && (
              <p className="ml-4 mt-0.5 text-xs text-text-muted">
                Focus events: {student.focus_summary.away_count} · Away time:{' '}
                {formatDuration(student.focus_summary.away_total_seconds)}
                {student.focus_summary.route_exit_attempts > 0
                  ? ` · Exit attempts: ${student.focus_summary.route_exit_attempts}`
                  : ''}
              </p>
            )}
            {expandedStudent === student.student_id && (
              <ul className="ml-4 mt-2 space-y-3">
                {questions.map((q, idx) => {
                  const rawAnswer = student.answers[q.id]
                  const answer = toTestAnswerDetail(rawAnswer)
                  const questionType =
                    q.question_type === 'open_response' ? 'open_response' : 'multiple_choice'
                  const points = Number(q.points ?? 0)

                  if (!isTestsView || questionType === 'multiple_choice') {
                    const selectedIdx =
                      typeof rawAnswer === 'number'
                        ? rawAnswer
                        : typeof answer?.selected_option === 'number'
                          ? answer.selected_option
                          : undefined
                    const selectedText =
                      selectedIdx !== undefined ? q.options[selectedIdx] : '—'
                    const autoScore = typeof answer?.score === 'number' ? answer.score : null
                    return (
                      <li key={q.id} className="text-xs text-text-muted">
                        <p>
                          Q{idx + 1}: {selectedText}
                          {points > 0 && autoScore != null ? ` · ${autoScore}/${points}` : ''}
                        </p>
                      </li>
                    )
                  }

                  if (!answer) {
                    return (
                      <li key={q.id} className="text-xs text-text-muted">
                        <p>Q{idx + 1}: —</p>
                      </li>
                    )
                  }

                  const draft = gradeDrafts[answer.response_id] || { score: '', feedback: '' }
                  return (
                    <li key={q.id} className="rounded-md border border-border bg-surface p-3 space-y-2">
                      <p className="text-xs font-medium text-text-default">
                        Q{idx + 1} · Open response · {points} pts
                      </p>
                      <p className="whitespace-pre-wrap text-xs text-text-default bg-surface-2 rounded-md px-2 py-1">
                        {answer.response_text || '—'}
                      </p>
                      <div className="grid gap-2 md:grid-cols-[120px_minmax(0,1fr)]">
                        <Input
                          type="number"
                          min="0"
                          max={String(points)}
                          step="0.25"
                          value={draft.score}
                          onChange={(event) => updateDraft(answer.response_id, { score: event.target.value })}
                        />
                        <textarea
                          value={draft.feedback}
                          onChange={(event) => updateDraft(answer.response_id, { feedback: event.target.value })}
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
                    </li>
                  )
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
