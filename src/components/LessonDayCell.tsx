'use client'

import { useState, useCallback } from 'react'
import { format } from 'date-fns'
import { Copy } from 'lucide-react'
import { RichTextEditor } from '@/components/editor/RichTextEditor'
import type { LessonPlan, TiptapContent } from '@/types'

const EMPTY_CONTENT: TiptapContent = { type: 'doc', content: [] }

interface LessonDayCellProps {
  date: string // YYYY-MM-DD
  day: Date
  lessonPlan: LessonPlan | null
  isWeekend: boolean
  isToday: boolean
  isHoliday: boolean
  editable: boolean
  compact?: boolean
  onContentChange?: (date: string, content: TiptapContent) => void
  onCopy?: (fromDate: string) => void
}

export function LessonDayCell({
  date,
  day,
  lessonPlan,
  isWeekend,
  isToday,
  isHoliday,
  editable,
  compact = false,
  onContentChange,
  onCopy,
}: LessonDayCellProps) {
  const [isHovered, setIsHovered] = useState(false)
  const content = lessonPlan?.content || EMPTY_CONTENT

  const handleContentChange = useCallback(
    (newContent: TiptapContent) => {
      onContentChange?.(date, newContent)
    },
    [date, onContentChange]
  )

  const handleCopy = useCallback(() => {
    onCopy?.(date)
  }, [date, onCopy])

  // Check if content is empty
  const hasContent = content.content && content.content.length > 0

  // Weekend cells are narrow and minimal
  if (isWeekend) {
    return (
      <div
        className={`
          border-r border-gray-200 dark:border-gray-700 last:border-r-0
          bg-gray-50 dark:bg-gray-900
          ${isToday ? 'ring-2 ring-inset ring-blue-500' : ''}
        `}
      >
        <div className="p-1 text-center">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {format(day, 'd')}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`
        relative border-r border-gray-200 dark:border-gray-700 last:border-r-0
        ${isToday ? 'ring-2 ring-inset ring-blue-500' : ''}
        ${isHoliday ? 'bg-amber-50 dark:bg-amber-900/20' : ''}
        ${!editable && !hasContent ? 'bg-gray-50/50 dark:bg-gray-900/50' : ''}
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Date header */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-gray-100 dark:border-gray-800">
        <span
          className={`
            text-sm font-medium
            ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'}
          `}
        >
          {format(day, compact ? 'd' : 'EEE d')}
        </span>
        {isHoliday && (
          <span className="text-xs text-amber-600 dark:text-amber-400">Holiday</span>
        )}
        {/* Copy button - only show on hover for editable cells with content */}
        {editable && hasContent && isHovered && (
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            title="Copy to another day"
          >
            <Copy className="w-3.5 h-3.5 text-gray-500" />
          </button>
        )}
      </div>

      {/* Content area */}
      <div className={`${compact ? 'p-1' : 'p-2'} ${compact ? 'min-h-[40px]' : 'min-h-[80px]'}`}>
        {editable ? (
          <RichTextEditor
            content={content}
            onChange={handleContentChange}
            placeholder="Add lesson plan..."
            editable={true}
            showToolbar={false}
            className="text-sm prose-sm"
          />
        ) : (
          <div className="text-sm text-gray-700 dark:text-gray-300 prose prose-sm dark:prose-invert max-w-none">
            {hasContent ? (
              <RichTextEditor
                content={content}
                onChange={() => {}}
                editable={false}
                showToolbar={false}
                className="text-sm"
              />
            ) : (
              <span className="text-gray-400 dark:text-gray-500 italic">No plan</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
