import { Check, Circle, Clock, Reply, RotateCcw, type LucideIcon } from 'lucide-react'

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
  returned: { icon: Reply, className: 'text-primary' },
  resubmitted: { icon: RotateCcw, className: 'text-warning' },
}

export function AssessmentStatusIcon({
  state,
  late = false,
  className = '',
}: AssessmentStatusIconProps) {
  const meta = STATUS_ICON_META[state]
  const Icon = meta.icon
  const iconClassName = [ICON_CLASS, !late && meta.className, !late && className].filter(Boolean).join(' ')
  const statusIcon = state === 'in_progress' ? (
    <span
      className={`relative inline-flex shrink-0 ${iconClassName}`}
      aria-hidden="true"
      data-testid="assessment-status-icon-in_progress"
    >
      <Circle className="absolute inset-0 h-full w-full text-text-muted" aria-hidden="true" />
      {/* Lucide Circle has radius 10: 40π/3 draws exactly 240° of its ring. */}
      <Circle
        className="absolute inset-0 h-full w-full -rotate-90 text-assessment-progress [&_circle]:[stroke-dasharray:41.887902_20.943951] [&_circle]:[stroke-linecap:butt]"
        aria-hidden="true"
      />
    </span>
  ) : (
    <Icon className={iconClassName} aria-hidden="true" data-testid={`assessment-status-icon-${state}`} />
  )

  if (late) {
    return (
      <span
        className={['inline-flex items-center gap-0.5', meta.className, className].filter(Boolean).join(' ')}
        data-testid={`assessment-status-icon-${state}-late`}
      >
        {statusIcon}
        <Clock className={LATE_CLOCK_CLASS} aria-hidden="true" data-testid="assessment-status-icon-late-clock" />
      </span>
    )
  }

  return statusIcon
}
