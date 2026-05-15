'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Button, Card, Input } from '@/ui'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import { Spinner } from '@/components/Spinner'
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
  onBack: () => void
  onCompleted?: () => void
}

type SurveyDetailPayload = {
  survey: Survey & { student_status: StudentSurveyStatus }
  questions: SurveyQuestion[]
  student_responses: Record<string, SurveyResponseValue>
  student_status: StudentSurveyStatus
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
                const percent = result.total_responses > 0 ? (count / result.total_responses) * 100 : 0
                return (
                  <div key={optionIndex} className="space-y-0.5">
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="min-w-0 text-text-default">{option}</span>
                      <span className="shrink-0 text-text-muted">{count} ({percent.toFixed(0)}%)</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                    </div>
                  </div>
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

export function StudentSurveyPanel({
  surveyId,
  onBack,
  onCompleted,
}: StudentSurveyPanelProps) {
  const [detail, setDetail] = useState<SurveyDetailPayload | null>(null)
  const [responses, setResponses] = useState<Record<string, SurveyResponseValue>>({})
  const [results, setResults] = useState<SurveyResultsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const loadSurvey = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/student/surveys/${surveyId}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load survey')
      setDetail(data)
      setResponses(data.student_responses || {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load survey')
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [surveyId])

  const loadResults = useCallback(async () => {
    try {
      const response = await fetch(`/api/student/surveys/${surveyId}/results`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load results')
      setResults(data)
    } catch {
      setResults(null)
    }
  }, [surveyId])

  useEffect(() => {
    void loadSurvey()
  }, [loadSurvey])

  useEffect(() => {
    if (detail?.survey.show_results && detail.student_status !== 'not_started') {
      void loadResults()
    } else {
      setResults(null)
    }
  }, [detail?.student_status, detail?.survey.show_results, loadResults])

  const canRespond = useMemo(() => {
    if (!detail) return false
    if (detail.survey.status !== 'active') return false
    return detail.student_status === 'not_started' || detail.student_status === 'can_update'
  }, [detail])

  const allAnswered = useMemo(() => {
    if (!detail) return false
    return detail.questions.every((question) => {
      const response = responses[question.id]
      if (!response) return false
      if (question.question_type === 'multiple_choice') {
        return response.question_type === 'multiple_choice'
      }
      return response.question_type !== 'multiple_choice' && response.response_text.trim().length > 0
    })
  }, [detail, responses])

  async function submitResponses() {
    if (!detail) return
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
      if (detail.survey.show_results) await loadResults()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit responses')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <Card tone="panel" padding="lg">
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      </Card>
    )
  }

  if (!detail) {
    return (
      <Card tone="panel" padding="lg">
        <Button size="sm" variant="secondary" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          Back
        </Button>
        <p className="mt-4 text-sm text-danger">{error || 'Survey unavailable'}</p>
      </Card>
    )
  }

  const { survey, questions, student_status: studentStatus } = detail
  const hasSubmitted = studentStatus !== 'not_started'

  return (
    <div className="space-y-4">
      <Card tone="panel" padding="lg" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-text-muted hover:text-text-default"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Classwork
            </button>
            <h2 className="text-xl font-semibold text-text-default">{survey.title}</h2>
            <p className="mt-1 text-sm text-text-muted">
              {survey.dynamic_responses
                ? 'Dynamic survey'
                : 'Survey'}
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
        ) : null}
      </Card>

      {survey.show_results && hasSubmitted && (
        <Card tone="panel" padding="lg" className="space-y-4">
          <h3 className="text-base font-semibold text-text-default">Class results</h3>
          <StudentSurveyResults payload={results} />
        </Card>
      )}
    </div>
  )
}
