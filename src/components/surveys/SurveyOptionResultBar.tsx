'use client'

interface SurveyOptionResultBarProps {
  option: string
  count: number
  totalResponses: number
}

export function SurveyOptionResultBar({
  option,
  count,
  totalResponses,
}: SurveyOptionResultBarProps) {
  const percent = totalResponses > 0 ? (count / totalResponses) * 100 : 0
  const roundedPercent = percent.toFixed(0)
  const showPercentInFill = percent >= 18

  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-3 text-sm">
        <span className="min-w-0 text-text-default">{option}</span>
        <span className="shrink-0 text-xs font-medium text-text-muted">{count}</span>
      </div>
      <div
        className="relative h-6 overflow-hidden rounded-full bg-surface-2"
        aria-label={`${option}: ${count} responses, ${roundedPercent}%`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: `${percent}%` }}
        >
          {showPercentInFill ? (
            <span className="absolute inset-y-0 right-2 flex items-center text-xs font-semibold text-text-inverse">
              {roundedPercent}%
            </span>
          ) : null}
        </div>
        {!showPercentInFill ? (
          <span className="absolute inset-y-0 right-2 flex items-center text-xs font-semibold text-text-muted">
            {roundedPercent}%
          </span>
        ) : null}
      </div>
    </div>
  )
}
