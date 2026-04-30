import { forwardRef, useEffect } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeacherClassroomView } from '@/app/classrooms/[classroomId]/TeacherClassroomView'
import { TEACHER_ASSIGNMENTS_SELECTION_EVENT } from '@/lib/events'
import type { Classroom } from '@/types'

const mockFetchJSONWithCache = vi.fn()
const mockToggleSelect = vi.fn()
const mockToggleSelectAll = vi.fn()
const mockClearSelection = vi.fn()
const mockSetSelection = vi.fn()
const mockShowMessage = vi.fn()
const mockUseOverlayMessage = vi.fn()
const mockIsVisibleAtNow = vi.fn(() => true)
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
  ConfirmDialog: ({ isOpen, title, description, confirmLabel, cancelLabel, onConfirm, onCancel, isConfirmDisabled, isCancelDisabled }: any) => (
    isOpen ? (
      <div>
        <div>{title}</div>
        {description ? <div>{description}</div> : null}
        <button type="button" onClick={onCancel} disabled={isCancelDisabled}>{cancelLabel}</button>
        <button type="button" onClick={onConfirm} disabled={isConfirmDisabled}>{confirmLabel}</button>
      </div>
    ) : null
  ),
  SplitButton: ({ label, onPrimaryClick, disabled, primaryButtonProps, options = [] }: any) => (
    <div>
      <button
        type="button"
        onClick={onPrimaryClick}
        disabled={disabled}
        {...primaryButtonProps}
      >
        {label}
      </button>
      {options.map((option: any) => (
        <button
          key={option.id}
          type="button"
          onClick={option.onSelect}
          disabled={option.disabled}
          onMouseEnter={() => option.onHoverChange?.(true)}
          onMouseLeave={() => option.onHoverChange?.(false)}
          onFocus={() => option.onHoverChange?.(true)}
          onBlur={() => option.onHoverChange?.(false)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
  SegmentedControl: ({ ariaLabel, value, options, onChange }: any) => (
    <div role="group" aria-label={ariaLabel}>
      {options.map((option: any) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          disabled={option.disabled}
          aria-pressed={option.value === value}
          aria-label={option.label}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  ),
  Tooltip: ({ children, content }: any) => (
    <span data-tooltip={typeof content === 'string' ? content : undefined}>{children}</span>
  ),
  useAppMessage: () => ({ showMessage: mockShowMessage, clearMessage: vi.fn() }),
  useOverlayMessage: (...args: any[]) => mockUseOverlayMessage(...args),
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
    setSelection: mockSetSelection,
    selectedCount: mockStudentSelectionState.selectedCount,
  }),
}))

vi.mock('@/components/Spinner', () => ({
  Spinner: () => <div data-testid="spinner" />,
}))

vi.mock('@/components/AssignmentModal', () => ({
  AssignmentModal: ({ isOpen, assignment }: any) => (
    isOpen ? (
      <div role="dialog">
        {assignment ? `Editing ${assignment.title}` : 'New Assignment'}
      </div>
    ) : null
  ),
}))

vi.mock('@/components/SortableAssignmentCard', () => ({
  SortableAssignmentCard: ({ assignment, editMode, onOpen, onEdit, onDelete }: any) => (
    <div>
      <button type="button" onClick={editMode ? onEdit : onOpen}>
        {assignment.title}
      </button>
      {editMode ? (
        <button type="button" onClick={onDelete} aria-label={`Delete ${assignment.title}`}>
          Delete
        </button>
      ) : null}
    </div>
  ),
}))

vi.mock('@/components/AssignmentArtifactsCell', () => ({
  AssignmentArtifactsCell: () => <div>Artifacts</div>,
}))

vi.mock('@/components/TeacherStudentWorkPanel', () => ({
  TeacherStudentWorkPanel: ({
    assignmentId,
    studentId,
    mode,
    classPane,
    leftPaneView = 'class',
    leftHeader,
    onDetailsMetaChange,
    onGradeTemplateChange,
    highlightedInspectorSections = [],
  }: any) => {
    useEffect(() => {
      onDetailsMetaChange?.(
        mode === 'details' || mode === 'workspace'
          ? { studentName: `${studentId} Student`, characterCount: 17 }
          : null,
      )
    }, [leftPaneView, mode, onDetailsMetaChange, studentId])

    useEffect(() => {
      onGradeTemplateChange?.(
        mode === 'overview' || mode === 'workspace'
          ? {
              studentId,
              scoreCompletion: '7',
              scoreThinking: '8',
              scoreWorkflow: '9',
              feedbackDraft: 'Use this feedback for the selected students.',
              gradeMode: 'graded',
            }
          : null,
      )
    }, [mode, onGradeTemplateChange, studentId])

    if (mode === 'workspace') {
      return (
        <div
          data-testid="teacher-work-panel"
          data-highlighted-sections={highlightedInspectorSections.join(',')}
        >
          <div>{`overview:${assignmentId}:${studentId}`}</div>
          <div data-testid="assignment-left-pane">
            {leftHeader}
            {leftPaneView === 'class' ? classPane : <div>{`work:${assignmentId}:${studentId}`}</div>}
          </div>
          <div data-testid="assignment-right-pane">
            <div>{`grading:${assignmentId}:${studentId}`}</div>
          </div>
        </div>
      )
    }

    return (
      <div
        data-testid="teacher-work-panel"
        data-highlighted-sections={highlightedInspectorSections.join(',')}
      >
        {`${mode}:${assignmentId}:${studentId}`}
      </div>
    )
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
  getAssignmentRubricState: vi.fn((doc: any) => {
    if (!doc) return null
    const filledCount = [doc.score_completion, doc.score_thinking, doc.score_workflow]
      .filter((value) => value !== null && value !== undefined).length
    if (filledCount === 0) return 'blank'
    if (filledCount === 3) return 'complete'
    return 'partial'
  }),
  isAssignmentAlreadyReturnedWithoutResubmission: vi.fn((doc: any) => {
    if (!doc?.returned_at && !doc?.teacher_cleared_at) return false
    const returnedAt = new Date(doc.teacher_cleared_at || doc.returned_at).getTime()
    if (!doc.is_submitted || !doc.submitted_at) return true
    return new Date(doc.submitted_at).getTime() <= returnedAt
  }),
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
  isVisibleAtNow: (...args: any[]) => mockIsVisibleAtNow(...args),
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

function makeAssignmentSummary(id: string, title: string, overrides: Record<string, unknown> = {}) {
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
    ...overrides,
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

function applySearchParamsUpdate(
  call: [(params: URLSearchParams) => void, { replace?: boolean } | undefined],
  initial = 'tab=assignments',
) {
  const [updater, options] = call
  const params = new URLSearchParams(initial)
  updater(params)
  return { params, options }
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
    mockSetSelection.mockReset()
    mockShowMessage.mockReset()
    mockUseOverlayMessage.mockReset()
    mockIsVisibleAtNow.mockReset()
    mockIsVisibleAtNow.mockReturnValue(true)
    mockStudentSelectionState.selectedIds = new Set<string>()
    mockStudentSelectionState.allSelected = false
    mockStudentSelectionState.selectedCount = 0
    clearSelectionCookie()
    mockFetchJSONWithCache.mockImplementation((key: string, fetcher: () => Promise<unknown>) => {
      if (key === `teacher-assignments:${classroom.id}`) {
        return Promise.resolve({
          assignments: [
            makeAssignmentSummary('assignment-1', 'Assignment One'),
            makeAssignmentSummary('assignment-2', 'Assignment Two'),
          ],
        })
      }
      if (key === `class-days:${classroom.id}`) {
        return Promise.resolve({ class_days: [] })
      }
      return fetcher()
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    clearSelectionCookie()
  })

  it('does not reopen a stale assignment cookie when URL selection is on summary', async () => {
    document.cookie = `${encodeURIComponent(`teacherAssignmentsSelection:${classroom.id}`)}=${encodeURIComponent('assignment-1')}; Path=/; SameSite=Lax`

    render(<TeacherClassroomView classroom={classroom} selectedAssignmentId={null} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Assignment One' })).toBeInTheDocument()
    })

    expect(screen.queryByTestId('teacher-work-panel')).not.toBeInTheDocument()
  })

  it('keeps New visible without a Code action while edit mode is active', async () => {
    const onEditModeChange = vi.fn()

    render(
      <TeacherClassroomView
        classroom={classroom}
        selectedAssignmentId={null}
        onEditModeChange={onEditModeChange}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Assignment One' })).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'New assignment' })).toBeInTheDocument()
    expect(screen.getByTestId('assignment-summary-actionbar-center')).toHaveClass('grid')
    expect(screen.getByText('Assignments')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open assignment code editor' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'Open assignment code editor' })).not.toBeInTheDocument()
    expect(onEditModeChange).toHaveBeenLastCalledWith(true)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onEditModeChange).toHaveBeenLastCalledWith(false)
    expect(screen.queryByRole('button', { name: 'Open assignment code editor' })).not.toBeInTheDocument()
  })

  it('exits assignment edit mode on Escape', async () => {
    render(
      <TeacherClassroomView
        classroom={classroom}
        selectedAssignmentId={null}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Assignment One' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'Open assignment code editor' })).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-pressed', 'false')
    })
  })

  it('opens the assignment editor from summary cards while edit mode is active', async () => {
    const updateSearchParams = vi.fn()

    render(
      <TeacherClassroomView
        classroom={classroom}
        selectedAssignmentId={null}
        updateSearchParams={updateSearchParams}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Assignment One' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Assignment One' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('Editing Assignment One')
    expect(updateSearchParams).not.toHaveBeenCalled()
    expect(screen.queryByTestId('teacher-work-panel')).not.toBeInTheDocument()
  })

  it('resets edit mode when the selected assignment workspace changes', async () => {
    const onEditModeChange = vi.fn()

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

    const { rerender } = render(
      <TeacherClassroomView
        classroom={classroom}
        selectedAssignmentId={null}
        onEditModeChange={onEditModeChange}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Assignment One' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-pressed', 'true')

    rerender(
      <TeacherClassroomView
        classroom={classroom}
        selectedAssignmentId="assignment-1"
        onEditModeChange={onEditModeChange}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-pressed', 'false')
    })
    expect(onEditModeChange).toHaveBeenLastCalledWith(false)
  })

  it('keeps draft and scheduled assignments opening the editor in normal mode', async () => {
    mockIsVisibleAtNow.mockReturnValue(false)
    mockFetchJSONWithCache.mockImplementation((key: string, fetcher: () => Promise<unknown>) => {
      if (key === `teacher-assignments:${classroom.id}`) {
        return Promise.resolve({
          assignments: [
            makeAssignmentSummary('draft-assignment', 'Draft Assignment', { is_draft: true }),
            makeAssignmentSummary('scheduled-assignment', 'Scheduled Assignment', {
              released_at: '2026-05-10T12:00:00Z',
            }),
          ],
        })
      }
      if (key === `class-days:${classroom.id}`) {
        return Promise.resolve({ class_days: [] })
      }
      return fetcher()
    })
    const updateSearchParams = vi.fn()

    render(
      <TeacherClassroomView
        classroom={classroom}
        selectedAssignmentId={null}
        updateSearchParams={updateSearchParams}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Draft Assignment' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Editing Draft Assignment')
    expect(updateSearchParams).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Scheduled Assignment' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Editing Scheduled Assignment')
    expect(updateSearchParams).not.toHaveBeenCalled()
  })

  it('pushes assignment selection into classroom history', async () => {
    const updateSearchParams = vi.fn()

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

    render(
      <TeacherClassroomView
        classroom={classroom}
        selectedAssignmentId={null}
        updateSearchParams={updateSearchParams}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Assignment One' }))

    expect(updateSearchParams).toHaveBeenCalled()
    const { params, options } = applySearchParamsUpdate(
      updateSearchParams.mock.calls[0],
      'tab=assignments&assignmentStudentId=student-2',
    )
    expect(options?.replace).not.toBe(true)
    expect(params.get('tab')).toBe('assignments')
    expect(params.get('assignmentId')).toBe('assignment-1')
    expect(params.get('assignmentStudentId')).toBeNull()
  })

  it('replaces the assignment history entry with the default selected student', async () => {
    const updateSearchParams = vi.fn()

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

    render(
      <TeacherClassroomView
        classroom={classroom}
        selectedAssignmentId="assignment-1"
        selectedAssignmentStudentId={null}
        updateSearchParams={updateSearchParams}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-1:student-1')
    })

    const replaceCall = updateSearchParams.mock.calls.find((call) => call[1]?.replace === true)
    expect(replaceCall).toBeTruthy()
    const { params } = applySearchParamsUpdate(replaceCall!, 'tab=assignments&assignmentId=assignment-1')
    expect(params.get('assignmentStudentId')).toBe('student-1')
  })

  it('pushes selected student changes into classroom history', async () => {
    const updateSearchParams = vi.fn()

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url === `/api/classrooms/${classroom.id}/class-days`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ class_days: [] }),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1') {
        const details = makeAssignmentDetails('assignment-1', 'Assignment One', 'student-1')
        return Promise.resolve({
          ok: true,
          json: async () => ({
            assignment: details.assignment,
            students: [
              ...details.students,
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

    render(
      <TeacherClassroomView
        classroom={classroom}
        selectedAssignmentId="assignment-1"
        selectedAssignmentStudentId="student-1"
        updateSearchParams={updateSearchParams}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-1:student-1')
    })

    updateSearchParams.mockClear()
    fireEvent.click(screen.getAllByText('student-2')[0])

    await waitFor(() => {
      expect(updateSearchParams).toHaveBeenCalled()
    })
    const { params, options } = applySearchParamsUpdate(
      updateSearchParams.mock.calls[0],
      'tab=assignments&assignmentId=assignment-1&assignmentStudentId=student-1',
    )
    expect(options?.replace).not.toBe(true)
    expect(params.get('assignmentId')).toBe('assignment-1')
    expect(params.get('assignmentStudentId')).toBe('student-2')
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
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-1:student-1')
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
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-2:student-2')
    })
  })

  it('renders the class-individual switch and grading split button in the selected-assignment action bar', async () => {
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
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-1:student-1')
    })

    const workspaceControls = within(screen.getByRole('group', { name: 'Assignment workspace view' }))
    expect(workspaceControls.getByRole('button', { name: 'Class' })).toHaveAttribute('aria-pressed', 'true')
    expect(workspaceControls.getByRole('button', { name: 'Individual' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('group', { name: 'Left pane view' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Right pane view' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /AI Grade/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /Return/i })).toHaveLength(1)
    expect(screen.getByText('Assignment One')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit assignment' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByRole('button', { name: 'Edit assignment' })).toBeInTheDocument()
  })

  it('copies the active inspector grade to checked students after confirmation', async () => {
    mockStudentSelectionState.selectedIds = new Set(['student-1', 'student-2'])
    mockStudentSelectionState.selectedCount = 2

    const gradeSelectedBodies: Array<Record<string, unknown>> = []
    const details = makeAssignmentDetails('assignment-1', 'Assignment One', 'student-1')
    details.students.push({
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
    })

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url === '/api/teacher/assignments/assignment-1') {
        return Promise.resolve({
          ok: true,
          json: async () => details,
        })
      }

      if (url === '/api/teacher/assignments/assignment-1/grade-selected') {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        gradeSelectedBodies.push(body)
        const studentIds = body.student_ids as string[]
        return Promise.resolve({
          ok: true,
          json: async () => ({
            updated_count: studentIds.length,
            updated_student_ids: studentIds,
            docs: studentIds.map((studentId) => ({
              student_id: studentId,
              score_completion: 7,
              score_thinking: 8,
              score_workflow: 9,
              graded_at: '2026-04-12T12:00:00Z',
              graded_by: 'teacher',
              updated_at: '2026-04-12T12:00:00Z',
            })),
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

    const gradeSelectedOption = screen.getByRole('button', { name: 'Apply Grade to Selected Students' })
    await waitFor(() => {
      expect(gradeSelectedOption).not.toBeDisabled()
    })

    fireEvent.click(gradeSelectedOption)
    expect(screen.getByText('Apply grade to 2 selected student(s)?')).toBeInTheDocument()
    expect(screen.getByText("The current student's grading will be applied to the selected students.")).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      expect(gradeSelectedBodies).toHaveLength(1)
    })

    expect(gradeSelectedBodies[0]).toEqual({
      student_ids: ['student-1', 'student-2'],
      apply_target: 'grade',
      score_completion: '7',
      score_thinking: '8',
      score_workflow: '9',
      save_mode: 'graded',
    })
    expect(mockClearSelection).toHaveBeenCalled()
    await waitFor(() => {
      expect(mockShowMessage).toHaveBeenCalledWith({
        text: 'Applied grade to 2 selected students',
        tone: 'info',
      })
    })
  })

  it('copies the active inspector comments to checked students after confirmation', async () => {
    mockStudentSelectionState.selectedIds = new Set(['student-1', 'student-2'])
    mockStudentSelectionState.selectedCount = 2

    const gradeSelectedBodies: Array<Record<string, unknown>> = []
    const details = makeAssignmentDetails('assignment-1', 'Assignment One', 'student-1')
    details.students.push({
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
    })

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url === '/api/teacher/assignments/assignment-1') {
        return Promise.resolve({
          ok: true,
          json: async () => details,
        })
      }

      if (url === '/api/teacher/assignments/assignment-1/grade-selected') {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        gradeSelectedBodies.push(body)
        const studentIds = body.student_ids as string[]
        return Promise.resolve({
          ok: true,
          json: async () => ({
            updated_count: studentIds.length,
            updated_student_ids: studentIds,
            docs: studentIds.map((studentId) => ({
              student_id: studentId,
              teacher_feedback_draft: 'Use this feedback for the selected students.',
              teacher_feedback_draft_updated_at: '2026-04-12T12:00:00Z',
              updated_at: '2026-04-12T12:00:00Z',
            })),
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

    const commentsSelectedOption = screen.getByRole('button', { name: 'Apply Comments to Selected Students' })
    await waitFor(() => {
      expect(commentsSelectedOption).not.toBeDisabled()
    })

    fireEvent.click(commentsSelectedOption)
    expect(screen.getByText('Apply comments to 2 selected student(s)?')).toBeInTheDocument()
    expect(screen.getByText("The current student's comments will be applied to the selected students.")).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      expect(gradeSelectedBodies).toHaveLength(1)
    })

    expect(gradeSelectedBodies[0]).toEqual({
      student_ids: ['student-1', 'student-2'],
      apply_target: 'comments',
      feedback: 'Use this feedback for the selected students.',
    })
    expect(mockClearSelection).toHaveBeenCalled()
    await waitFor(() => {
      expect(mockShowMessage).toHaveBeenCalledWith({
        text: 'Applied comments to 2 selected students',
        tone: 'info',
      })
    })
  })

  it('highlights the matching inspector card while hovering apply menu actions', async () => {
    mockStudentSelectionState.selectedIds = new Set(['student-1', 'student-2'])
    mockStudentSelectionState.selectedCount = 2

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url === '/api/teacher/assignments/assignment-1') {
        const details = makeAssignmentDetails('assignment-1', 'Assignment One', 'student-1')
        details.students.push({
          student_id: 'student-2',
          student_email: 'student-2@example.com',
          student_first_name: 'student-2',
          student_last_name: 'Student',
          status: 'submitted_on_time',
          student_updated_at: '2026-04-10T12:00:00Z',
          artifacts: [],
          doc: null,
        })
        return Promise.resolve({
          ok: true,
          json: async () => details,
        })
      }

      return Promise.resolve({
        ok: false,
        json: async () => ({ error: `Unhandled fetch: ${url}` }),
      })
    })

    document.cookie = `${encodeURIComponent(`teacherAssignmentsSelection:${classroom.id}`)}=${encodeURIComponent('assignment-1')}; Path=/; SameSite=Lax`

    render(<TeacherClassroomView classroom={classroom} />)

    const workPanel = await screen.findByTestId('teacher-work-panel')
    const applyGradeOption = screen.getByRole('button', { name: 'Apply Grade to Selected Students' })
    const applyCommentsOption = screen.getByRole('button', { name: 'Apply Comments to Selected Students' })
    await waitFor(() => {
      expect(applyGradeOption).not.toBeDisabled()
      expect(applyCommentsOption).not.toBeDisabled()
    })

    fireEvent.mouseEnter(applyGradeOption)
    expect(workPanel).toHaveAttribute('data-highlighted-sections', 'grades')

    fireEvent.mouseLeave(applyGradeOption)
    expect(workPanel).toHaveAttribute('data-highlighted-sections', '')

    fireEvent.mouseEnter(applyCommentsOption)
    expect(workPanel).toHaveAttribute('data-highlighted-sections', 'comments')

    fireEvent.mouseLeave(applyCommentsOption)
    expect(workPanel).toHaveAttribute('data-highlighted-sections', '')
  })

  it('keeps checked students selected when Apply Grade to Selected Students fails', async () => {
    mockStudentSelectionState.selectedIds = new Set(['student-1'])
    mockStudentSelectionState.selectedCount = 1

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)

      if (url === '/api/teacher/assignments/assignment-1') {
        return Promise.resolve({
          ok: true,
          json: async () => makeAssignmentDetails('assignment-1', 'Assignment One', 'student-1'),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1/grade-selected') {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Batch save failed' }),
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

    mockClearSelection.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Apply Grade to Selected Students' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(await screen.findByText('Batch save failed')).toBeInTheDocument()
    expect(mockClearSelection).not.toHaveBeenCalled()
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
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-1:student-1')
    })

    fireEvent.click(within(screen.getByRole('group', { name: 'Assignment workspace view' })).getByRole('button', { name: 'Individual' }))

    await waitFor(() => {
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('work:assignment-1:student-1')
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-1:student-1')
    })

    expect(within(screen.getByRole('group', { name: 'Assignment workspace view' })).getByRole('button', { name: 'Individual' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('button', { name: /AI Grade/i })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Send/i })).not.toBeInTheDocument()
    expect(screen.getByText('student-1 Student')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('17 chars')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Previous student' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next student' })).toBeInTheDocument()
  })

  it('keeps the right pane on grading when switching the action bar view control', async () => {
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
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-1:student-1')
    })

    fireEvent.click(within(screen.getByRole('group', { name: 'Assignment workspace view' })).getByRole('button', { name: 'Individual' }))

    await waitFor(() => {
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('work:assignment-1:student-1')
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-1:student-1')
    })

    expect(within(screen.getByRole('group', { name: 'Assignment workspace view' })).getByRole('button', { name: 'Individual' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('student-1 Student')).toBeInTheDocument()
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
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-1:student-1')
    })

    fireEvent.click(screen.getAllByText('student-2')[0])

    await waitFor(() => {
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-1:student-2')
    })

    const leftPaneControls = within(screen.getByRole('group', { name: 'Assignment workspace view' }))
    expect(leftPaneControls.getByRole('button', { name: 'Class' })).toHaveAttribute('aria-pressed', 'true')
    expect(leftPaneControls.getByRole('button', { name: 'Individual' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps the active student selected when Escape is pressed in class mode', async () => {
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
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-1:student-1')
    })

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-1:student-1')
    })
    expect(screen.getByText('student-1')).toBeInTheDocument()
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
      expect(mockShowMessage).toHaveBeenCalledWith({ text: 'Graded 1 • 1 missing', tone: 'info' })
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
    expect(mockUseOverlayMessage).toHaveBeenCalledWith(
      true,
      expect.stringMatching(/Grading \d+ of 2 students/),
      { tone: 'loading' },
    )
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

      expect(mockShowMessage).toHaveBeenCalledWith({ text: 'Graded 2', tone: 'info' })
      expect(tickFetchCount).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('disables batch return when selected students have nothing returnable', async () => {
    mockStudentSelectionState.selectedIds = new Set(['student-1', 'student-2'])
    mockStudentSelectionState.selectedCount = 2

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
              {
                student_id: 'student-1',
                student_email: 'student-1@example.com',
                student_first_name: 'student-1',
                student_last_name: 'Student',
                status: 'submitted_on_time',
                student_updated_at: '2026-04-10T12:00:00Z',
                artifacts: [],
                doc: {
                  is_submitted: false,
                  submitted_at: '2026-04-09T12:00:00Z',
                  updated_at: '2026-04-09T12:00:00Z',
                  score_completion: 7,
                  score_thinking: 7,
                  score_workflow: 7,
                  graded_at: '2026-04-09T13:00:00Z',
                  returned_at: '2026-04-09T14:00:00Z',
                  teacher_cleared_at: '2026-04-09T14:00:00Z',
                  feedback_returned_at: '2026-04-09T14:00:00Z',
                },
              },
              {
                student_id: 'student-2',
                student_email: 'student-2@example.com',
                student_first_name: 'student-2',
                student_last_name: 'Student',
                status: 'submitted_on_time',
                student_updated_at: '2026-04-10T12:00:00Z',
                artifacts: [],
                doc: {
                  is_submitted: false,
                  submitted_at: null,
                  updated_at: '2026-04-10T12:00:00Z',
                  score_completion: 8,
                  score_thinking: null,
                  score_workflow: 9,
                  graded_at: null,
                  returned_at: null,
                  teacher_cleared_at: null,
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
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-1:student-1')
    })

    const returnButton = screen.getByRole('button', { name: /Return/i })
    expect(returnButton).toBeDisabled()

    fireEvent.click(returnButton)
    expect(screen.queryByText(/Return work to 2 selected student/)).not.toBeInTheDocument()
  })

  it('keeps blocked students selected and clears returned, created, and already-returned students after a mixed batch return', async () => {
    mockStudentSelectionState.selectedIds = new Set(['student-1', 'student-2', 'student-3', 'student-4'])
    mockStudentSelectionState.selectedCount = 4

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
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
              {
                student_id: 'student-1',
                student_email: 'student-1@example.com',
                student_first_name: 'student-1',
                student_last_name: 'Student',
                status: 'submitted_on_time',
                student_updated_at: '2026-04-10T12:00:00Z',
                artifacts: [],
                doc: {
                  submitted_at: '2026-04-10T12:00:00Z',
                  updated_at: '2026-04-10T12:00:00Z',
                  score_completion: 8,
                  score_thinking: 7,
                  score_workflow: 9,
                  graded_at: '2026-04-10T13:00:00Z',
                  returned_at: null,
                  feedback_returned_at: null,
                },
              },
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
                  score_completion: 8,
                  score_thinking: null,
                  score_workflow: 9,
                  graded_at: null,
                  returned_at: null,
                  feedback_returned_at: null,
                },
              },
              {
                student_id: 'student-3',
                student_email: 'student-3@example.com',
                student_first_name: 'student-3',
                student_last_name: 'Student',
                status: 'not_started',
                student_updated_at: null,
                artifacts: [],
                doc: null,
              },
              {
                student_id: 'student-4',
                student_email: 'student-4@example.com',
                student_first_name: 'student-4',
                student_last_name: 'Student',
                status: 'returned',
                student_updated_at: '2026-04-09T12:00:00Z',
                artifacts: [],
                doc: {
                  is_submitted: false,
                  submitted_at: '2026-04-09T12:00:00Z',
                  updated_at: '2026-04-09T12:00:00Z',
                  score_completion: 7,
                  score_thinking: 7,
                  score_workflow: 7,
                  graded_at: '2026-04-09T13:00:00Z',
                  returned_at: '2026-04-09T14:00:00Z',
                  teacher_cleared_at: '2026-04-09T14:00:00Z',
                  feedback_returned_at: '2026-04-09T14:00:00Z',
                },
              },
            ],
          }),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1/return') {
        expect(init?.method).toBe('POST')
        return Promise.resolve({
          ok: true,
          json: async () => ({
            returned_count: 2,
            cleared_count: 2,
            created_count: 1,
            returned_student_ids: ['student-1', 'student-3'],
            blocked_count: 1,
            blocked_student_ids: ['student-2'],
            already_returned_count: 1,
            already_returned_student_ids: ['student-4'],
            missing_count: 0,
            missing_student_ids: [],
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
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-1:student-1')
    })

    fireEvent.click(screen.getByRole('button', { name: /Return/i }))

    expect(
      screen.getByText(/partial rubric drafts and must be completed or cleared before return/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/create returned 0\/0\/0 documents/i)).toBeInTheDocument()
    expect(screen.getByText(/already returned and will be skipped/i)).toBeInTheDocument()

    const confirmReturnButton = screen.getAllByRole('button', { name: 'Return' }).at(-1)
    expect(confirmReturnButton).toBeDefined()
    fireEvent.click(confirmReturnButton!)

    await waitFor(() => {
      expect(mockShowMessage).toHaveBeenCalledWith({
        text: 'Returned 1 • Created 1 zero-grade return • Skipped 1 already returned • Blocked 1 partial-rubric draft',
        tone: 'info',
      })
    })
    expect(mockSetSelection).toHaveBeenCalledWith(['student-2'])
  })
})
