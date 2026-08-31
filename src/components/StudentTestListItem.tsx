'use client'

import { forwardRef } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button, cn } from '@/ui'
import { getStudentTestPresentation, type StudentTestSummary } from '@/lib/student-test-presentation'

interface Props {
  test: StudentTestSummary
  selected?: boolean
  onClick: () => void
}

/** Feature-owned list action, also rendered with fixed fixtures in Pattern Lab. */
export const StudentTestListItem = forwardRef<HTMLButtonElement, Props>(function StudentTestListItem(
  { test, selected = false, onClick },
  ref,
) {
  const state = getStudentTestPresentation(test)
  return (
    <Button
      ref={ref}
      type="button"
      variant="surface"
      fullWidth
      onClick={onClick}
      disabled={state.unavailable}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'gap-3 rounded-card p-card text-left disabled:opacity-100',
        state.unavailable && 'bg-surface-2',
        selected && 'border-primary bg-surface-selected',
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="min-w-0">
          <span role="heading" aria-level={3} className="block break-words text-base font-semibold text-text-default">
            {test.title}
          </span>
          <span className="mt-1 block text-sm font-normal text-text-muted">{state.description}</span>
        </span>
        <span className={cn('shrink-0 self-start rounded-badge px-2.5 py-1 text-xs font-semibold sm:self-center', state.badgeClass)}>
          {state.label}
        </span>
      </span>
      {!state.unavailable && <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />}
    </Button>
  )
})
