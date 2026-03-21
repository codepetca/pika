import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { LessonCalendar } from '@/components/LessonCalendar'
import { TooltipProvider } from '@/ui'
import type { Assignment, Classroom, LessonPlan, TiptapContent } from '@/types'
import type { ReactNode } from 'react'

// Mock the keyboard shortcut hook
vi.mock('@/hooks/use-keyboard-shortcut-hint', () => ({
  useKeyboardShortcutHint: () => ({ rightPanel: '⌘]' }),
}))

const mockClassroom: Classroom = {
  id: 'cls-123',
  teacher_id: 't1',
  title: 'Test Classroom',
  class_code: 'ABC123',
  term_label: null,
  allow_enrollment: true,
  start_date: '2026-01-01',
  end_date: '2026-06-01',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const mondayAssignment: Assignment = {
  id: 'assignment-1',
  classroom_id: 'cls-123',
  title: 'Week 11 quiz',
  description: 'Quiz instructions',
  instructions_markdown: 'Quiz instructions',
  rich_instructions: null,
  due_at: '2026-03-16T16:00:00.000Z',
  position: 0,
  is_draft: false,
  released_at: '2026-03-10T00:00:00.000Z',
  track_authenticity: false,
  created_by: 't1',
  created_at: '2026-03-01T00:00:00.000Z',
  updated_at: '2026-03-01T00:00:00.000Z',
}

const lessonPlanContent: TiptapContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'All mode lesson' }] }],
}

const allModeLessonPlan: LessonPlan = {
  id: 'lesson-plan-1',
  classroom_id: 'cls-123',
  date: '2026-03-16',
  content: lessonPlanContent,
  content_markdown: 'All mode lesson',
  created_at: '2026-03-01T00:00:00.000Z',
  updated_at: '2026-03-01T00:00:00.000Z',
}

function Wrapper({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>
}

describe('LessonCalendar', () => {
  describe('All view row heights', () => {
    it('renders rows with auto height in all view for content-based sizing', () => {
      const { container } = render(
        <LessonCalendar
          classroom={mockClassroom}
          lessonPlans={[]}
          viewMode="all"
          currentDate={new Date('2026-03-15')}
          editable={false}
          onDateChange={vi.fn()}
          onViewModeChange={vi.fn()}
        />,
        { wrapper: Wrapper }
      )

      // Find the grid element by looking for the one with grid-template-rows style
      const grids = container.querySelectorAll('[class*="grid"]')
      const calendarGrid = Array.from(grids).find(g => g.getAttribute('style')?.includes('grid-template-rows'))
      expect(calendarGrid).toBeTruthy()

      const style = calendarGrid?.getAttribute('style')
      // All view uses auto rows so content determines height
      expect(style).toContain('grid-template-rows: auto')
    })

    it('renders rows with 1fr in week view', () => {
      const { container } = render(
        <LessonCalendar
          classroom={mockClassroom}
          lessonPlans={[]}
          viewMode="week"
          currentDate={new Date('2026-03-15')}
          editable={false}
          onDateChange={vi.fn()}
          onViewModeChange={vi.fn()}
        />,
        { wrapper: Wrapper }
      )

      const grid = container.querySelector('[class*="grid"][class*="overflow-visible"]')
      expect(grid).toBeTruthy()

      const style = grid?.getAttribute('style')
      // Week view uses 1fr
      expect(style).toContain('grid-template-rows: 1fr')
    })

    it('renders month rows with compact content-based minimum heights', () => {
      const { container } = render(
        <LessonCalendar
          classroom={mockClassroom}
          lessonPlans={[]}
          viewMode="month"
          currentDate={new Date('2026-03-15')}
          editable={false}
          onDateChange={vi.fn()}
          onViewModeChange={vi.fn()}
        />,
        { wrapper: Wrapper }
      )

      const grid = container.querySelector('[class*="grid"][class*="overflow-visible"]')
      expect(grid).toBeTruthy()

      const style = grid?.getAttribute('style')
      expect(style).toContain('minmax(4.5rem, auto)')
      expect(style).not.toContain('minmax(0, 1fr)')
    })
  })

  it('uses the date label as the return-to-today control in week view', () => {
    const onDateChange = vi.fn()

    render(
      <LessonCalendar
        classroom={mockClassroom}
        lessonPlans={[]}
        viewMode="week"
        currentDate={new Date('2026-03-15')}
        editable={false}
        onDateChange={onDateChange}
        onViewModeChange={vi.fn()}
      />,
      { wrapper: Wrapper }
    )

    fireEvent.click(screen.getByRole('button', { name: /go to today/i }))

    expect(onDateChange).toHaveBeenCalledTimes(1)
    expect(onDateChange.mock.calls[0]?.[0]).toBeInstanceOf(Date)
  })

  it('opens a focused day dialog from the week header', () => {
    render(
      <LessonCalendar
        classroom={mockClassroom}
        lessonPlans={[]}
        assignments={[mondayAssignment]}
        viewMode="week"
        currentDate={new Date('2026-03-16T12:00:00')}
        editable={false}
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
      { wrapper: Wrapper }
    )

    fireEvent.click(screen.getByRole('button', { name: /open monday, march 16, 2026/i }))

    const dialog = screen.getByRole('dialog', { name: /monday, march 16, 2026/i })

    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText('Week 11 quiz')).toBeInTheDocument()
  })

  it('allows inline editing in all view', () => {
    render(
      <LessonCalendar
        classroom={mockClassroom}
        lessonPlans={[allModeLessonPlan]}
        viewMode="all"
        currentDate={new Date('2026-03-16T12:00:00')}
        editable={true}
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
        onContentChange={vi.fn()}
      />,
      { wrapper: Wrapper }
    )

    fireEvent.click(screen.getByText('All mode lesson'))

    expect(screen.getByDisplayValue('All mode lesson')).toBeInTheDocument()
  })
})
