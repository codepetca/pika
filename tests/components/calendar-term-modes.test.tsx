import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LessonCalendar, type CalendarViewMode } from '@/components/LessonCalendar'
import { TooltipProvider } from '@/ui'
import type { Assignment, Classroom, LessonPlan } from '@/types'

vi.mock('@/hooks/use-toronto-today', () => ({ useTorontoToday: () => '2026-04-15' }))

const classroom = {
  id: 'classroom', teacher_id: 'teacher', title: 'Course', class_code: 'CODE',
  theme_color: 'blue', term_label: null, allow_enrollment: true,
  start_date: '2026-03-02', end_date: '2026-04-10',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
} satisfies Classroom

function lesson(id: string, date: string, content: string): LessonPlan {
  return { id, classroom_id: classroom.id, date, content: null, content_markdown: content,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' } as LessonPlan
}

const assignment = {
  id: 'assignment', classroom_id: classroom.id, title: 'Final assignment', description: '',
  instructions_markdown: '', rich_instructions: null, due_at: '2026-04-10T16:00:00Z',
  position: 0, is_draft: false, released_at: '2026-03-01T00:00:00Z',
  track_authenticity: false, created_by: 'teacher', created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
} satisfies Assignment

describe('term calendar modes', () => {
  it.each(['list', 'grid'] as const)('shows both ends of the term and retains event navigation in %s', mode => {
    const onAssignmentClick = vi.fn()
    render(<TooltipProvider><LessonCalendar classroom={classroom}
      lessonPlans={[
        lesson('first', '2026-03-02', 'First term lesson'),
        lesson('last', '2026-04-10', 'Last term lesson'),
        lesson('outside', '2026-04-11', 'Outside term lesson'),
      ]} assignments={[assignment]} viewMode={mode as CalendarViewMode}
      currentDate={new Date('2026-03-15T12:00:00')} editable={false}
      onDateChange={vi.fn()} onViewModeChange={vi.fn()} onAssignmentClick={onAssignmentClick} />
    </TooltipProvider>)
    expect(screen.getByText('First term lesson')).toBeInTheDocument()
    expect(screen.getByText('Last term lesson')).toBeInTheDocument()
    expect(screen.queryByText('Outside term lesson')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Due: Final assignment' }))
    expect(onAssignmentClick).toHaveBeenCalledWith(assignment)
  })

  it.each(['list', 'grid'] as const)('shows the selected month for an incomplete term in %s', mode => {
    render(<TooltipProvider><LessonCalendar classroom={{ ...classroom, start_date: null }}
      lessonPlans={[lesson('prior', '2026-02-16', 'Previous month lesson')]}
      viewMode={mode} currentDate={new Date('2026-02-15T12:00:00')} editable={false}
      onDateChange={vi.fn()} onViewModeChange={vi.fn()} /></TooltipProvider>)
    expect(screen.getByText('Previous month lesson')).toBeInTheDocument()
  })

  it('unclamps expanded read-only grid text while keeping plain text', () => {
    const longText = 'First line\nSecond line\nThird line\nFourth line'
    render(<TooltipProvider><LessonCalendar classroom={classroom} lessonPlans={[lesson('long', '2026-03-02', longText)]}
      viewMode="grid" currentDate={new Date('2026-03-15T12:00:00')} editable={false}
      onDateChange={vi.fn()} onViewModeChange={vi.fn()} /></TooltipProvider>)
    const text = screen.getByText(/First line/)
    expect(text).toHaveClass('line-clamp-3')
    fireEvent.click(text)
    expect(text).not.toHaveClass('line-clamp-3')
    expect(text).toHaveTextContent('Fourth line')
  })

  it.each([false, true])('centers after initial sources settle unless the user has scrolled (interacted=%s)', interacted => {
    const props = { classroom, lessonPlans: [], viewMode: 'list' as const,
      currentDate: new Date('2026-03-15T12:00:00'), editable: false,
      onDateChange: vi.fn(), onViewModeChange: vi.fn() }
    const view = render(<TooltipProvider><LessonCalendar {...props} initialSourcesLoading /></TooltipProvider>)
    const target = view.container.querySelector('[data-calendar-date="2026-04-10"]') as HTMLElement
    const scroller = target.closest('.overflow-auto') as HTMLElement
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 300 } as DOMRect)
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect)
    scroller.scrollTop = 20
    if (interacted) fireEvent.wheel(scroller)
    view.rerender(<TooltipProvider><LessonCalendar {...props} initialSourcesLoading={false} /></TooltipProvider>)
    expect(scroller.scrollTop).toBe(interacted ? 20 : 320)
    scroller.scrollTop = 40
    view.rerender(<TooltipProvider><LessonCalendar {...props} initialSourcesLoading /></TooltipProvider>)
    view.rerender(<TooltipProvider><LessonCalendar {...props} initialSourcesLoading={false} /></TooltipProvider>)
    expect(scroller.scrollTop).toBe(40)
  })

})
