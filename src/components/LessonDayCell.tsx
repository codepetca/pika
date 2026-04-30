'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import { useMarkdownPreference } from '@/contexts/MarkdownPreferenceContext'
import { getLessonPlanMarkdown } from '@/lib/lesson-plan-content'
import { Tooltip } from '@/ui'
import type { Announcement, Assignment, LessonPlan } from '@/types'

// Helper to check if announcement is scheduled (not yet published)
function isScheduled(announcement: Announcement): boolean {
  if (!announcement.scheduled_for) return false
  return new Date(announcement.scheduled_for) > new Date()
}

function AnnouncementTooltipContent({ announcements }: { announcements: Announcement[] }) {
  return (
    <div className="w-[min(14rem,calc(100vw-2rem))] text-left text-sm leading-5 whitespace-pre-wrap break-words">
      {announcements.map((announcement, index) => (
        <p key={announcement.id} className={index > 0 ? 'mt-3' : undefined}>
          {announcement.content}
        </p>
      ))}
    </div>
  )
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
  plainTextOnly?: boolean
  onContentChange?: (date: string, contentMarkdown: string) => void
  onAssignmentClick?: (assignment: Assignment) => void
  onAnnouncementClick?: () => void
}

type MarkdownShortcut = 'bold' | 'italic' | 'code' | 'unordered-list' | 'heading-3'

type ShortcutResult = {
  value: string
  selectionStart: number
  selectionEnd: number
}

function applyWrapShortcut(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  open: string,
  close = open
): ShortcutResult {
  const selected = value.slice(selectionStart, selectionEnd)
  const replacement = `${open}${selected}${close}`
  const nextValue = `${value.slice(0, selectionStart)}${replacement}${value.slice(selectionEnd)}`

  if (selectionStart === selectionEnd) {
    return {
      value: nextValue,
      selectionStart: selectionStart + open.length,
      selectionEnd: selectionStart + open.length,
    }
  }

  return {
    value: nextValue,
    selectionStart: selectionStart + open.length,
    selectionEnd: selectionStart + open.length + selected.length,
  }
}

function toggleLinePrefix(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string
): ShortcutResult {
  const blockStart = value.lastIndexOf('\n', Math.max(selectionStart - 1, 0)) + 1
  const nextBreak = value.indexOf('\n', selectionEnd)
  const blockEnd = nextBreak === -1 ? value.length : nextBreak
  const block = value.slice(blockStart, blockEnd)
  const lines = block.split('\n')
  const shouldRemove = lines.every((line) => line.trim().length === 0 || line.startsWith(prefix))
  const updated = lines.map((line) => {
    if (line.trim().length === 0) return line
    if (shouldRemove) {
      return line.startsWith(prefix) ? line.slice(prefix.length) : line
    }
    return `${prefix}${line}`
  })
  const replacement = updated.join('\n')

  return {
    value: `${value.slice(0, blockStart)}${replacement}${value.slice(blockEnd)}`,
    selectionStart: blockStart,
    selectionEnd: blockStart + replacement.length,
  }
}

export function applyMarkdownShortcut(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  shortcut: MarkdownShortcut
): ShortcutResult {
  if (shortcut === 'bold') {
    return applyWrapShortcut(value, selectionStart, selectionEnd, '**')
  }
  if (shortcut === 'italic') {
    return applyWrapShortcut(value, selectionStart, selectionEnd, '*')
  }
  if (shortcut === 'code') {
    return applyWrapShortcut(value, selectionStart, selectionEnd, '`')
  }
  if (shortcut === 'unordered-list') {
    return toggleLinePrefix(value, selectionStart, selectionEnd, '- ')
  }
  return toggleLinePrefix(value, selectionStart, selectionEnd, '### ')
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
  const markdown = useMemo(() => getLessonPlanMarkdown(lessonPlan).markdown, [lessonPlan])
  const { showMarkdown } = useMarkdownPreference()
  const [isEditing, setIsEditing] = useState(false)
  const [localMarkdown, setLocalMarkdown] = useState(markdown)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const renderPlainText = plainTextOnly || !showMarkdown

  useEffect(() => {
    if (!isEditing) {
      setLocalMarkdown(markdown)
    }
  }, [markdown, isEditing])

  useEffect(() => {
    if (!isEditing) return
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.focus()
    const cursor = textarea.value.length
    textarea.setSelectionRange(cursor, cursor)
  }, [isEditing])

  const handleStartEditing = useCallback(() => {
    if (!editable) return
    setLocalMarkdown(markdown)
    setIsEditing(true)
  }, [editable, markdown])

  const handleMarkdownChange = useCallback((nextMarkdown: string) => {
    setLocalMarkdown(nextMarkdown)
    onContentChange?.(date, nextMarkdown)
  }, [date, onContentChange])

  const applyShortcut = useCallback((shortcut: MarkdownShortcut) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const result = applyMarkdownShortcut(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
      shortcut
    )

    handleMarkdownChange(result.value)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd)
    })
  }, [handleMarkdownChange])

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showMarkdown) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsEditing(false)
      }
      return
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault()
      applyShortcut('bold')
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
      event.preventDefault()
      applyShortcut('italic')
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.altKey && event.key.toLowerCase() === 'l') {
      event.preventDefault()
      applyShortcut('unordered-list')
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.altKey && event.key === '3') {
      event.preventDefault()
      applyShortcut('heading-3')
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setIsEditing(false)
    }
  }, [applyShortcut, showMarkdown])

  const hasContent = markdown.trim().length > 0
  const plainText = useMemo(() => {
    if (!renderPlainText || !hasContent) return ''
    return markdown
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^\s*[-*]\s+/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }, [renderPlainText, hasContent, markdown])
  const previewClassName = compact || plainTextOnly
    ? 'space-y-1 text-[10px] leading-tight [&_p]:text-[10px] [&_p]:leading-tight [&_ul]:text-[10px] [&_ol]:text-[10px] [&_blockquote]:text-[10px] [&_h1]:text-xs [&_h2]:text-[11px] [&_h3]:text-[10px]'
    : 'space-y-2 text-sm leading-snug [&_p]:text-sm [&_ul]:text-sm [&_ol]:text-sm [&_blockquote]:text-sm [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm'
  const plainTextClassName = compact || plainTextOnly
    ? 'text-[10px] leading-tight text-text-muted line-clamp-3 whitespace-pre-wrap'
    : 'text-sm leading-snug text-text-muted whitespace-pre-wrap'

  // Weekend cells are narrow and minimal
  if (isWeekend) {
    const assignmentTitles = assignments.map(a => a.is_draft ? `[Draft] ${a.title}` : a.title).join(', ')
    const announcementCount = announcements.length

    return (
      <div
        className={`
          h-full bg-surface-2
          ${isToday ? 'ring-2 ring-inset ring-blue-500' : ''}
        `}
      >
        <div className={`px-0.5 ${compact ? 'py-0' : 'py-0.5'} text-center`}>
          <span className={`font-medium text-text-muted ${compact ? 'text-xs' : 'text-sm'}`}>
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
                className={`w-full min-w-[12px] rounded bg-primary hover:bg-primary-hover cursor-pointer ${compact ? 'h-4' : 'h-6'} ${
                  assignments.some(a => a.is_draft) ? 'opacity-50' : ''
                }`}
              />
            </Tooltip>
          </div>
        )}
        {/* Weekend announcement pill - no text, tooltip on hover */}
        {announcementCount > 0 && (
          <div className="px-0.5 mt-0.5 flex items-start justify-center">
            <Tooltip
              content={<AnnouncementTooltipContent announcements={announcements} />}
              side="right"
              align="start"
            >
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
      onClick={() => {
        if (!isEditing) {
          handleStartEditing()
        }
      }}
      className={`
        relative h-full min-w-0 overflow-hidden flex flex-col
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
            ${compact ? 'text-xs' : 'text-sm'}
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
            <Tooltip key={assignment.id} content={assignment.is_draft ? `[Draft] ${assignment.title}` : assignment.title}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onAssignmentClick?.(assignment)
                }}
                className={`w-full min-w-0 rounded bg-primary text-white font-medium hover:bg-primary-hover text-center truncate ${
                  compact ? 'text-[10px] px-0.5 py-px' : 'text-xs px-2 py-1'
                } ${assignment.is_draft ? 'opacity-50' : ''}`}
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

            return (
              <Tooltip
                key={announcement.id}
                content={<AnnouncementTooltipContent announcements={[announcement]} />}
                align="start"
              >
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
                      ? 'bg-amber-500/40 text-amber-800 hover:bg-amber-500/60'
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
      <div className={`calendar-day-text flex-1 min-h-0 ${compact ? 'px-0.5' : 'px-2 py-0.5'} [&_.ProseMirror]:!p-0 [&_.ProseMirror_p]:!my-0 overflow-hidden`}>
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={localMarkdown}
            onChange={(event) => handleMarkdownChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => setIsEditing(false)}
            className={`w-full h-full resize-none border-none bg-transparent text-text-default focus:outline-none ${showMarkdown ? 'font-mono' : ''} ${compact ? 'text-[10px] leading-tight' : 'text-sm leading-snug'}`}
          />
        ) : (
          <button
            type="button"
            onClick={handleStartEditing}
            className={`w-full text-left ${editable ? 'cursor-text' : 'cursor-default'}`}
          >
            {hasContent ? (
              renderPlainText ? (
                <div className={plainTextClassName}>
                  {plainText}
                </div>
              ) : (
                <LimitedMarkdown
                  content={markdown}
                  className={`${previewClassName} text-text-muted`.trim()}
                  emptyPlaceholder={null}
                />
              )
            ) : null}
          </button>
        )}
      </div>
    </div>
  )
})
