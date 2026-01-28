import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { TeacherLessonCalendarTab } from '@/app/classrooms/[classroomId]/TeacherLessonCalendarTab'
import { StudentLessonCalendarTab } from '@/app/classrooms/[classroomId]/StudentLessonCalendarTab'
import { TooltipProvider } from '@/ui'
import * as cookies from '@/lib/cookies'
import type { Classroom } from '@/types'
import type { ReactNode } from 'react'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// Mock the layout hooks
vi.mock('@/components/layout', () => ({
  useRightSidebar: () => ({
    toggle: vi.fn(),
    isOpen: false,
    setOpen: vi.fn(),
    enabled: true,
    cssWidth: '300px',
  }),
}))

// Mock the class days hook
vi.mock('@/hooks/useClassDays', () => ({
  useClassDays: () => [],
}))

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

function mockFetchResponse(data: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(data) }) as ReturnType<typeof fetch>
}

function Wrapper({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>
}

describe('Calendar view mode persistence', () => {
  let readCookieSpy: ReturnType<typeof vi.spyOn>
  let writeCookieSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.restoreAllMocks()
    readCookieSpy = vi.spyOn(cookies, 'readCookie')
    writeCookieSpy = vi.spyOn(cookies, 'writeCookie')

    // Default mock for fetch
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.includes('/lesson-plans')) {
        return mockFetchResponse({ lesson_plans: [] })
      }
      if (url.includes('/assignments')) {
        return mockFetchResponse({ assignments: [] })
      }
      throw new Error(`Unhandled fetch: ${url}`)
    }))
  })

  afterEach(() => {
    cleanup()
  })

  describe('TeacherLessonCalendarTab', () => {
    it('initializes to week view when no cookie exists', async () => {
      readCookieSpy.mockReturnValue(null)

      render(<TeacherLessonCalendarTab classroom={mockClassroom} />, { wrapper: Wrapper })

      await waitFor(() => {
        const weekButton = screen.getByRole('button', { name: /week/i })
        expect(weekButton).toHaveClass('font-medium')
      })
    })

    it('initializes to saved view mode from cookie', async () => {
      readCookieSpy.mockReturnValue('month')

      render(<TeacherLessonCalendarTab classroom={mockClassroom} />, { wrapper: Wrapper })

      await waitFor(() => {
        const monthButton = screen.getByRole('button', { name: /month/i })
        expect(monthButton).toHaveClass('font-medium')
      })
    })

    it('initializes to all view from cookie', async () => {
      readCookieSpy.mockReturnValue('all')

      render(<TeacherLessonCalendarTab classroom={mockClassroom} />, { wrapper: Wrapper })

      await waitFor(() => {
        const allButton = screen.getByRole('button', { name: /all/i })
        expect(allButton).toHaveClass('font-medium')
      })
    })

    it('persists view mode to cookie when changed', async () => {
      readCookieSpy.mockReturnValue(null)

      render(<TeacherLessonCalendarTab classroom={mockClassroom} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /week/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /all/i }))

      expect(writeCookieSpy).toHaveBeenCalledWith('calendarViewMode:cls-123', 'all')
    })

    it('ignores invalid cookie values and defaults to week', async () => {
      readCookieSpy.mockReturnValue('invalid-value')

      render(<TeacherLessonCalendarTab classroom={mockClassroom} />, { wrapper: Wrapper })

      await waitFor(() => {
        const weekButton = screen.getByRole('button', { name: /week/i })
        expect(weekButton).toHaveClass('font-medium')
      })
    })

    it('reads cookie with classroom-specific key', async () => {
      readCookieSpy.mockReturnValue(null)

      render(<TeacherLessonCalendarTab classroom={mockClassroom} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(readCookieSpy).toHaveBeenCalledWith('calendarViewMode:cls-123')
      })
    })
  })

  describe('StudentLessonCalendarTab', () => {
    it('initializes to week view when no cookie exists', async () => {
      readCookieSpy.mockReturnValue(null)

      render(<StudentLessonCalendarTab classroom={mockClassroom} />, { wrapper: Wrapper })

      await waitFor(() => {
        const weekButton = screen.getByRole('button', { name: /week/i })
        expect(weekButton).toHaveClass('font-medium')
      })
    })

    it('initializes to saved view mode from cookie', async () => {
      readCookieSpy.mockReturnValue('month')

      render(<StudentLessonCalendarTab classroom={mockClassroom} />, { wrapper: Wrapper })

      await waitFor(() => {
        const monthButton = screen.getByRole('button', { name: /month/i })
        expect(monthButton).toHaveClass('font-medium')
      })
    })

    it('persists view mode to cookie when changed', async () => {
      readCookieSpy.mockReturnValue(null)

      render(<StudentLessonCalendarTab classroom={mockClassroom} />, { wrapper: Wrapper })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /week/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /month/i }))

      expect(writeCookieSpy).toHaveBeenCalledWith('calendarViewMode:cls-123', 'month')
    })

    it('ignores invalid cookie values and defaults to week', async () => {
      readCookieSpy.mockReturnValue('garbage')

      render(<StudentLessonCalendarTab classroom={mockClassroom} />, { wrapper: Wrapper })

      await waitFor(() => {
        const weekButton = screen.getByRole('button', { name: /week/i })
        expect(weekButton).toHaveClass('font-medium')
      })
    })
  })
})
