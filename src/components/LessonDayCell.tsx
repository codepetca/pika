'use client'

import { useCallback, useMemo, memo } from 'react'
import { format } from 'date-fns'
import { RichTextEditor } from '@/components/editor/RichTextEditor'
import { extractTextFromTiptap } from '@/lib/lesson-plan-markdown'
import { Tooltip } from '@/ui'
import type { LessonPlan, TiptapContent, Assignment, Announcement } from '@/types'

const EMPTY_CONTENT: TiptapContent = { type: 'doc', content: [] }

// Helper to check if announcement is scheduled (not yet published)
function isScheduled(announcement: Announcement): boolean {
  if (!announcement.scheduled_for) return false
  return new Date(announcement.scheduled_for) > new Date()
}

interface LessonDayCellProps {
  date: string // YYYY-MM-DD
  day: Date
  lessonPlan: LessonPlan | null
  assignments?: Assignment[]
  announcements?: Announcement[]
  isWeekend: boolean
  isToday: boolean
  isClassDay?: boolean // undefined means class days not initialized
  editable: boolean
  compact?: boolean
  plainTextOnly?: boolean // Force plain text rendering (for 'all' view performance)
  onContentChange?: (date: string, content: TiptapContent) => void
  onAssignmentClick?: (assignment: Assignment) => void
  onAnnouncementClick?: () => void
}

export const LessonDayCell = memo(function LessonDayCell({
  date,
  day,
  lessonPlan,
  assignments = [],
  announcements = [],
  isWeekend,
  isToday,
  isClassDay,
  editable,
  compact = false,
  plainTextOnly = false,
  onContentChange,
  onAssignmentClick,
  onAnnouncementClick,
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
    const announcementCount = announcements.length

    return (
      <div
        className={`
          h-full bg-surface-2
          ${isToday ? 'ring-2 ring-inset ring-blue-500' : ''}
        `}
      >
        <div className={`px-0.5 ${compact ? 'py-0' : 'py-0.5'} text-center`}>
          <span className={`font-medium text-text-muted ${compact ? 'text-[10px]' : 'text-sm'}`}>
            {format(day, 'd')}
          </span>
        </div>
        {/* Weekend assignment pill - no text, tooltip on hover */}
        {assignments.length > 0 && (
          <div className="px-0.5 flex items-start justify-center">
            <Tooltip content={assignmentTitles} side="right">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  if (assignments.length === 1) {
                    onAssignmentClick?.(assignments[0])
                  }
                }}
                className={`w-full min-w-[12px] rounded bg-primary hover:bg-primary-hover cursor-pointer ${compact ? 'h-4' : 'h-6'}`}
              />
            </Tooltip>
          </div>
        )}
        {/* Weekend announcement pill - no text, tooltip on hover */}
        {announcementCount > 0 && (
          <div className="px-0.5 mt-0.5 flex items-start justify-center">
            <Tooltip content={`${announcementCount} announcement${announcementCount > 1 ? 's' : ''}`} side="right">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onAnnouncementClick?.()
                }}
                className={`w-full min-w-[12px] rounded cursor-pointer ${compact ? 'h-4' : 'h-6'} ${
                  announcements.some(isScheduled)
                    ? 'bg-amber-500/40 hover:bg-amber-500/60'
                    : 'bg-amber-500 hover:bg-amber-600'
                }`}
              />
            </Tooltip>
          </div>
        )}
      </div>
    )
  }

  // Non-class day (explicitly false, not undefined) gets a gray background
  // Class days data is the source of truth - no special holiday styling
  const isNonClassDay = isClassDay === false

  return (
    <div
      className={`
        relative h-full min-w-0 overflow-hidden
        ${isToday ? 'ring-2 ring-inset ring-blue-500' : ''}
        ${isNonClassDay ? 'bg-surface-2/50' : ''}
        ${!editable && !hasContent && !isNonClassDay ? 'bg-surface-2/50' : ''}
      `}
    >
      {/* Date header */}
      <div className={`px-1 ${compact ? 'py-0' : 'py-0.5'} text-right`}>
        <span
          className={`
            font-medium
            ${compact ? 'text-[10px]' : 'text-sm'}
            ${isToday ? 'text-primary' : 'text-text-muted'}
          `}
        >
          {format(day, 'd')}
        </span>
      </div>

      {/* Assignment due dates - shown first */}
      {assignments.length > 0 && (
        <div className={`min-w-0 ${compact ? 'px-0.5 space-y-0.5' : 'px-1 pb-1 space-y-1'}`}>
          {assignments.map((assignment) => (
            <Tooltip key={assignment.id} content={assignment.title}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onAssignmentClick?.(assignment)
                }}
                className={`w-full min-w-0 rounded bg-primary text-white font-medium hover:bg-primary-hover text-center truncate ${
                  compact ? 'text-[10px] px-0.5 py-px' : 'text-xs px-2 py-1'
                }`}
              >
                {compact ? assignment.title : `Due: ${assignment.title}`}
              </button>
            </Tooltip>
          ))}
        </div>
      )}

      {/* Announcements - shown after assignments */}
      {announcements.length > 0 && (
        <div className={`min-w-0 ${compact ? 'px-0.5 space-y-0.5' : 'px-1 pb-1 space-y-1'}`}>
          {announcements.map((announcement) => {
            const scheduled = isScheduled(announcement)
            const tooltipText = scheduled
              ? `(Scheduled) ${announcement.content.slice(0, 80)}${announcement.content.length > 80 ? '...' : ''}`
              : announcement.content.slice(0, 100) + (announcement.content.length > 100 ? '...' : '')

            return (
              <Tooltip key={announcement.id} content={tooltipText}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onAnnouncementClick?.()
                  }}
                  className={`w-full min-w-0 rounded font-medium text-center truncate ${
                    compact ? 'text-[10px] px-0.5 py-px' : 'text-xs px-2 py-1'
                  } ${
                    scheduled
                      ? 'bg-amber-500/40 text-amber-900 dark:text-amber-200 hover:bg-amber-500/60'
                      : 'bg-amber-500 text-white hover:bg-amber-600'
                  }`}
                >
                  {compact ? (scheduled ? 'Scheduled' : 'Announcement') : (scheduled ? 'Scheduled' : 'Announcement')}
                </button>
              </Tooltip>
            )
          })}
        </div>
      )}

      {/* Content area */}
      <div className={`${compact ? 'px-0.5' : 'px-2 py-0.5'} [&_.ProseMirror]:!p-0 [&_.ProseMirror_p]:!my-0 overflow-hidden`}>
        {plainTextOnly ? (
          // Plain text mode: lightweight rendering for 'all' view performance
          hasContent && (
            <div className="text-[10px] leading-tight text-text-muted line-clamp-3 whitespace-pre-wrap">
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
          <div className={`${compact ? 'text-xs' : 'text-sm'} text-text-muted`}>
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
