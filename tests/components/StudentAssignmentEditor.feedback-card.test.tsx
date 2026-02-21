import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { StudentAssignmentEditor } from '@/components/StudentAssignmentEditor'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/components/StudentNotificationsProvider', () => ({
  useStudentNotifications: () => null,
}))

vi.mock('@/components/Spinner', () => ({
  Spinner: () => <div data-testid="spinner" />,
}))

vi.mock('@/components/HistoryList', () => ({
  HistoryList: () => <div data-testid="history-list" />,
}))

vi.mock('@/components/editor', () => ({
  RichTextEditor: () => <div data-testid="rich-text-editor" />,
  RichTextViewer: () => <div data-testid="rich-text-viewer" />,
}))

vi.mock('@/ui', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Tooltip: ({ children }: any) => <>{children}</>,
}))

function makeAssignment() {
  return {
    id: 'assignment-1',
    classroom_id: 'classroom-1',
    title: 'Assignment Title',
    description: 'Assignment description',
    due_at: '2026-02-20T00:00:00Z',
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
  } as any
}

function makeDoc(overrides: Record<string, unknown>) {
  return {
    id: 'doc-1',
    assignment_id: 'assignment-1',
    student_id: 'student-1',
    content: { type: 'doc', content: [] },
    is_submitted: false,
    submitted_at: null,
    viewed_at: '2026-02-10T00:00:00Z',
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    score_completion: null,
    score_thinking: null,
    score_workflow: null,
    feedback: null,
    graded_at: null,
    graded_by: null,
    returned_at: '2026-02-15T00:00:00Z',
    ...overrides,
  } as any
}

describe('StudentAssignmentEditor feedback card rendering', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function mockLoadResponses(doc: any) {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ history: [] }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ assignment: makeAssignment(), doc, wasFirstView: false }),
      })
    })
  }

  it('shows returned feedback card for feedback-only (no scores)', async () => {
    mockLoadResponses(
      makeDoc({
        feedback: 'Teacher comment only.',
        score_completion: null,
        score_thinking: null,
        score_workflow: null,
      }),
    )

    render(<StudentAssignmentEditor classroomId="classroom-1" assignmentId="assignment-1" variant="embedded" />)

    await waitFor(() => {
      expect(screen.getByText('Feedback')).toBeInTheDocument()
    })
    expect(screen.getByText('Teacher comment only.')).toBeInTheDocument()
    expect(screen.getByText('No score assigned.')).toBeInTheDocument()
    expect(screen.queryByText('Total')).not.toBeInTheDocument()
  })

  it('shows available score rows for partial grades and hides total', async () => {
    mockLoadResponses(
      makeDoc({
        feedback: '',
        score_completion: 7,
        score_thinking: null,
        score_workflow: null,
      }),
    )

    render(<StudentAssignmentEditor classroomId="classroom-1" assignmentId="assignment-1" variant="embedded" />)

    await waitFor(() => {
      expect(screen.getByText('Feedback')).toBeInTheDocument()
    })
    expect(screen.getByText('Completion')).toBeInTheDocument()
    expect(screen.queryByText('Thinking')).not.toBeInTheDocument()
    expect(screen.queryByText('Workflow')).not.toBeInTheDocument()
    expect(screen.queryByText('Total')).not.toBeInTheDocument()
    expect(screen.getByText('No feedback provided yet.')).toBeInTheDocument()
  })

  it('shows full score set and total percent when all scores exist', async () => {
    mockLoadResponses(
      makeDoc({
        feedback: 'Strong effort and clear structure.',
        score_completion: 9,
        score_thinking: 8,
        score_workflow: 7,
      }),
    )

    render(<StudentAssignmentEditor classroomId="classroom-1" assignmentId="assignment-1" variant="embedded" />)

    await waitFor(() => {
      expect(screen.getByText('Feedback')).toBeInTheDocument()
    })
    expect(screen.getByText('Completion')).toBeInTheDocument()
    expect(screen.getByText('Thinking')).toBeInTheDocument()
    expect(screen.getByText('Workflow')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getByText('Strong effort and clear structure.')).toBeInTheDocument()
  })
})
