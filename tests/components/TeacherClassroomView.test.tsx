import { forwardRef, useEffect } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeacherClassroomView } from '@/app/classrooms/[classroomId]/TeacherClassroomView'
import { TEACHER_ASSIGNMENTS_SELECTION_EVENT } from '@/lib/events'
import type { Classroom } from '@/types'

const mockFetchJSONWithCache = vi.fn()
const mockToggleSelect = vi.fn()
const mockToggleSelectAll = vi.fn()
const mockClearSelection = vi.fn()
const mockStudentSelectionState = {
  selectedIds: new Set<string>(),
  allSelected: false,
  selectedCount: 0,
}

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: any) => <div>{children}</div>,
  closestCenter: vi.fn(),
  KeyboardSensor: class {},
  PointerSensor: class {},
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}))

vi.mock('@dnd-kit/sortable', () => ({
  arrayMove: vi.fn((items) => items),
  SortableContext: ({ children }: any) => <div>{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: vi.fn(),
}))

vi.mock('@/ui', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  ConfirmDialog: () => null,
  SplitButton: ({ label, onPrimaryClick, disabled, primaryButtonProps }: any) => (
    <button
      type="button"
      onClick={onPrimaryClick}
      disabled={disabled}
      {...primaryButtonProps}
    >
      {label}
    </button>
  ),
  Tooltip: ({ children }: any) => <>{children}</>,
}))

vi.mock('@/hooks/useDelayedBusy', () => ({
  useDelayedBusy: (value: boolean) => value,
}))

vi.mock('@/hooks/useStudentSelection', () => ({
  useStudentSelection: () => ({
    selectedIds: mockStudentSelectionState.selectedIds,
    toggleSelect: mockToggleSelect,
    toggleSelectAll: mockToggleSelectAll,
    allSelected: mockStudentSelectionState.allSelected,
    clearSelection: mockClearSelection,
    selectedCount: mockStudentSelectionState.selectedCount,
  }),
}))

vi.mock('@/components/Spinner', () => ({
  Spinner: () => <div data-testid="spinner" />,
}))

vi.mock('@/components/AssignmentModal', () => ({
  AssignmentModal: () => null,
}))

vi.mock('@/components/SortableAssignmentCard', () => ({
  SortableAssignmentCard: ({ assignment, onSelect }: any) => (
    <button type="button" onClick={onSelect}>
      {assignment.title}
    </button>
  ),
}))

vi.mock('@/components/AssignmentArtifactsCell', () => ({
  AssignmentArtifactsCell: () => <div>Artifacts</div>,
}))

vi.mock('@/components/TeacherStudentWorkPanel', () => ({
  TeacherStudentWorkPanel: ({ assignmentId, studentId, mode, onDetailsMetaChange }: any) => {
    useEffect(() => {
      onDetailsMetaChange?.(
        mode === 'details'
          ? { studentName: `${studentId} Student`, characterCount: 17 }
          : null,
      )
    }, [mode, onDetailsMetaChange, studentId])

    return <div data-testid="teacher-work-panel">{`${mode}:${assignmentId}:${studentId}`}</div>
  },
}))

vi.mock('@/components/PageLayout', () => ({
  ACTIONBAR_ICON_BUTTON_CLASSNAME: 'icon-button',
  ACTIONBAR_BUTTON_PRIMARY_CLASSNAME: 'primary-button',
  ACTIONBAR_ICON_BUTTON_WIDE_CLASSNAME: 'wide-button',
  PageLayout: ({ children }: any) => <div>{children}</div>,
  PageActionBar: ({ primary, trailing }: any) => (
    <div>
      {primary}
      {trailing}
    </div>
  ),
  PageContent: ({ children }: any) => <div>{children}</div>,
  PageStack: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('@/components/layout', () => ({
  RightSidebarToggle: () => null,
}))

vi.mock('@/lib/assignments', () => ({
  calculateAssignmentStatus: vi.fn(() => 'submitted_on_time'),
  getAssignmentStatusIconClass: vi.fn(() => ''),
  getAssignmentStatusLabel: vi.fn(() => 'Submitted'),
  hasDraftSavedGrade: vi.fn(() => false),
}))

vi.mock('@/hooks/use-assignment-grading-layout', () => ({
  useAssignmentGradingLayout: () => ({
    layout: {
      overview: { inspectorCollapsed: false, inspectorWidth: 50 },
      details: { inspectorCollapsed: false, inspectorWidth: 50 },
    },
    updateModeLayout: vi.fn(),
  }),
}))

vi.mock('@/lib/scheduling', () => ({
  isVisibleAtNow: () => true,
}))

vi.mock('@/components/DataTable', () => ({
  DataTable: ({ children }: any) => <table><tbody>{children}</tbody></table>,
  DataTableBody: ({ children }: any) => <>{children}</>,
  DataTableCell: ({ children }: any) => <td>{children}</td>,
  DataTableHead: ({ children }: any) => <>{children}</>,
  DataTableHeaderCell: ({ children }: any) => <th>{children}</th>,
  DataTableRow: ({ children, ...props }: any) => <tr {...props}>{children}</tr>,
  EmptyStateRow: ({ message }: any) => <tr><td>{message}</td></tr>,
  KeyboardNavigableTable: forwardRef<HTMLDivElement, any>(function KeyboardNavigableTableMock(
    { children },
    ref,
  ) {
    return <div ref={ref}>{children}</div>
  }),
  SortableHeaderCell: ({ label, onClick }: any) => <button type="button" onClick={onClick}>{label}</button>,
  TableCard: ({ children }: any) => <div>{children}</div>,
}))

vi.mock('@/lib/request-cache', () => ({
  fetchJSONWithCache: (...args: any[]) => mockFetchJSONWithCache(...args),
  invalidateCachedJSON: vi.fn(),
}))

vi.mock('@/hooks/use-window-size', () => ({
  useWindowSize: () => ({ width: 1440, height: 900 }),
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const classroom: Classroom = {
  id: 'classroom-1',
  teacher_id: 'teacher-1',
  title: 'Physics',
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

function makeAssignmentSummary(id: string, title: string) {
  return {
    id,
    classroom_id: classroom.id,
    title,
    description: `${title} description`,
    instructions_markdown: `${title} instructions`,
    rich_instructions: null,
    due_at: '2026-04-20T12:00:00Z',
    position: 0,
    is_draft: false,
    released_at: '2026-04-10T12:00:00Z',
    created_by: 'teacher-1',
    created_at: '2026-04-01T12:00:00Z',
    updated_at: '2026-04-01T12:00:00Z',
    stats: { total_students: 1, submitted: 1, late: 0 },
  }
}

function makeAssignmentDetails(
  assignmentId: string,
  title: string,
  studentId: string,
  activeAiGradingRun: any = null,
) {
  return {
    assignment: {
      id: assignmentId,
      classroom_id: classroom.id,
      title,
      description: `${title} description`,
      instructions_markdown: `${title} instructions`,
      rich_instructions: null,
      due_at: '2026-04-20T12:00:00Z',
      position: 0,
      is_draft: false,
      released_at: '2026-04-10T12:00:00Z',
      created_by: 'teacher-1',
      created_at: '2026-04-01T12:00:00Z',
      updated_at: '2026-04-01T12:00:00Z',
    },
    students: [
      {
        student_id: studentId,
        student_email: `${studentId}@example.com`,
        student_first_name: studentId,
        student_last_name: 'Student',
        status: 'submitted_on_time',
        student_updated_at: '2026-04-10T12:00:00Z',
        artifacts: [],
        doc: {
          submitted_at: '2026-04-10T12:00:00Z',
          updated_at: '2026-04-10T12:00:00Z',
          score_completion: null,
          score_thinking: null,
          score_workflow: null,
          graded_at: null,
          returned_at: null,
          feedback_returned_at: null,
        },
      },
    ],
    active_ai_grading_run: activeAiGradingRun,
  }
}

function clearSelectionCookie() {
  document.cookie = `${encodeURIComponent(`teacherAssignmentsSelection:${classroom.id}`)}=; Path=/; Max-Age=0; SameSite=Lax`
}

describe('TeacherClassroomView', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    mockToggleSelect.mockReset()
    mockToggleSelectAll.mockReset()
    mockClearSelection.mockReset()
    mockStudentSelectionState.selectedIds = new Set<string>()
    mockStudentSelectionState.allSelected = false
    mockStudentSelectionState.selectedCount = 0
    clearSelectionCookie()
    mockFetchJSONWithCache.mockResolvedValue({
      assignments: [
        makeAssignmentSummary('assignment-1', 'Assignment One'),
        makeAssignmentSummary('assignment-2', 'Assignment Two'),
      ],
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    clearSelectionCookie()
  })

  it('clears the old split pane while the next assignment roster is still loading', async () => {
    const assignmentTwoDeferred = createDeferred<any>()

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url === `/api/classrooms/${classroom.id}/class-days`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ class_days: [] }),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1') {
        return Promise.resolve({
          ok: true,
          json: async () => makeAssignmentDetails('assignment-1', 'Assignment One', 'student-1'),
        })
      }

      if (url === '/api/teacher/assignments/assignment-2') {
        return assignmentTwoDeferred.promise
      }

      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch: ${url}` }),
      })
    })

    document.cookie = `${encodeURIComponent(`teacherAssignmentsSelection:${classroom.id}`)}=${encodeURIComponent('assignment-1')}; Path=/; SameSite=Lax`

    render(<TeacherClassroomView classroom={classroom} />)

    await waitFor(() => {
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('overview:assignment-1:student-1')
    })

    act(() => {
      window.dispatchEvent(
        new CustomEvent(TEACHER_ASSIGNMENTS_SELECTION_EVENT, {
          detail: { classroomId: classroom.id, value: 'assignment-2' },
        }),
      )
    })

    await waitFor(() => {
      expect(screen.queryByTestId('teacher-work-panel')).not.toBeInTheDocument()
    })

    await act(async () => {
      assignmentTwoDeferred.resolve({
        ok: true,
        json: async () => makeAssignmentDetails('assignment-2', 'Assignment Two', 'student-2'),
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('overview:assignment-2:student-2')
    })
  })

  it('renders class-mode actions in the selected-assignment action bar without duplicating them in the table', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url === `/api/classrooms/${classroom.id}/class-days`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ class_days: [] }),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1') {
        return Promise.resolve({
          ok: true,
          json: async () => makeAssignmentDetails('assignment-1', 'Assignment One', 'student-1'),
        })
      }

      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch: ${url}` }),
      })
    })

    document.cookie = `${encodeURIComponent(`teacherAssignmentsSelection:${classroom.id}`)}=${encodeURIComponent('assignment-1')}; Path=/; SameSite=Lax`

    render(<TeacherClassroomView classroom={classroom} />)

    await waitFor(() => {
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('overview:assignment-1:student-1')
    })

    expect(screen.getByRole('button', { name: 'Class' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Individual' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByRole('button', { name: /AI Grade/i })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Return/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit assignment' })).toBeInTheDocument()
  })

  it('switches to individual mode with student controls in the action bar', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url === `/api/classrooms/${classroom.id}/class-days`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ class_days: [] }),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1') {
        return Promise.resolve({
          ok: true,
          json: async () => makeAssignmentDetails('assignment-1', 'Assignment One', 'student-1'),
        })
      }

      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch: ${url}` }),
      })
    })

    document.cookie = `${encodeURIComponent(`teacherAssignmentsSelection:${classroom.id}`)}=${encodeURIComponent('assignment-1')}; Path=/; SameSite=Lax`

    render(<TeacherClassroomView classroom={classroom} />)

    await waitFor(() => {
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('overview:assignment-1:student-1')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Individual' }))

    await waitFor(() => {
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('details:assignment-1:student-1')
    })

    expect(screen.getByRole('button', { name: 'Individual' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /AI Grade/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Send/i })).not.toBeInTheDocument()
    expect(screen.getByText('student-1 Student')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('17 chars')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Previous student' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next student' })).toBeInTheDocument()
  })

  it('keeps class mode active when clicking a student row', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url === `/api/classrooms/${classroom.id}/class-days`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ class_days: [] }),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            assignment: makeAssignmentDetails('assignment-1', 'Assignment One', 'student-1').assignment,
            students: [
              ...makeAssignmentDetails('assignment-1', 'Assignment One', 'student-1').students,
              {
                student_id: 'student-2',
                student_email: 'student-2@example.com',
                student_first_name: 'student-2',
                student_last_name: 'Student',
                status: 'submitted_on_time',
                student_updated_at: '2026-04-10T12:00:00Z',
                artifacts: [],
                doc: {
                  submitted_at: '2026-04-10T12:00:00Z',
                  updated_at: '2026-04-10T12:00:00Z',
                  score_completion: null,
                  score_thinking: null,
                  score_workflow: null,
                  graded_at: null,
                  returned_at: null,
                  feedback_returned_at: null,
                },
              },
            ],
          }),
        })
      }

      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch: ${url}` }),
      })
    })

    document.cookie = `${encodeURIComponent(`teacherAssignmentsSelection:${classroom.id}`)}=${encodeURIComponent('assignment-1')}; Path=/; SameSite=Lax`

    render(<TeacherClassroomView classroom={classroom} />)

    await waitFor(() => {
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('overview:assignment-1:student-1')
    })

    fireEvent.click(screen.getAllByText('student-2')[0])

    await waitFor(() => {
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('overview:assignment-1:student-2')
    })

    expect(screen.getByRole('button', { name: 'Class' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Individual' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('resumes an active assignment AI grading run and reports the final counts', async () => {
    const initialRun = {
      id: 'run-1',
      assignment_id: 'assignment-1',
      status: 'running',
      model: 'gpt-5-nano',
      requested_count: 2,
      gradable_count: 1,
      processed_count: 0,
      completed_count: 0,
      skipped_missing_count: 1,
      skipped_empty_count: 0,
      failed_count: 0,
      pending_count: 2,
      next_retry_at: null,
      error_samples: [],
      started_at: '2026-04-20T12:00:00Z',
      completed_at: null,
      created_at: '2026-04-20T12:00:00Z',
    }

    let assignmentFetchCount = 0

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url === `/api/classrooms/${classroom.id}/class-days`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ class_days: [] }),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1') {
        assignmentFetchCount += 1
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeAssignmentDetails(
              'assignment-1',
              'Assignment One',
              'student-1',
              assignmentFetchCount === 1 ? initialRun : null,
            ),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1/auto-grade-runs/run-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            run: {
              ...initialRun,
              processed_count: 1,
              pending_count: 1,
              next_retry_at: null,
            },
          }),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1/auto-grade-runs/run-1/tick') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            claimed: true,
            run: {
              ...initialRun,
              status: 'completed',
              processed_count: 2,
              completed_count: 1,
              pending_count: 0,
              next_retry_at: null,
              completed_at: '2026-04-20T12:02:00Z',
            },
          }),
        })
      }

      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch: ${url}` }),
      })
    })

    document.cookie = `${encodeURIComponent(`teacherAssignmentsSelection:${classroom.id}`)}=${encodeURIComponent('assignment-1')}; Path=/; SameSite=Lax`

    render(<TeacherClassroomView classroom={classroom} />)

    await waitFor(() => {
      expect(screen.getByText('Graded 1 • 1 missing')).toBeInTheDocument()
    })
    expect(mockClearSelection).toHaveBeenCalled()
  })

  it('shows only unique true errors in the completion message and treats empty work as missing', async () => {
    const initialRun = {
      id: 'run-1',
      assignment_id: 'assignment-1',
      status: 'running',
      model: 'gpt-5-nano',
      requested_count: 3,
      gradable_count: 2,
      processed_count: 0,
      completed_count: 0,
      skipped_missing_count: 0,
      skipped_empty_count: 1,
      failed_count: 0,
      pending_count: 3,
      next_retry_at: null,
      error_samples: [],
      started_at: '2026-04-20T12:00:00Z',
      completed_at: null,
      created_at: '2026-04-20T12:00:00Z',
    }

    let assignmentFetchCount = 0

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url === `/api/classrooms/${classroom.id}/class-days`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ class_days: [] }),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1') {
        assignmentFetchCount += 1
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeAssignmentDetails(
              'assignment-1',
              'Assignment One',
              'student-1',
              assignmentFetchCount === 1 ? initialRun : null,
            ),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1/auto-grade-runs/run-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            run: {
              ...initialRun,
              processed_count: 1,
              pending_count: 2,
              next_retry_at: null,
            },
          }),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1/auto-grade-runs/run-1/tick') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            claimed: true,
            run: {
              ...initialRun,
              status: 'completed_with_errors',
              processed_count: 3,
              completed_count: 0,
              failed_count: 2,
              pending_count: 0,
              next_retry_at: null,
              error_samples: [
                {
                  student_id: 'student-1',
                  code: 'server',
                  message: 'AI grading service failed for this submission. Try again.',
                },
                {
                  student_id: 'student-2',
                  code: 'server',
                  message: 'AI grading service failed for this submission. Try again.',
                },
              ],
              completed_at: '2026-04-20T12:02:00Z',
            },
          }),
        })
      }

      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch: ${url}` }),
      })
    })

    document.cookie = `${encodeURIComponent(`teacherAssignmentsSelection:${classroom.id}`)}=${encodeURIComponent('assignment-1')}; Path=/; SameSite=Lax`

    render(<TeacherClassroomView classroom={classroom} />)

    await waitFor(() => {
      expect(screen.getByText(/1 missing • 2 failed/)).toBeInTheDocument()
    })
    expect(screen.getByText(/AI grading service failed for this submission\. Try again\./)).toBeInTheDocument()
    expect(screen.queryByText(/2 students:/)).not.toBeInTheDocument()
  })

  it('waits for the next retry window before polling tick again', async () => {
    const nextRetryAt = new Date(Date.now() + 60_000).toISOString()
    let statusFetchCount = 0
    let tickFetchCount = 0

    const initialRun = {
      id: 'run-1',
      assignment_id: 'assignment-1',
      status: 'running',
      model: 'gpt-5-nano',
      requested_count: 2,
      gradable_count: 2,
      processed_count: 1,
      completed_count: 1,
      skipped_missing_count: 0,
      skipped_empty_count: 0,
      failed_count: 0,
      pending_count: 1,
      next_retry_at: nextRetryAt,
      error_samples: [],
      started_at: '2026-04-20T12:00:00Z',
      completed_at: null,
      created_at: '2026-04-20T12:00:00Z',
    }

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url === `/api/classrooms/${classroom.id}/class-days`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ class_days: [] }),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1') {
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeAssignmentDetails(
              'assignment-1',
              'Assignment One',
              'student-1',
              initialRun,
            ),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1/auto-grade-runs/run-1') {
        statusFetchCount += 1
        return Promise.resolve({
          ok: true,
          json: async () => ({
            run: initialRun,
          }),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1/auto-grade-runs/run-1/tick') {
        tickFetchCount += 1
        return Promise.resolve({
          ok: true,
          json: async () => ({
            claimed: true,
            run: initialRun,
          }),
        })
      }

      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch: ${url}` }),
      })
    })

    document.cookie = `${encodeURIComponent(`teacherAssignmentsSelection:${classroom.id}`)}=${encodeURIComponent('assignment-1')}; Path=/; SameSite=Lax`

    render(<TeacherClassroomView classroom={classroom} />)

    await waitFor(() => {
      expect(statusFetchCount).toBeGreaterThan(0)
    })
    expect(
      screen.getByText('Keep this assignment open while grading runs. Reopening it resumes the current progress.'),
    ).toBeInTheDocument()
    expect(tickFetchCount).toBe(0)
  })

  it('retries after a transient tick failure while the assignment stays open', async () => {
    vi.useFakeTimers()

    const initialRun = {
      id: 'run-1',
      assignment_id: 'assignment-1',
      status: 'running',
      model: 'gpt-5-nano',
      requested_count: 2,
      gradable_count: 2,
      processed_count: 0,
      completed_count: 0,
      skipped_missing_count: 0,
      skipped_empty_count: 0,
      failed_count: 0,
      pending_count: 2,
      next_retry_at: null,
      error_samples: [],
      started_at: '2026-04-20T12:00:00Z',
      completed_at: null,
      created_at: '2026-04-20T12:00:00Z',
    }

    let assignmentFetchCount = 0
    let tickFetchCount = 0

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url === `/api/classrooms/${classroom.id}/class-days`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ class_days: [] }),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1') {
        assignmentFetchCount += 1
        return Promise.resolve({
          ok: true,
          json: async () =>
            makeAssignmentDetails(
              'assignment-1',
              'Assignment One',
              'student-1',
              assignmentFetchCount === 1 ? initialRun : null,
            ),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1/auto-grade-runs/run-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            run: initialRun,
          }),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1/auto-grade-runs/run-1/tick') {
        tickFetchCount += 1
        if (tickFetchCount === 1) {
          return Promise.reject(new Error('temporary network issue'))
        }

        return Promise.resolve({
          ok: true,
          json: async () => ({
            claimed: true,
            run: {
              ...initialRun,
              status: 'completed',
              processed_count: 2,
              completed_count: 2,
              pending_count: 0,
              completed_at: '2026-04-20T12:03:00Z',
            },
          }),
        })
      }

      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch: ${url}` }),
      })
    })

    document.cookie = `${encodeURIComponent(`teacherAssignmentsSelection:${classroom.id}`)}=${encodeURIComponent('assignment-1')}; Path=/; SameSite=Lax`

    try {
      render(<TeacherClassroomView classroom={classroom} />)

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(tickFetchCount).toBe(1)

      await act(async () => {
        vi.advanceTimersByTime(2_100)
        await Promise.resolve()
        await Promise.resolve()
      })

      await act(async () => {
        await Promise.resolve()
      })

      expect(screen.getByText('Graded 2')).toBeInTheDocument()
      expect(tickFetchCount).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
