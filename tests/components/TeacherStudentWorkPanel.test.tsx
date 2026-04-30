import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TeacherStudentWorkPanel } from '@/components/TeacherStudentWorkPanel'

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
  HistoryList: ({ entries, onEntryClick, onEntryHover }: any) => (
    <div data-testid="history-list">
      {entries.map((entry: any) => (
        <button
          key={entry.id}
          type="button"
          onMouseEnter={() => onEntryHover?.(entry)}
          onClick={() => onEntryClick(entry)}
        >
          {entry.id}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@/ui', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Tooltip: ({ children }: any) => <>{children}</>,
}))

function makeStudentWork(
  studentId: string,
  opts: {
    graded: boolean
    repoUrl?: string | null
    githubUsername?: string | null
    aiFeedbackSuggestion?: string | null
    teacherFeedbackDraft?: string | null
    feedbackEntries?: Array<{ id: string; body: string; returned_at: string }>
    repoReviewResult?: Record<string, any> | null
    authenticityScore?: number | null
  },
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
    authenticity_score: opts.authenticityScore ?? null,
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
    feedback_entries: opts.feedbackEntries || [],
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
      latest_result: opts.repoReviewResult ?? null,
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

function mockFetchByStudent(
  studentMap: Record<
    string,
    {
      graded: boolean
      repoUrl?: string | null
      githubUsername?: string | null
      aiFeedbackSuggestion?: string | null
      teacherFeedbackDraft?: string | null
      feedbackEntries?: Array<{ id: string; body: string; returned_at: string }>
      repoReviewResult?: Record<string, any> | null
      authenticityScore?: number | null
      historyEntries?: Array<Record<string, any>>
    }
  >,
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

    if (url.includes('/api/assignment-docs/') && url.includes('/history')) {
      const match = url.match(/student_id=([^&]+)/)
      const studentId = match?.[1] || ''
      const config = studentMap[studentId]
      return Promise.resolve({
        ok: true,
        json: async () => ({ history: config?.historyEntries || [{ id: 'history-1' }] }),
      })
    }

    if (url.includes('/api/teacher/assignments/') && url.endsWith('/grade')) {
      const body = JSON.parse(String(init?.body || '{}')) as {
        student_id: string
        score_completion: number
        score_thinking: number
        score_workflow: number
        feedback: string
        save_mode?: 'draft' | 'graded'
      }
      const config = studentMap[body.student_id]
      const baseDoc = makeStudentWork(body.student_id, config || { graded: false }).doc

      return Promise.resolve({
        ok: true,
        json: async () => ({
          doc: {
            ...baseDoc,
            score_completion: body.score_completion,
            score_thinking: body.score_thinking,
            score_workflow: body.score_workflow,
            teacher_feedback_draft: body.feedback,
            teacher_feedback_draft_updated_at: '2026-02-20T13:05:00Z',
            graded_at: body.save_mode === 'graded' ? '2026-02-20T13:05:00Z' : null,
            graded_by: body.save_mode === 'graded' ? 'teacher@example.com' : null,
          },
        }),
      })
    }

    return Promise.resolve({
      ok: false,
      json: async () => ({ error: `Unhandled fetch in test: ${url}` }),
    })
  })
}

function clearInspectorSectionsCookies() {
  document.cookie = 'pika_teacher_student_work_sections%3Aclassroom-1=; Path=/; Max-Age=0; SameSite=Lax'
  document.cookie = 'pika_teacher_student_work_sections%3Aclassroom-2=; Path=/; Max-Age=0; SameSite=Lax'
  document.cookie = 'pika_teacher_student_work_visible_sections%3Aclassroom-1=; Path=/; Max-Age=0; SameSite=Lax'
  document.cookie = 'pika_teacher_student_work_visible_sections%3Aclassroom-2=; Path=/; Max-Age=0; SameSite=Lax'
}

function writeInspectorSectionsCookie(classroomId: string, value: string) {
  document.cookie = `pika_teacher_student_work_sections%3A${encodeURIComponent(classroomId)}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`
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
    clearInspectorSectionsCookies()
    mockVisualViewport(1440)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    clearInspectorSectionsCookies()
  })

  it('renders the new inspector sections in order with grade mode actions', async () => {
    mockFetchByStudent({
      'student-1': { graded: false, authenticityScore: 64 },
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

    await screen.findByTestId('grading-inspector-pane')

    const sectionIds = Array.from(
      document.querySelectorAll('[data-testid^="inspector-section-"]'),
    ).map((element) => element.getAttribute('data-testid'))
    expect(sectionIds).toEqual([
      'inspector-section-history',
      'inspector-section-repo',
      'inspector-section-grades',
      'inspector-section-comments',
    ])

    const gradesSection = screen.getByTestId('inspector-section-grades')
    expect(screen.getByText('Authenticity 64%')).toBeInTheDocument()
    expect(screen.getByText('No repo linked')).toBeInTheDocument()
    expect(within(gradesSection).getByText('0%')).toBeInTheDocument()
    expect(within(gradesSection).getByText('Total')).toBeInTheDocument()
    expect(within(gradesSection).getByText('30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Feedback' })).toBeInTheDocument()
    expect(screen.queryByText('No draft')).not.toBeInTheDocument()

    expect(screen.getByLabelText('Completion score')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Teacher feedback draft')).toBeInTheDocument()
    expect(screen.queryByTestId('history-list')).not.toBeInTheDocument()
    expect(screen.queryByText('Contribution')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Analyze Repo' })).not.toBeInTheDocument()

    expect(within(gradesSection).queryByRole('button', { name: 'AI grade' })).not.toBeInTheDocument()
    const gradeModeToggle = within(gradesSection).getByTestId('grade-mode-toggle')
    expect(within(gradeModeToggle).getByRole('button', { name: 'Draft' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(gradeModeToggle).getByRole('button', { name: 'Final' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(gradesSection).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    const feedbackSection = screen.getByTestId('inspector-section-comments')
    expect(within(feedbackSection).getByRole('button', { name: 'Send feedback' })).toBeInTheDocument()
  })

  it('uses edit-mode checkboxes to hide inspector cards outside edit mode', async () => {
    mockFetchByStudent({
      'student-1': { graded: false },
    })

    const user = userEvent.setup()
    const panelProps = {
      classroomId: 'classroom-1',
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      mode: 'details' as const,
      inspectorCollapsed: false,
      inspectorWidth: 40,
      totalWidth: 1200,
    }
    const { rerender } = render(
      <TeacherStudentWorkPanel
        {...panelProps}
        inspectorEditMode
      />,
    )

    const repoSection = await screen.findByTestId('inspector-section-repo')
    const repoVisibility = within(repoSection).getByRole('checkbox', { name: 'Show Repo card' })
    expect(repoVisibility).toBeChecked()
    expect(within(repoSection).getByText('No repo linked')).toBeInTheDocument()

    await user.click(repoVisibility)

    expect(repoVisibility).not.toBeChecked()
    expect(within(repoSection).queryByText('No repo linked')).not.toBeInTheDocument()

    rerender(<TeacherStudentWorkPanel {...panelProps} />)

    expect(screen.queryByTestId('inspector-section-repo')).not.toBeInTheDocument()

    rerender(
      <TeacherStudentWorkPanel
        {...panelProps}
        inspectorEditMode
      />,
    )

    const hiddenRepoSection = screen.getByTestId('inspector-section-repo')
    const hiddenRepoVisibility = within(hiddenRepoSection).getByRole('checkbox', {
      name: 'Show Repo card',
    })
    expect(hiddenRepoVisibility).not.toBeChecked()

    await user.click(hiddenRepoVisibility)

    expect(hiddenRepoVisibility).toBeChecked()

    rerender(<TeacherStudentWorkPanel {...panelProps} />)

    expect(screen.getByTestId('inspector-section-repo')).toBeInTheDocument()
  })

  it('collapses inspector cards when edit mode is entered', async () => {
    mockFetchByStudent({
      'student-1': { graded: false },
    })

    const panelProps = {
      classroomId: 'classroom-1',
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      mode: 'details' as const,
      inspectorCollapsed: false,
      inspectorWidth: 40,
      totalWidth: 1200,
    }
    const { rerender } = render(<TeacherStudentWorkPanel {...panelProps} />)

    expect(await screen.findByLabelText('Completion score')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Teacher feedback draft')).toBeInTheDocument()

    rerender(
      <TeacherStudentWorkPanel
        {...panelProps}
        inspectorEditMode
      />,
    )

    expect(screen.getByRole('button', { name: 'Grade' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Feedback' })).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => {
      expect(screen.queryByLabelText('Completion score')).not.toBeInTheDocument()
    })
    expect(screen.queryByPlaceholderText('Teacher feedback draft')).not.toBeInTheDocument()
  })

  it('autosaves valid grading edits as final by default without a save button', async () => {
    const gradeBodies: Array<Record<string, unknown>> = []

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/api/teacher/assignments/') && url.includes('/students/')) {
        return Promise.resolve({
          ok: true,
          json: async () => makeStudentWork('student-1', { graded: false }),
        })
      }

      if (url.includes('/api/assignment-docs/') && url.includes('/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ history: [] }),
        })
      }

      if (url.includes('/api/teacher/assignments/') && url.endsWith('/grade')) {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        gradeBodies.push(body)
        return Promise.resolve({
          ok: true,
          json: async () => ({
            doc: {
              ...makeStudentWork('student-1', { graded: true }).doc,
              score_completion: 6,
              score_thinking: 7,
              score_workflow: 8,
              teacher_feedback_draft: 'Teacher note',
              teacher_feedback_draft_updated_at: '2026-02-20T13:05:00Z',
              graded_at: '2026-02-20T13:05:00Z',
              graded_by: 'teacher@example.com',
            },
          }),
        })
      }

      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch in test: ${url}` }),
      })
    })

    const user = userEvent.setup()
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

    await screen.findByLabelText('Completion score')

    await user.click(screen.getByRole('button', { name: 'Set Completion score to 6' }))
    await user.click(screen.getByRole('button', { name: 'Set Thinking score to 7' }))
    await user.click(screen.getByRole('button', { name: 'Set Workflow score to 8' }))
    fireEvent.change(screen.getByPlaceholderText('Teacher feedback draft'), {
      target: { value: 'Teacher note' },
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100))
    })

    await waitFor(() => {
      expect(gradeBodies).toHaveLength(1)
    })
    expect(gradeBodies[0]).toMatchObject({
      student_id: 'student-1',
      score_completion: 6,
      score_thinking: 7,
      score_workflow: 8,
      feedback: 'Teacher note',
      save_mode: 'graded',
    })
    expect(screen.getByText('Graded Feb 20, 8:05 AM')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('autosaves feedback-only edits after switching to draft', async () => {
    const gradeBodies: Array<Record<string, unknown>> = []

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/api/teacher/assignments/') && url.includes('/students/')) {
        return Promise.resolve({
          ok: true,
          json: async () => makeStudentWork('student-1', { graded: false }),
        })
      }

      if (url.includes('/api/assignment-docs/') && url.includes('/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ history: [] }),
        })
      }

      if (url.includes('/api/teacher/assignments/') && url.endsWith('/grade')) {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        gradeBodies.push(body)
        return Promise.resolve({
          ok: true,
          json: async () => ({
            doc: {
              ...makeStudentWork('student-1', { graded: false }).doc,
              score_completion: body.score_completion ?? null,
              score_thinking: body.score_thinking ?? null,
              score_workflow: body.score_workflow ?? null,
              teacher_feedback_draft: body.feedback ?? null,
              teacher_feedback_draft_updated_at: '2026-02-20T13:05:00Z',
              graded_at: null,
              graded_by: null,
            },
          }),
        })
      }

      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch in test: ${url}` }),
      })
    })

    const user = userEvent.setup()
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

    await screen.findByPlaceholderText('Teacher feedback draft')
    await user.click(screen.getByRole('button', { name: 'Draft' }))

    await waitFor(() => {
      expect(gradeBodies).toHaveLength(1)
    })
    gradeBodies.length = 0

    await user.type(screen.getByPlaceholderText('Teacher feedback draft'), 'Teacher note')

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100))
    })

    await waitFor(() => {
      expect(gradeBodies).toHaveLength(1)
    })
    expect(gradeBodies[0]).toMatchObject({
      student_id: 'student-1',
      score_completion: null,
      score_thinking: null,
      score_workflow: null,
      feedback: 'Teacher note',
      save_mode: 'draft',
    })
    expect(screen.getByText('Draft autosaved')).toBeInTheDocument()
  })

  it('clears the draft autosaved label shortly after a successful autosave', async () => {
    const gradeBodies: Array<Record<string, unknown>> = []

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/api/teacher/assignments/') && url.includes('/students/')) {
        return Promise.resolve({
          ok: true,
          json: async () => makeStudentWork('student-1', { graded: false }),
        })
      }

      if (url.includes('/api/assignment-docs/') && url.includes('/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ history: [] }),
        })
      }

      if (url.includes('/api/teacher/assignments/') && url.endsWith('/grade')) {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        gradeBodies.push(body)
        return Promise.resolve({
          ok: true,
          json: async () => ({
            doc: {
              ...makeStudentWork('student-1', { graded: false }).doc,
              score_completion: body.score_completion ?? null,
              score_thinking: body.score_thinking ?? null,
              score_workflow: body.score_workflow ?? null,
              teacher_feedback_draft: body.feedback ?? null,
              teacher_feedback_draft_updated_at: '2026-02-20T13:05:00Z',
              graded_at: null,
              graded_by: null,
            },
          }),
        })
      }

      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch in test: ${url}` }),
      })
    })

    const user = userEvent.setup()
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

    await screen.findByPlaceholderText('Teacher feedback draft')
    await user.click(screen.getByRole('button', { name: 'Draft' }))

    await waitFor(() => {
      expect(gradeBodies).toHaveLength(1)
    })
    gradeBodies.length = 0

    await user.type(screen.getByPlaceholderText('Teacher feedback draft'), 'Teacher note')

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100))
    })

    await waitFor(() => {
      expect(gradeBodies).toHaveLength(1)
    })
    expect(screen.getByText('Draft autosaved')).toBeInTheDocument()

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2600))
    })

    expect(screen.queryByText('Draft autosaved')).not.toBeInTheDocument()
  })

  it('marks the current grade as graded on demand', async () => {
    const gradeBodies: Array<Record<string, unknown>> = []

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/api/teacher/assignments/') && url.includes('/students/')) {
        return Promise.resolve({
          ok: true,
          json: async () => makeStudentWork('student-1', { graded: false }),
        })
      }

      if (url.includes('/api/assignment-docs/') && url.includes('/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ history: [] }),
        })
      }

      if (url.includes('/api/teacher/assignments/') && url.endsWith('/grade')) {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        gradeBodies.push(body)
        return Promise.resolve({
          ok: true,
          json: async () => ({
            doc: {
              ...makeStudentWork('student-1', { graded: true }).doc,
              score_completion: 7,
              score_thinking: 8,
              score_workflow: 9,
              teacher_feedback_draft: 'Nice work',
              teacher_feedback_draft_updated_at: '2026-02-20T13:05:00Z',
              graded_at: '2026-02-20T13:05:00Z',
              graded_by: 'teacher@example.com',
            },
          }),
        })
      }

      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch in test: ${url}` }),
      })
    })

    const user = userEvent.setup()
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

    await screen.findByLabelText('Completion score')
    await user.click(screen.getByRole('button', { name: 'Set Completion score to 7' }))
    await user.click(screen.getByRole('button', { name: 'Set Thinking score to 8' }))
    await user.click(screen.getByRole('button', { name: 'Set Workflow score to 9' }))
    await user.click(screen.getByRole('button', { name: 'Final' }))

    await waitFor(() => {
      expect(gradeBodies.at(-1)).toMatchObject({ save_mode: 'graded' })
    })
    expect(screen.getByText('Graded Feb 20, 8:05 AM')).toBeInTheDocument()
  })

  it('persists expanded and collapsed sections per classroom when switching students', async () => {
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

    await user.click(await screen.findByRole('button', { name: 'History' }))
    await user.click(screen.getByRole('button', { name: 'Grade' }))

    expect(await screen.findByTestId('history-list')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByLabelText('Completion score')).not.toBeInTheDocument()
    })

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

    expect(await screen.findByTestId('history-list')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByLabelText('Completion score')).not.toBeInTheDocument()
    })
  })

  it('falls back to the default expanded sections when the cookie is invalid', async () => {
    writeInspectorSectionsCookie('classroom-1', 'nope,grades')
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

    expect(await screen.findByLabelText('Completion score')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Teacher feedback draft')).toBeInTheDocument()
    expect(screen.queryByTestId('history-list')).not.toBeInTheDocument()
    expect(screen.queryByText('Contribution')).not.toBeInTheDocument()
  })

  it('keeps classroom-specific section state isolated', async () => {
    writeInspectorSectionsCookie('classroom-2', 'history,repo')
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

    expect(await screen.findByLabelText('Completion score')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Teacher feedback draft')).toBeInTheDocument()
    expect(screen.queryByTestId('history-list')).not.toBeInTheDocument()
  })

  it('reveals repo metrics only when the repo section is expanded and keeps Analyze Repo there', async () => {
    mockFetchByStudent({
      'student-1': {
        graded: false,
        repoUrl: 'https://github.com/example/student-1-repo',
        githubUsername: 'student1',
        repoReviewResult: {
          github_login: 'student1',
          relative_contribution_share: 0.8,
          spread_score: 0.7,
          iteration_score: 0.6,
        },
      },
    })

    const user = userEvent.setup()
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

    const repoSection = await screen.findByTestId('inspector-section-repo')
    expect(within(repoSection).queryByRole('button', { name: 'Analyze Repo' })).not.toBeInTheDocument()
    expect(screen.queryByText('Contribution')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Repo' }))

    expect(within(repoSection).getByRole('button', { name: 'Analyze Repo' })).toBeInTheDocument()
    expect(within(repoSection).getByText('Contribution')).toBeInTheDocument()
    expect(within(repoSection).getByText('Consistency')).toBeInTheDocument()
    expect(within(repoSection).getByText('Iteration')).toBeInTheDocument()
  })

  it('toggles collapsed cards when clicking the header summary area', async () => {
    mockFetchByStudent({
      'student-1': { graded: false },
    })

    const user = userEvent.setup()
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

    const repoSection = await screen.findByTestId('inspector-section-repo')
    expect(within(repoSection).queryByRole('button', { name: 'Analyze Repo' })).not.toBeInTheDocument()

    await user.click(within(repoSection).getByText('No repo linked'))

    expect(within(repoSection).getByRole('button', { name: 'Analyze Repo' })).toBeInTheDocument()
  })

  it('updates the individual-mode preview when hovering a history entry', async () => {
    mockFetchByStudent({
      'student-1': {
        graded: false,
        historyEntries: [
          {
            id: 'history-older',
            assignment_doc_id: 'doc-student-1',
            patch: null,
            snapshot: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Older saved work' }],
                },
              ],
            },
            word_count: 3,
            char_count: 16,
            paste_word_count: 0,
            keystroke_count: 10,
            trigger: 'save',
            created_at: '2026-02-20T11:00:00Z',
          },
          {
            id: 'history-newer',
            assignment_doc_id: 'doc-student-1',
            patch: null,
            snapshot: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Newer saved work' }],
                },
              ],
            },
            word_count: 3,
            char_count: 16,
            paste_word_count: 0,
            keystroke_count: 10,
            trigger: 'save',
            created_at: '2026-02-20T12:00:00Z',
          },
        ],
      },
    })

    const user = userEvent.setup()
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

    await user.click(await screen.findByRole('button', { name: 'History' }))

    expect(screen.getByTestId('rich-text-viewer')).toHaveTextContent('Work for student-1')

    await user.hover(screen.getByRole('button', { name: 'history-older' }))

    expect(screen.getByTestId('rich-text-viewer')).toHaveTextContent('Older saved work')
    expect(screen.getByText('Previewing save from Feb 20, 6:00 AM')).toBeInTheDocument()
  })

  it('shows no comments summary pills when collapsed and keeps expanded returned feedback details', async () => {
    mockFetchByStudent({
      'student-1': {
        graded: false,
        teacherFeedbackDraft: 'Teacher draft',
        feedbackEntries: [
          {
            id: 'feedback-1',
            body: 'Returned feedback body',
            returned_at: '2026-02-20T14:00:00Z',
          },
        ],
      },
    })

    const user = userEvent.setup()
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

    expect(await screen.findByText('Returned feedback body')).toBeInTheDocument()
    expect(screen.getByText('Returned feedback body')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Feedback' }))

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Teacher feedback draft')).not.toBeInTheDocument()
    })
    expect(screen.queryByText('Draft present')).not.toBeInTheDocument()
    expect(screen.queryByText('1 returned')).not.toBeInTheDocument()
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

    const draft = await screen.findByPlaceholderText('Teacher feedback draft')
    expect(draft).toHaveValue('AI feedback suggestion\n\nTeacher note')
    expect(draft).toHaveClass('border-primary')
    expect(draft).toHaveClass('bg-info-bg')
    expect(screen.getByText('AI draft')).toBeInTheDocument()

    await userEvent.setup().click(draft)

    expect(draft).toHaveValue('AI feedback suggestion\n\nTeacher note')
    expect(draft).not.toHaveClass('border-primary')
    expect(draft).not.toHaveClass('bg-info-bg')
    expect(screen.queryByText('AI draft')).not.toBeInTheDocument()
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

    expect(await screen.findByTestId('grading-inspector-pane')).toBeInTheDocument()
    expect(screen.queryByTestId('rich-text-viewer')).not.toBeInTheDocument()
  })

  it('highlights requested inspector sections', async () => {
    mockFetchByStudent({
      'student-1': { graded: false },
    })

    render(
      <TeacherStudentWorkPanel
        classroomId="classroom-1"
        assignmentId="assignment-1"
        studentId="student-1"
        mode="overview"
        highlightedInspectorSections={['grades', 'comments']}
      />,
    )

    await screen.findByTestId('grading-inspector-pane')

    expect(screen.getByTestId('inspector-section-history')).not.toHaveAttribute('data-highlighted')
    expect(screen.getByTestId('inspector-section-repo')).not.toHaveAttribute('data-highlighted')
    expect(screen.getByTestId('inspector-section-grades')).toHaveAttribute('data-highlighted', 'true')
    expect(screen.getByTestId('inspector-section-comments')).toHaveAttribute('data-highlighted', 'true')
  })

  it('clears the grade template while the next overview student loads', async () => {
    const deferredStudent2 = createDeferred<any>()

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/api/teacher/assignments/assignment-1/students/student-1')) {
        return Promise.resolve({
          ok: true,
          json: async () => makeStudentWork('student-1', {
            graded: true,
            teacherFeedbackDraft: 'Student 1 feedback',
          }),
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

    const onGradeTemplateChange = vi.fn()
    const { rerender } = render(
      <TeacherStudentWorkPanel
        classroomId="classroom-1"
        assignmentId="assignment-1"
        studentId="student-1"
        mode="overview"
        onGradeTemplateChange={onGradeTemplateChange}
      />,
    )

    await waitFor(() => {
      expect(onGradeTemplateChange).toHaveBeenCalledWith(expect.objectContaining({
        studentId: 'student-1',
        feedbackDraft: 'Student 1 feedback',
      }))
    })

    onGradeTemplateChange.mockClear()

    rerender(
      <TeacherStudentWorkPanel
        classroomId="classroom-1"
        assignmentId="assignment-1"
        studentId="student-2"
        mode="overview"
        onGradeTemplateChange={onGradeTemplateChange}
      />,
    )

    await waitFor(() => {
      expect(onGradeTemplateChange).toHaveBeenLastCalledWith(null)
    })

    expect(onGradeTemplateChange).not.toHaveBeenCalledWith(expect.objectContaining({
      studentId: 'student-2',
      feedbackDraft: 'Student 1 feedback',
    }))

    deferredStudent2.resolve(makeStudentWork('student-2', {
      graded: true,
      teacherFeedbackDraft: 'Student 2 feedback',
    }))

    await waitFor(() => {
      expect(onGradeTemplateChange).toHaveBeenCalledWith(expect.objectContaining({
        studentId: 'student-2',
        feedbackDraft: 'Student 2 feedback',
      }))
    })
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
    expect(loadingStateSpy).toHaveBeenCalledWith(true)

    deferredStudent2.resolve(makeStudentWork('student-2', { graded: false }))

    expect(await screen.findByText(/Work for student-2/)).toBeInTheDocument()
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
    expect(screen.queryByTestId('individual-content-header')).not.toBeInTheDocument()
  })

  it('removes student identity and repo metadata from the top content header in details mode', async () => {
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

    await screen.findByTestId('rich-text-viewer')
    expect(screen.queryByTestId('individual-content-header')).not.toBeInTheDocument()
  })

  it('resets the individual pane split to 50/50 on separator double click', async () => {
    mockFetchByStudent({
      'student-1': { graded: false },
    })

    const onLayoutChange = vi.fn()

    render(
      <TeacherStudentWorkPanel
        classroomId="classroom-1"
        assignmentId="assignment-1"
        studentId="student-1"
        mode="details"
        inspectorCollapsed={false}
        inspectorWidth={40}
        totalWidth={1200}
        onLayoutChange={onLayoutChange}
      />,
    )

    await screen.findByTestId('rich-text-viewer')

    fireEvent.doubleClick(screen.getByRole('separator', { name: 'Resize content and grading panes' }))

    expect(onLayoutChange).toHaveBeenCalledTimes(1)
    expect(onLayoutChange.mock.calls[0]?.[0]).toEqual(expect.any(Function))
    expect(onLayoutChange.mock.calls[0][0]({
      inspectorCollapsed: false,
      inspectorWidth: 40,
    })).toEqual({
      inspectorCollapsed: false,
      inspectorWidth: 50,
    })
  })
})
