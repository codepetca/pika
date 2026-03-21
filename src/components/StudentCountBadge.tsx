import { Tooltip } from '@/ui'

interface CountBadgeProps {
  count: number
  tooltip?: string
  variant?: 'primary' | 'success' | 'danger'
}

/**
 * Displays a count badge.
 * Used in table headers to show counts.
 */
export function CountBadge({ count, tooltip, variant = 'primary' }: CountBadgeProps) {
  const bgClass =
    variant === 'success' ? 'bg-success text-text-inverse' :
    variant === 'danger' ? 'bg-danger text-text-inverse' :
    'bg-primary'
  const badge = (
    <span className={`inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-badge px-2 text-sm font-semibold ${bgClass} ${variant === 'primary' ? 'text-text-inverse' : ''}`}>
      {count}
    </span>
  )

  if (tooltip) {
    return <Tooltip content={tooltip}>{badge}</Tooltip>
  }
  return badge
}

/**
 * Displays a count badge for students.
 */
export function StudentCountBadge({ count }: { count: number }) {
  return <CountBadge count={count} tooltip={`${count} ${count === 1 ? 'student' : 'students'}`} />
}
