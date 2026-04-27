import { Check, Circle, Clock, RotateCcw, Send, type LucideIcon } from 'lucide-react'

export type AssessmentStatusIconState =
  | 'not_started'
  | 'in_progress'
  | 'submitted'
  | 'draft_graded'
  | 'graded'
  | 'returned'
  | 'resubmitted'

interface AssessmentStatusIconProps {
  state: AssessmentStatusIconState
  late?: boolean
  className?: string
}

const ICON_CLASS = 'h-4 w-4'
const LATE_CLOCK_CLASS = 'h-3 w-3'

const STATUS_ICON_META: Record<AssessmentStatusIconState, { icon: LucideIcon; className: string }> = {
  not_started: { icon: Circle, className: 'text-text-muted' },
  in_progress: { icon: Circle, className: 'text-warning' },
  submitted: { icon: Circle, className: 'text-success' },
  draft_graded: { icon: Check, className: 'text-text-muted' },
  graded: { icon: Check, className: 'text-success' },
  returned: { icon: Send, className: 'text-primary' },
  resubmitted: { icon: RotateCcw, className: 'text-warning' },
}

export function AssessmentStatusIcon({
  state,
  late = false,
  className = '',
}: AssessmentStatusIconProps) {
  const meta = STATUS_ICON_META[state]
  const Icon = meta.icon

  if (late) {
    return (
      <span
        className={['inline-flex items-center gap-0.5', meta.className, className].filter(Boolean).join(' ')}
        data-testid={`assessment-status-icon-${state}-late`}
      >
        <Icon className={ICON_CLASS} aria-hidden="true" data-testid={`assessment-status-icon-${state}`} />
        <Clock className={LATE_CLOCK_CLASS} aria-hidden="true" data-testid="assessment-status-icon-late-clock" />
      </span>
    )
  }

  return (
    <Icon
      className={[ICON_CLASS, meta.className, className].filter(Boolean).join(' ')}
      aria-hidden="true"
      data-testid={`assessment-status-icon-${state}`}
    />
  )
}
