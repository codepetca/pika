import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { TeacherLessonCalendarTab } from '@/app/classrooms/[classroomId]/TeacherLessonCalendarTab'
import { StudentLessonCalendarTab } from '@/app/classrooms/[classroomId]/StudentLessonCalendarTab'
import { AppMessageProvider, TooltipProvider } from '@/ui'
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
  useClassDaysContext: () => ({
    classDays: [],
    error: null,
    hasLoadedSnapshot: true,
    isLoading: false,
    refresh: vi.fn(async () => {}),
  }),
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
  theme_color: 'blue',
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
  return <AppMessageProvider><TooltipProvider>{children}</TooltipProvider></AppMessageProvider>
}

function getCalendarViewButtons(name: 'list' | 'grid') {
  return screen.getAllByRole('button', { name: new RegExp(`^${name}$`, 'i') })
}

function expectCalendarViewSelected(name: 'list' | 'grid') {
  expect(getCalendarViewButtons(name).some((button) => button.getAttribute('aria-pressed') === 'true')).toBe(true)
}

describe('Calendar view mode persistence', () => {
  let readCookieSpy: ReturnType<typeof vi.spyOn>
  let writeCookieSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.restoreAllMocks()
    readCookieSpy = vi.spyOn(cookies, 'readCookie')
    writeCookieSpy = vi.spyOn(cookies, 'writeCookie')
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.includes('/lesson-plans')) return mockFetchResponse({ lesson_plans: [] })
      if (url.includes('/assignments')) return mockFetchResponse({ assignments: [] })
      if (url.includes('/announcements')) return mockFetchResponse({ announcements: [] })
      throw new Error(`Unhandled fetch: ${url}`)
    }))
  })

  afterEach(() => cleanup())

  describe.each([
    ['teacher', TeacherLessonCalendarTab],
    ['student', StudentLessonCalendarTab],
  ] as const)('%s calendar', (_role, CalendarTab) => {
    it.each([
      [null, 'grid'],
      ['invalid-value', 'grid'],
      ['list', 'list'],
      ['grid', 'grid'],
      ['week', 'list'],
      ['month', 'grid'],
      ['all', 'grid'],
    ] as const)('selects %s cookie as %s', async (saved, selected) => {
      readCookieSpy.mockReturnValue(saved)
      render(<CalendarTab showTests={false} classroom={mockClassroom} />, { wrapper: Wrapper })
      await waitFor(() => expectCalendarViewSelected(selected))
      expect(readCookieSpy).toHaveBeenCalledWith('calendarViewMode:cls-123')
    })

    it('persists the selected mode for this classroom', async () => {
      readCookieSpy.mockReturnValue(null)
      render(<CalendarTab showTests={false} classroom={mockClassroom} />, { wrapper: Wrapper })
      await waitFor(() => expectCalendarViewSelected('grid'))
      fireEvent.click(getCalendarViewButtons('list')[0])
      expect(writeCookieSpy).toHaveBeenCalledWith('calendarViewMode:cls-123', 'list')
      fireEvent.click(getCalendarViewButtons('grid')[0])
      expect(writeCookieSpy).toHaveBeenCalledWith('calendarViewMode:cls-123', 'grid')
    })
  })

  it('keeps the teacher Markdown control in More actions', async () => {
    readCookieSpy.mockReturnValue(null)
    render(<TeacherLessonCalendarTab showTests={false} classroom={mockClassroom} />, { wrapper: Wrapper })
    await waitFor(() => expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Edit calendar in Markdown' })).toBeInTheDocument()
  })

  it('does not offer the teacher Markdown control to students', async () => {
    readCookieSpy.mockReturnValue(null)
    render(<StudentLessonCalendarTab showTests={false} classroom={mockClassroom} />, { wrapper: Wrapper })
    await waitFor(() => expectCalendarViewSelected('grid'))
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Edit calendar in Markdown' })).not.toBeInTheDocument()
  })
})
