'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { getTestExitCount } from '@/lib/tests'
import { Button, Input } from '@/ui'
import type { TestFocusSummary } from '@/types'
import type { TestQuestionGradingSnapshot } from '@/lib/test-grading-context'
import type { TestGradingProvenance } from '@/lib/grading/contracts'

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
  response_revision: number
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
  focus_summary: TestFocusSummary | null
}

interface Props {
  testId?: string
  quizId?: string
  apiBasePath?: string
  assessmentType?: 'quiz' | 'test'
  onUpdated?: () => void
}

interface GradeDraft {
  score: string
  feedback: string
  aiGradingBasis?: 'teacher_key' | 'generated_reference'
  aiReferenceAnswers?: string[]
  aiModel?: string
  questionGradingSnapshot?: TestQuestionGradingSnapshot
  aiProvenanceToken?: string
  aiSuggestedScore?: number
  aiSuggestedFeedback?: string
  aiGradingProvenance?: TestGradingProvenance
}

interface TestStats {
  open_questions_count?: number
  graded_open_responses?: number
  ungraded_open_responses?: number
}

interface ResponsesDataState {
  scope: string
  responders: Responder[]
  questions: QuestionInfo[]
  stats: TestStats | null
}

interface ScopedMessageState {
  scope: string
  message: string
}

const EMPTY_RESPONDERS: Responder[] = []
const EMPTY_QUESTIONS: QuestionInfo[] = []

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

export function TestIndividualResponses({
  testId: testIdProp,
  quizId,
  apiBasePath = '/api/teacher/tests',
  assessmentType = 'test',
  onUpdated,
}: Props) {
  const resolvedTestId = testIdProp ?? quizId
  if (!resolvedTestId) {
    throw new Error('TestIndividualResponses requires testId')
  }
  const testId: string = resolvedTestId

  const isTestsView = assessmentType === 'test'
  const scope = `${assessmentType}:${apiBasePath}:${testId}`
  const [dataState, setDataState] = useState<ResponsesDataState | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorState, setErrorState] = useState<ScopedMessageState | null>(null)
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null)
  const [gradeDrafts, setGradeDrafts] = useState<Record<string, GradeDraft>>({})
  const [savingResponseId, setSavingResponseId] = useState<string | null>(null)
  const [suggestingResponseId, setSuggestingResponseId] = useState<string | null>(null)
  const [gradingErrorState, setGradingErrorState] = useState<ScopedMessageState | null>(null)
  const [gradingMessageState, setGradingMessageState] = useState<ScopedMessageState | null>(null)
  const loadRequestIdRef = useRef(0)
  const gradeDraftsRef = useRef<Record<string, GradeDraft>>({})
  const currentScopeRef = useRef(scope)
  currentScopeRef.current = scope

  const activeData = dataState?.scope === scope ? dataState : null
  const responders = activeData?.responders ?? EMPTY_RESPONDERS
  const questions = activeData?.questions ?? EMPTY_QUESTIONS
  const stats = activeData?.stats ?? null
  const error = errorState?.scope === scope ? errorState.message : ''
  const gradingError = gradingErrorState?.scope === scope ? gradingErrorState.message : ''
  const gradingMessage = gradingMessageState?.scope === scope ? gradingMessageState.message : ''

  const load = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    const requestedScope = scope
    if (currentScopeRef.current !== requestedScope) return
    setLoading(true)
    setErrorState(null)
    try {
      // Bypass fetchJSONWithCache for selected assessment responses freshness; request ids guard stale responses.
      const res = await fetch(`${apiBasePath}/${testId}/results`)
      const data = await res.json()
      if (loadRequestIdRef.current !== requestId || currentScopeRef.current !== requestedScope) return
      if (!res.ok) throw new Error(data.error || 'Failed to load')

      const nextResponders = data.responders || []
      setDataState({
        scope: requestedScope,
        responders: nextResponders,
        questions: data.questions || [],
        stats: (data.stats as TestStats | null) || null,
      })

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
        gradeDraftsRef.current = nextDrafts
        setGradeDrafts(nextDrafts)
      } else {
        gradeDraftsRef.current = {}
        setGradeDrafts({})
      }
    } catch (loadError: any) {
      if (loadRequestIdRef.current === requestId && currentScopeRef.current === requestedScope) {
        setErrorState({
          scope: requestedScope,
          message: loadError.message || 'Failed to load responses',
        })
      }
    } finally {
      if (loadRequestIdRef.current === requestId && currentScopeRef.current === requestedScope) {
        setLoading(false)
      }
    }
  }, [apiBasePath, isTestsView, testId, scope])

  useEffect(() => {
    void load()
  }, [load])

  const questionById = useMemo(
    () => new Map(questions.map((question) => [question.id, question])),
    [questions]
  )

  function updateDraft(responseId: string, updates: Partial<GradeDraft>) {
    const nextDrafts = {
      ...gradeDraftsRef.current,
      [responseId]: {
        score: gradeDraftsRef.current[responseId]?.score ?? '',
        feedback: gradeDraftsRef.current[responseId]?.feedback ?? '',
        ...updates,
      },
    }
    gradeDraftsRef.current = nextDrafts
    setGradeDrafts(nextDrafts)
  }

  async function handleSuggestGrade(
    responseId: string
  ) {
    const operationScope = scope
    setGradingErrorState(null)
    setGradingMessageState(null)
    setSuggestingResponseId(responseId)
    try {
      const res = await fetch(`${apiBasePath}/${testId}/responses/${responseId}/ai-suggest`, {
        method: 'POST',
      })
      const data = await res.json()
      if (currentScopeRef.current !== operationScope) return
      if (!res.ok) throw new Error(data.error || 'Failed to generate AI suggestion')

      updateDraft(responseId, {
        score: data.suggestion?.score != null ? String(data.suggestion.score) : '',
        feedback: data.suggestion?.feedback || '',
        aiGradingBasis: data.suggestion?.grading_basis,
        aiReferenceAnswers:
          data.suggestion?.grading_basis === 'generated_reference'
            ? data.suggestion?.reference_answers
            : undefined,
        aiModel: data.suggestion?.model,
        questionGradingSnapshot: data.question_grading_snapshot,
        aiProvenanceToken: data.ai_provenance_token,
        aiSuggestedScore: data.suggestion?.score,
        aiSuggestedFeedback: data.suggestion?.feedback,
        aiGradingProvenance: data.suggestion?.provenance,
      })
      setGradingMessageState({
        scope: operationScope,
        message: 'AI suggestion loaded. Review before saving.',
      })
    } catch (suggestError: any) {
      if (currentScopeRef.current === operationScope) {
        setGradingErrorState({
          scope: operationScope,
          message: suggestError.message || 'Failed to generate AI suggestion',
        })
      }
    }
    finally {
      if (currentScopeRef.current === operationScope) {
        setSuggestingResponseId(null)
      }
    }
  }

  async function handleSaveGrade(responseId: string, maxPoints: number) {
    const operationScope = scope
    const draft = gradeDrafts[responseId]
    if (!draft) return
    const response = responders
      .flatMap((student) => Object.values(student.answers || {}))
      .map(toTestAnswerDetail)
      .find((answer) => answer?.response_id === responseId)
    if (!response || !Number.isSafeInteger(response.response_revision) || response.response_revision < 1) {
      setGradingErrorState({ scope: operationScope, message: 'Response revision is unavailable' })
      return
    }

    const score = Number(draft.score)
    if (!Number.isFinite(score) || score < 0 || score > maxPoints) {
      setGradingErrorState({
        scope: operationScope,
        message: `Score must be between 0 and ${maxPoints}`,
      })
      return
    }

    setGradingErrorState(null)
    setGradingMessageState(null)
    setSavingResponseId(responseId)
    try {
      const res = await fetch(`${apiBasePath}/${testId}/responses/${responseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response_id: responseId,
          expected_response_revision: response.response_revision,
          score,
          feedback: draft.feedback.trim(),
          ...(draft.aiGradingBasis
            ? {
                ai_grading_basis: draft.aiGradingBasis,
                ai_reference_answers:
                  draft.aiGradingBasis === 'generated_reference'
                    ? draft.aiReferenceAnswers
                    : null,
                ai_model: draft.aiModel,
                question_grading_snapshot: draft.questionGradingSnapshot,
                ai_provenance_token: draft.aiProvenanceToken,
                ai_suggested_score: draft.aiSuggestedScore,
                ai_suggested_feedback: draft.aiSuggestedFeedback,
                ai_grading_provenance: draft.aiGradingProvenance,
              }
            : {}),
        }),
      })
      const data = await res.json()
      if (currentScopeRef.current !== operationScope) return
      if (res.status === 409) {
        const latestDraft = gradeDraftsRef.current[responseId] ?? draft
        const hadAiProvenance = Boolean(draft.aiGradingBasis || latestDraft.aiGradingBasis)
        await load()
        if (currentScopeRef.current !== operationScope) return
        const nextDrafts = {
          ...gradeDraftsRef.current,
          [responseId]: {
            score: latestDraft.score,
            feedback: latestDraft.feedback,
          },
        }
        gradeDraftsRef.current = nextDrafts
        setGradeDrafts(nextDrafts)
        setGradingErrorState({
          scope: operationScope,
          message: hadAiProvenance
            ? 'Grade changed elsewhere. Your draft was preserved, but the AI suggestion must be regenerated or saved as a manual grade.'
            : 'Grade changed elsewhere. The latest version was loaded and your draft was preserved; review and save again.',
        })
        return
      }
      if (!res.ok) throw new Error(data.error || 'Failed to save grade')

      setGradingMessageState({ scope: operationScope, message: 'Grade saved.' })
      await load()
      if (currentScopeRef.current === operationScope) {
        onUpdated?.()
      }
    } catch (saveError: any) {
      if (currentScopeRef.current === operationScope) {
        setGradingErrorState({
          scope: operationScope,
          message: saveError.message || 'Failed to save grade',
        })
      }
    } finally {
      if (currentScopeRef.current === operationScope) {
        setSavingResponseId(null)
      }
    }
  }

  async function handleClearGrade(responseId: string) {
    const operationScope = scope
    const response = responders
      .flatMap((student) => Object.values(student.answers || {}))
      .map(toTestAnswerDetail)
      .find((answer) => answer?.response_id === responseId)
    if (!response || !Number.isSafeInteger(response.response_revision) || response.response_revision < 1) {
      setGradingErrorState({ scope: operationScope, message: 'Response revision is unavailable' })
      return
    }
    setGradingErrorState(null)
    setGradingMessageState(null)
    setSavingResponseId(responseId)
    try {
      const res = await fetch(`${apiBasePath}/${testId}/responses/${responseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response_id: responseId,
          expected_response_revision: response.response_revision,
          clear_grade: true,
        }),
      })
      const data = await res.json()
      if (currentScopeRef.current !== operationScope) return
      if (res.status === 409) {
        await load()
        if (currentScopeRef.current !== operationScope) return
        setGradingErrorState({
          scope: operationScope,
          message: 'Grade changed elsewhere. The latest version was loaded; try clearing again.',
        })
        return
      }
      if (!res.ok) throw new Error(data.error || 'Failed to clear grade')

      setGradingMessageState({ scope: operationScope, message: 'Grade cleared.' })
      await load()
      if (currentScopeRef.current === operationScope) {
        onUpdated?.()
      }
    } catch (clearError: any) {
      if (currentScopeRef.current === operationScope) {
        setGradingErrorState({
          scope: operationScope,
          message: clearError.message || 'Failed to clear grade',
        })
      }
    } finally {
      if (currentScopeRef.current === operationScope) {
        setSavingResponseId(null)
      }
    }
  }

  if (loading || (!activeData && !error)) {
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
                Exits: {getTestExitCount(student.focus_summary)} · Away time:{' '}
                {formatDuration(student.focus_summary.away_total_seconds)}
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
                          placeholder="Comment (optional)"
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
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={savingResponseId === answer.response_id}
                          onClick={() => handleClearGrade(answer.response_id)}
                        >
                          {savingResponseId === answer.response_id ? 'Saving...' : 'Clear'}
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
