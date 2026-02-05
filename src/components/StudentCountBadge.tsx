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
    variant === 'success' ? 'bg-green-500' :
    variant === 'danger' ? 'bg-red-500' :
    'bg-primary'
  const badge = (
    <span className={`inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 rounded-full ${bgClass} text-white text-sm font-semibold`}>
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
