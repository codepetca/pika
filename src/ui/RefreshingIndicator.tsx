'use client'

interface RefreshingIndicatorProps {
  label?: string
  className?: string
}

export function RefreshingIndicator({
  label = 'Refreshing...',
  className = '',
}: RefreshingIndicatorProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={['px-3 py-2 text-xs text-text-muted', className].filter(Boolean).join(' ')}
    >
      {label}
    </div>
  )
}
