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

  return (
    <div
      role="group"
      className="relative overflow-hidden rounded-lg bg-surface-2"
      aria-label={`${option}: ${count} responses, ${roundedPercent}%`}
    >
      <div
        className="absolute inset-y-0 left-0 bg-primary opacity-20"
        style={{ width: `${percent}%` }}
        aria-hidden="true"
      />
      <div className="relative flex min-h-9 items-center gap-3 px-3 py-2">
        <span className="min-w-0 flex-1 break-words text-sm text-text-default">{option}</span>
        <span className="w-10 shrink-0 text-right text-xs font-semibold text-text-default">
          {count > 0 ? `${roundedPercent}%` : null}
        </span>
      </div>
    </div>
  )
}
