import {
  AssessmentStatusIcon,
  type AssessmentStatusIconState,
} from '@/components/AssessmentStatusIcon'
import { getAssignmentStatusLabel } from '@/lib/assignments'
import type { AssignmentStatus, GradebookAssessmentStatus } from '@/types'

export type TestGradingWorkStatus =
  | 'not_started'
  | 'in_progress'
  | 'closed'
  | 'submitted'
  | 'returned'

export interface AssessmentWorkStatusDisplay {
  label: string
  iconState: AssessmentStatusIconState
  late: boolean
  labelClassName: string
  shortLabel?: string
  chipClassName?: string
}

interface AssessmentStatusIndicatorProps {
  display: AssessmentWorkStatusDisplay
  showLabel?: boolean
  className?: string
  iconClassName?: string
}

export function AssessmentStatusIndicator({
  display,
  showLabel = true,
  className = '',
  iconClassName = '',
}: AssessmentStatusIndicatorProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 font-medium',
        display.labelClassName,
        className,
      ].filter(Boolean).join(' ')}
    >
      <AssessmentStatusIcon
        state={display.iconState}
        late={display.late}
        className={iconClassName}
      />
      {showLabel ? <span>{display.label}</span> : null}
    </span>
  )
}

export function getAssignmentWorkStatusDisplay(
  status: AssignmentStatus,
  {
    wasLate = false,
    hasDraftGrade = false,
  }: {
    wasLate?: boolean
    hasDraftGrade?: boolean
  } = {},
): AssessmentWorkStatusDisplay {
  const late =
    status === 'in_progress_late' ||
    status === 'submitted_late' ||
    ((status === 'graded' || status === 'returned' || status === 'resubmitted') && wasLate)

  const baseLabel = getAssignmentStatusLabel(status)
  const label =
    wasLate && (status === 'graded' || status === 'returned' || status === 'resubmitted')
      ? `${baseLabel} (late)`
      : baseLabel

  switch (status) {
    case 'not_started':
      return {
        label,
        iconState: 'not_started',
        late,
        labelClassName: 'text-text-muted',
      }
    case 'in_progress':
    case 'in_progress_late':
      return {
        label,
        iconState: 'in_progress',
        late,
        labelClassName: 'text-warning',
      }
    case 'submitted_on_time':
    case 'submitted_late':
      return {
        label,
        iconState: hasDraftGrade ? 'draft_graded' : 'submitted',
        late,
        labelClassName: hasDraftGrade ? 'text-text-muted' : 'text-success',
      }
    case 'graded':
      return {
        label,
        iconState: 'graded',
        late,
        labelClassName: 'text-success',
      }
    case 'returned':
      return {
        label,
        iconState: 'returned',
        late,
        labelClassName: 'text-primary',
      }
    case 'resubmitted':
      return {
        label,
        iconState: 'resubmitted',
        late,
        labelClassName: 'text-warning',
        shortLabel: 'Resub',
        chipClassName: 'border border-warning bg-warning-bg text-warning',
      }
    default:
      return {
        label: 'Unknown',
        iconState: 'not_started',
        late: false,
        labelClassName: 'text-text-muted',
      }
  }
}

export function getTestGradingWorkStatusDisplay(
  status: TestGradingWorkStatus,
): AssessmentWorkStatusDisplay {
  switch (status) {
    case 'not_started':
      return {
        label: 'Not started',
        iconState: 'not_started',
        late: false,
        labelClassName: 'text-text-muted',
      }
    case 'in_progress':
      return {
        label: 'In progress',
        iconState: 'in_progress',
        late: false,
        labelClassName: 'text-warning',
      }
    case 'closed':
      return {
        label: 'Closed for grading',
        iconState: 'draft_graded',
        late: false,
        labelClassName: 'text-text-muted',
      }
    case 'submitted':
      return {
        label: 'Submitted',
        iconState: 'submitted',
        late: false,
        labelClassName: 'text-success',
      }
    case 'returned':
      return {
        label: 'Returned',
        iconState: 'returned',
        late: false,
        labelClassName: 'text-primary',
      }
    default:
      return {
        label: 'Unknown',
        iconState: 'not_started',
        late: false,
        labelClassName: 'text-text-muted',
      }
  }
}

export function getGradebookAssessmentStatusDisplay(
  status: GradebookAssessmentStatus | null | undefined,
): AssessmentWorkStatusDisplay | null {
  switch (status) {
    case 'missing':
      return {
        label: 'Missing',
        iconState: 'not_started',
        late: true,
        labelClassName: 'text-warning',
      }
    case 'not_submitted':
      return {
        label: 'Not submitted',
        iconState: 'not_started',
        late: false,
        labelClassName: 'text-text-muted',
      }
    case 'late':
      return {
        label: 'Late',
        iconState: 'in_progress',
        late: true,
        labelClassName: 'text-warning',
      }
    case 'submitted_late':
      return {
        label: 'Submitted late',
        iconState: 'submitted',
        late: true,
        labelClassName: 'text-warning',
      }
    case 'started':
      return {
        label: 'Started',
        iconState: 'in_progress',
        late: false,
        labelClassName: 'text-warning',
      }
    case 'submitted':
      return {
        label: 'Submitted',
        iconState: 'submitted',
        late: false,
        labelClassName: 'text-success',
      }
    case 'resubmitted':
      return {
        label: 'Resubmitted',
        iconState: 'resubmitted',
        late: false,
        labelClassName: 'text-warning',
      }
    default:
      return null
  }
}
