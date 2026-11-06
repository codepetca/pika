'use client'

import type { ReactNode } from 'react'
import { Ellipsis } from 'lucide-react'
import { Button, SegmentedControl, cn } from '@/ui'
import { PageActionBar } from '@/components/PageLayout'
import { TeacherWorkSurfaceIconMenuButton, type TeacherWorkSurfaceActionItem } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import type { CalendarViewMode } from '@/components/LessonCalendar'

interface CalendarActionBarProps {
  viewMode: CalendarViewMode
  currentDate: Date
  visibleMonth?: string
  rangeStart?: string | null
  rangeEnd?: string | null
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onViewModeChange: (mode: CalendarViewMode) => void
  trailing?: ReactNode
  context?: ReactNode
  moreActions?: TeacherWorkSurfaceActionItem[]
  className?: string
}

export function CalendarActionBar({ viewMode, visibleMonth, onToday, onViewModeChange, trailing, context, moreActions, className = '' }: CalendarActionBarProps) {
  return <PageActionBar className={cn('pt-density-compact-content-top', className)} primary={<div className="flex items-center gap-2"><span aria-live="polite" className="text-sm font-medium text-text-muted">{visibleMonth}</span>{context}</div>} center={<>
    <SegmentedControl<CalendarViewMode> ariaLabel="Calendar view" value={viewMode} onChange={onViewModeChange} className="gap-0 bg-transparent p-0"
      options={[
        { value: 'list', label: 'List', className: 'bg-transparent px-0 hover:bg-transparent [&>span]:rounded-control [&>span]:px-3 [&>span]:py-1', activeClassName: '[&>span]:bg-info-bg [&>span]:text-primary', inactiveClassName: '[&>span]:text-text-muted' },
        { value: 'grid', label: 'Grid', className: 'bg-transparent px-0 hover:bg-transparent [&>span]:rounded-control [&>span]:px-3 [&>span]:py-1', activeClassName: '[&>span]:bg-info-bg [&>span]:text-primary', inactiveClassName: '[&>span]:text-text-muted' },
      ]} />
    <Button variant="ghost" size="sm" className="px-0 hover:bg-transparent" onClick={onToday}><span className="rounded-control border border-border bg-surface-2 px-3 py-1 text-text-default">Today</span></Button>
    {trailing}
  </>} trailing={moreActions && moreActions.length > 0 ? <TeacherWorkSurfaceIconMenuButton
    ariaLabel="More actions" menuAriaLabel="Calendar actions" tooltip="More actions"
    icon={<Ellipsis className="h-5 w-5" aria-hidden="true" />} items={moreActions} menuPlacement="down" menuAlign="end" menuClassName="w-64" className="h-11 w-11" /> : null} />
}
