import { forwardRef, useEffect } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeacherClassroomView } from '@/app/classrooms/[classroomId]/TeacherClassroomView'
import { TEACHER_ASSIGNMENTS_SELECTION_EVENT } from '@/lib/events'
import type { Classroom, ClassworkMaterial, SurveyWithStats } from '@/types'

const mockFetchJSONWithCache = vi.fn()
const mockInvalidateCachedJSON = vi.fn()
const mockToggleSelect = vi.fn()
const mockToggleSelectAll = vi.fn()
const mockClearSelection = vi.fn()
const mockSetSelection = vi.fn()
const mockShowMessage = vi.fn()
const mockUseOverlayMessage = vi.fn()
const mockIsVisibleAtNow = vi.fn(() => true)
const mockUpdateModeLayout = vi.fn()
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
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  })),
  verticalListSortingStrategy: vi.fn(),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: vi.fn(() => undefined),
    },
  },
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
  ContentDialog: ({ isOpen, title, subtitle, children }: any) => (
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <div>{title}</div>
        {subtitle ? <div>{subtitle}</div> : null}
        {children}
      </div>
    ) : null
  ),
  DialogPanel: ({ isOpen, children }: any) => (
    isOpen ? (
      <div role="dialog">
        {children}
      </div>
    ) : null
  ),
  FormField: ({ label, children }: any) => (
    <label>
      <span>{label}</span>
      {children}
    </label>
  ),
  Input: (props: any) => <input {...props} />,
  Select: ({ options = [], ...props }: any) => (
    <select {...props}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
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
  AssignmentModal: ({ isOpen, assignment, onClose }: any) => (
    isOpen ? (
      <div role="dialog">
        {assignment ? `Editing ${assignment.title}` : 'New Assignment'}
        <button type="button" onClick={onClose}>
          Close assignment modal
        </button>
      </div>
    ) : null
  ),
}))

vi.mock('@/components/SortableAssignmentCard', () => ({
  SortableAssignmentCard: ({ assignment, editMode, onOpen, onEdit, onDelete }: any) => (
    <div>
      <button type="button" onClick={editMode ? onEdit : onOpen} aria-label={assignment.title}>
        {assignment.title}
      </button>
      <span data-testid={`assignment-count-${assignment.id}`}>
        {assignment.stats.submitted}/{assignment.stats.total_students}
      </span>
      {editMode ? (
        <button type="button" onClick={onDelete} aria-label={`Delete ${assignment.title}`}>
          Delete
        </button>
      ) : null}
    </div>
  ),
}))

vi.mock('@/components/surveys/TeacherSurveyWorkspace', () => ({
  TeacherSurveyWorkspace: ({ surveyId, initialEditMode, autoEditTitle, onBack }: any) => (
    <div data-testid="mock-survey-workspace">
      Survey workspace {surveyId}
      {initialEditMode ? ` mode ${initialEditMode}` : ''}
      {autoEditTitle ? ' auto title' : ''}
      <button type="button" onClick={onBack}>
        Close survey workspace
      </button>
    </div>
  ),
}))

vi.mock('@/components/surveys/TeacherSurveyResultsPane', () => ({
  TeacherSurveyResultsPane: ({ survey }: any) => (
    <div data-testid="mock-survey-results-pane">
      Survey results {survey.id}
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
    splitPaneView = 'students-grading',
    studentHeader,
    inspectorWidth,
    onLayoutChange,
    onDetailsMetaChange,
    onGradeTemplateChange,
    highlightedInspectorSections = [],
  }: any) => {
    useEffect(() => {
      onDetailsMetaChange?.(
        mode === 'details' || (mode === 'workspace' && splitPaneView !== 'students-grading')
          ? { studentName: `${studentId} Student`, characterCount: 17 }
          : null,
      )
    }, [mode, onDetailsMetaChange, splitPaneView, studentId])

    useEffect(() => {
      onGradeTemplateChange?.(
        mode === 'overview' || (mode === 'workspace' && splitPaneView !== 'students-content')
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
    }, [mode, onGradeTemplateChange, splitPaneView, studentId])

    if (mode === 'workspace') {
      return (
        <div
          data-testid="teacher-work-panel"
          data-highlighted-sections={highlightedInspectorSections.join(',')}
        >
          <div data-testid="assignment-split-pane-view">{splitPaneView}</div>
          <div data-testid="assignment-workspace-inspector-width">{inspectorWidth}</div>
          <button
            type="button"
            onClick={() => onLayoutChange?.({ inspectorCollapsed: false, inspectorWidth: 61 })}
          >
            Mock resize split
          </button>
          <div>{`overview:${assignmentId}:${studentId}`}</div>
          <div key={studentId} data-testid="assignment-left-pane">
            {splitPaneView === 'content-grading' ? (
              <>
                {studentHeader}
                <div>{`work:${assignmentId}:${studentId}`}</div>
              </>
            ) : (
              classPane
            )}
          </div>
          <div data-testid="assignment-right-pane">
            {splitPaneView === 'students-content' ? (
              <>
                {studentHeader}
                <div>{`work:${assignmentId}:${studentId}`}</div>
              </>
            ) : (
              <div>{`grading:${assignmentId}:${studentId}`}</div>
            )}
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
  isAssignmentScheduledForFuture: vi.fn((assignment: any) => (
    !assignment.is_draft &&
    !!assignment.released_at &&
    !mockIsVisibleAtNow(assignment.released_at)
  )),
  getAssignmentStatusIconClass: vi.fn(() => ''),
  getAssignmentStatusLabel: vi.fn(() => 'Submitted'),
  hasDraftSavedGrade: vi.fn(() => false),
}))

vi.mock('@/hooks/use-assignment-grading-layout', () => ({
  useAssignmentGradingLayout: () => ({
    layout: {
      overview: { inspectorCollapsed: false, inspectorWidth: 50 },
      details: { inspectorCollapsed: false, inspectorWidth: 64 },
    },
    updateModeLayout: mockUpdateModeLayout,
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
  invalidateCachedJSON: (...args: any[]) => mockInvalidateCachedJSON(...args),
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

function makeMaterialSummary(id: string, title: string, overrides: Partial<ClassworkMaterial> = {}): ClassworkMaterial {
  return {
    id,
    classroom_id: classroom.id,
    title,
    content: { type: 'doc', content: [] },
    is_draft: false,
    released_at: '2026-04-10T12:00:00Z',
    position: 0,
    created_by: 'teacher-1',
    created_at: '2026-04-01T12:00:00Z',
    updated_at: '2026-04-01T12:00:00Z',
    ...overrides,
  }
}

function makeSurveySummary(id: string, title: string, overrides: Partial<SurveyWithStats> = {}): SurveyWithStats {
  return {
    id,
    classroom_id: classroom.id,
    title,
    status: 'draft',
    opens_at: null,
    show_results: true,
    dynamic_responses: false,
    position: 0,
    created_by: 'teacher-1',
    created_at: '2026-04-01T12:00:00Z',
    updated_at: '2026-04-01T12:00:00Z',
    stats: { total_students: 2, responded: 0, questions_count: 0 },
    ...overrides,
  }
}

function makeStudentSubmissionRow(studentId: string, overrides: Record<string, unknown> = {}) {
  return {
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
      makeStudentSubmissionRow(studentId),
    ],
    active_ai_grading_run: activeAiGradingRun,
  }
}

function clearSelectionCookie() {
  document.cookie = `${encodeURIComponent(`teacherAssignmentsSelection:${classroom.id}`)}=; Path=/; Max-Age=0; SameSite=Lax`
}

function expectAssignmentSplitPaneIndicator({
  index,
  icon,
  iconClass,
}: {
  index: string
  icon: string
  iconClass: string
}) {
  const indicator = screen.getByTestId('assignment-split-pane-indicator')
  const iconNode = screen.getByTestId('assignment-split-pane-icon')
  const svg = iconNode.querySelector('svg')

  if (!svg) {
    throw new Error('Expected assignment split-pane toggle icon to render an SVG')
  }

  expect(indicator).toHaveAttribute('data-view-index', index)
  expect(indicator).toHaveAttribute('data-view-icon', icon)
  expect(screen.getByTestId('assignment-split-pane-index')).toHaveTextContent(index)
  expect(svg).toHaveClass(iconClass)
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
    mockUpdateModeLayout.mockReset()
    mockIsVisibleAtNow.mockReturnValue(true)
    mockStudentSelectionState.selectedIds = new Set<string>()
    mockStudentSelectionState.allSelected = false
    mockStudentSelectionState.selectedCount = 0
    window.sessionStorage.clear()
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
      if (key === `teacher-materials:${classroom.id}`) {
        return Promise.resolve({ materials: [] })
      }
      return fetcher()
    })
    mockInvalidateCachedJSON.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.sessionStorage.clear()
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
    expect(screen.getByRole('button', { name: 'New assignment' }).closest('.fixed')).toHaveClass('fixed')
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
        updateSearchParams={updateSearchParams}
        selectedSurveyId={null}
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

  it('renders materials and assignments in shared order and gives materials a drag handle in edit mode', async () => {
    mockFetchJSONWithCache.mockImplementation((key: string, fetcher: () => Promise<unknown>) => {
      if (key === `teacher-assignments:${classroom.id}`) {
        return Promise.resolve({
          assignments: [
            makeAssignmentSummary('assignment-1', 'Assignment One', { position: 2 }),
          ],
        })
      }
      if (key === `teacher-materials:${classroom.id}`) {
        return Promise.resolve({
          materials: [
            makeMaterialSummary('material-1', 'Opening Reading', { position: 1 }),
          ],
        })
      }
      if (key === `class-days:${classroom.id}`) {
        return Promise.resolve({ class_days: [] })
      }
      return fetcher()
    })

    render(<TeacherClassroomView classroom={classroom} selectedAssignmentId={null} />)

    const materialButton = await screen.findByRole('button', { name: 'Open Opening Reading' })
    const assignmentButton = screen.getByRole('button', { name: 'Assignment One' })
    expect(
      materialButton.compareDocumentPosition(assignmentButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('button', { name: 'Drag to reorder material' })).toBeInTheDocument()
    expect(materialButton.querySelector('.border-l-2')).not.toBeInTheDocument()
    expect(materialButton.closest('.bg-info-bg')).not.toHaveClass('border-primary/40')
  })

  it('opens a survey card in the selected results pane with action controls', async () => {
    mockFetchJSONWithCache.mockImplementation((key: string, fetcher: () => Promise<unknown>) => {
      if (key === `teacher-assignments:${classroom.id}`) {
        return Promise.resolve({
          assignments: [
            makeAssignmentSummary('assignment-1', 'Assignment One', { position: 1 }),
          ],
        })
      }
      if (key === `teacher-materials:${classroom.id}`) {
        return Promise.resolve({ materials: [] })
      }
      if (key === `teacher-surveys:${classroom.id}`) {
        return Promise.resolve({
          surveys: [
            makeSurveySummary('survey-1', 'Game Jam Links', {
              position: 2,
              status: 'active',
              dynamic_responses: true,
              stats: { total_students: 2, responded: 0, questions_count: 1 },
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
        updateSearchParams={updateSearchParams}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Game Jam Links' }))

    expect(screen.getByTestId('mock-survey-results-pane')).toHaveTextContent('Survey results survey-1')
    expect(screen.getByTestId('survey-workspace-actionbar-center').parentElement).toHaveClass('fixed')
    expect(screen.getByRole('button', { name: 'Edit survey' })).toBeInTheDocument()
    const closePollButton = screen.getByRole('button', { name: 'Close poll' })
    const hideResultsButton = screen.getByRole('button', { name: 'Hide results' })
    expect(closePollButton).toHaveClass('bg-success-bg', 'text-success')
    expect(hideResultsButton).toHaveClass('bg-success-bg', 'text-success')
    expect(screen.queryByRole('button', { name: 'Lock responses' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete survey' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('teacher-work-panel')).not.toBeInTheDocument()

    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        survey: makeSurveySummary('survey-1', 'Game Jam Links', { show_results: false }),
      }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Hide results' }))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/teacher/surveys/survey-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ show_results: false }),
        }),
      )
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Show results' })).toHaveClass('bg-danger-bg', 'text-danger')
    })

    const { params } = applySearchParamsUpdate(updateSearchParams.mock.calls[0])
    expect(params.get('tab')).toBe('assignments')
    expect(params.get('surveyId')).toBe('survey-1')
    expect(params.get('assignmentId')).toBeNull()
  })

  it('opens a routed survey selection in the selected results pane', async () => {
    mockFetchJSONWithCache.mockImplementation((key: string, fetcher: () => Promise<unknown>) => {
      if (key === `teacher-assignments:${classroom.id}`) {
        return Promise.resolve({
          assignments: [
            makeAssignmentSummary('assignment-1', 'Assignment One'),
          ],
        })
      }
      if (key === `teacher-materials:${classroom.id}`) {
        return Promise.resolve({ materials: [] })
      }
      if (key === `teacher-surveys:${classroom.id}`) {
        return Promise.resolve({
          surveys: [
            makeSurveySummary('survey-1', 'Game Jam Links'),
          ],
        })
      }
      if (key === `class-days:${classroom.id}`) {
        return Promise.resolve({ class_days: [] })
      }
      return fetcher()
    })

    render(
      <TeacherClassroomView
        classroom={classroom}
        selectedSurveyId="survey-1"
      />,
    )

    expect(await screen.findByTestId('mock-survey-results-pane')).toHaveTextContent('Survey results survey-1')
    const openPollButton = screen.getByRole('button', { name: 'Open poll' })
    expect(openPollButton).toBeDisabled()
    expect(openPollButton).toHaveClass('bg-danger-bg', 'text-danger')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('teacher-work-panel')).not.toBeInTheDocument()
  })

  it('creates a draft survey directly from the New menu and opens visual editing', async () => {
    mockFetchJSONWithCache.mockImplementation((key: string, fetcher: () => Promise<unknown>) => {
      if (key === `teacher-assignments:${classroom.id}`) {
        return Promise.resolve({
          assignments: [
            makeAssignmentSummary('assignment-1', 'Assignment One'),
          ],
        })
      }
      if (key === `teacher-materials:${classroom.id}`) {
        return Promise.resolve({ materials: [] })
      }
      if (key === `teacher-surveys:${classroom.id}`) {
        return Promise.resolve({ surveys: [] })
      }
      if (key === `class-days:${classroom.id}`) {
        return Promise.resolve({ class_days: [] })
      }
      return fetcher()
    })
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        survey: makeSurveySummary('survey-new', 'Untitled 2026-05-14 10:15:30'),
      }),
    })
    const updateSearchParams = vi.fn()

    render(
      <TeacherClassroomView
        classroom={classroom}
        updateSearchParams={updateSearchParams}
      />,
    )

    await screen.findByRole('button', { name: 'Assignment One' })
    fireEvent.click(screen.getByRole('button', { name: 'Survey' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/teacher/surveys',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ classroom_id: classroom.id }),
        }),
      )
    })
    expect(await screen.findByRole('dialog')).toHaveTextContent('Survey workspace survey-new mode edit auto title')

    const { params } = applySearchParamsUpdate(updateSearchParams.mock.calls[0])
    expect(params.get('surveyId')).toBeNull()
    expect(params.get('assignmentId')).toBeNull()
  })

  it('exits assignment edit mode when the create assignment modal closes', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'New assignment' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('New Assignment')

    fireEvent.click(screen.getByRole('button', { name: 'Close assignment modal' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-pressed', 'false')
    })
    expect(onEditModeChange).toHaveBeenLastCalledWith(false)
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
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
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
      if (key === `teacher-materials:${classroom.id}`) {
        return Promise.resolve({ materials: [] })
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

  it('clears URL selection after opening an unreleased assignment editor from a route selection', async () => {
    mockIsVisibleAtNow.mockReturnValue(false)
    mockFetchJSONWithCache.mockImplementation((key: string, fetcher: () => Promise<unknown>) => {
      if (key === `teacher-assignments:${classroom.id}`) {
        return Promise.resolve({
          assignments: [
            makeAssignmentSummary('scheduled-assignment', 'Scheduled Assignment', {
              released_at: '2026-05-10T12:00:00Z',
            }),
          ],
        })
      }
      if (key === `class-days:${classroom.id}`) {
        return Promise.resolve({ class_days: [] })
      }
      if (key === `teacher-materials:${classroom.id}`) {
        return Promise.resolve({ materials: [] })
      }
      return fetcher()
    })
    const updateSearchParams = vi.fn()

    render(
      <TeacherClassroomView
        classroom={classroom}
        selectedAssignmentId="scheduled-assignment"
        updateSearchParams={updateSearchParams}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveTextContent('Editing Scheduled Assignment')
    })

    expect(updateSearchParams).toHaveBeenCalled()
    const { params, options } = applySearchParamsUpdate(
      updateSearchParams.mock.calls[0],
      'tab=calendar&assignmentId=scheduled-assignment&assignmentStudentId=student-1',
    )
    expect(options?.replace).toBe(true)
    expect(params.get('tab')).toBe('assignments')
    expect(params.get('assignmentId')).toBeNull()
    expect(params.get('assignmentStudentId')).toBeNull()
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

  it('renders the split-pane cycle button and grading split button in the selected-assignment action bar', async () => {
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

    expect(screen.getByRole('button', {
      name: 'Assignment panes: Students + grading. Switch to Content + grading.',
    })).toBeInTheDocument()
    expectAssignmentSplitPaneIndicator({
      index: '1',
      icon: 'grading',
      iconClass: 'lucide-file-check',
    })
    expect(screen.getByTestId('assignment-split-pane-view')).toHaveTextContent('students-grading')
    expect(screen.queryByRole('group', { name: 'Left pane view' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Right pane view' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Assignment workspace view' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /AI Grade/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /Return/i })).toHaveLength(1)
    expect(screen.getByTestId('assignment-workspace-actionbar-center').parentElement).toHaveClass('fixed')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit assignment' })).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Edit Assignment' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Assignment' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Assignment' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('Editing Assignment One')
  })

  it('deletes a selected assignment from the actions dropdown with confirmation', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url === `/api/classrooms/${classroom.id}/class-days`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ class_days: [] }),
        })
      }

      if (url === '/api/teacher/assignments/assignment-1' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
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

    fireEvent.click(screen.getByRole('button', { name: 'Delete Assignment' }))

    expect(await screen.findByText('Delete assignment?')).toBeInTheDocument()
    expect(screen.getByText(/Assignment One/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/teacher/assignments/assignment-1',
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
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
    const gradeSelectedOption = screen.getByRole('button', { name: 'Apply Grade to Selected Students' })
    await waitFor(() => {
      expect(gradeSelectedOption).not.toBeDisabled()
    })

    fireEvent.click(gradeSelectedOption)
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(await screen.findByText('Batch save failed')).toBeInTheDocument()
    expect(mockClearSelection).not.toHaveBeenCalled()
  })

  it('cycles to content and grading with student controls in the content pane', async () => {
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

    fireEvent.click(screen.getByRole('button', {
      name: 'Assignment panes: Students + grading. Switch to Content + grading.',
    }))

    await waitFor(() => {
      expect(screen.getByTestId('assignment-split-pane-view')).toHaveTextContent('content-grading')
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('work:assignment-1:student-1')
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-1:student-1')
    })
    expect(JSON.parse(
      window.sessionStorage.getItem(`pika_assignment_split_pane_view:${classroom.id}:assignment-1`) ?? 'null',
    )).toBe('content-grading')

    expect(screen.getByTestId('assignment-workspace-inspector-width')).toHaveTextContent('64')
    fireEvent.click(screen.getByRole('button', { name: 'Mock resize split' }))

    expect(mockUpdateModeLayout).toHaveBeenCalledWith('details', {
      inspectorCollapsed: false,
      inspectorWidth: 61,
    })
    expect(screen.getByRole('button', {
      name: 'Assignment panes: Content + grading. Switch to Students + content.',
    })).toBeInTheDocument()
    expectAssignmentSplitPaneIndicator({
      index: '2',
      icon: 'content',
      iconClass: 'lucide-file-text',
    })
    expect(screen.getAllByRole('button', { name: /AI Grade/i })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Send/i })).not.toBeInTheDocument()
    expect(screen.getByText('student-1 Student')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('17 chars')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Previous student' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next student' })).toBeInTheDocument()
  })

  it('cycles through all three requested split-pane views', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /Assignment panes:/ }))

    await waitFor(() => {
      expect(screen.getByTestId('assignment-split-pane-view')).toHaveTextContent('content-grading')
      expectAssignmentSplitPaneIndicator({
        index: '2',
        icon: 'content',
        iconClass: 'lucide-file-text',
      })
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('work:assignment-1:student-1')
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-1:student-1')
    })

    fireEvent.click(screen.getByRole('button', { name: /Assignment panes:/ }))

    await waitFor(() => {
      expect(screen.getByTestId('assignment-split-pane-view')).toHaveTextContent('students-content')
      expectAssignmentSplitPaneIndicator({
        index: '3',
        icon: 'students',
        iconClass: 'lucide-table',
      })
      expect(screen.getByTestId('assignment-left-pane')).toHaveTextContent('student-1')
      expect(screen.getByTestId('assignment-right-pane')).toHaveTextContent('work:assignment-1:student-1')
      expect(screen.getByTestId('assignment-right-pane')).not.toHaveTextContent('grading:assignment-1:student-1')
    })

    fireEvent.click(screen.getByRole('button', { name: /Assignment panes:/ }))

    await waitFor(() => {
      expect(screen.getByTestId('assignment-split-pane-view')).toHaveTextContent('students-grading')
      expectAssignmentSplitPaneIndicator({
        index: '1',
        icon: 'grading',
        iconClass: 'lucide-file-check',
      })
      expect(screen.getByTestId('assignment-left-pane')).toHaveTextContent('student-1')
      expect(screen.getByTestId('assignment-right-pane')).toHaveTextContent('grading:assignment-1:student-1')
      expect(screen.getByTestId('assignment-right-pane')).not.toHaveTextContent('work:assignment-1:student-1')
    })
  })

  it('restores the assignment split-pane view from browser session storage', async () => {
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
    window.sessionStorage.setItem(
      `pika_assignment_split_pane_view:${classroom.id}:assignment-1`,
      JSON.stringify('students-content'),
    )

    render(<TeacherClassroomView classroom={classroom} />)

    await waitFor(() => {
      expect(screen.getByTestId('assignment-split-pane-view')).toHaveTextContent('students-content')
      expectAssignmentSplitPaneIndicator({
        index: '3',
        icon: 'students',
        iconClass: 'lucide-table',
      })
      expect(screen.getByTestId('assignment-left-pane')).toHaveTextContent('student-1')
      expect(screen.getByTestId('assignment-right-pane')).toHaveTextContent('work:assignment-1:student-1')
      expect(screen.getByTestId('assignment-right-pane')).not.toHaveTextContent('grading:assignment-1:student-1')
    })
    expect(screen.getByRole('button', {
      name: 'Assignment panes: Students + content. Switch to Students + grading.',
    })).toBeInTheDocument()
  })

  it('keeps the students and grading view active when clicking a student row', async () => {
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

    expect(screen.getByTestId('assignment-split-pane-view')).toHaveTextContent('students-grading')
    expect(screen.getByRole('button', {
      name: 'Assignment panes: Students + grading. Switch to Content + grading.',
    })).toBeInTheDocument()
  })

  it('restores the class-pane scroll position after selecting a lower student row', async () => {
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
            assignment: makeAssignmentDetails('assignment-1', 'Assignment One', 'student-01').assignment,
            students: Array.from({ length: 30 }, (_, index) =>
              makeStudentSubmissionRow(`student-${String(index + 1).padStart(2, '0')}`),
            ),
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
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-1:student-01')
    })

    const scrollPane = screen.getByTestId('assignment-student-scroll-pane') as HTMLDivElement
    scrollPane.scrollTop = 520
    fireEvent.scroll(scrollPane)

    fireEvent.click(screen.getAllByText('student-25')[0])

    await waitFor(() => {
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('grading:assignment-1:student-25')
    })
    await waitFor(() => {
      expect(screen.getByTestId('assignment-student-scroll-pane')).toHaveProperty('scrollTop', 520)
    })
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

  it('refreshes assignment list card counts after returning selected work', async () => {
    mockStudentSelectionState.selectedIds = new Set(['student-1'])
    mockStudentSelectionState.selectedCount = 1
    let assignmentSummaryLoadCount = 0

    mockFetchJSONWithCache.mockImplementation((key: string, fetcher: () => Promise<unknown>) => {
      if (key === `teacher-assignments:${classroom.id}`) {
        assignmentSummaryLoadCount += 1
        return Promise.resolve({
          assignments: [
            makeAssignmentSummary('assignment-1', 'Assignment One', {
              stats: {
                total_students: 31,
                submitted: assignmentSummaryLoadCount === 1 ? 1 : 0,
                late: 0,
              },
            }),
          ],
        })
      }
      if (key === `class-days:${classroom.id}`) {
        return Promise.resolve({ class_days: [] })
      }
      if (key === `teacher-materials:${classroom.id}`) {
        return Promise.resolve({ materials: [] })
      }
      return fetcher()
    })

    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

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
                status: 'resubmitted',
                student_updated_at: '2026-04-22T12:00:00Z',
                artifacts: [],
                doc: {
                  is_submitted: true,
                  submitted_at: '2026-04-22T12:00:00Z',
                  updated_at: '2026-04-22T12:00:00Z',
                  score_completion: 8,
                  score_thinking: 8,
                  score_workflow: 8,
                  graded_at: '2026-04-22T13:00:00Z',
                  returned_at: '2026-04-21T12:00:00Z',
                  teacher_cleared_at: '2026-04-21T12:00:00Z',
                  feedback_returned_at: '2026-04-21T12:00:00Z',
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
            returned_count: 1,
            cleared_count: 1,
            created_count: 0,
            returned_student_ids: ['student-1'],
            blocked_count: 0,
            blocked_student_ids: [],
            already_returned_count: 0,
            already_returned_student_ids: [],
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

    render(<TeacherClassroomView classroom={classroom} />)

    expect(await screen.findByRole('button', { name: 'Assignment One' })).toBeInTheDocument()
    expect(screen.getByTestId('assignment-count-assignment-1')).toHaveTextContent('1/31')

    fireEvent.click(screen.getByRole('button', { name: 'Assignment One' }))
    await waitFor(() => {
      expect(screen.getByTestId('teacher-work-panel')).toHaveTextContent('overview:assignment-1:student-1')
    })

    fireEvent.click(screen.getByRole('button', { name: /Return/i }))
    const confirmReturnButton = screen.getAllByRole('button', { name: 'Return' }).at(-1)
    expect(confirmReturnButton).toBeDefined()
    fireEvent.click(confirmReturnButton!)

    await waitFor(() => {
      expect(mockInvalidateCachedJSON).toHaveBeenCalledWith(`teacher-assignments:${classroom.id}`)
    })
    act(() => {
      window.dispatchEvent(
        new CustomEvent(TEACHER_ASSIGNMENTS_SELECTION_EVENT, {
          detail: { classroomId: classroom.id, value: 'summary' },
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByTestId('assignment-count-assignment-1')).toHaveTextContent('0/31')
    })
    expect(assignmentSummaryLoadCount).toBeGreaterThan(1)
  })
})
