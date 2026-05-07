'use client'

import { cn } from '@/ui/utils'

interface MultipleChoiceOptionReviewProps {
  options: string[]
  selectedOption: number | null | undefined
  correctOption: number | null | undefined
  className?: string
}

export function normalizeMultipleChoiceOptionIndex(
  value: number | null | undefined,
  optionCount: number
): number | null {
  if (!Number.isInteger(value)) return null
  const index = Number(value)
  return index >= 0 && index < optionCount ? index : null
}

function getOptionLetter(index: number): string {
  return String.fromCharCode(65 + index)
}

export function MultipleChoiceOptionReview({
  options,
  selectedOption,
  correctOption,
  className,
}: MultipleChoiceOptionReviewProps) {
  const normalizedSelected = normalizeMultipleChoiceOptionIndex(selectedOption, options.length)
  const normalizedCorrect = normalizeMultipleChoiceOptionIndex(correctOption, options.length)

  if (options.length === 0) return null

  return (
    <div
      className={cn('space-y-1', className)}
      role="list"
      aria-label="Multiple choice answer options"
    >
      {options.map((option, optionIndex) => {
        const isCorrect = normalizedCorrect === optionIndex
        const isSelected = normalizedSelected === optionIndex
        const isIncorrectSelection = isSelected && !isCorrect
        const statusSymbol = isCorrect ? '✓' : isIncorrectSelection ? '✕' : ''
        const statusLabel = isCorrect
          ? isSelected
            ? 'Your answer, correct'
            : 'Correct answer'
          : isIncorrectSelection
            ? 'Your answer, incorrect'
            : null

        return (
          <div
            key={`${optionIndex}-${option}`}
            role="listitem"
            className={cn(
              'grid grid-cols-[1rem_1.25rem_minmax(0,1fr)] items-start gap-1.5 rounded-md px-2.5 py-1.5 text-sm',
              isCorrect
                ? 'bg-success-bg-muted text-text-default'
                : isIncorrectSelection
                  ? 'bg-warning-bg text-text-default'
                  : 'bg-surface-2 text-text-default'
            )}
          >
            <span
              className={cn(
                'flex h-5 w-4 items-center justify-center text-xs font-bold leading-none',
                isCorrect ? 'text-success' : isIncorrectSelection ? 'text-warning' : 'text-text-muted'
              )}
              aria-label={statusLabel || undefined}
              aria-hidden={statusLabel ? undefined : true}
            >
              {statusSymbol}
            </span>
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center text-xs font-semibold leading-none',
                isCorrect ? 'text-success' : isIncorrectSelection ? 'text-warning' : 'text-text-muted'
              )}
            >
              {getOptionLetter(optionIndex)}
            </span>
            <span className="min-w-0 whitespace-pre-wrap leading-5">
              {option}
            </span>
          </div>
        )
      })}
    </div>
  )
}
