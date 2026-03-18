import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TeacherStudentWorkPanel } from '@/components/TeacherStudentWorkPanel'
import { readCookie, writeCookie } from '@/lib/cookies'
import { TEACHER_GRADE_UPDATED_EVENT } from '@/lib/events'

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
  SplitButton: ({ label, onPrimaryClick, options, toggleAriaLabel, ...props }: any) => (
    <div {...props}>
      <button type="button" onClick={onPrimaryClick}>
        {label}
      </button>
      <button type="button" aria-label={toggleAriaLabel || 'More actions'}>
        Toggle
      </button>
      {options.map((option: { id: string; label: string; onSelect: () => void }) => (
        <button key={option.id} type="button" onClick={option.onSelect}>
          {option.label}
        </button>
      ))}
    </div>
  ),
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
    teacher_feedback_draft: opts.graded ? 'Nice work' : null,
    teacher_feedback_draft_updated_at: opts.graded ? '2026-02-20T13:00:00Z' : null,
    feedback_returned_at: null,
    ai_feedback_suggestion: null,
    ai_feedback_suggested_at: null,
    ai_feedback_model: null,
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
      rich_instructions: null,
      due_at: '2026-02-20T12:00:00Z',
      position: 0,
      is_draft: false,
      released_at: '2026-02-18T12:00:00Z',
      evaluation_mode: 'document',
      track_authenticity: true,
      created_at: '2026-02-20T12:00:00Z',
      updated_at: '2026-02-20T12:00:00Z',
    },
    classroom: { id: 'classroom-1', title: 'Classroom' },
    student: { id: studentId, email: `${studentId}@example.com`, name: studentId },
    doc,
    status: 'submitted_on_time',
    feedback_entries: [],
    github_identity: null,
    repo_target: {
      target: null,
      candidateRepos: [],
      effectiveRepoUrl: null,
      repoOwner: null,
      repoName: null,
      selectionMode: 'auto',
      validationStatus: 'missing',
      validationMessage: 'No GitHub repo link detected in the submission.',
      latest_result: null,
    },
  }
}

function mockFetchByStudent(
  studentMap: Record<string, { graded: boolean }>,
  options?: { onGradeSave?: (body: Record<string, unknown>) => void }
) {
  ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
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

    if (url.includes('/api/teacher/assignments/') && url.includes('/grade') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>
      options?.onGradeSave?.(body)
      const isGraded = body.save_mode === 'graded'
      return Promise.resolve({
        ok: true,
        json: async () => ({
          doc: {
            ...makeStudentWork('student-1', { graded: isGraded }).doc,
            score_completion: Number(body.score_completion ?? 0),
            score_thinking: Number(body.score_thinking ?? 0),
            score_workflow: Number(body.score_workflow ?? 0),
            teacher_feedback_draft: String(body.feedback ?? ''),
            graded_at: isGraded ? '2026-02-20T13:00:00Z' : null,
            graded_by: isGraded ? 'teacher' : null,
          },
        }),
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

  it('saves as graded with the primary save action', async () => {
    const savedBodies: Array<Record<string, unknown>> = []
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    mockFetchByStudent(
      {
        'student-1': { graded: false },
      },
      {
        onGradeSave: (body) => savedBodies.push(body),
      }
    )

    const user = userEvent.setup()
    render(<TeacherStudentWorkPanel classroomId="classroom-1" assignmentId="assignment-1" studentId="student-1" />)

    await user.click(await screen.findByRole('button', { name: 'Grading' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(savedBodies).toHaveLength(1)
    })
    expect(savedBodies[0].save_mode).toBe('graded')
    const gradeEvent = dispatchSpy.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === TEACHER_GRADE_UPDATED_EVENT) as CustomEvent | undefined
    expect(gradeEvent).toBeDefined()
    expect(gradeEvent?.detail).toMatchObject({
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      doc: expect.objectContaining({
        student_id: 'student-1',
        graded_at: '2026-02-20T13:00:00Z',
      }),
    })
    expect(await screen.findByText(/^Graded /)).toBeInTheDocument()
  })

  it('saves as draft from split-button menu action', async () => {
    const savedBodies: Array<Record<string, unknown>> = []
    mockFetchByStudent(
      {
        'student-1': { graded: false },
      },
      {
        onGradeSave: (body) => savedBodies.push(body),
      }
    )

    const user = userEvent.setup()
    render(<TeacherStudentWorkPanel classroomId="classroom-1" assignmentId="assignment-1" studentId="student-1" />)

    await user.click(await screen.findByRole('button', { name: 'Grading' }))
    await user.click(screen.getByRole('button', { name: 'Choose save mode' }))
    await user.click(screen.getByRole('button', { name: 'Draft' }))

    await waitFor(() => {
      expect(savedBodies).toHaveLength(1)
    })
    expect(savedBodies[0].save_mode).toBe('draft')
    expect(screen.queryByText(/^Graded /)).not.toBeInTheDocument()
  })
})
