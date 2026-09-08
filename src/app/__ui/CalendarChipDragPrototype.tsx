'use client'

import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  BookOpenText,
  ClipboardCheck,
  FileText,
  GripVertical,
  LockKeyhole,
  Megaphone,
  RotateCcw,
} from 'lucide-react'
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, SaveStatus, Tooltip, cn } from '@/ui'
import type { CalendarViewMode } from '@/components/LessonCalendar'

export type PrototypeCalendarItemKind = 'assignment' | 'announcement' | 'test' | 'lesson'

export interface PrototypeCalendarItem {
  id: string
  date: string
  kind: PrototypeCalendarItemKind
  label: string
  movable: boolean
  lockedReason?: string
}

export const PROTOTYPE_CALENDAR_ITEMS: readonly PrototypeCalendarItem[] = [
  { id: 'lesson-ecosystems', date: '2026-09-14', kind: 'lesson', label: 'Ecosystem review', movable: true },
  { id: 'assignment-field-notes', date: '2026-09-15', kind: 'assignment', label: 'Field notes', movable: true },
  { id: 'announcement-lab-groups', date: '2026-09-15', kind: 'announcement', label: 'Lab groups', movable: true },
  { id: 'test-cell-systems', date: '2026-09-16', kind: 'test', label: 'Cell systems', movable: true },
  {
    id: 'announcement-posted',
    date: '2026-09-17',
    kind: 'announcement',
    label: 'Trip reminder',
    movable: false,
    lockedReason: 'Published announcements keep their original posted date',
  },
  { id: 'assignment-lab-reflection', date: '2026-09-18', kind: 'assignment', label: 'Lab reflection', movable: true },
  { id: 'lesson-semester-reflection', date: '2027-01-22', kind: 'lesson', label: 'Semester ecosystem reflection.', movable: true },
]

const KIND_LABELS: Record<PrototypeCalendarItemKind, string> = {
  assignment: 'Assignment',
  announcement: 'Announcement',
  test: 'Test',
  lesson: 'Lesson plan',
}

const CHIP_TONES: Record<PrototypeCalendarItemKind, string> = {
  assignment: 'border-transparent bg-primary-solid text-text-inverse',
  announcement: 'border-warning bg-warning-bg text-warning',
  test: 'border-border-strong bg-surface-3 text-text-default',
  lesson: 'border-success bg-success-bg text-success',
}

function ItemIcon({ kind }: { kind: PrototypeCalendarItemKind }) {
  if (kind === 'assignment') return <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
  if (kind === 'announcement') return <Megaphone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
  if (kind === 'test') return <ClipboardCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
  return <BookOpenText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
}

function CalendarChipVisual({
  item,
  overlay = false,
  chipRef,
  dragAttributes,
  dragListeners,
  transform,
  isDragging = false,
}: {
  item: PrototypeCalendarItem
  overlay?: boolean
  chipRef?: (node: HTMLElement | null) => void
  dragAttributes?: React.ButtonHTMLAttributes<HTMLButtonElement>
  dragListeners?: Record<string, unknown>
  transform?: string
  isDragging?: boolean
}) {
  const chip = (
    <Button
      ref={chipRef}
      type="button"
      variant="surface"
      size="xs"
      disabled={!item.movable}
      aria-label={item.movable
        ? `Move ${KIND_LABELS[item.kind]} ${item.label}`
        : `${KIND_LABELS[item.kind]} ${item.label}, locked`}
      className={cn(
        'min-h-8 w-full min-w-0 touch-none justify-start gap-1.5 overflow-hidden border px-2 py-1 text-left text-xs shadow-none',
        CHIP_TONES[item.kind],
        item.movable && 'cursor-grab active:cursor-grabbing',
        !item.movable && 'cursor-not-allowed opacity-65',
        (isDragging || overlay) && 'relative z-floating shadow-elevated',
        isDragging && 'opacity-35',
      )}
      style={transform ? { transform } : undefined}
      {...dragAttributes}
      {...dragListeners}
    >
      {item.movable ? <GripVertical className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <LockKeyhole className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <ItemIcon kind={item.kind} />
      <span className="truncate">{item.label}</span>
    </Button>
  )

  if (!item.lockedReason || overlay) return chip
  return <Tooltip content={item.lockedReason}><span className="block w-full">{chip}</span></Tooltip>
}

function CalendarChip({ item }: { item: PrototypeCalendarItem }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: item.id,
    disabled: !item.movable,
    data: { date: item.date, kind: item.kind },
  })
  return (
    <CalendarChipVisual
      item={item}
      chipRef={setNodeRef}
      dragAttributes={item.movable ? attributes : undefined}
      dragListeners={item.movable ? listeners : undefined}
      transform={transform ? CSS.Translate.toString(transform) : undefined}
      isDragging={isDragging}
    />
  )
}

function CalendarDay({
  date,
  currentMonth,
  showMonthName,
  items,
  activeItem,
  overDate,
  compact,
}: {
  date: Date
  currentMonth: number | null
  showMonthName: boolean
  items: PrototypeCalendarItem[]
  activeItem: PrototypeCalendarItem | null
  overDate: string | null
  compact: boolean
}) {
  const dateString = format(date, 'yyyy-MM-dd')
  const { isOver, setNodeRef } = useDroppable({
    id: `calendar-day-${dateString}`,
    data: { date: dateString },
  })
  const isTarget = Boolean(activeItem && activeItem.date !== dateString && (isOver || overDate === dateString))

  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={format(date, 'EEEE, MMMM d, yyyy')}
      data-calendar-date={dateString}
      className={cn(
        'relative w-28 min-w-0 border-b border-r border-border bg-surface p-1.5 transition-colors last:border-r-0 sm:w-auto',
        compact ? 'min-h-24' : 'min-h-40',
        currentMonth !== null && date.getMonth() !== currentMonth && 'bg-surface-2 text-text-muted',
        activeItem && activeItem.date !== dateString && 'bg-info-bg',
        isTarget && 'z-local-menu bg-info-bg ring-2 ring-inset ring-primary',
      )}
    >
      <div className="mb-1 flex min-h-6 items-center justify-between gap-1">
        <span className="inline-flex min-w-0 items-baseline gap-1 text-xs font-medium text-text-muted">
          {showMonthName ? <span className="truncate font-semibold text-text-default">{format(date, 'MMMM')}</span> : null}
          <span>{format(date, 'd')}</span>
        </span>
        {isTarget ? <span className="text-xs font-semibold text-info">Move here</span> : null}
      </div>
      <div className="space-y-1">
        {items.map((item) => <CalendarChip key={item.id} item={item} />)}
      </div>
    </div>
  )
}

function getVisibleDays(viewMode: CalendarViewMode, currentDate: Date): Date[] {
  if (viewMode === 'week') {
    return eachDayOfInterval({
      start: startOfWeek(currentDate, { weekStartsOn: 0 }),
      end: endOfWeek(currentDate, { weekStartsOn: 0 }),
    })
  }
  if (viewMode === 'month') {
    return eachDayOfInterval({
      start: startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 }),
      end: endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 }),
    })
  }
  return eachDayOfInterval({
    start: startOfWeek(new Date('2026-09-01T12:00:00'), { weekStartsOn: 0 }),
    end: endOfWeek(new Date('2027-01-29T12:00:00'), { weekStartsOn: 0 }),
  })
}

export function movePrototypeCalendarItem(
  items: readonly PrototypeCalendarItem[],
  itemId: string,
  targetDate: string,
): PrototypeCalendarItem[] {
  return items.map((item) => (
    item.id === itemId && item.movable ? { ...item, date: targetDate } : item
  ))
}

const calendarKeyboardCoordinates: KeyboardCoordinateGetter = (event, { active, context }) => {
  if (![KeyboardCode.Left, KeyboardCode.Right, KeyboardCode.Up, KeyboardCode.Down].includes(event.code as KeyboardCode)) {
    return undefined
  }
  event.preventDefault()
  const originDate = context.draggableNodes.get(active)?.data.current?.date
  const currentDate = context.over?.data.current?.date ?? originDate
  if (typeof currentDate !== 'string') return undefined

  const visibleDates = context.droppableContainers.getEnabled()
    .map((container) => container.data.current?.date)
    .filter((date): date is string => typeof date === 'string')
    .sort()
  const currentIndex = visibleDates.indexOf(currentDate)
  if (currentIndex === -1) return undefined
  const offset = event.code === KeyboardCode.Left
    ? -1
    : event.code === KeyboardCode.Right
      ? 1
      : event.code === KeyboardCode.Up
        ? -7
        : 7
  const targetDate = visibleDates[currentIndex + offset]
  if (!targetDate) return undefined
  const targetRect = context.droppableRects.get(`calendar-day-${targetDate}`)
  return targetRect ? { x: targetRect.left, y: targetRect.top } : undefined
}

export function CalendarChipDragPrototype({
  viewMode,
  currentDate,
}: {
  viewMode: CalendarViewMode
  currentDate: Date
}) {
  const [items, setItems] = useState<PrototypeCalendarItem[]>(() => [...PROTOTYPE_CALENDAR_ITEMS])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overDate, setOverDate] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [failNextMove, setFailNextMove] = useState(false)
  const saveTimerRef = useRef<number | null>(null)
  const visibleDays = useMemo(() => getVisibleDays(viewMode, currentDate), [currentDate, viewMode])
  const visibleDates = useMemo(() => new Set(visibleDays.map((day) => format(day, 'yyyy-MM-dd'))), [visibleDays])
  const activeItem = items.find((item) => item.id === activeId) ?? null
  const compact = viewMode !== 'week'
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: calendarKeyboardCoordinates }),
  )

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
  }, [])

  const resetDragState = useCallback(() => {
    setActiveId(null)
    setOverDate(null)
  }, [])

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
    setSaveStatus('saved')
  }

  function handleDragOver(event: DragOverEvent) {
    const date = event.over?.data.current?.date
    setOverDate(typeof date === 'string' ? date : null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const targetDate = event.over?.data.current?.date
    const itemId = String(event.active.id)
    const item = items.find((candidate) => candidate.id === itemId)
    resetDragState()
    if (!item || typeof targetDate !== 'string' || targetDate === item.date) return

    const previousItems = items
    setItems(movePrototypeCalendarItem(items, itemId, targetDate))
    setSaveStatus('saving')
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      if (failNextMove) {
        setItems(previousItems)
        setSaveStatus('error')
        setFailNextMove(false)
        return
      }
      setSaveStatus('saved')
    }, 650)
  }

  function resetPrototype() {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    setItems([...PROTOTYPE_CALENDAR_ITEMS])
    setFailNextMove(false)
    setSaveStatus('saved')
    resetDragState()
  }

  return (
    <div data-testid="calendar-chip-drag-prototype" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-badge border border-border bg-surface px-2 py-1 text-xs font-semibold text-text-default">Experimental</span>
          <SaveStatus
            status={saveStatus}
            errorMessage="Move failed — restored"
            data-testid="calendar-prototype-save-status"
          />
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={failNextMove ? 'subtle' : 'ghost'}
            size="xs"
            aria-pressed={failNextMove}
            onClick={() => setFailNextMove((current) => !current)}
          >
            Fail next move
          </Button>
          <Tooltip content="Reset example">
            <Button type="button" variant="ghost" size="xs" onClick={resetPrototype} aria-label="Reset calendar prototype">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Tooltip>
        </div>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragCancel={resetDragState}
        onDragEnd={handleDragEnd}
      >
        <div className="overflow-x-auto">
          <div className="w-max min-w-full sm:w-auto">
            <div className="grid grid-cols-7 border-b border-border bg-surface-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
                <div key={label} className="w-28 border-r border-border px-2 py-1.5 text-center text-xs font-semibold text-text-muted last:border-r-0 sm:w-auto">
                  {label}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {visibleDays.map((day, index) => {
                const dateString = format(day, 'yyyy-MM-dd')
                return (
                  <CalendarDay
                    key={dateString}
                    date={day}
                    currentMonth={viewMode === 'month' ? currentDate.getMonth() : null}
                    showMonthName={viewMode === 'all' && (index === 0 || day.getDate() === 1)}
                    items={items.filter((item) => item.date === dateString && visibleDates.has(item.date))}
                    activeItem={activeItem}
                    overDate={overDate}
                    compact={compact}
                  />
                )
              })}
            </div>
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {activeItem ? <div className="w-52"><CalendarChipVisual item={activeItem} overlay /></div> : null}
        </DragOverlay>
      </DndContext>
      <p id="calendar-drag-instructions" className="sr-only">
        Focus a movable chip, press Space to pick it up, use arrow keys to choose another day, then press Space to drop it. Press Escape to cancel.
      </p>
    </div>
  )
}
