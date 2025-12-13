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
          className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm hover:bg-gray-50 disabled:opacity-50"
          onClick={() => onChange(addDaysToDateString(value, -1))}
          disabled={disabled}
        >
          ←
        </button>

        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm disabled:opacity-50"
          disabled={disabled}
        />

        <button
          type="button"
          className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm hover:bg-gray-50 disabled:opacity-50"
          onClick={() => onChange(addDaysToDateString(value, 1))}
          disabled={disabled}
        >
          →
        </button>

        {canUseShortcut && (
          <button
            type="button"
            className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm hover:bg-gray-50 disabled:opacity-50"
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

