import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TeacherAttendanceTab } from '@/app/classrooms/[classroomId]/TeacherAttendanceTab'
import type { Classroom, Entry } from '@/types'

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: () => '2026-05-06',
}))

const classDaysMock = vi.hoisted(() => ({
  classDays: [
    {
      id: 'day-1',
      classroom_id: 'classroom-1',
      date: '2026-05-05',
      prompt_text: null,
      is_class_day: true,
    },
  ],
  refresh: vi.fn(),
}))

vi.mock('@/hooks/useClassDays', () => ({
  useClassDaysContext: () => ({
    classDays: classDaysMock.classDays,
    isLoading: false,
    refresh: classDaysMock.refresh,
  }),
}))

vi.mock('@/components/StudentLogHistory', () => ({
  StudentLogHistory: ({ studentId }: { studentId: string }) => (
    <div data-testid="student-log-history">History for {studentId}</div>
  ),
}))

vi.mock('@/app/classrooms/[classroomId]/LogSummary', () => ({
  LogSummary: () => (
    <div data-testid="class-log-summary">Cached class summary</div>
  ),
}))

vi.mock('@/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui')>()
  return {
    ...actual,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    RefreshingIndicator: () => <div data-testid="refreshing-indicator" />,
  }
})

const classroom: Classroom = {
  id: 'classroom-1',
  teacher_id: 'teacher-1',
  title: 'Daily Test Classroom',
  class_code: 'ABC123',
  term_label: null,
  allow_enrollment: true,
  start_date: null,
  end_date: null,
  lesson_plan_visibility: 'hidden',
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: 'entry-1',
    student_id: 'student-1',
    classroom_id: 'classroom-1',
    date: '2026-05-05',
    text: 'Today I worked carefully.',
    rich_content: null,
    version: 1,
    minutes_reported: null,
    mood: null,
    created_at: '2026-05-05T12:00:00.000Z',
    updated_at: '2026-05-05T12:00:00.000Z',
    on_time: true,
    ...overrides,
  }
}

const longLogText =
  'Today I worked on my persuasive letter about bike lanes and revised my thesis after getting peer feedback from my table group.'

function mockJson(data: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(data) }) as any
}

function mockLogsFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/teacher/logs?')) {
      return mockJson({
        logs: [
          {
            student_id: 'student-1',
            student_email: 'student1@example.com',
            student_first_name: 'Student1',
            student_last_name: 'Test',
            entry: entry({ text: longLogText }),
            history_preview: [],
          },
          {
            student_id: 'student-2',
            student_email: 'student2@example.com',
            student_first_name: 'Student2',
            student_last_name: 'Test',
            entry: null,
            history_preview: [],
          },
        ],
      })
    }
    throw new Error(`Unhandled fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('TeacherAttendanceTab', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows a full-width table with a truncated day-log column when no student is selected', async () => {
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    const logText = await screen.findByText(longLogText)

    expect(screen.getByRole('columnheader', { name: 'Log' })).toBeInTheDocument()
    expect(logText).toHaveClass('truncate')
    expect(logText).toHaveAttribute('title', longLogText)
    expect(screen.getByText('Class Log Summary')).toBeInTheDocument()
    expect(screen.getByTestId('class-log-summary')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide class log summary' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'Resize class log summary' })).toBeInTheDocument()
    expect(screen.queryByRole('separator', { name: 'Resize Daily panes' })).not.toBeInTheDocument()
  })

  it('hides and shows the class log summary from the floating action cluster', async () => {
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    expect(await screen.findByTestId('class-log-summary')).toBeInTheDocument()

    const hideButton = screen.getByRole('button', { name: 'Hide class log summary' })
    expect(hideButton).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(hideButton)

    expect(screen.queryByTestId('class-log-summary')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Class Log Summary' })).not.toBeInTheDocument()

    const showButton = screen.getByRole('button', { name: 'Show class log summary' })
    expect(showButton).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(showButton)

    expect(await screen.findByTestId('class-log-summary')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Class Log Summary' })).toHaveStyle({ height: '180px' })
  })

  it('resizes the class log summary card from the handle with keyboard controls', async () => {
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    const panel = await screen.findByRole('region', { name: 'Class Log Summary' })
    const separator = screen.getByRole('separator', { name: 'Resize class log summary' })

    expect(panel).toHaveStyle({ height: '180px' })
    expect(separator).toHaveClass('cursor-ns-resize')

    fireEvent.keyDown(separator, { key: 'ArrowUp' })
    expect(panel).toHaveStyle({ height: '212px' })

    fireEvent.keyDown(separator, { key: 'ArrowDown' })
    expect(panel).toHaveStyle({ height: '180px' })

    fireEvent.keyDown(separator, { key: 'ArrowUp' })
    fireEvent.keyDown(separator, { key: 'Enter' })
    expect(panel).toHaveStyle({ height: '180px' })
  })

  it('returns to the full-width log table after deselecting a selected student', async () => {
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    const studentCell = await screen.findByRole('cell', { name: 'Student1', exact: true })
    fireEvent.click(studentCell)

    expect(await screen.findByTestId('student-log-history')).toHaveTextContent('History for student-1')
    expect(screen.getByRole('separator', { name: 'Resize Daily panes' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Log' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('class-log-summary')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('cell', { name: 'Student1', exact: true }))

    await waitFor(() => {
      expect(screen.queryByRole('separator', { name: 'Resize Daily panes' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('columnheader', { name: 'Log' })).toBeInTheDocument()
    expect(screen.getByTestId('class-log-summary')).toBeInTheDocument()
  })

  it('deselects the selected student when Escape is pressed', async () => {
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    fireEvent.click(await screen.findByRole('cell', { name: 'Student1', exact: true }))

    expect(await screen.findByTestId('student-log-history')).toHaveTextContent('History for student-1')
    expect(screen.getByRole('separator', { name: 'Resize Daily panes' })).toBeInTheDocument()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    await waitFor(() => {
      expect(screen.queryByRole('separator', { name: 'Resize Daily panes' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('columnheader', { name: 'Log' })).toBeInTheDocument()
  })

  it('deselects the selected student when clicking outside the selected workspace', async () => {
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    fireEvent.click(await screen.findByRole('cell', { name: 'Student1', exact: true }))

    const historyPane = await screen.findByTestId('student-log-history')
    expect(historyPane).toHaveTextContent('History for student-1')

    fireEvent.pointerDown(historyPane)
    expect(screen.getByRole('separator', { name: 'Resize Daily panes' })).toBeInTheDocument()

    fireEvent.pointerDown(document.body)

    await waitFor(() => {
      expect(screen.queryByRole('separator', { name: 'Resize Daily panes' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('columnheader', { name: 'Log' })).toBeInTheDocument()
  })

  it('uses entry animations when switching between the full table and selected workspace', async () => {
    mockLogsFetch()

    const { container } = render(<TeacherAttendanceTab classroom={classroom} />)

    await screen.findByRole('columnheader', { name: 'Log' })
    expect(container.querySelector('.daily-table-enter')).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('cell', { name: 'Student1', exact: true }))

    expect(await screen.findByTestId('student-log-history')).toHaveTextContent('History for student-1')
    expect(container.querySelector('.daily-workspace-enter')).toBeInTheDocument()
    expect(container.querySelector('.daily-inspector-enter')).toBeInTheDocument()

    fireEvent.pointerDown(document.body)

    await waitFor(() => {
      expect(screen.queryByRole('separator', { name: 'Resize Daily panes' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('columnheader', { name: 'Log' })).toBeInTheDocument()
    expect(container.querySelector('.daily-table-enter')).toBeInTheDocument()
  })
})
