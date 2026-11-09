'use client'

import { ClassworkTypeIcon } from '@/components/ClassworkTypeIcon'
import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, isSameDay, startOfMonth, endOfMonth, addMonths, subMonths, isWeekend, addDays, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, PanelRight, PanelRightClose } from 'lucide-react'
import { LessonDayCell } from './LessonDayCell'
import { AnnouncementContent } from '@/components/AnnouncementContent'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'
import { normalizeAnnouncementTitle } from '@/lib/announcements'
import { getCalendarAnnouncementDate, getCalendarAssignmentDate, getCalendarMaterialDate, getCalendarTestDate } from '@/lib/calendar-items'
import { getLessonPlanMarkdown } from '@/lib/lesson-plan-content'
import { useKeyboardShortcutHint } from '@/hooks/use-keyboard-shortcut-hint'
import { useTorontoToday } from '@/hooks/use-toronto-today'
import { Button, DialogPanel, IconButton, SegmentedControl, Tooltip } from '@/ui'
import type { Announcement, Assignment, ClassDay, Classroom, ClassworkMaterial, LessonPlan, TestAssessment } from '@/types'

export type CalendarViewMode = 'list' | 'grid'

interface LessonCalendarProps {
  classroom: Classroom
  lessonPlans: LessonPlan[]
  assignments?: Assignment[]
  tests?: TestAssessment[]
  materials?: ClassworkMaterial[]
  announcements?: Announcement[]
  classDays?: ClassDay[]
  viewMode: CalendarViewMode
  currentDate: Date
  editable: boolean
  saving?: boolean
  showHeader?: boolean
  constrainToWorkspace?: boolean
  agendaGutter?: 'compact' | 'comfortable'
  todayRequest?: number
  initialSourcesLoading?: boolean
  onDateChange: (date: Date) => void
  onViewModeChange: (mode: CalendarViewMode) => void
  onContentChange?: (date: string, contentMarkdown: string) => void
  onAssignmentClick?: (assignment: Assignment) => void
  onTestClick?: (test: TestAssessment) => void
  onMaterialClick?: (material: ClassworkMaterial) => void
  onAnnouncementClick?: () => void
  onMarkdownToggle?: () => void
  isSidebarOpen?: boolean
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Preserve weekday/weekend proportions while reserving a full touch target per day.
const GRID_DAY_MIN_WIDTH = 'var(--size-control-min)'
const GRID_COLUMNS_7 = [0.5, 2, 2, 2, 2, 2, 0.5]
  .map(fraction => `minmax(${GRID_DAY_MIN_WIDTH}, ${fraction}fr)`).join(' ')
const GRID_COLUMNS_8 = `24px ${GRID_COLUMNS_7}`
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
  tests = [],
  materials = [],
  announcements = [],
  classDays = [],
  viewMode,
  currentDate,
  editable,
  saving = false,
  showHeader = true,
  constrainToWorkspace = false,
  agendaGutter = 'compact',
  todayRequest = 0,
  initialSourcesLoading = false,
  onDateChange,
  onViewModeChange,
  onContentChange,
  onAssignmentClick,
  onTestClick,
  onMaterialClick,
  onAnnouncementClick,
  onMarkdownToggle,
  isSidebarOpen = false,
}: LessonCalendarProps) {
  const currentTorontoDate = useTorontoToday()
  const today = useMemo(() => parseISO(currentTorontoDate), [currentTorontoDate])
  const [presentedDay, setPresentedDay] = useState<Date | null>(null)
  const handlePresentedDayPrev = useCallback(() => {
    setPresentedDay((d) => (d ? addDays(d, -1) : d))
  }, [])

  const handlePresentedDayNext = useCallback(() => {
    setPresentedDay((d) => (d ? addDays(d, 1) : d))
  }, [])

  useEffect(() => {
    if (!presentedDay) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') handlePresentedDayPrev()
      if (e.key === 'ArrowRight') handlePresentedDayNext()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [presentedDay, handlePresentedDayPrev, handlePresentedDayNext])

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
      const dueDate = getCalendarAssignmentDate(assignment)
      if (!dueDate) return
      const existing = map.get(dueDate)
      if (existing) {
        existing.push(assignment)
      } else {
        map.set(dueDate, [assignment])
      }
    })
    return map
  }, [assignments])

  const testsByDate = useMemo(() => {
    const map = new Map<string, TestAssessment[]>()
    for (const test of tests) {
      const date = getCalendarTestDate(test)
      if (date) map.set(date, [...(map.get(date) || []), test])
    }
    return map
  }, [tests])

  const materialsByDate = useMemo(() => {
    const map = new Map<string, ClassworkMaterial[]>()
    for (const material of materials) {
      const date = getCalendarMaterialDate(material)
      if (date) map.set(date, [...(map.get(date) || []), material])
    }
    return map
  }, [materials])

  // Build a map of date -> announcements for quick lookup
  // Explicit calendar dates stay independent of publication. Legacy rows use
  // their publication day, including after a schedule passes. Drafts are excluded.
  const announcementsByDate = useMemo(() => {
    const map = new Map<string, Announcement[]>()
    announcements.forEach((announcement) => {
      const dateString = getCalendarAnnouncementDate(announcement)
      if (!dateString) return
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

  const hasCompleteTerm = Boolean(classroom.start_date && classroom.end_date)
  const termStart = useMemo(() => hasCompleteTerm ? parseISO(classroom.start_date!) : startOfMonth(currentDate), [hasCompleteTerm, classroom.start_date, currentDate])
  const termEnd = useMemo(() => hasCompleteTerm ? parseISO(classroom.end_date!) : endOfMonth(currentDate), [hasCompleteTerm, classroom.end_date, currentDate])
  const days = useMemo(() => eachDayOfInterval({
    start: startOfWeek(termStart, { weekStartsOn: 0 }),
    end: endOfWeek(termEnd, { weekStartsOn: 0 }),
  }), [termStart, termEnd])
  const calendarRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [localTodayRequest, setLocalTodayRequest] = useState(0)
  const centerToday = useCallback(() => {
    const target = today < termStart ? termStart : today > termEnd ? termEnd : today
    const key = format(target, 'yyyy-MM-dd')
    const element = calendarRef.current?.querySelector<HTMLElement>(`[data-calendar-date="${key}"]`)
    const scroller = scrollRef.current
    if (!element || !scroller) return
    const offset = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    // For a week taller than the viewport, start at its date and first items.
    const scrollPadding = parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0
    const top = Math.max(scrollPadding, (scroller.clientHeight - element.offsetHeight) / 2)
    scroller.scrollTop += offset - top
  }, [termStart, termEnd, today])
  const lastTodayRequest = useRef({ external: todayRequest, local: localTodayRequest })
  useEffect(() => {
    centerToday()
    const requested = lastTodayRequest.current.external !== todayRequest || lastTodayRequest.current.local !== localTodayRequest
    lastTodayRequest.current = { external: todayRequest, local: localTodayRequest }
    if (requested && constrainToWorkspace && scrollRef.current) {
      const scroller = scrollRef.current
      const bounds = scroller.getBoundingClientRect()
      const shell = scroller.closest('main')?.getBoundingClientRect()
      if (window.innerHeight <= 400 || bounds.top < (shell?.top ?? 0) || bounds.bottom > (shell?.bottom ?? window.innerHeight)) {
        scroller.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [centerToday, viewMode, classroom.id, todayRequest, localTodayRequest, constrainToWorkspace])

  // Source snapshots may arrive after the first render and change row heights.
  // Recenter once after the initial load, unless the user has taken control.
  const initialLoad = useRef({ classroomId: classroom.id, complete: false, interacted: false })
  if (initialLoad.current.classroomId !== classroom.id) {
    initialLoad.current = { classroomId: classroom.id, complete: false, interacted: false }
  }
  useEffect(() => {
    if (initialSourcesLoading || initialLoad.current.complete) return
    initialLoad.current.complete = true
    if (!initialLoad.current.interacted) centerToday()
  }, [initialSourcesLoading, centerToday, classroom.id])
  const markUserInteraction = () => { initialLoad.current.interacted = true }

  // Group days into weeks for rendering
  const weeks = useMemo(() => {
    const result: Date[][] = []
    for (let i = 0; i < days.length; i += 7) {
      result.push(days.slice(i, i + 7))
    }
    return result
  }, [days])

  useEffect(() => {
    setPresentedDay(null)
  }, [viewMode])

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
      tests: testsByDate.get(dateString) || [],
      assignments: assignmentsByDate.get(dateString) || [],
      materials: materialsByDate.get(dateString) || [],
      announcements: announcementsByDate.get(dateString) || [],
      isWeekend: isWeekendDay,
      isToday: isSameDay(presentedDay, today),
      isClassDay: classDays.length > 0 ? classDayDates.has(dateString) : undefined,
    }
  }, [presentedDay, plansByDate, assignmentsByDate, testsByDate, materialsByDate, announcementsByDate, today, classDays.length, classDayDates])

  return (
    <div ref={calendarRef} className={constrainToWorkspace ? "flex min-h-0 min-w-0 flex-1 flex-col" : "min-w-0"}>
      {showHeader && <div className="flex items-center justify-center gap-2">
        <SegmentedControl<CalendarViewMode> ariaLabel="Calendar view" value={viewMode} onChange={onViewModeChange}
          options={[{ value: 'list', label: 'List' }, { value: 'grid', label: 'Grid' }]} />
        <Button variant="secondary" size="sm" onClick={() => setLocalTodayRequest(value => value + 1)}>Today</Button>
      </div>}
      <div ref={scrollRef} role="region" aria-label="Calendar dates" tabIndex={0} onWheel={markUserInteraction} onTouchStart={markUserInteraction} onPointerDown={markUserInteraction} onKeyDown={markUserInteraction} className={constrainToWorkspace ? "isolate min-h-40 min-w-0 flex-1 overflow-auto scroll-pt-8 calendar-short:max-h-40 focus-visible:outline-none focus-visible:ring-foundation focus-visible:ring-focus focus-visible:ring-inset" : "max-h-screen min-w-0 overflow-auto scroll-pt-8"}>
      {viewMode === 'list' ? (
        <div role="region" aria-label="Term agenda" className={constrainToWorkspace ? `mx-auto min-w-0 max-w-standard ${agendaGutter === 'comfortable' ? 'px-density-comfortable-gutter' : 'px-density-compact-gutter'}` : 'min-w-0'}>
          {Array.from(new Set(days.filter(day => day >= termStart && day <= termEnd).map(day => format(day, 'yyyy-MM')))).map(month => (
            <section key={month} data-calendar-month={format(parseISO(`${month}-01`), 'MMMM yyyy')}>
              <div className="sticky top-0 z-sticky-table border-y border-border bg-surface-3 px-4 py-1 text-sm font-semibold text-text-default">{format(parseISO(`${month}-01`), 'MMMM yyyy')}</div>
              {days.filter(day => day >= termStart && day <= termEnd && format(day, 'yyyy-MM') === month).map(day => {
                const dateString = format(day, 'yyyy-MM-dd')
                const isWeekendDay = isWeekend(day)
                return <div key={dateString} data-calendar-date={dateString} className={day.getDay() === 0 ? 'border-t border-border' : ''}>
                  <LessonDayCell layout="agenda" denseAgenda date={dateString} day={day} lessonPlan={plansByDate.get(dateString) || null}
                    tests={testsByDate.get(dateString) || []} assignments={assignmentsByDate.get(dateString) || []}
                    materials={materialsByDate.get(dateString) || []} announcements={announcementsByDate.get(dateString) || []}
                    isWeekend={isWeekendDay} isToday={isSameDay(day, today)}
                    isClassDay={classDays.length > 0 ? classDayDates.has(dateString) : undefined}
                    editable={editable && !isWeekendDay} onPresentDay={() => setPresentedDay(day)}
                    onContentChange={onContentChange} onTestClick={onTestClick} onAssignmentClick={onAssignmentClick}
                    onMaterialClick={onMaterialClick} onAnnouncementClick={onAnnouncementClick} />
                </div>
              })}
            </section>
          ))}
        </div>
      ) : (
        <div className="min-w-0">
          <div className="grid" style={{ gridTemplateColumns: GRID_COLUMNS_8, gridTemplateRows: `auto ${weeks.map(() => 'auto').join(' ')}` }}>
            <div className="sticky top-0 z-sticky-table border-b border-r border-border bg-surface" style={{ gridColumn: 1, gridRow: 1 }} />
            {DAY_LABELS.map((label, idx) => <div key={label} className="sticky top-0 z-sticky-table border-b border-r border-border bg-surface py-1 text-center text-sm font-medium text-text-muted" style={{ gridColumn: idx + 2, gridRow: 1 }}>{idx === 0 || idx === 6 ? label.charAt(0) : label}</div>)}
            {monthSpans.map(span => <div key={span.month} className="relative flex items-center justify-center overflow-hidden border-b border-r border-border bg-surface-3" style={{ gridColumn: 1, gridRow: `${span.startIdx + 2} / span ${span.count}` }}><span className="whitespace-nowrap text-xs font-semibold text-text-default" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{span.monthName}</span></div>)}
            {weeks.flatMap((week, weekIdx) => week.map((day, dayIdx) => {
              const dateString = format(day, 'yyyy-MM-dd')
              const inTerm = day >= termStart && day <= termEnd
              const isWeekendDay = isWeekend(day)
              const sameMonth = (other: Date | undefined) => other && other.getMonth() === day.getMonth() && other.getFullYear() === day.getFullYear()
              return <div key={dateString} data-calendar-date={inTerm ? dateString : undefined}
                className={`overflow-hidden border-b border-r border-border ${!sameMonth(weeks[weekIdx - 1]?.[dayIdx]) ? 'border-t border-t-border-strong' : ''} ${!sameMonth(weeks[weekIdx + 1]?.[dayIdx]) ? 'border-b-border-strong' : ''} ${dayIdx === 0 || !sameMonth(week[dayIdx - 1]) ? 'border-l border-l-border-strong' : ''} ${dayIdx === 6 || !sameMonth(week[dayIdx + 1]) ? 'border-r-border-strong' : ''}`}
                style={{ gridColumn: dayIdx + 2, gridRow: weekIdx + 2 }}>
                {inTerm && <LessonDayCell date={dateString} day={day} lessonPlan={plansByDate.get(dateString) || null}
                  tests={testsByDate.get(dateString) || []} assignments={assignmentsByDate.get(dateString) || []}
                  materials={materialsByDate.get(dateString) || []} announcements={announcementsByDate.get(dateString) || []}
                  isWeekend={isWeekendDay} isToday={isSameDay(day, today)} isClassDay={classDays.length > 0 ? classDayDates.has(dateString) : undefined}
                  editable={editable && !isWeekendDay} plainTextOnly
                  onContentChange={onContentChange} onTestClick={onTestClick} onAssignmentClick={onAssignmentClick}
                  onMaterialClick={onMaterialClick} onAnnouncementClick={onAnnouncementClick} />}
              </div>
            }))}
          </div>
        </div>
      )}
      </div>

      <DialogPanel
        isOpen={presentedDayDetails !== null}
        exitMotion="opacity"
        onClose={() => setPresentedDay(null)}
        ariaLabelledBy="calendar-day-presentation-title"
        maxWidth="max-w-none"
        className="!w-[40rem] max-w-[92vw] border-none bg-surface px-8 py-8 shadow-2xl"
      >
        {presentedDayDetails && (
          <div className="flex min-h-[76vh] flex-col">
            <div className="-mx-8 -mt-8 flex shrink-0 items-center justify-between gap-3 rounded-t-dialog border-b border-border bg-surface-accent px-8 py-6 pr-16">
              <h2
                id="calendar-day-presentation-title"
                className="text-4xl font-semibold tracking-tight text-text-default sm:text-5xl"
              >
                {format(presentedDayDetails.day, 'EEE MMM d, yyyy')}
              </h2>
              <div className="flex shrink-0 items-center gap-1">
                <IconButton icon={ChevronLeft} label="Previous day" onClick={handlePresentedDayPrev} />
                <IconButton icon={ChevronRight} label="Next day" onClick={handlePresentedDayNext} />
              </div>
            </div>

            <div
              role="region"
              aria-label="Day lesson and events"
              tabIndex={0}
              className="mt-8 flex-1 overflow-y-auto focus-visible:outline-none focus-visible:ring-foundation focus-visible:ring-focus focus-visible:ring-inset"
            >
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
                        className="rounded-full bg-calendar-assessment-bg px-5 py-2 text-lg font-medium text-calendar-assessment"
                      >
                        {assignment.title}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {presentedDayDetails.tests.length > 0 && (
                <div className="mt-10">
                  <h3 className="text-sm font-semibold text-text-muted">Tests</h3>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {presentedDayDetails.tests.map(test => (
                      <Button key={test.id} variant="ghost" onClick={() => {
                        setPresentedDay(null)
                        onTestClick?.(test)
                      }} className="max-w-full whitespace-normal bg-calendar-assessment-bg text-calendar-assessment hover:bg-calendar-assessment-hover">
                        Test: {test.title}{test.status === 'draft' ? ' [Draft]' : ''}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {presentedDayDetails.materials.length > 0 && (
                <div className="mt-10">
                  <h3 className="text-sm font-semibold text-text-muted">Materials</h3>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {presentedDayDetails.materials.map(material => (
                      <Button key={material.id} variant="ghost" aria-label={`Material: ${material.title}`} onClick={() => {
                        setPresentedDay(null)
                        onMaterialClick?.(material)
                      }} className="max-w-full whitespace-normal bg-calendar-resource-bg text-calendar-resource hover:bg-calendar-resource-hover">
                        <ClassworkTypeIcon type="material" />{material.title}
                      </Button>
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
                    {presentedDayDetails.announcements.map((announcement) => {
                      const title = normalizeAnnouncementTitle(announcement.title)

                      return (
                        <div key={announcement.id}>
                          {title && (
                            <h4 className="mb-2 text-xl font-semibold text-text-default">
                              {title}
                            </h4>
                          )}
                          <AnnouncementContent
                            content={announcement.content}
                            size="lg"
                          />
                        </div>
                      )
                    })}
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
