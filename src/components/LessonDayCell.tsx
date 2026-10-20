'use client'

import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { AnnouncementContent } from '@/components/AnnouncementContent'
import { useLessonCellMotion } from './useLessonCellMotion'
import { MarkdownContentEditor } from '@/components/editor'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import { getAnnouncementCalendarLabel, normalizeAnnouncementTitle } from '@/lib/announcements'
import { isCalendarAnnouncementScheduled } from '@/lib/calendar-items'
import { useMarkdownPreference } from '@/contexts/MarkdownPreferenceContext'
import { getLessonPlanMarkdown } from '@/lib/lesson-plan-content'
import { Button, Tooltip } from '@/ui'
import type { Announcement, Assignment, LessonPlan, TestAssessment } from '@/types'

// Helper to check if announcement is scheduled (not yet published)
function isScheduled(announcement: Announcement): boolean {
  return isCalendarAnnouncementScheduled(announcement)
}

function AnnouncementTooltipContent({ announcements }: { announcements: Announcement[] }) {
  return (
    <div className="w-[min(14rem,calc(100vw-2rem))] md:w-[28rem] text-left text-sm leading-5 break-words">
      {announcements.map((announcement, index) => {
        const title = normalizeAnnouncementTitle(announcement.title)

        return (
          <div key={announcement.id} className={index > 0 ? 'mt-3' : undefined}>
            {title && (
              <p className="mb-1 text-xs font-semibold text-text-default">
                {title}
              </p>
            )}
            <AnnouncementContent content={announcement.content} />
          </div>
        )
      })}
    </div>
  )
}

interface LessonDayCellProps {
  date: string // YYYY-MM-DD
  day: Date
  lessonPlan: LessonPlan | null
  tests?: TestAssessment[]
  assignments?: Assignment[]
  announcements?: Announcement[]
  isWeekend: boolean
  isToday: boolean
  isClassDay?: boolean // undefined means class days not initialized
  editable: boolean
  compact?: boolean
  plainTextOnly?: boolean
  layout?: 'grid' | 'agenda'
  onPresentDay?: () => void
  onEditingStart?: () => void
  onEditingEnd?: () => void
  onContentChange?: (date: string, contentMarkdown: string) => void
  onTestClick?: (test: TestAssessment) => void
  onAssignmentClick?: (assignment: Assignment) => void
  onAnnouncementClick?: () => void
}

export const LessonDayCell = memo(function LessonDayCell({
  date,
  day,
  lessonPlan,
  tests = [],
  assignments = [],
  announcements = [],
  isWeekend,
  isToday,
  isClassDay,
  editable,
  compact = false,
  plainTextOnly = false,
  layout = 'grid',
  onPresentDay,
  onEditingStart,
  onEditingEnd,
  onContentChange,
  onTestClick,
  onAssignmentClick,
  onAnnouncementClick,
}: LessonDayCellProps) {
  const markdown = useMemo(() => getLessonPlanMarkdown(lessonPlan).markdown, [lessonPlan])
  const { showMarkdown } = useMarkdownPreference()
  const [editingDate, setEditingDate] = useState<string | null>(null)
  const isEditing = editingDate === date && editable && !isWeekend
  const { outerRef, innerRef, prepare, settle: settleMotion } = useLessonCellMotion(isEditing, `${date}:${layout}:${editable}`, compact)
  const [localMarkdown, setLocalMarkdown] = useState(markdown)
  const agendaHeadingId = useId()
  const editActionRef = useRef<HTMLButtonElement | null>(null)
  const renderPlainText = plainTextOnly || !showMarkdown

  useEffect(() => {
    if (!isEditing) {
      setLocalMarkdown(markdown)
    }
  }, [markdown, isEditing])

  const focusReturnRef = useRef(false)
  useLayoutEffect(() => {
    setEditingDate(null)
    focusReturnRef.current = false
  }, [date, layout, editable])
  useLayoutEffect(() => {
    if (!isEditing && focusReturnRef.current) {
      focusReturnRef.current = false
      editActionRef.current?.focus({ preventScroll: true })
    }
  }, [isEditing])

  const handleStartEditing = useCallback(() => {
    if (!editable || isWeekend || isEditing) return
    focusReturnRef.current = false
    prepare()
    setLocalMarkdown(markdown)
    setEditingDate(date)
    onEditingStart?.()
  }, [date, editable, isEditing, isWeekend, markdown, onEditingStart, prepare])

  const finishEditing = (restoreFocus = false) => {
    prepare()
    setEditingDate(null)
    onEditingEnd?.()
    focusReturnRef.current = restoreFocus
  }

  const handleMarkdownChange = useCallback((nextMarkdown: string) => {
    settleMotion()
    setLocalMarkdown(nextMarkdown)
    onContentChange?.(date, nextMarkdown)
  }, [date, onContentChange, settleMotion])

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

  const testLinks = tests.map(test => (
    <Tooltip key={test.id} content={`Test: ${test.title}${test.status === 'draft' ? ' [Draft]' : ''}`}>
      <Button variant="ghost" size="sm" aria-label={`Test: ${test.title}${test.status === 'draft' ? ' [Draft]' : ''}`}
        onClick={event => { event.stopPropagation(); onTestClick?.(test) }}
        className="w-full overflow-hidden bg-info-bg px-0.5 text-primary">
        <span className="truncate">Test: {test.title}{test.status === 'draft' ? ' [Draft]' : ''}</span>
      </Button>
    </Tooltip>
  ))

  if (layout === 'agenda') {
    const nonClassDay = isWeekend || isClassDay === false
    const canEdit = editable && !isWeekend

    return (
      <article
        aria-labelledby={agendaHeadingId}
        aria-describedby={nonClassDay ? `${agendaHeadingId}-status` : undefined}
        className={`flex min-w-0 gap-3 px-3 sm:gap-6 sm:px-5 ${
          nonClassDay && !hasContent && assignments.length === 0 && announcements.length === 0 && tests.length === 0 ? 'py-3' : 'py-5'
        } ${nonClassDay ? 'bg-surface-3' : ''} ${isToday ? 'ring-2 ring-inset ring-primary' : ''}`}
      >
        {nonClassDay && <span id={`${agendaHeadingId}-status`} hidden>No class</span>}
        <div className="flex w-11 shrink-0 flex-col items-start gap-1 sm:w-24">
          <Button
            id={agendaHeadingId}
            variant="ghost"
            size="sm"
            onClick={onPresentDay}
            aria-label={`Open ${format(day, 'EEEE, MMMM d, yyyy')}`}
            className="flex-col items-start px-0 text-left"
          >
            <span className="text-xs font-medium text-text-muted">{format(day, 'EEE')}</span>
            <time dateTime={date} aria-current={isToday ? 'date' : undefined} className={`text-xl font-semibold leading-tight ${nonClassDay ? 'text-text-muted' : 'text-text-default'}`}>{format(day, 'd')}</time>
          </Button>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div
            ref={outerRef}
            className={`transition-[height] duration-standard ease-standard motion-reduce:transition-none calendar-day-text relative min-w-0 flex-none break-words text-sm leading-relaxed text-text-default [&_pre]:max-w-full [&_pre]:overflow-x-auto ${!isEditing ? 'flex flex-col justify-center' : ''} ${canEdit && !isEditing ? 'min-h-control cursor-text' : ''}`}
            onClick={event => {
              if (canEdit && !isEditing && !(event.target as Element).closest('a, button')) handleStartEditing()
            }}
          >
            <div ref={innerRef} className="relative min-w-0">
              {canEdit && !isEditing && (
                <Button
                  ref={editActionRef}
                  variant="ghost"
                  size="sm"
                  aria-label={`${hasContent ? 'Edit' : 'Add'} lesson for ${format(day, 'MMMM d, yyyy')}`}
                  onClick={handleStartEditing}
                  className="absolute inset-0 h-full w-full cursor-text p-0"
                />
              )}
              {isEditing && canEdit ? (
                <MarkdownContentEditor
                  markdown={localMarkdown}
                  onMarkdownChange={handleMarkdownChange}
                  onBlur={() => finishEditing()}
                  onEscape={() => finishEditing(true)}
                  toolbarPreset="brief"
                  autoFocus
                  placeholder=""
                  aria-label={`Lesson plan for ${format(day, 'MMMM d, yyyy')}`}
                  className="[&_.ProseMirror]:min-h-control [&_.ProseMirror]:text-sm [&_.ProseMirror]:leading-relaxed"
                />
              ) : hasContent ? (
                renderPlainText ? <div className={canEdit ? 'relative whitespace-pre-wrap' : 'whitespace-pre-wrap'}>{plainText}</div> : (
                  <LimitedMarkdown
                    content={markdown}
                    className={`space-y-3 text-sm leading-relaxed [&_p]:text-sm [&_ul]:text-sm [&_ol]:text-sm [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-base ${canEdit ? 'relative' : ''}`}
                    emptyPlaceholder={null}
                  />
                )
              ) : !nonClassDay ? (
                <p className={`text-sm text-text-muted ${canEdit ? 'relative' : ''}`}>{canEdit ? 'No lesson planned' : 'No lesson posted'}</p>
              ) : null}
            </div>
          </div>

          {(assignments.length > 0 || announcements.length > 0 || tests.length > 0) && (
            <div className="flex min-w-0 flex-wrap gap-2">
              {tests.map(test => (
                <Button key={test.id} variant="ghost" size="sm" onClick={() => onTestClick?.(test)}
                  className="max-w-full whitespace-normal bg-info-bg px-3 py-2 text-left text-primary">
                  <span className="min-w-0 break-words">Test: {test.title}{test.status === 'draft' ? ' [Draft]' : ''}</span>
                </Button>
              ))}
              {assignments.map(assignment => (
                <Button key={assignment.id} variant="ghost" size="sm" onClick={() => onAssignmentClick?.(assignment)}
                  className="h-auto min-w-0 max-w-full whitespace-normal bg-info-bg px-3 py-2 text-left text-primary">
                  <span className="min-w-0 break-words">Due: {assignment.title}{assignment.is_draft ? ' [Draft]' : ''}</span>
                </Button>
              ))}
              {announcements.map(announcement => {
                const calendarLabel = getAnnouncementCalendarLabel(announcement, isScheduled(announcement))
                return (
                  <Tooltip key={announcement.id} content={<AnnouncementTooltipContent announcements={[announcement]} />}
                    className="md:max-w-none" align="start" interactive>
                    <Button variant="ghost" size="sm" onClick={onAnnouncementClick} aria-label={calendarLabel}
                      className="h-auto min-w-0 max-w-full whitespace-normal bg-warning-bg px-3 py-2 text-left text-warning">
                      <span className="min-w-0 break-words">{calendarLabel}</span>
                    </Button>
                  </Tooltip>
                )
              })}
            </div>
          )}
        </div>
      </article>
    )
  }

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
        {tests.length > 0 && <div className="space-y-0.5 px-0.5">{testLinks}</div>}
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
              className="md:max-w-none"
              side="right"
              align="start"
              interactive
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
      onClick={event => {
        if (editable) {
          event.stopPropagation()
          if (!isEditing) handleStartEditing()
        }
      }}
      className={`
        relative h-full min-w-0 overflow-hidden flex flex-col
        ${isToday ? 'ring-2 ring-inset ring-blue-500' : ''}
        ${isEditing && !isToday ? 'ring-2 ring-inset ring-primary' : ''}
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

      {tests.length > 0 && <div className="space-y-0.5 px-0.5">{testLinks}</div>}
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
                className={`w-full min-w-0 rounded bg-primary-solid text-text-inverse font-medium hover:bg-primary-solid-hover text-center truncate ${
                  compact ? 'text-[10px] px-0.5 py-px' : 'text-xs px-2 py-1'
                } ${assignment.is_draft ? 'opacity-50' : ''}`}
              >
                Due: {assignment.title}
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
            const calendarLabel = getAnnouncementCalendarLabel(announcement, scheduled)

            return (
              <Tooltip
                key={announcement.id}
                content={<AnnouncementTooltipContent announcements={[announcement]} />}
                className="md:max-w-none"
                align="start"
                interactive
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onAnnouncementClick?.()
                  }}
                  title={calendarLabel}
                  aria-label={calendarLabel}
                  className={`w-full min-w-0 rounded font-medium text-center truncate ${
                    compact ? 'text-[10px] px-0.5 py-px' : 'text-xs px-2 py-1'
                  } ${
                    scheduled
                      ? 'bg-amber-500/40 text-amber-800 hover:bg-amber-500/60'
                      : 'bg-amber-500 text-white hover:bg-amber-600'
                  }`}
                >
                  {calendarLabel}
                </button>
              </Tooltip>
            )
          })}
        </div>
      )}

      {/* Content area */}
      <div className={`calendar-day-text min-h-0 ${compact ? 'px-0.5' : 'px-2 py-0.5'} [&_.ProseMirror]:!p-0 [&_.ProseMirror_p]:!my-0 overflow-hidden`}>
        <div ref={outerRef} className="transition-[height] duration-standard ease-standard motion-reduce:transition-none">
          <div ref={innerRef}>
            {isEditing ? (
              <MarkdownContentEditor
                markdown={localMarkdown}
                onMarkdownChange={handleMarkdownChange}
                onBlur={() => finishEditing()}
                onEscape={() => finishEditing(true)}
                toolbarPreset="brief"
                autoFocus
                placeholder=""
                aria-label={`Lesson plan for ${format(day, 'MMMM d, yyyy')}`}
                className={`[&_.simple-editor-content]:overflow-hidden [&_.ProseMirror]:!min-h-0 [&_.ProseMirror]:!p-0 ${
                  compact ? '[&_.ProseMirror]:text-[10px] [&_.ProseMirror]:leading-tight' : '[&_.ProseMirror]:text-sm [&_.ProseMirror]:leading-snug'
                }`}
              />
            ) : (
              <button
                ref={editActionRef}
                type="button"
                aria-label={editable ? `${hasContent ? 'Edit' : 'Add'} lesson for ${format(day, 'MMMM d, yyyy')}` : undefined}
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
      </div>
    </div>
  )
})
