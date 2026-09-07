import { afterEach, describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LessonCalendar } from '@/components/LessonCalendar'
import { MarkdownPreferenceProvider } from '@/contexts/MarkdownPreferenceContext'
import { TooltipProvider } from '@/ui'
import type { Announcement, Assignment, Classroom, LessonPlan, TiptapContent } from '@/types'
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
  theme_color: 'blue',
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
  title: 'Week 11 test',
  description: 'Test instructions',
  instructions_markdown: 'Test instructions',
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

const markdownAnnouncement: Announcement = {
  id: 'announcement-1',
  classroom_id: 'cls-123',
  content: 'Read the [course outline](https://example.com/outline) before class.',
  created_by: 't1',
  scheduled_for: null,
  created_at: '2026-03-16T14:00:00.000Z',
  updated_at: '2026-03-16T14:00:00.000Z',
}

function Wrapper({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>
}

function MarkdownPreferenceWrapper({ children }: { children: ReactNode }) {
  return (
    <MarkdownPreferenceProvider>
      <TooltipProvider>{children}</TooltipProvider>
    </MarkdownPreferenceProvider>
  )
}

afterEach(() => {
  vi.useRealTimers()
  window.localStorage.clear()
})

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
    expect(within(dialog).getByText('Week 11 test')).toBeInTheDocument()
  })

  it('renders announcement markdown in the focused day dialog', () => {
    render(
      <LessonCalendar
        classroom={mockClassroom}
        lessonPlans={[]}
        announcements={[markdownAnnouncement]}
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
    expect(within(dialog).getByRole('link', { name: 'course outline' })).toHaveAttribute(
      'href',
      'https://example.com/outline',
    )
  })

  it('moves a scheduled announcement to its published date at the publication boundary', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-17T13:59:59.900Z'))
    const scheduledAnnouncement: Announcement = {
      ...markdownAnnouncement,
      id: 'scheduled-announcement',
      content: 'Publication boundary announcement',
      created_at: '2026-03-16T14:00:00.000Z',
      scheduled_for: '2026-03-17T14:00:00.000Z',
    }
    const announcements = [scheduledAnnouncement]

    render(
      <LessonCalendar
        classroom={mockClassroom}
        lessonPlans={[]}
        announcements={announcements}
        viewMode="week"
        currentDate={new Date('2026-03-16T12:00:00')}
        editable={false}
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
      { wrapper: Wrapper },
    )

    fireEvent.click(screen.getByRole('button', { name: /open tuesday, march 17, 2026/i }))
    expect(within(screen.getByRole('dialog')).getByText('Publication boundary announcement')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(200))
    expect(within(screen.getByRole('dialog')).queryByText('Publication boundary announcement')).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /open monday, march 16, 2026/i }))
    expect(within(screen.getByRole('dialog')).getByText('Publication boundary announcement')).toBeInTheDocument()
  })

  it('re-arms bounded timers until a long-range announcement publication boundary', () => {
    vi.useFakeTimers()
    const start = new Date('2026-03-01T14:00:00.000Z')
    const publication = new Date('2026-04-15T14:00:00.000Z')
    vi.setSystemTime(start)
    const timeoutSpy = vi.spyOn(window, 'setTimeout')
    const scheduledAnnouncement: Announcement = {
      ...markdownAnnouncement,
      id: 'long-range-announcement',
      content: 'Long-range publication announcement',
      created_at: start.toISOString(),
      scheduled_for: publication.toISOString(),
    }
    const announcements = [scheduledAnnouncement]
    const props = {
      classroom: mockClassroom,
      lessonPlans: [],
      announcements,
      viewMode: 'week' as const,
      editable: false,
      onDateChange: vi.fn(),
      onViewModeChange: vi.fn(),
    }

    const view = render(
      <LessonCalendar {...props} currentDate={new Date('2026-04-15T12:00:00')} />,
      { wrapper: Wrapper },
    )
    fireEvent.click(screen.getByRole('button', { name: /open wednesday, april 15, 2026/i }))
    expect(within(screen.getByRole('dialog')).getByText('Long-range publication announcement')).toBeInTheDocument()
    expect(timeoutSpy.mock.calls.some(([, delay]) => delay === 2_147_483_647)).toBe(true)

    act(() => vi.advanceTimersByTime(2_147_483_647))
    expect(within(screen.getByRole('dialog')).getByText('Long-range publication announcement')).toBeInTheDocument()
    expect(timeoutSpy.mock.calls.every(([, delay]) => typeof delay !== 'number' || delay <= 2_147_483_647)).toBe(true)

    act(() => vi.advanceTimersByTime(publication.getTime() - start.getTime() - 2_147_483_647 + 100))
    expect(within(screen.getByRole('dialog')).queryByText('Long-range publication announcement')).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    view.rerender(<LessonCalendar {...props} currentDate={new Date('2026-03-01T12:00:00')} />)
    fireEvent.click(screen.getByRole('button', { name: /open sunday, march 1, 2026/i }))
    expect(within(screen.getByRole('dialog')).getByText('Long-range publication announcement')).toBeInTheDocument()
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

    expect(
      screen.getByRole('textbox', { name: 'Lesson plan for March 16, 2026' })
    ).toHaveTextContent('All mode lesson')
  })

  it('renders lesson markdown as plain text when the user preference is off', async () => {
    window.localStorage.setItem('pika_show_markdown', 'false')
    const markdownLessonPlan: LessonPlan = {
      ...allModeLessonPlan,
      content_markdown: '### Lesson title\n- **Read** `notes`',
    }

    const { container } = render(
      <LessonCalendar
        classroom={mockClassroom}
        lessonPlans={[markdownLessonPlan]}
        viewMode="week"
        currentDate={new Date('2026-03-16T12:00:00')}
        editable={false}
        onDateChange={vi.fn()}
        onViewModeChange={vi.fn()}
      />,
      { wrapper: MarkdownPreferenceWrapper }
    )

    await waitFor(() => {
      expect(container.querySelector('h3')).toBeNull()
    })
    expect(screen.getAllByText((_, node) => node?.textContent === 'Lesson title\nRead notes').length).toBeGreaterThan(0)
  })
})
