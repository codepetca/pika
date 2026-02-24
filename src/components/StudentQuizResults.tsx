'use client'

import { useEffect, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import type { QuizResultsAggregate } from '@/types'

interface Props {
  quizId: string
  myResponses: Record<string, number>
  apiBasePath?: string
}

export function StudentQuizResults({
  quizId,
  myResponses,
  apiBasePath = '/api/student/quizzes',
}: Props) {
  const [results, setResults] = useState<QuizResultsAggregate[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadResults() {
      try {
        const res = await fetch(`${apiBasePath}/${quizId}/results`)
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || 'Failed to load results')
        }
        setResults(data.results || [])
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

  if (!results || results.length === 0) {
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

      {results.map((result, index) => {
        const myAnswer = myResponses[result.question_id]

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
