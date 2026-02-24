import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TeacherStudentWorkPanel } from '@/components/TeacherStudentWorkPanel'
import { readCookie, writeCookie } from '@/lib/cookies'

vi.mock('@/components/Spinner', () => ({
  Spinner: () => <div data-testid="spinner" />,
}))

vi.mock('@/components/editor', () => ({
  RichTextViewer: () => <div data-testid="rich-text-viewer" />,
}))

vi.mock('@/components/HistoryList', () => ({
  HistoryList: () => <div data-testid="history-list" />,
}))

vi.mock('@/ui', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Tooltip: ({ children }: any) => <>{children}</>,
  RefreshingIndicator: ({ label = 'Refreshing...' }: { label?: string }) => <div>{label}</div>,
}))

function makeStudentWork(studentId: string, opts: { graded: boolean }) {
  const doc = {
    id: `doc-${studentId}`,
    assignment_id: 'assignment-1',
    student_id: studentId,
    content: { type: 'doc', content: [] },
    is_submitted: true,
    submitted_at: '2026-02-20T12:00:00Z',
    viewed_at: '2026-02-20T12:00:00Z',
    score_completion: opts.graded ? 7 : null,
    score_thinking: opts.graded ? 8 : null,
    score_workflow: opts.graded ? 9 : null,
    feedback: opts.graded ? 'Nice work' : null,
    graded_at: opts.graded ? '2026-02-20T13:00:00Z' : null,
    graded_by: opts.graded ? 'teacher@example.com' : null,
    returned_at: null,
    authenticity_score: null,
    authenticity_flags: [],
    created_at: '2026-02-20T12:00:00Z',
    updated_at: '2026-02-20T12:00:00Z',
  }

  return {
    assignment: {
      id: 'assignment-1',
      classroom_id: 'classroom-1',
      title: 'Assignment',
      description: null,
      due_at: '2026-02-20T12:00:00Z',
      order_index: 0,
      is_draft: false,
      created_at: '2026-02-20T12:00:00Z',
      updated_at: '2026-02-20T12:00:00Z',
    },
    classroom: { id: 'classroom-1', title: 'Classroom' },
    student: { id: studentId, email: `${studentId}@example.com`, name: studentId },
    doc,
    status: 'submitted',
  }
}

function mockFetchByStudent(studentMap: Record<string, { graded: boolean }>) {
  ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)

    if (url.includes('/api/teacher/assignments/') && url.includes('/students/')) {
      const match = url.match(/\/students\/([^/?]+)/)
      const studentId = match?.[1] || ''
      const config = studentMap[studentId]
      if (!config) {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Student not found in test mock' }),
        })
      }

      return Promise.resolve({
        ok: true,
        json: async () => makeStudentWork(studentId, config),
      })
    }

    if (url.includes('/api/assignment-docs/') && url.includes('/history')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ history: [] }),
      })
    }

    return Promise.resolve({
      ok: false,
      json: async () => ({ error: `Unhandled fetch in test: ${url}` }),
    })
  })
}

function clearRightTabCookie() {
  document.cookie = 'pika_teacher_student_work_tab%3Aclassroom-1=; Path=/; Max-Age=0; SameSite=Lax'
  document.cookie = 'pika_teacher_student_work_tab%3Aclassroom-2=; Path=/; Max-Age=0; SameSite=Lax'
}

describe('TeacherStudentWorkPanel right-tab persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    clearRightTabCookie()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    clearRightTabCookie()
  })

  it('keeps grading tab selected when switching students', async () => {
    mockFetchByStudent({
      'student-1': { graded: false },
      'student-2': { graded: false },
    })

    const user = userEvent.setup()
    const { rerender } = render(
      <TeacherStudentWorkPanel classroomId="classroom-1" assignmentId="assignment-1" studentId="student-1" />
    )

    await user.click(await screen.findByRole('button', { name: 'Grading' }))
    expect(await screen.findByLabelText('Completion score')).toBeInTheDocument()

    rerender(
      <TeacherStudentWorkPanel classroomId="classroom-1" assignmentId="assignment-1" studentId="student-2" />
    )

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/teacher/assignments/assignment-1/students/student-2')
    })
    expect(await screen.findByLabelText('Completion score')).toBeInTheDocument()
    expect(screen.queryByText('No saves yet')).not.toBeInTheDocument()
  })

  it('keeps history tab selected when switching students', async () => {
    mockFetchByStudent({
      'student-1': { graded: true },
      'student-2': { graded: true },
    })

    const user = userEvent.setup()
    const { rerender } = render(
      <TeacherStudentWorkPanel classroomId="classroom-1" assignmentId="assignment-1" studentId="student-1" />
    )

    await user.click(await screen.findByRole('button', { name: 'Grading' }))
    expect(await screen.findByLabelText('Completion score')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'History' }))
    expect(await screen.findByText('No saves yet')).toBeInTheDocument()

    rerender(
      <TeacherStudentWorkPanel classroomId="classroom-1" assignmentId="assignment-1" studentId="student-2" />
    )

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/teacher/assignments/assignment-1/students/student-2')
    })
    expect(await screen.findByText('No saves yet')).toBeInTheDocument()
    expect(screen.queryByLabelText('Completion score')).not.toBeInTheDocument()
  })

  it('restores grading tab from cookie on initial load', async () => {
    writeCookie('pika_teacher_student_work_tab:classroom-1', 'grading')
    mockFetchByStudent({
      'student-1': { graded: false },
    })

    render(<TeacherStudentWorkPanel classroomId="classroom-1" assignmentId="assignment-1" studentId="student-1" />)

    expect(await screen.findByLabelText('Completion score')).toBeInTheDocument()
    expect(screen.queryByText('No saves yet')).not.toBeInTheDocument()
  })

  it('writes selected right-tab to cookie when toggled', async () => {
    mockFetchByStudent({
      'student-1': { graded: false },
    })

    const user = userEvent.setup()
    render(<TeacherStudentWorkPanel classroomId="classroom-1" assignmentId="assignment-1" studentId="student-1" />)

    await user.click(await screen.findByRole('button', { name: 'Grading' }))
    expect(readCookie('pika_teacher_student_work_tab:classroom-1')).toBe('grading')

    await user.click(screen.getByRole('button', { name: 'History' }))
    expect(readCookie('pika_teacher_student_work_tab:classroom-1')).toBe('history')
  })

  it('scopes right-tab preference per classroom', async () => {
    writeCookie('pika_teacher_student_work_tab:classroom-2', 'grading')
    mockFetchByStudent({
      'student-1': { graded: false },
    })

    render(<TeacherStudentWorkPanel classroomId="classroom-1" assignmentId="assignment-1" studentId="student-1" />)

    expect(await screen.findByText('No saves yet')).toBeInTheDocument()
    expect(screen.queryByLabelText('Completion score')).not.toBeInTheDocument()
  })
})
