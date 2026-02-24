'use client'

import { useEffect, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import type {
  QuizAssessmentType,
  QuizResultsAggregate,
  TestResponseDraftValue,
} from '@/types'

interface TestQuestionResult {
  question_id: string
  question_type: 'multiple_choice' | 'open_response'
  question_text: string
  options: string[]
  points: number
  response_max_chars: number
  correct_option: number | null
  selected_option: number | null
  response_text: string | null
  score: number | null
  feedback: string | null
  graded_at: string | null
  is_correct: boolean | null
}

interface TestResultSummary {
  earned_points: number
  possible_points: number
  percent: number
}

interface ResultsPayload {
  results?: QuizResultsAggregate[]
  question_results?: TestQuestionResult[]
  summary?: TestResultSummary
}

function selectedOptionFromResponse(
  value: number | TestResponseDraftValue | undefined
): number | null {
  if (typeof value === 'number') return value
  if (value?.question_type === 'multiple_choice') return value.selected_option
  return null
}

interface Props {
  quizId: string
  myResponses: Record<string, number | TestResponseDraftValue>
  assessmentType?: QuizAssessmentType
  apiBasePath?: string
}

export function StudentQuizResults({
  quizId,
  myResponses,
  assessmentType,
  apiBasePath = '/api/student/quizzes',
}: Props) {
  const [payload, setPayload] = useState<ResultsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const isTestsView =
    assessmentType === 'test' || apiBasePath.includes('/tests')

  useEffect(() => {
    async function loadResults() {
      try {
        const res = await fetch(`${apiBasePath}/${quizId}/results`)
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || 'Failed to load results')
        }
        setPayload(data as ResultsPayload)
      } catch (err: any) {
        setError(err.message || 'Failed to load results')
      } finally {
        setLoading(false)
      }
    }
    loadResults()
  }, [apiBasePath, quizId])

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-danger-bg text-danger rounded-lg mt-4">
        {error}
      </div>
    )
  }

  const results = payload?.results || []
  const questionResults = payload?.question_results || []
  const summary = payload?.summary || null

  if (isTestsView && questionResults.length === 0) {
    return (
      <div className="text-center py-8 text-text-muted">
        No results available.
      </div>
    )
  }

  if (!isTestsView && results.length === 0) {
    return (
      <div className="text-center py-8 text-text-muted">
        No results available.
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="p-4 bg-success-bg rounded-lg">
        <p className="text-success font-medium">Your response has been submitted.</p>
      </div>

      <h3 className="font-semibold text-text-default">Results</h3>

      {isTestsView && summary && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-sm text-text-muted">Score</p>
          <p className="text-lg font-semibold text-text-default">
            {summary.earned_points.toFixed(2).replace(/\.00$/, '')}
            {' / '}
            {summary.possible_points.toFixed(2).replace(/\.00$/, '')}
          </p>
          <p className="text-sm text-text-muted">
            {summary.percent.toFixed(1)}%
          </p>
        </div>
      )}

      {isTestsView
        ? questionResults.map((result, index) => {
            const possible = Number(result.points || 0)
            const earned = result.score
            return (
              <div key={result.question_id} className="space-y-2 rounded-lg border border-border bg-surface p-4">
                <p className="font-medium text-text-default">
                  {index + 1}. {result.question_text}
                  {' '}
                  <span className="text-sm font-normal text-text-muted">({possible} pts)</span>
                </p>

                {result.question_type === 'multiple_choice' ? (
                  <div className="space-y-1 text-sm">
                    <p className="text-text-default">
                      Your answer:{' '}
                      <span className="font-medium">
                        {typeof result.selected_option === 'number'
                          ? (result.options[result.selected_option] || '—')
                          : '—'}
                      </span>
                    </p>
                    <p className="text-text-muted">
                      Correct answer:{' '}
                      {typeof result.correct_option === 'number'
                        ? (result.options[result.correct_option] || '—')
                        : '—'}
                    </p>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap rounded-md bg-surface-2 px-3 py-2 text-sm text-text-default">
                    {result.response_text || '—'}
                  </p>
                )}

                <p className="text-sm text-text-default">
                  Score:{' '}
                  {earned == null
                    ? 'Pending grading'
                    : `${earned.toFixed(2).replace(/\.00$/, '')} / ${possible.toFixed(2).replace(/\.00$/, '')}`}
                </p>
                {result.feedback && (
                  <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-text-default">
                    {result.feedback}
                  </p>
                )}
              </div>
            )
          })
        : results.map((result, index) => {
            const myAnswer = selectedOptionFromResponse(myResponses[result.question_id])

            return (
              <div key={result.question_id} className="space-y-2">
                <p className="font-medium text-text-default">
                  {index + 1}. {result.question_text}
                </p>
                <div className="space-y-1.5">
                  {result.options.map((option, optionIndex) => {
                    const count = result.counts[optionIndex]
                    const percent = result.total_responses > 0
                      ? (count / result.total_responses) * 100
                      : 0
                    const isMyAnswer = myAnswer === optionIndex

                    return (
                      <div key={optionIndex} className="space-y-0.5">
                        <div className="flex justify-between text-sm">
                          <span className={isMyAnswer ? 'text-primary font-medium' : 'text-text-default'}>
                            {option}
                            {isMyAnswer && ' (your answer)'}
                          </span>
                          <span className="text-text-muted">
                            {count} ({percent.toFixed(0)}%)
                          </span>
                        </div>
                        <div className="h-4 bg-surface-2 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              isMyAnswer ? 'bg-primary' : 'bg-text-muted/30'
                            }`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
                <p className="text-xs text-text-muted">
                  {result.total_responses} response{result.total_responses !== 1 ? 's' : ''}
                </p>
              </div>
            )
          })}
    </div>
  )
}
