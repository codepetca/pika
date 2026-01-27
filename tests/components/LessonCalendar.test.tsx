import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { LessonCalendar } from '@/components/LessonCalendar'
import { TooltipProvider } from '@/ui'
import type { Classroom } from '@/types'
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

    it('renders rows with minmax in month view', () => {
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
      // Month view uses minmax(0, 1fr) for equal distribution
      expect(style).toContain('minmax(0, 1fr)')
    })
  })
})
