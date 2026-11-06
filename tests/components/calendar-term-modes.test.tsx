import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LessonCalendar, type CalendarViewMode } from '@/components/LessonCalendar'
import { TooltipProvider } from '@/ui'
import type { Assignment, Classroom, LessonPlan } from '@/types'

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
})
