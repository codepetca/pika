import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TeacherAttendanceTab } from '@/app/classrooms/[classroomId]/TeacherAttendanceTab'
import type { Classroom, Entry } from '@/types'

const todayMock = vi.hoisted(() => ({
  today: '2026-05-06',
}))

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: () => todayMock.today,
}))

const classDaysMock = vi.hoisted(() => ({
  defaultClassDays: [
    {
      id: 'day-1',
      classroom_id: 'classroom-1',
      date: '2026-05-05',
      prompt_text: null,
      is_class_day: true,
    },
  ],
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

function mockManyLogsFetch(count = 30) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/teacher/logs?')) {
      return mockJson({
        logs: Array.from({ length: count }, (_, index) => {
          const number = String(index + 1).padStart(2, '0')
          const studentId = `student-${number}`
          return {
            student_id: studentId,
            student_email: `${studentId}@example.com`,
            student_first_name: `Student${number}`,
            student_last_name: 'Test',
            entry: index % 2 === 0 ? entry({ id: `entry-${number}`, student_id: studentId }) : null,
            history_preview: [],
          }
        }),
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
    todayMock.today = '2026-05-06'
    classDaysMock.classDays = [...classDaysMock.defaultClassDays]
    classDaysMock.refresh.mockReset()
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
    expect(screen.queryByRole('button', { name: 'Hide class log summary' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show class log summary' })).not.toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'Resize class log summary' })).toBeInTheDocument()
    expect(screen.queryByRole('separator', { name: 'Resize Daily panes' })).not.toBeInTheDocument()
  })

  it('moves quickly between today and the last class day from the date picker cluster', async () => {
    const fetchMock = mockLogsFetch()
    const onDateChange = vi.fn()

    render(<TeacherAttendanceTab classroom={classroom} onDateChange={onDateChange} />)

    await screen.findByRole('columnheader', { name: 'Log' })

    const lastClassButton = screen.getByRole('button', { name: 'Go to last class' })
    const todayButton = screen.getByRole('button', { name: 'Go to today' })
    expect(lastClassButton).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Select attendance date' })).toHaveTextContent('Tue May 5')

    fireEvent.click(todayButton)

    await waitFor(() => {
      expect(onDateChange).toHaveBeenLastCalledWith('2026-05-06')
    })
    expect(screen.getByRole('button', { name: 'Select attendance date' })).toHaveTextContent('Wed May 6')

    fireEvent.click(lastClassButton)

    await waitFor(() => {
      expect(onDateChange).toHaveBeenLastCalledWith('2026-05-05')
    })
    expect(screen.getByRole('button', { name: 'Select attendance date' })).toHaveTextContent('Tue May 5')
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  it('uses the current Toronto date for quick jumps after a date rollover', async () => {
    classDaysMock.classDays = [
      ...classDaysMock.defaultClassDays,
      {
        id: 'day-2',
        classroom_id: 'classroom-1',
        date: '2026-05-06',
        prompt_text: null,
        is_class_day: true,
      },
    ]
    const onDateChange = vi.fn()
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} onDateChange={onDateChange} />)

    await screen.findByRole('columnheader', { name: 'Log' })
    expect(screen.getByRole('button', { name: 'Select attendance date' })).toHaveTextContent('Tue May 5')

    todayMock.today = '2026-05-07'
    fireEvent.click(screen.getByRole('button', { name: 'Go to today' }))

    await waitFor(() => {
      expect(onDateChange).toHaveBeenLastCalledWith('2026-05-07')
    })
    expect(screen.getByRole('button', { name: 'Select attendance date' })).toHaveTextContent('Thu May 7')

    fireEvent.click(screen.getByRole('button', { name: 'Go to last class' }))

    await waitFor(() => {
      expect(onDateChange).toHaveBeenLastCalledWith('2026-05-06')
    })
    expect(screen.getByRole('button', { name: 'Select attendance date' })).toHaveTextContent('Wed May 6')
  })

  it('collapses and restores the class log summary from a double click', async () => {
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    const panel = await screen.findByRole('region', { name: 'Class Log Summary' })
    expect(await screen.findByTestId('class-log-summary')).toBeInTheDocument()
    expect(panel).toHaveStyle({ height: '180px' })
    expect(panel).toHaveAttribute('data-state', 'expanded')

    fireEvent.doubleClick(panel)

    expect(screen.queryByTestId('class-log-summary')).not.toBeInTheDocument()
    expect(panel).toHaveStyle({ height: '40px' })
    expect(panel).toHaveAttribute('data-state', 'collapsed')
    expect(screen.getByText('Log Summary')).toBeInTheDocument()

    fireEvent.doubleClick(panel)

    expect(await screen.findByTestId('class-log-summary')).toBeInTheDocument()
    expect(panel).toHaveStyle({ height: '180px' })
    expect(panel).toHaveAttribute('data-state', 'expanded')
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

  it('reopens the collapsed class log summary by dragging the handle upward', async () => {
    mockLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    const panel = await screen.findByRole('region', { name: 'Class Log Summary' })

    fireEvent.doubleClick(panel)
    expect(panel).toHaveStyle({ height: '40px' })
    expect(panel).toHaveAttribute('data-state', 'collapsed')

    fireEvent(
      screen.getByRole('separator', { name: 'Resize class log summary' }),
      new MouseEvent('pointerdown', { clientY: 300, bubbles: true })
    )
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 90, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))

    expect(await screen.findByTestId('class-log-summary')).toBeInTheDocument()
    expect(panel).toHaveStyle({ height: '250px' })
    expect(panel).toHaveAttribute('data-state', 'expanded')
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

  it('restores the student table scroll position after opening a selected Daily workspace', async () => {
    let latestAnimationFrame: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      latestAnimationFrame = callback
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    mockManyLogsFetch()

    render(<TeacherAttendanceTab classroom={classroom} />)

    await screen.findByRole('cell', { name: 'Student25', exact: true })

    const scrollPane = screen.getByTestId('daily-student-scroll-pane') as HTMLDivElement
    scrollPane.scrollTop = 520
    fireEvent.scroll(scrollPane)

    fireEvent.click(screen.getByRole('cell', { name: 'Student25', exact: true }))

    expect(await screen.findByTestId('student-log-history')).toHaveTextContent('History for student-25')

    const selectedScrollPane = screen.getByTestId('daily-student-scroll-pane') as HTMLDivElement
    selectedScrollPane.scrollTop = 0
    act(() => {
      latestAnimationFrame?.(0)
    })

    expect(selectedScrollPane.scrollTop).toBe(520)
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
