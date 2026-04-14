import { forwardRef } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeacherClassroomView } from '@/app/classrooms/[classroomId]/TeacherClassroomView'
import { TEACHER_ASSIGNMENTS_SELECTION_EVENT } from '@/lib/events'
import type { Classroom } from '@/types'

const mockFetchJSONWithCache = vi.fn()
const mockToggleSelect = vi.fn()
const mockToggleSelectAll = vi.fn()
const mockClearSelection = vi.fn()

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
    selectedIds: new Set<string>(),
    toggleSelect: mockToggleSelect,
    toggleSelectAll: mockToggleSelectAll,
    allSelected: false,
    clearSelection: mockClearSelection,
    selectedCount: 0,
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
  TeacherStudentWorkPanel: ({ assignmentId, studentId, mode }: any) => (
    <div data-testid="teacher-work-panel">{`${mode}:${assignmentId}:${studentId}`}</div>
  ),
}))

vi.mock('@/components/PageLayout', () => ({
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

function makeAssignmentDetails(assignmentId: string, title: string, studentId: string) {
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
})
