import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TeacherStudentWorkPanel } from '@/components/TeacherStudentWorkPanel'
import { countCharacters } from '@/lib/tiptap-content'

vi.mock('@/components/Spinner', () => ({
  Spinner: () => <div data-testid="spinner" />,
}))

vi.mock('@/components/editor', () => ({
  RichTextViewer: ({ chrome, content }: any) => (
    <div data-testid="rich-text-viewer" data-chrome={chrome || 'default'}>
      {JSON.stringify(content)}
    </div>
  ),
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
}))

function makeStudentWork(
  studentId: string,
  opts: { graded: boolean; repoUrl?: string | null; githubUsername?: string | null; aiFeedbackSuggestion?: string | null; teacherFeedbackDraft?: string | null },
) {
  const doc = {
    id: `doc-${studentId}`,
    assignment_id: 'assignment-1',
    student_id: studentId,
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: `Work for ${studentId}` }],
        },
      ],
    },
    repo_url: null,
    github_username: null,
    is_submitted: true,
    submitted_at: '2026-02-20T12:00:00Z',
    viewed_at: '2026-02-20T12:00:00Z',
    score_completion: opts.graded ? 7 : null,
    score_thinking: opts.graded ? 8 : null,
    score_workflow: opts.graded ? 9 : null,
    feedback: opts.graded ? 'Nice work' : null,
    teacher_feedback_draft:
      opts.teacherFeedbackDraft !== undefined
        ? opts.teacherFeedbackDraft
        : opts.graded
          ? 'Nice work'
          : null,
    teacher_feedback_draft_updated_at:
      opts.teacherFeedbackDraft !== undefined || opts.graded
        ? '2026-02-20T13:00:00Z'
        : null,
    feedback_returned_at: null,
    ai_feedback_suggestion: opts.aiFeedbackSuggestion ?? null,
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
      track_authenticity: true,
      created_by: 'teacher-1',
      created_at: '2026-02-20T12:00:00Z',
      updated_at: '2026-02-20T12:00:00Z',
    },
    classroom: { id: 'classroom-1', title: 'Classroom' },
    student: { id: studentId, email: `${studentId}@example.com`, name: studentId },
    doc,
    status: 'submitted_on_time',
    feedback_entries: [],
    repo_target: {
      target: null,
      submittedRepoUrl: opts.repoUrl ?? null,
      submittedGitHubUsername: opts.githubUsername ?? null,
      effectiveRepoUrl: opts.repoUrl ?? null,
      effectiveGitHubUsername: opts.githubUsername ?? null,
      repoOwner: null,
      repoName: null,
      selectionMode: 'auto',
      validationStatus: 'missing',
      validationMessage: 'No GitHub repo link detected in the submission.',
      latest_result: null,
    },
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
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
}

function mockVisualViewport(width: number, height = 900) {
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: {
      width,
      height,
      offsetTop: 0,
      offsetLeft: 0,
      scale: 1,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  })
}

describe('TeacherStudentWorkPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    clearRightTabCookie()
    mockVisualViewport(1440)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    clearRightTabCookie()
  })

  it('keeps grading tab selected when switching students in details mode', async () => {
    mockFetchByStudent({
      'student-1': { graded: false },
      'student-2': { graded: false },
    })

    const user = userEvent.setup()
    const { rerender } = render(
      <TeacherStudentWorkPanel
        classroomId="classroom-1"
        assignmentId="assignment-1"
        studentId="student-1"
        mode="details"
        inspectorCollapsed={false}
        inspectorWidth={40}
        totalWidth={1200}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Grading' }))
    expect(await screen.findByLabelText('Completion score')).toBeInTheDocument()

    rerender(
      <TeacherStudentWorkPanel
        classroomId="classroom-1"
        assignmentId="assignment-1"
        studentId="student-2"
        mode="details"
        inspectorCollapsed={false}
        inspectorWidth={40}
        totalWidth={1200}
      />,
    )

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/teacher/assignments/assignment-1/students/student-2')
    })

    expect(await screen.findByLabelText('Completion score')).toBeInTheDocument()
  })

  it('renders details mode without the old shared header and keeps content flush', async () => {
    mockFetchByStudent({
      'student-1': { graded: false },
    })

    render(
      <TeacherStudentWorkPanel
        classroomId="classroom-1"
        assignmentId="assignment-1"
        studentId="student-1"
        mode="details"
        inspectorCollapsed={false}
        inspectorWidth={40}
        totalWidth={1200}
      />,
    )

    expect(await screen.findByTestId('rich-text-viewer')).toHaveAttribute('data-chrome', 'flush')
    expect(screen.queryByTestId('grading-workspace-header')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /show student table only/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('individual-content-header')).toHaveTextContent('student-1')
    const expectedCharacters = countCharacters({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Work for student-1' }],
        },
      ],
    })
    expect(screen.getByLabelText(`${expectedCharacters} characters`)).toHaveTextContent(`${expectedCharacters} chars`)
    expect(screen.queryByText(new RegExp(`${expectedCharacters} characters$`))).not.toBeInTheDocument()
  })

  it('prepends AI feedback suggestion into the feedback draft and marks it as an AI draft until focus', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/api/teacher/assignments/') && url.includes('/students/')) {
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeStudentWork('student-1', {
              graded: false,
              teacherFeedbackDraft: 'Teacher note',
              aiFeedbackSuggestion: 'AI feedback suggestion',
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

    render(
      <TeacherStudentWorkPanel
        classroomId="classroom-1"
        assignmentId="assignment-1"
        studentId="student-1"
        mode="details"
        inspectorCollapsed={false}
        inspectorWidth={40}
        totalWidth={1200}
      />,
    )

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Grading' }))
    const draft = await screen.findByPlaceholderText('Teacher feedback draft')
    expect(draft).toHaveValue('AI feedback suggestion\n\nTeacher note')
    expect(draft).toHaveClass('border-primary')
    expect(draft).toHaveClass('bg-info-bg')
    expect(screen.getByText('AI draft')).toBeInTheDocument()
    expect(screen.queryByText('AI Suggestion')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use' })).not.toBeInTheDocument()

    await userEvent.setup().click(draft)

    expect(draft).toHaveValue('AI feedback suggestion\n\nTeacher note')
    expect(draft).not.toHaveClass('border-primary')
    expect(draft).not.toHaveClass('bg-info-bg')
    expect(screen.queryByText('AI draft')).not.toBeInTheDocument()
  })

  it('prepends new AI feedback to the current unsaved draft after auto-grade', async () => {
    const user = userEvent.setup()
    let studentFetchCount = 0

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/api/teacher/assignments/') && url.includes('/students/')) {
        studentFetchCount += 1

        return Promise.resolve({
          ok: true,
          json: async () =>
            makeStudentWork('student-1', {
              graded: false,
              teacherFeedbackDraft: studentFetchCount > 1 ? null : '',
              aiFeedbackSuggestion: studentFetchCount > 1 ? 'AI feedback suggestion' : null,
            }),
        })
      }

      if (url.includes('/api/teacher/assignments/') && url.includes('/auto-grade')) {
        expect(init?.method).toBe('POST')

        return Promise.resolve({
          ok: true,
          json: async () => ({ graded_count: 1 }),
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

    render(
      <TeacherStudentWorkPanel
        classroomId="classroom-1"
        assignmentId="assignment-1"
        studentId="student-1"
        mode="details"
        inspectorCollapsed={false}
        inspectorWidth={40}
        totalWidth={1200}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Grading' }))
    const draft = await screen.findByPlaceholderText('Teacher feedback draft')
    await user.clear(draft)
    await user.type(draft, 'Teacher note')
    await user.click(screen.getByRole('button', { name: 'AI grade' }))

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Teacher feedback draft')).toHaveValue(
        'AI feedback suggestion\n\nTeacher note',
      )
    })

    expect(screen.getByText('AI draft')).toBeInTheDocument()
  })

  it('renders overview mode as inspector-only without submission content', async () => {
    mockFetchByStudent({
      'student-1': { graded: false },
    })

    render(
      <TeacherStudentWorkPanel
        classroomId="classroom-1"
        assignmentId="assignment-1"
        studentId="student-1"
        mode="overview"
        inspectorCollapsed={false}
        inspectorWidth={40}
        totalWidth={1200}
      />,
    )

    expect(await screen.findByText('History')).toBeInTheDocument()
    expect(screen.queryByTestId('rich-text-viewer')).not.toBeInTheDocument()
  })

  it('keeps prior content visible while the next student loads', async () => {
    const deferredStudent2 = createDeferred<any>()

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/api/teacher/assignments/assignment-1/students/student-1')) {
        return Promise.resolve({
          ok: true,
          json: async () => makeStudentWork('student-1', { graded: false }),
        })
      }

      if (url.includes('/api/teacher/assignments/assignment-1/students/student-2')) {
        return Promise.resolve({
          ok: true,
          json: async () => deferredStudent2.promise,
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

    const loadingStateSpy = vi.fn()
    const { rerender } = render(
      <TeacherStudentWorkPanel
        classroomId="classroom-1"
        assignmentId="assignment-1"
        studentId="student-1"
        mode="details"
        inspectorCollapsed={false}
        inspectorWidth={40}
        totalWidth={1200}
        onLoadingStateChange={loadingStateSpy}
      />,
    )

    expect(await screen.findByText(/Work for student-1/)).toBeInTheDocument()

    rerender(
      <TeacherStudentWorkPanel
        classroomId="classroom-1"
        assignmentId="assignment-1"
        studentId="student-2"
        mode="details"
        inspectorCollapsed={false}
        inspectorWidth={40}
        totalWidth={1200}
        onLoadingStateChange={loadingStateSpy}
      />,
    )

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/teacher/assignments/assignment-1/students/student-2')
    })

    expect(screen.getByText(/Work for student-1/)).toBeInTheDocument()
    expect(screen.queryByText('Refreshing history...')).not.toBeInTheDocument()
    expect(loadingStateSpy).toHaveBeenCalledWith(true)

    deferredStudent2.resolve(makeStudentWork('student-2', { graded: false }))

    expect(await screen.findByText(/Work for student-2/)).toBeInTheDocument()
  })

  it('renders the individual content header with student name first and repo metadata after it', async () => {
    mockFetchByStudent({
      'student-1': {
        graded: false,
        repoUrl: 'https://github.com/example/student-1-repo',
        githubUsername: 'student1',
      },
    })

    render(
      <TeacherStudentWorkPanel
        classroomId="classroom-1"
        assignmentId="assignment-1"
        studentId="student-1"
        mode="details"
        inspectorCollapsed={false}
        inspectorWidth={40}
        totalWidth={1200}
      />,
    )

    const header = await screen.findByTestId('individual-content-header')
    expect(header).toHaveTextContent('student-1')
    expect(header).toHaveTextContent('https://github.com/example/student-1-repo')
    expect(header).toHaveTextContent('@student1')
  })
})
