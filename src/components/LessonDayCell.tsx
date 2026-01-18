'use client'

import { useCallback, useMemo, memo } from 'react'
import { format } from 'date-fns'
import { RichTextEditor } from '@/components/editor/RichTextEditor'
import { extractTextFromTiptap } from '@/lib/lesson-plan-markdown'
import type { LessonPlan, TiptapContent, Assignment } from '@/types'

const EMPTY_CONTENT: TiptapContent = { type: 'doc', content: [] }

interface LessonDayCellProps {
  date: string // YYYY-MM-DD
  day: Date
  lessonPlan: LessonPlan | null
  assignments?: Assignment[]
  isWeekend: boolean
  isToday: boolean
  isHoliday: boolean
  isClassDay?: boolean // undefined means class days not initialized
  editable: boolean
  compact?: boolean
  plainTextOnly?: boolean // Force plain text rendering (for 'all' view performance)
  onContentChange?: (date: string, content: TiptapContent) => void
  onAssignmentClick?: (assignment: Assignment) => void
}

export const LessonDayCell = memo(function LessonDayCell({
  date,
  day,
  lessonPlan,
  assignments = [],
  isWeekend,
  isToday,
  isHoliday,
  isClassDay,
  editable,
  compact = false,
  plainTextOnly = false,
  onContentChange,
  onAssignmentClick,
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

  // For plain text mode, extract text (avoids creating heavy Tiptap editor instances)
  const plainText = useMemo(() => {
    if (!plainTextOnly || !hasContent) return ''
    return extractTextFromTiptap(content)
  }, [plainTextOnly, hasContent, content])

  // Weekend cells are narrow and minimal
  if (isWeekend) {
    const assignmentTitles = assignments.map(a => a.title).join(', ')

    return (
      <div
        className={`
          h-full bg-gray-50 dark:bg-gray-900
          ${isToday ? 'ring-2 ring-inset ring-blue-500' : ''}
        `}
      >
        <div className={`px-0.5 ${compact ? 'py-0' : 'py-0.5'} text-center`}>
          <span className={`font-medium text-gray-400 dark:text-gray-500 ${compact ? 'text-[10px]' : 'text-sm'}`}>
            {format(day, 'd')}
          </span>
        </div>
        {/* Weekend assignment pill - no text, tooltip on hover */}
        {assignments.length > 0 && (
          <div className="px-0.5 flex items-start justify-center">
            <div className="relative group">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  if (assignments.length === 1) {
                    onAssignmentClick?.(assignments[0])
                  }
                }}
                className={`w-full min-w-[12px] rounded bg-blue-500 dark:bg-blue-600 hover:bg-blue-600 dark:hover:bg-blue-700 cursor-pointer ${compact ? 'h-4' : 'h-6'}`}
                title={assignmentTitles}
              />
              <div className="absolute left-full top-1/2 -translate-y-1/2 ml-1 px-2 py-1 text-xs bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-[100]">
                {assignmentTitles}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Non-class day (explicitly false, not undefined) gets a gray background
  const isNonClassDay = isClassDay === false

  return (
    <div
      className={`
        relative h-full overflow-hidden
        ${isToday ? 'ring-2 ring-inset ring-blue-500' : ''}
        ${isHoliday ? 'bg-amber-50 dark:bg-amber-900/20' : ''}
        ${isNonClassDay ? 'bg-gray-100 dark:bg-gray-800/50' : ''}
        ${!editable && !hasContent && !isNonClassDay ? 'bg-gray-50/50 dark:bg-gray-900/50' : ''}
      `}
    >
      {/* Date header */}
      <div className={`px-1 ${compact ? 'py-0' : 'py-0.5'} text-right`}>
        <span
          className={`
            font-medium
            ${compact ? 'text-[10px]' : 'text-sm'}
            ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'}
          `}
        >
          {format(day, 'd')}
        </span>
      </div>

      {/* Assignment due dates - shown first */}
      {assignments.length > 0 && (
        <div className={compact ? 'px-0.5 space-y-0.5' : 'px-1 pb-1 space-y-1'}>
          {assignments.map((assignment) => (
            <button
              key={assignment.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onAssignmentClick?.(assignment)
              }}
              className={`w-full rounded bg-blue-500 dark:bg-blue-600 text-white font-medium hover:bg-blue-600 dark:hover:bg-blue-700 text-center overflow-hidden text-ellipsis whitespace-nowrap ${
                compact ? 'text-[10px] px-0.5 py-px' : 'text-xs px-2 py-1'
              }`}
              title={assignment.title}
            >
              {compact ? assignment.title : `Due: ${assignment.title}`}
            </button>
          ))}
        </div>
      )}

      {/* Content area */}
      <div className={`${compact ? 'px-0.5' : 'px-2 py-0.5'} [&_.ProseMirror]:!p-0 [&_.ProseMirror_p]:!my-0 overflow-hidden`}>
        {plainTextOnly ? (
          // Plain text mode: lightweight rendering for 'all' view performance
          hasContent && (
            <div className="text-[10px] leading-tight text-gray-600 dark:text-gray-400 line-clamp-3 whitespace-pre-wrap">
              {plainText}
            </div>
          )
        ) : editable ? (
          <RichTextEditor
            content={content}
            onChange={handleContentChange}
            placeholder="Add lesson plan..."
            editable={true}
            showToolbar={false}
            className={compact ? 'text-xs' : 'text-sm'}
          />
        ) : hasContent ? (
          <div className={`${compact ? 'text-xs' : 'text-sm'} text-gray-700 dark:text-gray-300`}>
            <RichTextEditor
              content={content}
              onChange={() => {}}
              editable={false}
              showToolbar={false}
              className={compact ? 'text-xs' : 'text-sm'}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
})
