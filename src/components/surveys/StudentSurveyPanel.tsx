'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { ExternalLink, Pencil } from 'lucide-react'
import { Button, Card, Input } from '@/ui'
import { FloatingActionCluster } from '@/components/FloatingActionCluster'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import { Spinner } from '@/components/Spinner'
import { SurveyOptionResultBar } from '@/components/surveys/SurveyOptionResultBar'
import { canStudentRespondToSurvey, canStudentViewSurveyResults } from '@/lib/surveys'
import type {
  StudentSurveyStatus,
  Survey,
  SurveyQuestion,
  SurveyQuestionResult,
  SurveyTextResponseResult,
  SurveyResponseValue,
} from '@/types'

interface StudentSurveyPanelProps {
  surveyId: string
  onCompleted?: () => void
}

type SurveyDetailPayload = {
  survey: Survey & { student_status: StudentSurveyStatus }
  questions: SurveyQuestion[]
  student_responses: Record<string, SurveyResponseValue>
  student_status: StudentSurveyStatus
  has_submitted?: boolean
}

type StudentSurveyQuestionResult = Omit<SurveyQuestionResult, 'responses'> & {
  responses: Array<Omit<SurveyTextResponseResult, 'student_id' | 'name' | 'email'>>
}

type SurveyResultsPayload = {
  results: StudentSurveyQuestionResult[]
}

function selectedOptionFromResponse(response: SurveyResponseValue | undefined): number | null {
  return response?.question_type === 'multiple_choice' ? response.selected_option : null
}

function textFromResponse(response: SurveyResponseValue | undefined): string {
  return response && response.question_type !== 'multiple_choice' ? response.response_text : ''
}

function StudentSurveyResults({ payload }: { payload: SurveyResultsPayload | null }) {
  if (!payload) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    )
  }

  if (payload.results.length === 0) {
    return <p className="text-sm text-text-muted">No class results yet.</p>
  }

  return (
    <div className="space-y-5">
      {payload.results.map((result, index) => (
        <div key={result.question_id} className="space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Q{index + 1}</p>
            <QuestionMarkdown content={result.question_text} />
          </div>
          {result.question_type === 'multiple_choice' ? (
            <div className="space-y-1.5">
              {result.options.map((option, optionIndex) => {
                const count = result.counts[optionIndex] || 0
                return (
                  <SurveyOptionResultBar
                    key={optionIndex}
                    option={option}
                    count={count}
                    totalResponses={result.total_responses}
                  />
                )
              })}
            </div>
          ) : result.responses.length === 0 ? (
            <p className="text-sm text-text-muted">No responses yet.</p>
          ) : (
            <div className="space-y-2">
              {result.responses.map((response) => (
                <div key={response.response_id} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                  {result.question_type === 'link' ? (
                    <a
                      href={response.response_text}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-full items-center gap-1 text-primary hover:underline"
                    >
                      <span className="truncate">{response.response_text}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    </a>
                  ) : (
                    <p className="whitespace-pre-wrap text-text-default">{response.response_text}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function formatSurveyDueLabel(dueAt: string | null | undefined) {
  if (!dueAt) return null
  return formatInTimeZone(new Date(dueAt), 'America/Toronto', "EEE MMM d, h:mm a")
}

export function StudentSurveyPanel({
  surveyId,
  onCompleted,
}: StudentSurveyPanelProps) {
  const [detail, setDetail] = useState<SurveyDetailPayload | null>(null)
  const [responses, setResponses] = useState<Record<string, SurveyResponseValue>>({})
  const [resultsState, setResultsState] = useState<{ surveyId: string; payload: SurveyResultsPayload } | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [isEditingResponse, setIsEditingResponse] = useState(false)
  const [error, setError] = useState('')
  const detailRequestIdRef = useRef(0)
  const resultsRequestIdRef = useRef(0)
  const currentSurveyIdRef = useRef(surveyId)
  currentSurveyIdRef.current = surveyId
  const activeDetail = detail?.survey?.id === surveyId ? detail : null
  const results = resultsState?.surveyId === surveyId ? resultsState.payload : null

  const loadSurvey = useCallback(async () => {
    const requestId = detailRequestIdRef.current + 1
    detailRequestIdRef.current = requestId
    const requestedSurveyId = surveyId
    setLoading(true)
    setError('')
    setResultsState(null)
    try {
      // Bypass fetchJSONWithCache for selected survey freshness; request ids guard stale responses.
      const response = await fetch(`/api/student/surveys/${surveyId}`)
      const data = await response.json()
      if (detailRequestIdRef.current !== requestId || currentSurveyIdRef.current !== requestedSurveyId) return
      if (!response.ok) throw new Error(data.error || 'Failed to load survey')
      setDetail(data)
      setResponses(data.student_responses || {})
    } catch (err) {
      if (detailRequestIdRef.current === requestId && currentSurveyIdRef.current === requestedSurveyId) {
        setError(err instanceof Error ? err.message : 'Failed to load survey')
        setDetail(null)
      }
    } finally {
      if (detailRequestIdRef.current === requestId && currentSurveyIdRef.current === requestedSurveyId) {
        setLoading(false)
      }
    }
  }, [surveyId])

  const loadResults = useCallback(async () => {
    const requestId = resultsRequestIdRef.current + 1
    resultsRequestIdRef.current = requestId
    const requestedSurveyId = surveyId
    setResultsState(null)
    try {
      // Bypass fetchJSONWithCache for selected survey results freshness; request ids guard stale responses.
      const response = await fetch(`/api/student/surveys/${surveyId}/results`)
      const data = await response.json()
      if (resultsRequestIdRef.current !== requestId || currentSurveyIdRef.current !== requestedSurveyId) return
      if (!response.ok) throw new Error(data.error || 'Failed to load results')
      setResultsState({ surveyId: requestedSurveyId, payload: data })
    } catch {
      if (resultsRequestIdRef.current === requestId && currentSurveyIdRef.current === requestedSurveyId) {
        setResultsState(null)
      }
    }
  }, [surveyId])

  useEffect(() => {
    void loadSurvey()
  }, [loadSurvey])

  useEffect(() => {
    if (activeDetail?.survey && canStudentViewSurveyResults(activeDetail.survey)) {
      void loadResults()
    } else {
      setResultsState(null)
    }
  }, [activeDetail?.survey, loadResults])

  useEffect(() => {
    const survey = activeDetail?.survey
    if (!survey) return
    setIsEditingResponse(!canStudentViewSurveyResults(survey))
  }, [activeDetail?.survey])

  const canRespond = useMemo(() => {
    if (!activeDetail) return false
    const hasSubmitted = activeDetail.has_submitted ?? Object.keys(activeDetail.student_responses || {}).length > 0
    return canStudentRespondToSurvey(activeDetail.survey, hasSubmitted)
  }, [activeDetail])

  const allAnswered = useMemo(() => {
    if (!activeDetail) return false
    return activeDetail.questions.every((question) => {
      const response = responses[question.id]
      if (!response) return false
      if (question.question_type === 'multiple_choice') {
        return response.question_type === 'multiple_choice'
      }
      return response.question_type !== 'multiple_choice' && response.response_text.trim().length > 0
    })
  }, [activeDetail, responses])

  async function submitResponses() {
    if (!activeDetail) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/student/surveys/${surveyId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to submit responses')
      onCompleted?.()
      await loadSurvey()
      if (canStudentViewSurveyResults(activeDetail.survey)) await loadResults()
      if (canStudentViewSurveyResults(activeDetail.survey)) setIsEditingResponse(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit responses')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || (detail !== null && !activeDetail)) {
    return (
      <Card tone="panel" padding="lg">
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      </Card>
    )
  }

  if (!activeDetail) {
    return (
      <Card tone="panel" padding="lg">
        <p className="text-sm text-danger">{error || 'Survey unavailable'}</p>
      </Card>
    )
  }

  const { survey, questions } = activeDetail
  const hasSubmitted = activeDetail.has_submitted ?? Object.keys(activeDetail.student_responses || {}).length > 0
  const canViewResults = canStudentViewSurveyResults(survey)
  const dueLabel = formatSurveyDueLabel(survey.due_at)
  const showResponseForm = isEditingResponse || !canViewResults
  const showResults = canViewResults
  const surveyActionFab = canViewResults && canRespond ? (
    <FloatingActionCluster>
      <Button
        type="button"
        size="sm"
        variant={isEditingResponse ? 'subtle' : 'primary'}
        onClick={() => setIsEditingResponse((current) => !current)}
      >
        <Pencil className="mr-1 h-4 w-4" aria-hidden="true" />
        {isEditingResponse ? 'View results' : hasSubmitted ? 'Edit response' : 'Respond'}
      </Button>
    </FloatingActionCluster>
  ) : null

  return (
    <div className={['space-y-4', surveyActionFab ? 'pt-8' : ''].filter(Boolean).join(' ')}>
      {surveyActionFab}

      {showResponseForm ? (
        <Card tone="panel" padding="lg" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-text-default">{survey.title}</h2>
              <p className="mt-1 text-sm text-text-muted">
                {dueLabel ? `Due ${dueLabel}` : 'Survey'}
              </p>
            </div>
            {hasSubmitted && (
              <span className="rounded-badge bg-success-bg px-2.5 py-1 text-xs font-semibold text-success">
                Submitted
              </span>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <div className="space-y-5">
            {questions.map((question, index) => {
              const selectedOption = selectedOptionFromResponse(responses[question.id])
              const textValue = textFromResponse(responses[question.id])
              return (
                <div key={question.id} className="space-y-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Q{index + 1}</p>
                    <QuestionMarkdown content={question.question_text} />
                  </div>

                  {question.question_type === 'multiple_choice' ? (
                    <div className="space-y-2">
                      {question.options.map((option, optionIndex) => {
                        const isSelected = selectedOption === optionIndex
                        return (
                          <button
                            key={optionIndex}
                            type="button"
                            disabled={!canRespond || submitting}
                            onClick={() => {
                              setResponses((current) => ({
                                ...current,
                                [question.id]: {
                                  question_type: 'multiple_choice',
                                  selected_option: optionIndex,
                                },
                              }))
                            }}
                            className={[
                              'flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors',
                              isSelected
                                ? 'border-primary bg-primary/5 text-text-default'
                                : 'border-border bg-surface hover:bg-surface-hover text-text-default',
                              !canRespond ? 'cursor-not-allowed opacity-70' : '',
                            ].join(' ')}
                          >
                            <span
                              aria-hidden="true"
                              className={[
                                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                                isSelected ? 'border-primary' : 'border-border',
                              ].join(' ')}
                            >
                              {isSelected && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                            </span>
                            <span>{option}</span>
                          </button>
                        )
                      })}
                    </div>
                  ) : question.question_type === 'link' ? (
                    <Input
                      type="url"
                      aria-label={`${question.question_text} response`}
                      value={textValue}
                      onChange={(event) =>
                        setResponses((current) => ({
                          ...current,
                          [question.id]: {
                            question_type: 'link',
                            response_text: event.target.value,
                          },
                        }))
                      }
                      disabled={!canRespond || submitting}
                      placeholder="https://example.com"
                    />
                  ) : (
                    <textarea
                      aria-label={`${question.question_text} response`}
                      value={textValue}
                      onChange={(event) =>
                        setResponses((current) => ({
                          ...current,
                          [question.id]: {
                            question_type: 'short_text',
                            response_text: event.target.value,
                          },
                        }))
                      }
                      rows={4}
                      maxLength={question.response_max_chars}
                      disabled={!canRespond || submitting}
                      className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-surface-2"
                      placeholder="Write your response..."
                    />
                  )}
                </div>
              )
            })}
          </div>

          {canRespond ? (
            <div className="flex justify-end border-t border-border pt-4">
              <Button onClick={submitResponses} disabled={!allAnswered || submitting}>
                {submitting ? 'Saving...' : hasSubmitted ? 'Update responses' : 'Submit'}
              </Button>
            </div>
          ) : hasSubmitted ? (
            <p className="border-t border-border pt-4 text-sm text-text-muted">
              {survey.dynamic_responses && survey.status === 'closed'
                ? 'This survey is closed.'
                : 'Your response is locked.'}
            </p>
          ) : canViewResults ? (
            <p className="border-t border-border pt-4 text-sm text-text-muted">
              This survey is closed.
            </p>
          ) : null}
        </Card>
      ) : null}

      {showResults && (
        <Card tone="panel" padding="lg" className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-text-default">{survey.title}</h2>
            <h3 className="mt-4 text-base font-semibold text-text-default">Class results</h3>
          </div>
          <StudentSurveyResults payload={results} />
        </Card>
      )}
    </div>
  )
}
