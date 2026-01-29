import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StudentAssignmentsTab } from '@/app/classrooms/[classroomId]/StudentAssignmentsTab'
import type { Classroom, AssignmentWithStatus } from '@/types'

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
  StudentAssignmentEditor: () => <div data-testid="student-editor">Editor</div>,
}))

vi.mock('@/components/editor', () => ({
  RichTextViewer: ({ content }: any) => <div data-testid="rich-text-viewer">{JSON.stringify(content)}</div>,
}))

// --- Helpers ---

const classroom: Classroom = {
  id: 'cls-1',
  name: 'Test Class',
  teacher_id: 'teacher-1',
  school_id: null,
  grade_level: null,
  subject: null,
  period: null,
  invite_code: 'ABC',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

function makeAssignment(overrides: Partial<AssignmentWithStatus> = {}): AssignmentWithStatus {
  return {
    id: 'asgn-1',
    classroom_id: 'cls-1',
    title: 'Essay Assignment',
    description: 'Write an essay',
    rich_instructions: null,
    due_at: '2025-06-01T00:00:00Z',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    status: 'not_started',
    doc: null,
    ...overrides,
  } as AssignmentWithStatus
}

function mockFetchAssignments(assignments: AssignmentWithStatus[]) {
  ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ assignments }),
  })
}

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

    render(<StudentAssignmentsTab classroom={classroom} />)

    // Modal should auto-appear for first-time view with assignment description
    await waitFor(() => {
      expect(screen.getByText('Write an essay')).toBeInTheDocument()
    })
    // Modal heading "Instructions" + action bar button "Instructions" = 2 matches
    expect(screen.getAllByText('Instructions').length).toBeGreaterThanOrEqual(1)
  })

  it('clicking Instructions button opens modal for viewed assignment', async () => {
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

    render(<StudentAssignmentsTab classroom={classroom} />)

    // Wait for the Instructions button to appear
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Instructions' })).toBeInTheDocument()
    })

    // Modal should not be visible yet
    expect(screen.queryByText('Write an essay')).not.toBeInTheDocument()

    // Click the Instructions button
    fireEvent.click(screen.getByRole('button', { name: 'Instructions' }))

    // Modal should now be visible
    expect(screen.getByText('Write an essay')).toBeInTheDocument()
  })

  it('closing modal dismisses it', async () => {
    const unviewed = makeAssignment({ doc: null })
    searchParamsMap.set('assignmentId', 'asgn-1')
    mockFetchAssignments([unviewed])

    render(<StudentAssignmentsTab classroom={classroom} />)

    // Wait for modal
    await waitFor(() => {
      expect(screen.getByText('Write an essay')).toBeInTheDocument()
    })

    // Click the Close button
    const closeButtons = screen.getAllByRole('button', { name: 'Close' })
    const modalCloseButton = closeButtons.find((btn) => btn.textContent === 'Close')!
    fireEvent.click(modalCloseButton)

    // Modal should be gone
    await waitFor(() => {
      expect(screen.queryByText('Write an essay')).not.toBeInTheDocument()
    })
  })
})
