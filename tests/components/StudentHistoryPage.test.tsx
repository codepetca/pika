import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import HistoryPage from '@/app/student/history/page'
import { fetchClassDaysForClassroom } from '@/lib/class-days-client'
import { fetchStudentClassrooms, invalidateStudentClassrooms } from '@/lib/student-classrooms-client'
import { fetchStudentEntriesForClassroom } from '@/lib/student-entries-client'
import type { Classroom } from '@/types'

vi.mock('@/components/Spinner', () => ({
  Spinner: () => <div>Loading...</div>,
}))

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: () => '2025-05-10',
}))

vi.mock('@/lib/class-days-client', () => ({
  fetchClassDaysForClassroom: vi.fn(),
}))

vi.mock('@/lib/student-classrooms-client', () => ({
  fetchStudentClassrooms: vi.fn(),
  invalidateStudentClassrooms: vi.fn(),
}))

vi.mock('@/lib/student-entries-client', () => ({
  fetchStudentEntriesForClassroom: vi.fn(),
}))

const classroom: Classroom = {
  id: 'classroom-1',
  teacher_id: 'teacher-1',
  title: 'History Class',
  class_code: 'ABC123',
  theme_color: 'blue',
  term_label: null,
  allow_enrollment: true,
  start_date: null,
  end_date: null,
  lesson_plan_visibility: 'hidden',
  archived_at: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response
}

describe('HistoryPage', () => {
  beforeEach(() => {
    vi.mocked(fetchClassDaysForClassroom).mockResolvedValue([
      { id: 'day-1', classroom_id: classroom.id, date: '2025-05-09', prompt_text: null, is_class_day: true },
    ])
    vi.mocked(fetchStudentEntriesForClassroom).mockResolvedValue([])
    vi.mocked(fetchStudentClassrooms).mockResolvedValue([classroom])
    vi.mocked(invalidateStudentClassrooms).mockClear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    cleanup()
  })

  it('loads student classrooms through the shared cached client', async () => {
    render(<HistoryPage />)

    await waitFor(() => {
      expect(screen.getAllByText('History Class')).toHaveLength(2)
    })
    expect(screen.getByText('My Classes')).toBeInTheDocument()
    expect(fetchStudentClassrooms).toHaveBeenCalledOnce()
    await waitFor(() => {
      expect(fetchClassDaysForClassroom).toHaveBeenCalledWith(classroom.id)
      expect(fetchStudentEntriesForClassroom).toHaveBeenCalledWith(classroom.id)
    })
  })

  it('invalidates cached student classrooms after joining a class from the empty state', async () => {
    const joinedClassroom = { ...classroom, id: 'classroom-2', title: 'Joined Class', class_code: 'JOIN42' }
    vi.mocked(fetchStudentClassrooms).mockResolvedValue([])
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/student/classrooms/join') {
        return Promise.resolve(jsonResponse({ classroom: joinedClassroom }))
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as any)

    render(<HistoryPage />)

    expect(await screen.findByText('No Classes Yet')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: /class code/i }), {
      target: { value: 'join42' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Join Class' }))

    await waitFor(() => {
      expect(invalidateStudentClassrooms).toHaveBeenCalledOnce()
    })
    await waitFor(() => {
      expect(screen.getAllByText('Joined Class')).toHaveLength(2)
    })
    await waitFor(() => {
      expect(fetchClassDaysForClassroom).toHaveBeenCalledWith(joinedClassroom.id)
    })
  })
})
