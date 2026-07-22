import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { forwardRef, useEffect, useImperativeHandle } from 'react'
import { StudentAssignmentsTab } from '@/app/classrooms/[classroomId]/StudentAssignmentsTab'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'
import type { Classroom, AssignmentWithStatus, ClassworkMaterial, StudentSurveyView } from '@/types'

// --- Mocks ---

const mockPush = vi.fn()
let searchParamsMap = new Map<string, string>()
let mockEditorState = {
  isSubmitted: false,
  canSubmit: false,
  canUnsubmit: false,
  submitting: false,
}

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
      ...mockEditorState,
    }))
    useEffect(() => {
      props.onStateChange?.(mockEditorState)
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
  theme_color: 'blue',
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

function makeSurvey(overrides: Partial<StudentSurveyView> = {}): StudentSurveyView {
  return {
    id: 'survey-1',
    classroom_id: classroom.id,
    title: 'Class survey',
    status: 'active',
    opens_at: null,
    show_results: true,
    dynamic_responses: false,
    position: 0,
    created_by: 'teacher-1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    student_status: 'not_started',
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
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ surveys: [] }),
    })
}

const mockFetchAssignments = mockFetchClasswork

function mockJSONResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  }
}

describe('StudentAssignmentsTab', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    searchParamsMap = new Map()
    mockEditorState = {
      isSubmitted: false,
      canSubmit: false,
      canUnsubmit: false,
      submitting: false,
    }
    mockPush.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows a classwork error and restores the list after retry', async () => {
    const retryClassroom = { ...classroom, id: 'cls-classwork-retry' }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let assignmentsShouldFail = true

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/student/assignments')) {
          if (assignmentsShouldFail) {
            return {
              ok: false,
              json: async () => ({ error: 'Assignments unavailable' }),
            }
          }
          return mockJSONResponse({
            assignments: [
              makeAssignment({
                classroom_id: retryClassroom.id,
                title: 'Restored assignment',
              }),
            ],
          })
        }
        if (url.includes('/materials')) {
          return mockJSONResponse({ materials: [] })
        }
        if (url.includes('/api/student/surveys')) {
          return mockJSONResponse({ surveys: [] })
        }
        throw new Error(`Unexpected request: ${url}`)
      }),
    )

    render(<StudentAssignmentsTab classroom={retryClassroom} />)

    expect(await screen.findByRole('alert')).toHaveTextContent("Classwork couldn't load")
    expect(screen.queryByText('No classwork yet')).not.toBeInTheDocument()

    assignmentsShouldFail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Restored assignment')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(consoleError).toHaveBeenCalledWith('Error loading assignments:', expect.any(Error))
  })

  it('treats a survey list failure as a retryable classwork failure', async () => {
    const retryClassroom = { ...classroom, id: 'cls-survey-retry' }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let surveysShouldFail = true

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/student/assignments')) return mockJSONResponse({ assignments: [] })
        if (url.includes('/materials')) return mockJSONResponse({ materials: [] })
        if (url.includes('/api/student/surveys')) {
          if (surveysShouldFail) {
            return {
              ok: false,
              json: async () => ({ error: 'Surveys unavailable' }),
            }
          }
          return mockJSONResponse({
            surveys: [makeSurvey({ classroom_id: retryClassroom.id, title: 'Recovered survey' })],
          })
        }
        throw new Error(`Unexpected request: ${url}`)
      }),
    )

    render(<StudentAssignmentsTab classroom={retryClassroom} />)

    expect(await screen.findByRole('alert')).toHaveTextContent("Classwork couldn't load")
    expect(screen.queryByText('No classwork yet')).not.toBeInTheDocument()

    surveysShouldFail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Recovered survey')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps failed classwork in a blocking state while reactivating the tab', async () => {
    const retryClassroom = { ...classroom, id: 'cls-classwork-reactivation' }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let assignmentAttempts = 0
    let resolveReactivation: ((response: ReturnType<typeof mockJSONResponse>) => void) | null = null

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/student/assignments')) {
          assignmentAttempts += 1
          if (assignmentAttempts === 1) {
            return {
              ok: false,
              json: async () => ({ error: 'Assignments unavailable' }),
            }
          }
          if (assignmentAttempts === 2) {
            return await new Promise<ReturnType<typeof mockJSONResponse>>((resolve) => {
              resolveReactivation = resolve
            })
          }
          return mockJSONResponse({
            assignments: [
              makeAssignment({
                classroom_id: retryClassroom.id,
                title: 'Recovered after reactivation',
              }),
            ],
          })
        }
        if (url.includes('/materials')) return mockJSONResponse({ materials: [] })
        if (url.includes('/api/student/surveys')) return mockJSONResponse({ surveys: [] })
        throw new Error(`Unexpected request: ${url}`)
      }),
    )

    const view = render(<StudentAssignmentsTab classroom={retryClassroom} isActive />)
    expect(await screen.findByRole('alert')).toHaveTextContent("Classwork couldn't load")

    view.rerender(<StudentAssignmentsTab classroom={retryClassroom} isActive={false} />)
    view.rerender(<StudentAssignmentsTab classroom={retryClassroom} isActive />)

    expect(await screen.findByRole('heading', { name: 'Loading classwork' })).toBeInTheDocument()
    expect(screen.queryByText('No classwork yet')).not.toBeInTheDocument()
    await waitFor(() => expect(resolveReactivation).toEqual(expect.any(Function)))

    await act(async () => {
      resolveReactivation?.({
        ok: false,
        json: async () => ({ error: 'Assignments still unavailable' }),
      })
    })
    expect(await screen.findByRole('alert')).toHaveTextContent("Classwork couldn't load")

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Recovered after reactivation')).toBeInTheDocument()
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
      expect(screen.getByRole('button', { name: 'Instructions', hidden: true })).toBeInTheDocument()
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

  it('does not show a separate Repo action when editing an assignment', async () => {
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
      expect(screen.getByRole('button', { name: 'Instructions' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Repo' })).not.toBeInTheDocument()
  })

  it('hides Unsubmit after submitted work has been returned', async () => {
    mockEditorState = {
      isSubmitted: true,
      canSubmit: false,
      canUnsubmit: false,
      submitting: false,
    }
    const viewed = makeAssignment({
      doc: {
        id: 'doc-1',
        assignment_id: 'asgn-1',
        student_id: 'stu-1',
        content: { type: 'doc', content: [] },
        is_submitted: true,
        submitted_at: '2024-10-23T12:00:00Z',
        returned_at: '2024-10-22T12:00:00Z',
        teacher_cleared_at: '2024-10-22T12:00:00Z',
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
      expect(screen.getByRole('button', { name: 'Instructions' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Unsubmit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()
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

  it('reloads active classwork on classroom change without showing stale classwork', async () => {
    invalidateCachedJSONMatching('student-assignments:')
    invalidateCachedJSONMatching('student-materials:')
    invalidateCachedJSONMatching('student-surveys:')
    const firstClassroom = { ...classroom, id: 'cls-first-classwork' }
    const secondClassroom = { ...classroom, id: 'cls-second-classwork' }
    let resolveSecondAssignments: (() => void) | null = null

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/student/assignments') && url.includes(firstClassroom.id)) {
          return mockJSONResponse({
            assignments: [
              makeAssignment({
                id: 'asgn-first',
                classroom_id: firstClassroom.id,
                title: 'First classroom assignment',
              }),
            ],
          })
        }
        if (url.includes('/api/student/assignments') && url.includes(secondClassroom.id)) {
          return new Promise((resolve) => {
            resolveSecondAssignments = () => resolve(mockJSONResponse({
              assignments: [
                makeAssignment({
                  id: 'asgn-second',
                  classroom_id: secondClassroom.id,
                  title: 'Second classroom assignment',
                }),
              ],
            }))
          })
        }
        if (url.includes('/materials')) {
          return mockJSONResponse({ materials: [] })
        }
        if (url.includes('/api/student/surveys')) {
          return mockJSONResponse({ surveys: [] })
        }
        throw new Error(`Unexpected request: ${url}`)
      }),
    )

    const view = render(<StudentAssignmentsTab classroom={firstClassroom} />)

    await screen.findByText('First classroom assignment')

    view.rerender(<StudentAssignmentsTab classroom={secondClassroom} />)

    expect(screen.queryByText('First classroom assignment')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(resolveSecondAssignments).toEqual(expect.any(Function))
    })
    await act(async () => {
      resolveSecondAssignments?.()
    })

    expect(await screen.findByText('Second classroom assignment')).toBeInTheDocument()
    expect(screen.queryByText('First classroom assignment')).not.toBeInTheDocument()
  })

  it('freezes assignment card timing once work is submitted', async () => {
    const submittedClassroom = { ...classroom, id: 'cls-submitted' }
    mockFetchAssignments([
      makeAssignment({
        classroom_id: submittedClassroom.id,
        due_at: '2024-10-20T12:00:00Z',
        status: 'submitted_late',
        doc: {
          id: 'doc-1',
          assignment_id: 'asgn-1',
          student_id: 'stu-1',
          content: { type: 'doc', content: [] },
          is_submitted: true,
          submitted_at: '2024-10-21T12:00:00Z',
          viewed_at: '2024-06-01T00:00:00Z',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        } as any,
      }),
    ])

    render(<StudentAssignmentsTab classroom={submittedClassroom} />)

    await waitFor(() => {
      expect(screen.getByText('Submitted 1 day late')).toBeInTheDocument()
    })
    expect(screen.queryByText(/days overdue/i)).not.toBeInTheDocument()
  })

  it('freezes returned late assignment card timing at the original submission timestamp', async () => {
    const returnedClassroom = { ...classroom, id: 'cls-returned' }
    mockFetchAssignments([
      makeAssignment({
        classroom_id: returnedClassroom.id,
        due_at: '2024-10-20T12:00:00Z',
        status: 'returned',
        doc: {
          id: 'doc-1',
          assignment_id: 'asgn-1',
          student_id: 'stu-1',
          content: { type: 'doc', content: [] },
          is_submitted: false,
          submitted_at: '2024-10-21T12:00:00Z',
          returned_at: '2024-10-22T12:00:00Z',
          viewed_at: '2024-06-01T00:00:00Z',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        } as any,
      }),
    ])

    render(<StudentAssignmentsTab classroom={returnedClassroom} />)

    await waitFor(() => {
      expect(screen.getByText('Submitted 1 day late')).toBeInTheDocument()
    })
    expect(screen.getByText('Returned')).toBeInTheDocument()
    expect(screen.queryByText(/days overdue/i)).not.toBeInTheDocument()
  })
})
