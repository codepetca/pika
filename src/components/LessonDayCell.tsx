'use client'

import { useCallback, memo } from 'react'
import { format } from 'date-fns'
import { RichTextEditor } from '@/components/editor/RichTextEditor'
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
  editable: boolean
  compact?: boolean
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
  editable,
  compact = false,
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

  // Weekend cells are narrow and minimal
  if (isWeekend) {
    const hasAssignments = assignments.length > 0
    const assignmentTitles = assignments.map(a => a.title).join(', ')

    return (
      <div
        className={`
          h-full bg-gray-50 dark:bg-gray-900
          ${isToday ? 'ring-2 ring-inset ring-blue-500' : ''}
        `}
      >
        <div className={`px-1 ${compact ? 'py-0' : 'py-0.5'} text-center`}>
          <span className="text-sm font-medium text-gray-400 dark:text-gray-500">
            {format(day, 'd')}
          </span>
          {hasAssignments && (
            <div className="relative group mx-auto mt-0.5">
              <div
                className="w-2 h-2 rounded-full bg-blue-500 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  if (assignments.length === 1) {
                    onAssignmentClick?.(assignments[0])
                  }
                }}
              />
              <div className="absolute left-full top-1/2 -translate-y-1/2 ml-1 px-2 py-1 text-xs bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-[100]">
                {assignmentTitles}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`
        relative h-full
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

      {/* Assignment due dates */}
      {assignments.length > 0 && !compact && (
        <div className={`${compact ? 'px-1' : 'px-1'} pb-1 space-y-1`}>
          {assignments.map((assignment) => (
            <button
              key={assignment.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onAssignmentClick?.(assignment)
              }}
              className="w-full text-xs px-2 py-1 rounded bg-blue-500 dark:bg-blue-600 text-white font-medium hover:bg-blue-600 dark:hover:bg-blue-700 truncate text-left"
              title={assignment.title}
            >
              {assignment.title}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
