'use client'

import { useCallback, memo } from 'react'
import { format } from 'date-fns'
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
}

export const LessonDayCell = memo(function LessonDayCell({
  date,
  day,
  lessonPlan,
  isWeekend,
  isToday,
  isHoliday,
  editable,
  compact = false,
  onContentChange,
}: LessonDayCellProps) {
  const content = lessonPlan?.content || EMPTY_CONTENT

  const handleContentChange = useCallback(
    (newContent: TiptapContent) => {
      onContentChange?.(date, newContent)
    },
    [date, onContentChange]
  )

  // Check if content is empty
  const hasContent = content.content && content.content.length > 0

  // Weekend cells are narrow and minimal
  if (isWeekend) {
    return (
      <div
        className={`
          border-r border-b border-gray-200 dark:border-gray-700
          bg-gray-50 dark:bg-gray-900
          ${isToday ? 'ring-2 ring-inset ring-blue-500' : ''}
        `}
      >
        <div className={`px-1 ${compact ? 'py-0' : 'py-0.5'} text-center`}>
          <span className="text-sm font-medium text-gray-400 dark:text-gray-500">
            {format(day, 'd')}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`
        relative border-r border-b border-gray-200 dark:border-gray-700
        ${isToday ? 'ring-2 ring-inset ring-blue-500' : ''}
        ${isHoliday ? 'bg-amber-50 dark:bg-amber-900/20' : ''}
        ${!editable && !hasContent ? 'bg-gray-50/50 dark:bg-gray-900/50' : ''}
      `}
    >
      {/* Date header */}
      <div className={`px-1 ${compact ? 'py-0' : 'py-0.5'} text-center`}>
        <span
          className={`
            text-sm font-medium
            ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'}
          `}
        >
          {format(day, 'd')}
        </span>
      </div>

      {/* Content area */}
      <div className={`${compact ? 'px-1' : 'px-2 py-0.5'} [&_.ProseMirror]:!p-0 [&_.ProseMirror_p]:!my-0`}>
        {editable ? (
          <RichTextEditor
            content={content}
            onChange={handleContentChange}
            placeholder="Add lesson plan..."
            editable={true}
            showToolbar={false}
            className="text-sm"
          />
        ) : hasContent ? (
          <div className="text-sm text-gray-700 dark:text-gray-300">
            <RichTextEditor
              content={content}
              onChange={() => {}}
              editable={false}
              showToolbar={false}
              className="text-sm"
            />
          </div>
        ) : null}
      </div>
    </div>
  )
})
