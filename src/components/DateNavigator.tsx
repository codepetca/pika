'use client'

import { addDaysToDateString } from '@/lib/date-string'

interface Props {
  value: string
  onChange: (next: string) => void
  onShortcut?: () => void
  shortcutLabel?: string
  disabled?: boolean
  className?: string
}

export function DateNavigator({
  value,
  onChange,
  onShortcut,
  shortcutLabel,
  disabled,
  className,
}: Props) {
  const canUseShortcut = Boolean(onShortcut && shortcutLabel)

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Previous day"
          className="px-3 py-2 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          onClick={() => onChange(addDaysToDateString(value, -1))}
          disabled={disabled}
        >
          ←
        </button>

        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Select date"
          className="px-3 py-2 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 disabled:opacity-50"
          disabled={disabled}
        />

        <button
          type="button"
          aria-label="Next day"
          className="px-3 py-2 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          onClick={() => onChange(addDaysToDateString(value, 1))}
          disabled={disabled}
        >
          →
        </button>

        {canUseShortcut && (
          <button
            type="button"
            className="px-3 py-2 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            onClick={onShortcut}
            disabled={disabled}
          >
            {shortcutLabel}
          </button>
        )}
      </div>
    </div>
  )
}

