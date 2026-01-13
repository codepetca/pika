'use client'

import { format, parseISO } from 'date-fns'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import type { TiptapContent } from '@/types'

const EMPTY_DOC: TiptapContent = { type: 'doc', content: [] }

interface DayPlanCardProps {
  date: string // YYYY-MM-DD
  content: TiptapContent | null
  isToday?: boolean
}

export function DayPlanCard({
  date,
  content,
  isToday = false,
}: DayPlanCardProps) {
  const dateObj = parseISO(date)
  const dayName = format(dateObj, 'EEEE') // Monday, Tuesday, etc.
  const dateDisplay = format(dateObj, 'MMM d') // Jan 12

  const displayContent = content ?? EMPTY_DOC
  const hasContent = content && content.content && content.content.length > 0

  return (
    <div
      className={[
        'flex flex-col bg-white dark:bg-gray-900 rounded-lg border overflow-hidden',
        isToday
          ? 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-500/20 dark:ring-blue-400/20'
          : 'border-gray-200 dark:border-gray-700',
      ].join(' ')}
    >
      {/* Header */}
      <div
        className={[
          'px-4 py-2 border-b flex items-center justify-between',
          isToday
            ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800'
            : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700',
        ].join(' ')}
      >
        <div className="flex items-center gap-2">
          <span
            className={[
              'font-semibold text-sm',
              isToday
                ? 'text-blue-700 dark:text-blue-300'
                : 'text-gray-900 dark:text-white',
            ].join(' ')}
          >
            {dayName}
          </span>
          <span
            className={[
              'text-sm',
              isToday
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-500 dark:text-gray-400',
            ].join(' ')}
          >
            {dateDisplay}
          </span>
          {isToday && (
            <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-200 rounded">
              Today
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-[120px]">
        {hasContent ? (
          <div className="p-4">
            <RichTextViewer content={displayContent} />
          </div>
        ) : (
          <div className="p-4 flex items-center justify-center min-h-[120px]">
            <span className="text-sm text-gray-400 dark:text-gray-500 italic">
              No plan for this day
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
