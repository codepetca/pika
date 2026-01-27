'use client'

import type { QuizResultsAggregate } from '@/types'

interface Props {
  results: QuizResultsAggregate[] | null
  responders?: { student_id: string; name: string | null; email: string }[]
}

export function QuizResultsView({ results, responders }: Props) {
  if (!results || results.length === 0) {
    return (
      <div className="text-sm text-text-muted py-4 text-center">
        No responses yet.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Results by Question */}
      {results.map((result, index) => (
        <div key={result.question_id} className="space-y-2">
          <p className="text-sm font-medium text-text-default">
            Q{index + 1}. {result.question_text}
          </p>
          <div className="space-y-1.5">
            {result.options.map((option, optionIndex) => {
              const count = result.counts[optionIndex]
              const percent = result.total_responses > 0
                ? (count / result.total_responses) * 100
                : 0

              return (
                <div key={optionIndex} className="space-y-0.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-default">{option}</span>
                    <span className="text-text-muted">
                      {count} ({percent.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="h-4 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
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
      ))}

      {/* Responders List */}
      {responders && responders.length > 0 && (
        <div className="pt-4 border-t border-border">
          <h4 className="text-sm font-medium text-text-default mb-2">
            Responded ({responders.length})
          </h4>
          <ul className="space-y-1">
            {responders.map((responder) => (
              <li key={responder.student_id} className="text-sm text-text-muted">
                {responder.name || responder.email.split('@')[0]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
