import { Button } from '@/ui'

export interface CalendarSourceFailure {
  id: string
  label: string
  isRetrying: boolean
  onRetry: () => void
}

export function CalendarSourceErrors({ failures }: { failures: CalendarSourceFailure[] }) {
  if (failures.length === 0) return null

  return (
    <div
      role="alert"
      className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger"
    >
      <p className="font-medium">Some calendar information could not be loaded.</p>
      <div className="flex flex-wrap gap-2">
        {failures.map((failure) => (
          <Button
            key={failure.id}
            type="button"
            size="sm"
            variant="secondary"
            disabled={failure.isRetrying}
            onClick={failure.onRetry}
          >
            {failure.isRetrying ? `Retrying ${failure.label}` : `Retry ${failure.label}`}
          </Button>
        ))}
      </div>
    </div>
  )
}
