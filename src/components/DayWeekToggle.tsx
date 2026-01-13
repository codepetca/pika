'use client'

export type ViewMode = 'day' | 'week'

interface DayWeekToggleProps {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}

export function DayWeekToggle({ mode, onChange }: DayWeekToggleProps) {
  return (
    <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <button
        type="button"
        onClick={() => onChange('day')}
        className={[
          'px-3 py-1.5 text-sm font-medium rounded-l-md transition-colors',
          mode === 'day'
            ? 'bg-blue-600 text-white'
            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
        ].join(' ')}
        aria-pressed={mode === 'day'}
      >
        Day
      </button>
      <button
        type="button"
        onClick={() => onChange('week')}
        className={[
          'px-3 py-1.5 text-sm font-medium rounded-r-md transition-colors',
          mode === 'week'
            ? 'bg-blue-600 text-white'
            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
        ].join(' ')}
        aria-pressed={mode === 'week'}
      >
        Week
      </button>
    </div>
  )
}
