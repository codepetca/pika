'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { QuestionMarkdown } from '@/components/QuestionMarkdown'
import { summarizeTestQuestionScores, type TestResultSummary } from '@/lib/test-result-summary'
import { fetchJSON, fetchJSONWithCache } from '@/lib/request-cache'
import {
  MultipleChoiceOptionReview,
  normalizeMultipleChoiceOptionIndex,
} from '@/components/MultipleChoiceOptionReview'

interface TestQuestionResult {
  question_id: string
  question_type: 'multiple_choice' | 'open_response'
  question_text: string
  options: string[]
  points: number
  response_max_chars: number
  response_monospace?: boolean
  sample_solution?: string | null
  correct_option: number | null
  selected_option: number | null
  response_text: string | null
  score: number | null
  feedback: string | null
  graded_at: string | null
  is_correct: boolean | null
}

interface ResultsPayload {
  question_results?: TestQuestionResult[]
  summary?: TestResultSummary
}

interface Props {
  testId: string
  apiBasePath?: string
  showSubmissionBanner?: boolean
}

export function StudentTestResults({
  testId,
  apiBasePath = '/api/student/tests',
  showSubmissionBanner = true,
}: Props) {
  if (!testId) {
    throw new Error('StudentTestResults requires testId')
  }

  const [payload, setPayload] = useState<ResultsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestIdRef = useRef(0)
  const requestOwnerId = useId()

  useEffect(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError('')
    setPayload(null)

    async function loadResults() {
      try {
        const data = await fetchJSONWithCache(
          `student-test-results:${requestOwnerId}:${apiBasePath}:${testId}:${requestId}`,
          () => fetchJSON<ResultsPayload>(`${apiBasePath}/${testId}/results`, { errorMessage: 'Failed to load results' }),
          0,
        )
        if (requestIdRef.current !== requestId) return
        setPayload(data)
      } catch (err: any) {
        if (requestIdRef.current === requestId) {
          setError(err.message || 'Failed to load results')
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false)
        }
      }
    }
    loadResults()
  }, [apiBasePath, requestOwnerId, testId])

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

  const questionResults = payload?.question_results || []
  const summary = payload?.summary ? summarizeTestQuestionScores(questionResults) : null

  if (questionResults.length === 0) {
    return (
      <div className="text-center py-8 text-text-muted">
        No results available.
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-6">
      {showSubmissionBanner && (
        <div className="p-4 bg-success-bg rounded-lg">
          <p className="text-success font-medium">Your response has been submitted.</p>
        </div>
      )}

      {summary && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-sm text-text-muted">Score</p>
          {summary.earned_points === null || summary.percent === null ? (
            <p className="text-lg font-semibold text-text-default">Pending grading</p>
          ) : (
            <>
              <p className="text-lg font-semibold text-text-default">
                {summary.earned_points.toFixed(2).replace(/\.00$/, '')}
                {' / '}
                {summary.possible_points.toFixed(2).replace(/\.00$/, '')}
              </p>
              <p className="text-sm text-text-muted">
                {summary.percent.toFixed(1)}%
              </p>
            </>
          )}
        </div>
      )}

      {questionResults.map((result, index) => {
        const possible = Number(result.points || 0)
        const earned = result.score
        const selectedOption =
          result.question_type === 'multiple_choice'
            ? normalizeMultipleChoiceOptionIndex(result.selected_option, result.options.length)
            : null

        return (
          <div
            key={result.question_id}
            className="space-y-2 rounded-lg border border-border bg-surface p-4"
          >
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Q{index + 1} · {possible} pts
                {result.question_type === 'multiple_choice' && selectedOption == null
                  ? ' · No answer'
                  : ''}
              </p>
              <QuestionMarkdown content={result.question_text} />
            </div>

            {result.question_type === 'multiple_choice' ? (
              <MultipleChoiceOptionReview
                options={result.options}
                selectedOption={selectedOption}
                correctOption={result.correct_option}
              />
            ) : (
              <div className="space-y-2">
                <p className="whitespace-pre-wrap rounded-md bg-surface-2 px-3 py-2 text-sm text-text-default">
                  {result.response_text || '—'}
                </p>
                {result.response_monospace && result.sample_solution ? (
                  <div className="rounded-md bg-surface-2 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                      Sample solution
                    </p>
                    <pre className="mt-2 whitespace-pre-wrap font-mono text-sm leading-6 text-text-default">
                      {result.sample_solution}
                    </pre>
                  </div>
                ) : null}
              </div>
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
      })}
    </div>
  )
}
