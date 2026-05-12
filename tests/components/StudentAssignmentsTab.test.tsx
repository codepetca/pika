import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { forwardRef, useEffect, useImperativeHandle } from 'react'
import { StudentAssignmentsTab } from '@/app/classrooms/[classroomId]/StudentAssignmentsTab'
import type { Classroom, AssignmentWithStatus, ClassworkMaterial } from '@/types'

// --- Mocks ---

const mockPush = vi.fn()
let searchParamsMap = new Map<string, string>()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({
    get: (key: string) => searchParamsMap.get(key) ?? null,
    toString: () => {
      const parts: string[] = []
      searchParamsMap.forEach((v, k) => parts.push(`${k}=${v}`))
      return parts.join('&')
    },
  }),
}))

vi.mock('@/components/StudentAssignmentEditor', () => ({
  StudentAssignmentEditor: forwardRef((props: any, ref) => {
    useImperativeHandle(ref, () => ({
      submit: vi.fn(),
      unsubmit: vi.fn(),
      openRepoDialog: vi.fn(),
      isSubmitted: false,
      canSubmit: false,
      submitting: false,
    }))
    useEffect(() => {
      props.onStateChange?.({ isSubmitted: false, canSubmit: false, submitting: false, hasRepoMetadata: false })
    }, [props.onStateChange])
    return <div data-testid="student-editor">Editor</div>
  }),
}))

vi.mock('@/components/editor', () => ({
  RichTextViewer: ({ content }: any) => <div data-testid="rich-text-viewer">{JSON.stringify(content)}</div>,
}))

// --- Helpers ---

const classroom: Classroom = {
  id: 'cls-1',
  teacher_id: 'teacher-1',
  title: 'Test Class',
  class_code: 'ABC123',
  term_label: null,
  allow_enrollment: true,
  start_date: null,
  end_date: null,
  lesson_plan_visibility: 'hidden',
  archived_at: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

function makeAssignment(overrides: Partial<AssignmentWithStatus> = {}): AssignmentWithStatus {
  return {
    id: 'asgn-1',
    classroom_id: 'cls-1',
    title: 'Essay Assignment',
    description: 'Write an essay',
    instructions_markdown: 'Write an essay',
    rich_instructions: null,
    due_at: '2025-06-01T00:00:00Z',
    position: 0,
    is_draft: false,
    released_at: '2025-05-01T00:00:00Z',
    track_authenticity: true,
    created_by: 'teacher-1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    status: 'not_started',
    doc: null,
    ...overrides,
  } as AssignmentWithStatus
}

function makeMaterial(overrides: Partial<ClassworkMaterial> = {}): ClassworkMaterial {
  return {
    id: 'mat-1',
    classroom_id: 'cls-1',
    title: 'Reference Material',
    content: { type: 'doc', content: [] },
    is_draft: false,
    released_at: '2025-05-01T00:00:00Z',
    position: 0,
    created_by: 'teacher-1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function mockFetchClasswork(assignments: AssignmentWithStatus[], materials: ClassworkMaterial[] = []) {
  ;(global.fetch as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ assignments }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ materials }),
    })
}

const mockFetchAssignments = mockFetchClasswork

describe('StudentAssignmentsTab', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    searchParamsMap = new Map()
    mockPush.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('first-time view: auto-shows instructions modal', async () => {
    const unviewed = makeAssignment({ doc: null })
    searchParamsMap.set('assignmentId', 'asgn-1')
    mockFetchAssignments([unviewed])

    render(
      <StudentAssignmentsTab
        classroom={classroom}
        selectedAssignmentId={searchParamsMap.get('assignmentId') ?? null}
      />
    )

    // Modal should auto-appear for first-time view with assignment description
    await waitFor(() => {
      expect(screen.getByText('Write an essay')).toBeInTheDocument()
    })
    // Modal heading "Instructions" + action bar button "Instructions" = 2 matches
    expect(screen.getAllByText('Instructions').length).toBeGreaterThanOrEqual(1)
  })

  it('Instructions button reopens modal for viewed assignment', async () => {
    const viewed = makeAssignment({
      doc: {
        id: 'doc-1',
        assignment_id: 'asgn-1',
        student_id: 'stu-1',
        content: { type: 'doc', content: [] },
        is_submitted: false,
        submitted_at: null,
        viewed_at: '2024-06-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      } as any,
    })
    searchParamsMap.set('assignmentId', 'asgn-1')
    mockFetchAssignments([viewed])

    render(
      <StudentAssignmentsTab
        classroom={classroom}
        selectedAssignmentId={searchParamsMap.get('assignmentId') ?? null}
      />
    )

    // Wait for the Instructions button to appear
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Instructions' })).toBeInTheDocument()
    })

    // Click the Instructions button
    fireEvent.click(screen.getByRole('button', { name: 'Instructions' }))

    // Modal should now be visible
    expect(screen.getByRole('dialog', { name: 'Instructions' })).toBeInTheDocument()
    expect(screen.getByText('Write an essay')).toBeInTheDocument()
  })

  it('closing modal dismisses it', async () => {
    const unviewed = makeAssignment({ doc: null })
    searchParamsMap.set('assignmentId', 'asgn-1')
    mockFetchAssignments([unviewed])

    render(
      <StudentAssignmentsTab
        classroom={classroom}
        selectedAssignmentId={searchParamsMap.get('assignmentId') ?? null}
      />
    )

    // Wait for modal
    await waitFor(() => {
      expect(screen.getByText('Write an essay')).toBeInTheDocument()
    })

    // Close via the dialog header button
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    // Modal should be gone
    await waitFor(() => {
      expect(screen.queryByText('Write an essay')).not.toBeInTheDocument()
    })
  })

  it('shows Repo action when editing an assignment', async () => {
    const viewed = makeAssignment({
      doc: {
        id: 'doc-1',
        assignment_id: 'asgn-1',
        student_id: 'stu-1',
        content: { type: 'doc', content: [] },
        is_submitted: false,
        submitted_at: null,
        viewed_at: '2024-06-01T00:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      } as any,
    })
    searchParamsMap.set('assignmentId', 'asgn-1')
    mockFetchAssignments([viewed])

    render(
      <StudentAssignmentsTab
        classroom={classroom}
        selectedAssignmentId={searchParamsMap.get('assignmentId') ?? null}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Repo' })).toBeInTheDocument()
    })
  })

  it('renders materials and assignments in shared classwork order', async () => {
    const mixedClassroom = { ...classroom, id: 'cls-mixed' }
    mockFetchClasswork(
      [makeAssignment({ id: 'asgn-1', classroom_id: mixedClassroom.id, title: 'Essay Assignment', position: 2 })],
      [makeMaterial({ id: 'mat-1', classroom_id: mixedClassroom.id, title: 'Opening Reading', position: 1 })],
    )

    render(<StudentAssignmentsTab classroom={mixedClassroom} />)

    await waitFor(() => {
      expect(screen.getByText('Opening Reading')).toBeInTheDocument()
    })

    const cards = [
      ...screen.getAllByTestId('material-card'),
      ...screen.getAllByTestId('assignment-card'),
    ].sort((left, right) => {
      const position = left.compareDocumentPosition(right)
      return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    })

    expect(cards[0]).toHaveTextContent('Opening Reading')
    expect(cards[1]).toHaveTextContent('Essay Assignment')
    expect(cards[0]).toHaveClass('border-border')
    expect(cards[0]).not.toHaveClass('border-primary/40')
    expect(cards[0].querySelector('.border-l-2')).not.toBeInTheDocument()
  })
})
