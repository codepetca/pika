'use client'

import { formatInTimeZone } from 'date-fns-tz'
import type { AssignmentDocHistoryEntry } from '@/types'

interface HistoryListProps {
  entries: AssignmentDocHistoryEntry[]
  activeEntryId: string | null
  onEntryClick: (entry: AssignmentDocHistoryEntry) => void
  onEntryHover?: (entry: AssignmentDocHistoryEntry) => void
  variant?: 'desktop' | 'mobile'
}

function getTriggerBadgeClasses(): string {
  return 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
}

export function HistoryList({
  entries,
  activeEntryId,
  onEntryClick,
  onEntryHover,
  variant = 'desktop',
}: HistoryListProps) {
  const entriesByDate = entries.reduce((acc, entry) => {
    const date = formatInTimeZone(new Date(entry.created_at), 'America/Toronto', 'MMM d')
    if (!acc[date]) acc[date] = []
    acc[date]!.push(entry)
    return acc
  }, {} as Record<string, AssignmentDocHistoryEntry[]>)

  if (variant === 'mobile') {
    return (
      <div className="space-y-3 mt-3">
        {Object.entries(entriesByDate).map(([date, dateEntries]) => (
          <div key={date}>
            <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {date}
            </div>
            <div className="space-y-1">
              {dateEntries.map((entry, idx) => {
                const prevEntry = idx > 0 ? dateEntries[idx - 1] : null
                const charDiff = prevEntry
                  ? entry.char_count - prevEntry.char_count
                  : entry.char_count
                const isActive = activeEntryId === entry.id

                return (
                  <button
                    key={entry.id}
                    onClick={() => onEntryClick(entry)}
                    className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                      isActive
                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                        : 'bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono">
                          {formatInTimeZone(
                            new Date(entry.created_at),
                            'America/Toronto',
                            'h:mm a'
                          )}
                        </span>
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${getTriggerBadgeClasses()}`}
                        >
                          {entry.trigger}
                        </span>
                      </div>
                      <span
                        className={`text-xs ${
                          charDiff > 200
                            ? 'text-orange-600 dark:text-orange-400 font-bold'
                            : charDiff > 0
                              ? 'text-green-600 dark:text-green-400'
                              : charDiff < 0
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-gray-500'
                        }`}
                      >
                        {charDiff > 0 ? '+' : ''}
                        {charDiff}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-700">
      {Object.entries(entriesByDate).map(([date, dateEntries]) => (
        <div key={date} className="px-3 py-2">
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            {date}
          </div>
          <div className="space-y-1">
            {dateEntries.map((entry, idx) => {
              const prevEntry = idx > 0 ? dateEntries[idx - 1] : null
              const charDiff = prevEntry
                ? entry.char_count - prevEntry.char_count
                : entry.char_count
              const isActive = activeEntryId === entry.id

              return (
                <button
                  key={entry.id}
                  onClick={() => onEntryClick(entry)}
                  onMouseEnter={onEntryHover ? () => onEntryHover(entry) : undefined}
                  className={`w-full text-left px-2 py-1 rounded text-xs transition-colors ${
                    isActive
                      ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                      : 'hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono">
                        {formatInTimeZone(
                          new Date(entry.created_at),
                          'America/Toronto',
                          'h:mm a'
                        )}
                      </span>
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${getTriggerBadgeClasses()}`}
                      >
                        {entry.trigger}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] ${
                        charDiff > 200
                          ? 'text-orange-600 dark:text-orange-400 font-bold'
                          : charDiff > 0
                            ? 'text-green-600 dark:text-green-400'
                            : charDiff < 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-gray-500 dark:text-gray-500'
                      }`}
                    >
                      {charDiff > 0 ? '+' : ''}
                      {charDiff}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
