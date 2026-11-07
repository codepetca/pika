'use client'

import type { ReactNode } from 'react'
import { MoreVertical } from 'lucide-react'
import { Button, SegmentedControl, cn } from '@/ui'
import { PageActionBar } from '@/components/PageLayout'
import { TeacherWorkSurfaceIconMenuButton, type TeacherWorkSurfaceActionItem } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import type { CalendarViewMode } from '@/components/LessonCalendar'

interface CalendarActionBarProps {
  viewMode: CalendarViewMode
  currentDate: Date
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

export function CalendarActionBar({ viewMode, onToday, onViewModeChange, trailing, context, moreActions, className = '' }: CalendarActionBarProps) {
  return <PageActionBar className={cn('py-0', className)} primary={context ?? null} center={<>
    <SegmentedControl<CalendarViewMode> ariaLabel="Calendar view" value={viewMode} onChange={onViewModeChange} className="h-6 gap-0 border border-border bg-surface-2 p-0"
      options={[
        { value: 'list', label: 'List', className: 'min-h-0 bg-transparent px-2 py-0 hover:bg-transparent [&>span]:rounded-control [&>span]:px-1 [&>span]:py-0.5', activeClassName: '[&>span]:bg-info-bg [&>span]:text-primary', inactiveClassName: '[&>span]:text-text-muted' },
        { value: 'grid', label: 'Grid', className: 'min-h-0 bg-transparent px-2 py-0 hover:bg-transparent [&>span]:rounded-control [&>span]:px-1 [&>span]:py-0.5', activeClassName: '[&>span]:bg-info-bg [&>span]:text-primary', inactiveClassName: '[&>span]:text-text-muted' },
      ]} />
    <Button variant="ghost" size="sm" className="min-h-0 px-0 py-0 hover:bg-transparent" onClick={onToday}><span className="rounded-control border border-border bg-surface-2 px-2 py-0.5 text-text-default">Today</span></Button>
    {trailing}
  </>} trailing={moreActions && moreActions.length > 0 ? <TeacherWorkSurfaceIconMenuButton
    ariaLabel="More actions" menuAriaLabel="Calendar actions" tooltip="More actions"
    icon={<MoreVertical className="h-5 w-5" aria-hidden="true" />} items={moreActions} menuPlacement="down" menuAlign="end" menuClassName="w-64" className="h-6 min-h-0 w-11" /> : null} />
}
