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
            <div
              className="mx-auto mt-0.5 w-2 h-2 rounded-full bg-blue-500 cursor-pointer"
              title={assignmentTitles}
              onClick={(e) => {
                e.stopPropagation()
                if (assignments.length === 1) {
                  onAssignmentClick?.(assignments[0])
                }
              }}
            />
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
        <div className={`${compact ? 'px-1' : 'px-2'} pb-1 flex flex-wrap gap-1`}>
          {assignments.map((assignment) => (
            <button
              key={assignment.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onAssignmentClick?.(assignment)
              }}
              className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 truncate max-w-full"
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
