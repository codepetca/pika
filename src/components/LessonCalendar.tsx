'use client'

import { useMemo, useState, useEffect } from 'react'
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, isSameDay, startOfMonth, endOfMonth, addMonths, subMonths, isWeekend } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { ChevronLeft, ChevronRight, PanelRight, PanelRightClose } from 'lucide-react'
import { LessonDayCell } from './LessonDayCell'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import { getLessonPlanMarkdown } from '@/lib/lesson-plan-content'
import { useKeyboardShortcutHint } from '@/hooks/use-keyboard-shortcut-hint'
import { DialogPanel, Tooltip } from '@/ui'
import type { Announcement, Assignment, ClassDay, Classroom, LessonPlan } from '@/types'

const TIMEZONE = 'America/Toronto'

export type CalendarViewMode = 'week' | 'month' | 'all'

interface LessonCalendarProps {
  classroom: Classroom
  lessonPlans: LessonPlan[]
  assignments?: Assignment[]
  announcements?: Announcement[]
  classDays?: ClassDay[]
  viewMode: CalendarViewMode
  currentDate: Date
  editable: boolean
  saving?: boolean
  showHeader?: boolean
  onDateChange: (date: Date) => void
  onViewModeChange: (mode: CalendarViewMode) => void
  onContentChange?: (date: string, contentMarkdown: string) => void
  onAssignmentClick?: (assignment: Assignment) => void
  onAnnouncementClick?: () => void
  onMarkdownToggle?: () => void
  isSidebarOpen?: boolean
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Grid columns using fr units for consistent alignment
// Weekends get 0.5fr, weekdays get 2fr each
const GRID_COLUMNS_7 = '0.5fr 2fr 2fr 2fr 2fr 2fr 0.5fr'
// Grid with month column: 24px for month, then same proportions
const GRID_COLUMNS_8 = '24px 0.5fr 2fr 2fr 2fr 2fr 2fr 0.5fr'

// Determine which month a week belongs to (month with 3+ days wins)
function getWeekMonth(week: Date[]): { key: string; name: string } {
  const monthCounts = new Map<string, { count: number; date: Date }>()
  for (const day of week) {
    const monthKey = format(day, 'yyyy-MM')
    const existing = monthCounts.get(monthKey)
    if (existing) {
      existing.count++
    } else {
      monthCounts.set(monthKey, { count: 1, date: day })
    }
  }
  let maxMonth = ''
  let maxCount = 0
  let monthDate: Date = week[0]
  for (const [month, data] of monthCounts) {
    if (data.count > maxCount) {
      maxCount = data.count
      maxMonth = month
      monthDate = data.date
    }
  }
  return { key: maxMonth, name: format(monthDate, 'MMMM') }
}

export function LessonCalendar({
  classroom,
  lessonPlans,
  assignments = [],
  announcements = [],
  classDays = [],
  viewMode,
  currentDate,
  editable,
  saving = false,
  showHeader = true,
  onDateChange,
  onViewModeChange,
  onContentChange,
  onAssignmentClick,
  onAnnouncementClick,
  onMarkdownToggle,
  isSidebarOpen = false,
}: LessonCalendarProps) {
  const today = useMemo(() => toZonedTime(new Date(), TIMEZONE), [])
  const [expandedWeekIdx, setExpandedWeekIdx] = useState<number | null>(null)
  const [presentedDay, setPresentedDay] = useState<Date | null>(null)
  const { rightPanel: shortcutHint } = useKeyboardShortcutHint()

  // Build a map of date -> lesson plan for quick lookup
  const plansByDate = useMemo(() => {
    const map = new Map<string, LessonPlan>()
    lessonPlans.forEach((plan) => {
      map.set(plan.date, plan)
    })
    return map
  }, [lessonPlans])

  // Build a map of date -> assignments for quick lookup
  const assignmentsByDate = useMemo(() => {
    const map = new Map<string, Assignment[]>()
    assignments.forEach((assignment) => {
      // Convert due_at to Toronto timezone before extracting date
      const dueInToronto = toZonedTime(new Date(assignment.due_at), TIMEZONE)
      const dueDate = format(dueInToronto, 'yyyy-MM-dd')
      const existing = map.get(dueDate)
      if (existing) {
        existing.push(assignment)
      } else {
        map.set(dueDate, [assignment])
      }
    })
    return map
  }, [assignments])

  // Build a map of date -> announcements for quick lookup
  // Scheduled announcements appear on their scheduled_for date
  // Published announcements appear on their created_at date
  const announcementsByDate = useMemo(() => {
    const map = new Map<string, Announcement[]>()
    announcements.forEach((announcement) => {
      // Use scheduled_for date if scheduled, otherwise created_at
      const isScheduled = announcement.scheduled_for && new Date(announcement.scheduled_for) > new Date()
      const dateToUse = isScheduled ? announcement.scheduled_for! : announcement.created_at
      const dateInToronto = toZonedTime(new Date(dateToUse), TIMEZONE)
      const dateString = format(dateInToronto, 'yyyy-MM-dd')
      const existing = map.get(dateString)
      if (existing) {
        existing.push(announcement)
      } else {
        map.set(dateString, [announcement])
      }
    })
    return map
  }, [announcements])

  // Build a set of class day dates for quick lookup
  const classDayDates = useMemo(() => {
    const set = new Set<string>()
    classDays.forEach((classDay) => {
      if (classDay.is_class_day) {
        set.add(classDay.date)
      }
    })
    return set
  }, [classDays])

  // Calculate days to display based on view mode
  const days = useMemo(() => {
    if (viewMode === 'week') {
      const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 })
      const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 })
      return eachDayOfInterval({ start: weekStart, end: weekEnd })
    }

    if (viewMode === 'month') {
      const monthStart = startOfMonth(currentDate)
      const monthEnd = endOfMonth(currentDate)
      // Extend to full weeks
      const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 })
      const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
      return eachDayOfInterval({ start: calendarStart, end: calendarEnd })
    }

    // 'all' mode: show entire term if available
    if (classroom.start_date && classroom.end_date) {
      const termStart = new Date(classroom.start_date)
      const termEnd = new Date(classroom.end_date)
      // Extend to full weeks
      const calendarStart = startOfWeek(termStart, { weekStartsOn: 0 })
      const calendarEnd = endOfWeek(termEnd, { weekStartsOn: 0 })
      return eachDayOfInterval({ start: calendarStart, end: calendarEnd })
    }

    // Fallback: show current month
    const monthStart = startOfMonth(currentDate)
    const monthEnd = endOfMonth(currentDate)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 })
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd })
  }, [viewMode, currentDate, classroom.start_date, classroom.end_date])

  // Group days into weeks for rendering
  const weeks = useMemo(() => {
    const result: Date[][] = []
    for (let i = 0; i < days.length; i += 7) {
      result.push(days.slice(i, i + 7))
    }
    return result
  }, [days])

  // Find the index of the week containing today
  const todayWeekIdx = useMemo(() => {
    for (let i = 0; i < weeks.length; i++) {
      if (weeks[i].some(day => isSameDay(day, today))) {
        return i
      }
    }
    return null
  }, [weeks, today])

  // Don't auto-expand any week in month/all views - let user click to expand
  useEffect(() => {
    setExpandedWeekIdx(null)
  }, [viewMode])

  useEffect(() => {
    if (viewMode !== 'week') {
      setPresentedDay(null)
    }
  }, [viewMode])

  useEffect(() => {
    setPresentedDay(null)
  }, [currentDate])

  // Calculate month spans for the month label column
  // Returns array of { month: string, monthName: string, startIdx: number, count: number }
  const monthSpans = useMemo(() => {
    if (weeks.length === 0) return []

    const spans: { month: string; monthName: string; startIdx: number; count: number }[] = []
    let current = getWeekMonth(weeks[0])
    let startIdx = 0
    let count = 1

    for (let i = 1; i < weeks.length; i++) {
      const weekMonth = getWeekMonth(weeks[i])
      if (weekMonth.key === current.key) {
        count++
      } else {
        spans.push({
          month: current.key,
          monthName: current.name,
          startIdx,
          count,
        })
        current = weekMonth
        startIdx = i
        count = 1
      }
    }
    // Push the last span
    spans.push({
      month: current.key,
      monthName: current.name,
      startIdx,
      count,
    })

    return spans
  }, [weeks])

  // Navigation handlers
  const handlePrev = () => {
    if (viewMode === 'week') {
      onDateChange(subWeeks(currentDate, 1))
    } else if (viewMode === 'month') {
      onDateChange(subMonths(currentDate, 1))
    }
  }

  const handleNext = () => {
    if (viewMode === 'week') {
      onDateChange(addWeeks(currentDate, 1))
    } else if (viewMode === 'month') {
      onDateChange(addMonths(currentDate, 1))
    }
  }

  const handleToday = () => {
    onDateChange(today)
  }

  const presentedDayDetails = useMemo(() => {
    if (!presentedDay) return null

    const dateString = format(presentedDay, 'yyyy-MM-dd')
    const isWeekendDay = isWeekend(presentedDay)
    const lessonPlan = plansByDate.get(dateString) || null
    const lessonMarkdown = lessonPlan ? getLessonPlanMarkdown(lessonPlan).markdown : ''

    return {
      day: presentedDay,
      dateString,
      lessonPlan,
      lessonMarkdown,
      assignments: assignmentsByDate.get(dateString) || [],
      announcements: announcementsByDate.get(dateString) || [],
      isWeekend: isWeekendDay,
      isToday: isSameDay(presentedDay, today),
      isClassDay: classDays.length > 0 ? classDayDates.has(dateString) : undefined,
    }
  }, [presentedDay, plansByDate, assignmentsByDate, announcementsByDate, today, classDays.length, classDayDates])

  const weekHeaderDays = viewMode === 'week' ? (weeks[0] || []) : []

  // Format header label
  const headerLabel = useMemo(() => {
    if (viewMode === 'week' || viewMode === 'month') {
      return format(currentDate, 'MMMM yyyy')
    }
    // 'all' mode
    if (classroom.start_date && classroom.end_date) {
      return `${format(new Date(classroom.start_date), 'MMM d, yyyy')} - ${format(new Date(classroom.end_date), 'MMM d, yyyy')}`
    }
    return 'All Dates'
  }, [viewMode, currentDate, classroom.start_date, classroom.end_date])

  return (
    <div className="flex flex-col">
      {/* Header with navigation, view mode selector, and actions */}
      {showHeader && (
        <div className="grid grid-cols-3 items-center border-b border-border bg-surface px-4 py-1.5">
          {/* Left: Navigation with month label */}
          <div className="flex items-center gap-1 justify-start">
            {viewMode !== 'all' && (
              <button
                onClick={handlePrev}
                className="rounded p-1 hover:bg-surface-hover"
                aria-label="Previous"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            {viewMode !== 'all' ? (
              <button
                type="button"
                onClick={handleToday}
                className="mx-1 min-w-[120px] rounded px-2 py-0.5 text-center text-lg font-semibold text-text-default hover:bg-surface-hover"
                aria-label="Go to today"
              >
                {headerLabel}
              </button>
            ) : (
              <span className="mx-1 min-w-[120px] text-center text-lg font-semibold text-text-default">
                {headerLabel}
              </span>
            )}
            {viewMode !== 'all' && (
              <>
                <button
                  type="button"
                  onClick={handleNext}
                  className="rounded p-1 hover:bg-surface-hover"
                  aria-label="Next"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </>
            )}
          </div>

          {/* Center: View mode selector */}
          <div className="flex items-center justify-center gap-1">
            {(['week', 'month', 'all'] as CalendarViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => onViewModeChange(mode)}
                className={`rounded-md border px-3 py-0.5 text-sm capitalize transition-colors ${
                  viewMode === mode
                    ? 'border-transparent bg-info-bg text-primary font-medium'
                    : 'border-transparent text-text-muted hover:bg-surface-hover hover:text-text-default'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 justify-end">
            {saving && (
              <span className="text-sm text-text-muted">Saving...</span>
            )}
            {onMarkdownToggle && (
              <Tooltip content={isSidebarOpen ? `Close sidebar (${shortcutHint})` : `Edit as Markdown (${shortcutHint})`}>
                <button
                  onClick={onMarkdownToggle}
                  className="rounded p-1 hover:bg-surface-hover"
                  aria-label={isSidebarOpen ? 'Close sidebar' : 'Edit as Markdown'}
                >
                  {isSidebarOpen ? (
                    <PanelRightClose className="w-5 h-5" />
                  ) : (
                    <PanelRight className="w-5 h-5" />
                  )}
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      )}

      {/* Day headers - only shown outside the grid for non-all modes */}
      {viewMode !== 'all' && (
        <div
          className="grid border-b-2 border-border"
          style={{ gridTemplateColumns: GRID_COLUMNS_7 }}
        >
          {DAY_LABELS.map((label, idx) => {
            const isWeekendDay = idx === 0 || idx === 6
            const isCompactView = viewMode !== 'week'
            const headerLabel = isWeekendDay ? label.charAt(0) : label
            const headerDay = weekHeaderDays[idx]

            if (viewMode === 'week' && headerDay) {
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setPresentedDay(headerDay)}
                  className={`${isCompactView ? 'py-0.5' : 'py-2'} border-r border-border text-center text-sm font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text-default last:border-r-0`}
                  aria-label={`Open ${format(headerDay, 'EEEE, MMMM d, yyyy')}`}
                >
                  {headerLabel}
                </button>
              )
            }

            return (
              <div
                key={label}
                className={`${isCompactView ? 'py-0.5' : 'py-2'} text-center text-sm font-medium border-r border-border last:border-r-0 text-text-muted`}
              >
                {headerLabel}
              </div>
            )
          })}
        </div>
      )}

      {/* Scrollable container for all mode */}
      <div
        className={viewMode === 'all' ? 'overflow-y-auto' : ''}
        style={viewMode === 'all' ? { maxHeight: `calc(100vh - 120px)` } : undefined}
      >
        {/* Calendar grid - in all mode, includes header row */}
        <div
          className={`grid ${viewMode !== 'all' ? 'overflow-visible' : ''}`}
          style={{
            gridTemplateColumns: viewMode === 'all' ? GRID_COLUMNS_8 : GRID_COLUMNS_7,
            gridTemplateRows: viewMode === 'week'
              ? '1fr'
              : viewMode === 'all'
                // First row is sticky header, rest are auto
                ? `auto ${weeks.map(() => 'auto').join(' ')}`
                : weeks.map((_, idx) => {
                    const isExpanded = expandedWeekIdx === idx
                    if (isExpanded) return 'minmax(60px, 1.5fr)'
                    return 'minmax(0, 1fr)'
                  }).join(' '),
            // In month view (not all), calculate height to fit all weeks
            height: viewMode === 'week' ? 'auto' : viewMode === 'all' ? undefined : `calc(100vh - 120px)`,
            minHeight: viewMode === 'week' ? '200px' : undefined,
          }}
        >
        {/* Day header row inside grid - only in all mode */}
        {viewMode === 'all' && (
          <>
            {/* Empty cell for month column */}
            <div
              className="sticky top-0 z-10 bg-surface border-r border-b-2 border-border"
              style={{ gridColumn: 1, gridRow: 1 }}
            />
            {DAY_LABELS.map((label, idx) => {
              const isWeekendDay = idx === 0 || idx === 6
              return (
                <div
                  key={label}
                  className="sticky top-0 z-10 bg-surface py-0.5 text-center text-sm font-medium border-r border-b-2 border-border last:border-r-0 text-text-muted"
                  style={{ gridColumn: idx + 2, gridRow: 1 }}
                >
                  {isWeekendDay ? label.charAt(0) : label}
                </div>
              )
            })}
          </>
        )}

        {/* Render month labels (they span rows) - only in 'all' mode */}
        {viewMode === 'all' && monthSpans.map((span) => (
          <div
            key={span.month}
            className="relative border-b border-r border-border bg-surface-2 flex items-center justify-center overflow-hidden"
            style={{
              gridColumn: 1,
              // +2 because row 1 is header
              gridRow: `${span.startIdx + 2} / span ${span.count}`,
              width: '24px',
            }}
          >
            <span
              className="text-xs font-medium text-text-muted whitespace-nowrap"
              style={{
                writingMode: 'vertical-rl',
                transform: 'rotate(180deg)',
              }}
            >
              {span.monthName}
            </span>
          </div>
        ))}

        {/* Render all day cells */}
        {weeks.map((week, weekIdx) => {
          const isExpanded = expandedWeekIdx === weekIdx
          const isCompactView = viewMode !== 'week'
          // In all mode, rows start at 2 (row 1 is header)
          const rowStart = viewMode === 'all' ? weekIdx + 2 : weekIdx + 1

          return week.map((day, dayIdx) => {
            const dateString = format(day, 'yyyy-MM-dd')
            const lessonPlan = plansByDate.get(dateString) || null
            const isToday = isSameDay(day, today)
            const isWeekendDay = isWeekend(day)
            // Only determine class day status if we have class days data
            const isClassDay = classDays.length > 0 ? classDayDates.has(dateString) : undefined
            // In 'all' mode, column starts at 2 (after month column)
            const colStart = viewMode === 'all' ? dayIdx + 2 : dayIdx + 1

            return (
              <div
                key={dateString}
                className={`border-r border-b border-border overflow-hidden ${isCompactView ? 'cursor-pointer' : ''}`}
                style={{
                  gridColumn: colStart,
                  gridRow: rowStart,
                }}
                onClick={isCompactView ? () => setExpandedWeekIdx(isExpanded ? null : weekIdx) : undefined}
              >
                <LessonDayCell
                  date={dateString}
                  day={day}
                  lessonPlan={lessonPlan}
                  assignments={assignmentsByDate.get(dateString) || []}
                  announcements={announcementsByDate.get(dateString) || []}
                  isWeekend={isWeekendDay}
                  isToday={isToday}
                  isClassDay={isClassDay}
                  editable={editable && !isWeekendDay}
                  compact={viewMode !== 'week' && !isExpanded}
                  plainTextOnly={viewMode === 'all'}
                  onContentChange={onContentChange}
                  onAssignmentClick={onAssignmentClick}
                  onAnnouncementClick={onAnnouncementClick}
                />
              </div>
            )
          })
        })}
        </div>
      </div>

      <DialogPanel
        isOpen={presentedDayDetails !== null}
        onClose={() => setPresentedDay(null)}
        ariaLabelledBy="calendar-day-presentation-title"
        maxWidth="max-w-none"
        className="!w-[40rem] max-w-[92vw] border-none bg-surface px-8 py-8 shadow-2xl"
      >
        {presentedDayDetails && (
          <div className="flex min-h-[76vh] flex-col">
            <h2
              id="calendar-day-presentation-title"
              className="text-4xl font-semibold tracking-tight text-text-default sm:text-5xl"
            >
              {format(presentedDayDetails.day, 'EEEE, MMMM d, yyyy')}
            </h2>

            <div className="mt-8 flex-1 overflow-y-auto">
              {presentedDayDetails.lessonMarkdown ? (
                <LimitedMarkdown
                  content={presentedDayDetails.lessonMarkdown}
                  className="space-y-4 text-2xl leading-relaxed sm:text-3xl [&_p]:text-2xl [&_p]:leading-relaxed [&_ul]:text-2xl [&_ol]:text-2xl [&_blockquote]:text-2xl [&_h1]:text-3xl [&_h2]:text-3xl [&_h3]:text-2xl sm:[&_p]:text-3xl sm:[&_ul]:text-3xl sm:[&_ol]:text-3xl sm:[&_blockquote]:text-3xl sm:[&_h1]:text-4xl sm:[&_h2]:text-4xl sm:[&_h3]:text-3xl"
                  emptyPlaceholder={null}
                />
              ) : (
                <div className="text-2xl leading-relaxed text-text-muted sm:text-3xl">
                  No lesson content for this day.
                </div>
              )}

              {presentedDayDetails.assignments.length > 0 && (
                <div className="mt-10">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-text-muted">
                    Assignments
                  </h3>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {presentedDayDetails.assignments.map((assignment) => (
                      <div
                        key={assignment.id}
                        className="rounded-full bg-info-bg px-5 py-2 text-lg font-medium text-text-default"
                      >
                        {assignment.title}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {presentedDayDetails.announcements.length > 0 && (
                <div className="mt-10">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-text-muted">
                    Announcements
                  </h3>
                  <div className="mt-4 space-y-4">
                    {presentedDayDetails.announcements.map((announcement) => (
                      <p
                        key={announcement.id}
                        className="text-xl leading-relaxed text-text-default sm:text-2xl"
                      >
                        {announcement.content}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogPanel>
    </div>
  )
}
