import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClassroomPageClient } from '@/app/classrooms/[classroomId]/ClassroomPageClient'
import { MarkdownPreferenceProvider } from '@/contexts/MarkdownPreferenceContext'
import type { Classroom } from '@/types'

const mockFetchJSONWithCache = vi.hoisted(() => vi.fn())
const mockAssignmentsToMarkdown = vi.hoisted(() => vi.fn())
const mockTeacherTestsTabProps = vi.hoisted(() => vi.fn())
const mockClassDays = vi.hoisted(() => [
  { id: 'day-today', classroom_id: 'classroom-1', date: '2026-05-12', is_class_day: true, prompt_text: null },
  { id: 'day-last', classroom_id: 'classroom-1', date: '2026-05-11', is_class_day: true, prompt_text: null },
])

vi.mock('@/app/classrooms/[classroomId]/TeacherClassroomView', () => ({
  TeacherClassroomView: ({
    onEditModeChange,
    onOpenMarkdownEditor,
    onSelectAssignment,
    onViewModeChange,
    showMarkdownEditorOption,
  }: any) => (
    <div>
      <button type="button" onClick={() => onEditModeChange?.(true)}>
        Set assignment edit active
      </button>
      {showMarkdownEditorOption ? (
        <button type="button" onClick={onOpenMarkdownEditor}>
          Edit Markdown
        </button>
      ) : null}
      <button type="button" onClick={() => onEditModeChange?.(false)}>
        Set assignment edit inactive
      </button>
      <button
        type="button"
        onClick={() => {
          onViewModeChange?.('assignment')
          onSelectAssignment?.({ title: 'Assignment One', instructions: null })
        }}
      >
        Select assignment workspace
      </button>
    </div>
  ),
  TeacherAssignmentsMarkdownEditor: ({ markdownContent }: any) => (
    <div>Markdown editor: {markdownContent}</div>
  ),
}))

vi.mock('@/components/AppShell', () => ({
  AppShell: ({ children, classrooms, currentClassroomId, pageTitle }: any) => {
    const currentClassroom = classrooms?.find((c: any) => c.id === currentClassroomId)
    return (
      <div>
        <div data-testid="app-shell-page-title">{pageTitle}</div>
        <div data-testid="app-shell-classroom-theme">{currentClassroom?.themeColor}</div>
        {children}
      </div>
    )
  },
}))

vi.mock('@/components/layout', async () => {
  const React = await import('react')
  const LayoutContext = React.createContext<any>(null)

  function useLayoutContext() {
    const value = React.useContext(LayoutContext)
    if (!value) {
      throw new Error('layout context missing')
    }
    return value
  }

  return {
    ThreePanelProvider: ({ children, routeKey }: any) => {
      const [isRightOpen, setRightOpen] = React.useState(
        routeKey === 'today' || routeKey === 'assignments-teacher-list' || routeKey === 'calendar-teacher'
      )
      const [rightWidth, setRightWidth] = React.useState(320)
      const value = React.useMemo(
        () => ({
          isRightOpen,
          rightWidth,
          setRightOpen,
          setRightWidth,
        }),
        [isRightOpen, rightWidth],
      )

      return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
    },
    ThreePanelShell: ({ children }: any) => <div>{children}</div>,
    LeftSidebar: ({ children }: any) => <div>{children}</div>,
    MainContent: ({ children }: any) => <main>{children}</main>,
    NavItems: ({ onTabChange }: any) => (
      <nav>
        <button type="button" onClick={() => onTabChange('attendance')}>
          Go Daily
        </button>
        <button type="button" onClick={() => onTabChange('assignments')}>
          Go Classwork
        </button>
        <button type="button" onClick={() => onTabChange('tests')}>
          Go Tests
        </button>
        <button type="button" onClick={() => onTabChange('resources')}>
          Go Syllabus
        </button>
      </nav>
    ),
    RightSidebar: ({ children, headerActions, title }: any) => {
      const { isRightOpen, setRightOpen } = useLayoutContext()
      if (!isRightOpen) return null
      return (
        <aside aria-label={title || 'Right sidebar'}>
          <button type="button" onClick={() => setRightOpen(false)}>
            Close panel
          </button>
          {headerActions}
          {children}
        </aside>
      )
    },
    useLayoutInitialState: () => ({ leftSidebarExpanded: true }),
    useMobileDrawer: () => {
      const { setRightOpen } = useLayoutContext()
      return {
        openLeft: vi.fn(),
        openRight: () => setRightOpen(true),
        close: () => setRightOpen(false),
      }
    },
    useRightSidebar: () => {
      const { isRightOpen, setRightOpen, rightWidth, setRightWidth } = useLayoutContext()
      return {
        isOpen: isRightOpen,
        setOpen: setRightOpen,
        setWidth: setRightWidth,
        enabled: true,
        cssWidth: typeof rightWidth === 'number' ? `${rightWidth}px` : rightWidth,
        desktopAlwaysOpen: false,
      }
    },
  }
})

vi.mock('@/components/StudentNotificationsProvider', () => ({
  StudentNotificationsProvider: ({ children }: any) => <>{children}</>,
}))

vi.mock('@/hooks/useClassDays', () => ({
  ClassDaysProvider: ({ children }: any) => <>{children}</>,
  useClassDaysContext: () => ({
    classDays: mockClassDays,
    error: null,
    hasLoadedSnapshot: true,
    isLoading: false,
    refresh: vi.fn(),
  }),
}))

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: () => '2026-05-12',
}))

vi.mock('@/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui')>()
  return {
    ...actual,
    Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    ConfirmDialog: () => null,
    DialogPanel: ({ isOpen, children, ariaLabelledBy }: any) => (
      isOpen ? (
        <div role="dialog" aria-labelledby={ariaLabelledBy}>
          {children}
        </div>
      ) : null
    ),
    TabContentTransition: ({ children, isActive }: any) => (isActive ? <>{children}</> : null),
  }
})

vi.mock('@/lib/request-cache', () => ({
  fetchJSONWithCache: (...args: any[]) => mockFetchJSONWithCache(...args),
  prefetchJSON: vi.fn(),
}))

vi.mock('@/lib/assignment-markdown', () => ({
  assignmentsToMarkdown: (...args: any[]) => mockAssignmentsToMarkdown(...args),
  markdownToAssignments: vi.fn(() => ({ assignments: [], errors: [], warnings: [] })),
}))

vi.mock('@/lib/classroom-ux-metrics', () => ({
  markClassroomTabSwitchReady: vi.fn(),
  markClassroomTabSwitchStart: vi.fn(),
}))

vi.mock('@/components/editor', () => ({
  RichTextViewer: ({ content }: any) => (
    <div>
      {content?.content?.[0]?.content?.[0]?.text ?? 'Rich text'}
    </div>
  ),
}))

vi.mock('@/components/Spinner', () => ({
  Spinner: () => <div data-testid="spinner" />,
}))

vi.mock('@/components/TeacherTestPreviewPage', () => ({
  TeacherTestPreviewPage: () => null,
}))

vi.mock('@/app/classrooms/[classroomId]/StudentTodayTab', async () => {
  const React = await import('react')

  return {
    StudentTodayTab: ({ classroom, onLessonPlanLoad }: any) => {
      React.useEffect(() => {
        if (classroom?.id !== 'classroom-1') return
        onLessonPlanLoad?.({
          id: 'today-plan',
          classroom_id: classroom.id,
          date: '2026-05-12',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Today calendar entry' }],
              },
            ],
          },
          content_markdown: null,
          created_at: '2026-05-12T00:00:00Z',
          updated_at: '2026-05-12T00:00:00Z',
        }, classroom.id)
      }, [classroom?.id, onLessonPlanLoad])

      return <div />
    },
  }
})
vi.mock('@/app/classrooms/[classroomId]/StudentAssignmentsTab', () => ({
  StudentAssignmentsTab: () => <div />,
}))
vi.mock('@/app/classrooms/[classroomId]/TeacherAttendanceTab', () => ({
  TeacherAttendanceTab: () => <div />,
}))
vi.mock('@/app/classrooms/[classroomId]/TeacherRosterTab', () => ({
  TeacherRosterTab: () => <div />,
}))
vi.mock('@/app/classrooms/[classroomId]/TeacherGradebookTab', () => ({
  TeacherGradebookTab: () => <div />,
}))
vi.mock('@/app/classrooms/[classroomId]/TeacherSettingsTab', () => ({
  TeacherSettingsTab: ({ classroom, onClassroomUpdated }: any) => (
    <button
      type="button"
      onClick={() => onClassroomUpdated?.({ ...classroom, title: 'Physics Updated', theme_color: 'teal' })}
    >
      Update classroom theme
    </button>
  ),
}))
vi.mock('@/app/classrooms/[classroomId]/TeacherLessonCalendarTab', async () => {
  const React = await import('react')

  return {
    TeacherLessonCalendarTab: ({ onSidebarStateChange }: any) => {
      React.useEffect(() => {
        onSidebarStateChange?.({ bulkSaving: false, onSave: vi.fn() })
      }, [onSidebarStateChange])

      return <div />
    },
    TeacherLessonCalendarSidebar: () => <div />,
  }
})
vi.mock('@/app/classrooms/[classroomId]/StudentLessonCalendarTab', () => ({
  StudentLessonCalendarTab: () => <div />,
}))
vi.mock('@/app/classrooms/[classroomId]/TeacherClassResourcesSidebar', () => ({
  TeacherClassResourcesSidebar: () => <div />,
}))
vi.mock('@/app/classrooms/[classroomId]/TeacherResourcesTab', () => ({
  TeacherResourcesTab: () => <div />,
}))
vi.mock('@/app/classrooms/[classroomId]/StudentClassResourcesSidebar', () => ({
  StudentClassResourcesSidebar: () => <div />,
}))
vi.mock('@/app/classrooms/[classroomId]/StudentResourcesTab', () => ({
  StudentResourcesTab: () => <div />,
}))
vi.mock('@/app/classrooms/[classroomId]/TeacherAnnouncementsTab', () => ({
  TeacherAnnouncementsTab: () => <div />,
}))
vi.mock('@/app/classrooms/[classroomId]/StudentAnnouncementsTab', () => ({
  StudentAnnouncementsTab: () => <div />,
}))
vi.mock('@/app/classrooms/[classroomId]/TeacherTestsTab', () => ({
  TeacherTestsTab: (props: any) => {
    mockTeacherTestsTabProps(props)
    return (
      <div>
        <button
          type="button"
          onClick={() => props.onSelectTest?.({ id: 'test-1', title: 'Test One' })}
        >
          Select test workspace
        </button>
      </div>
    )
  },
}))
vi.mock('@/app/classrooms/[classroomId]/StudentTestsTab', () => ({
  StudentTestsTab: () => <div />,
}))
vi.mock('@/components/StudentLogHistory', () => ({
  StudentLogHistory: () => <div />,
}))
vi.mock('@/app/classrooms/[classroomId]/LogSummary', () => ({
  LogSummary: () => <div />,
}))
vi.mock('@/components/PageLayout', () => ({
  PageDensityProvider: ({ children }: any) => <>{children}</>,
}))

const classroom: Classroom = {
  id: 'classroom-1',
  teacher_id: 'teacher-1',
  title: 'Physics',
  class_code: 'ABC123',
  theme_color: 'blue',
  term_label: null,
  allow_enrollment: true,
  start_date: null,
  end_date: null,
  lesson_plan_visibility: 'hidden',
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function renderClient(options?: {
  classroom?: Classroom
  initialTab?: string
  initialSearchParams?: Record<string, string | undefined>
}) {
  const targetClassroom = options?.classroom ?? classroom
  const initialTab = options?.initialTab ?? 'assignments'
  const initialSearchParams = options?.initialSearchParams ?? { tab: initialTab }

  return render(
    <MarkdownPreferenceProvider>
      <ClassroomPageClient
        classroom={targetClassroom}
        user={{ id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' }}
        teacherClassrooms={[targetClassroom]}
        initialTab={initialTab}
        initialSearchParams={initialSearchParams}
      />
    </MarkdownPreferenceProvider>,
  )
}

function renderStudentClient(options?: {
  classroom?: Classroom
  initialTab?: string
  initialSearchParams?: Record<string, string | undefined>
}) {
  const targetClassroom = options?.classroom ?? classroom
  const initialTab = options?.initialTab ?? 'today'
  const initialSearchParams = options?.initialSearchParams ?? { tab: initialTab }

  return render(
    <MarkdownPreferenceProvider>
      <ClassroomPageClient
        classroom={targetClassroom}
        user={{ id: 'student-1', email: 'student1@example.com', role: 'student' }}
        teacherClassrooms={[]}
        initialTab={initialTab}
        initialSearchParams={initialSearchParams}
      />
    </MarkdownPreferenceProvider>,
  )
}

describe('ClassroomPageClient assignment edit-mode markdown gating', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState({}, '', '/classrooms/classroom-1?tab=assignments')
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      writable: true,
    })
    mockFetchJSONWithCache.mockReset()
    mockAssignmentsToMarkdown.mockReset()
    mockTeacherTestsTabProps.mockReset()
    mockFetchJSONWithCache.mockResolvedValue({
      assignments: [
        {
          id: 'assignment-1',
          title: 'Assignment One',
          instructions_markdown: 'Instructions',
          rich_instructions: null,
        },
      ],
    })
    mockAssignmentsToMarkdown.mockReturnValue({
      markdown: '## Assignment One',
      hasRichContent: false,
    })
  })

  it('updates the app shell classroom theme when settings saves classroom changes', async () => {
    window.history.replaceState({}, '', '/classrooms/classroom-1?tab=settings')
    renderClient({ initialTab: 'settings', initialSearchParams: { tab: 'settings' } })

    expect(screen.getByTestId('app-shell-classroom-theme')).toHaveTextContent('blue')

    fireEvent.click(screen.getByRole('button', { name: 'Update classroom theme' }))

    await waitFor(() => {
      expect(screen.getByTestId('app-shell-classroom-theme')).toHaveTextContent('teal')
    })
  })

  it('replaces history when sidebar navigation changes first-level tabs', () => {
    renderClient()
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState')
    const pushStateSpy = vi.spyOn(window.history, 'pushState')

    fireEvent.click(screen.getByRole('button', { name: 'Go Syllabus' }))

    expect(pushStateSpy).not.toHaveBeenCalled()
    expect(replaceStateSpy).toHaveBeenCalled()
    const lastReplaceCall = replaceStateSpy.mock.calls.at(-1)
    expect(lastReplaceCall?.[2]).toBe('/classrooms/classroom-1?tab=resources')
  })

  it('opens assignment markdown from the assignments FAB dropdown and closes it from the modal', async () => {
    renderClient()

    expect(screen.queryByText(/Markdown editor:/)).not.toBeInTheDocument()
    expect(mockFetchJSONWithCache).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Markdown' }))

    await waitFor(() => {
      expect(screen.getByText('Markdown editor: ## Assignment One')).toBeInTheDocument()
    })
    expect(screen.getByRole('dialog', { name: 'Edit Markdown' })).toBeInTheDocument()
    expect(mockFetchJSONWithCache).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByText(/Markdown editor:/)).not.toBeInTheDocument()
    })
  })

  it('does not pin the selected assignment title in the app shell title slot', () => {
    renderClient()

    fireEvent.click(screen.getByRole('button', { name: 'Select assignment workspace' }))

    expect(screen.getByTestId('app-shell-page-title')).toBeEmptyDOMElement()
  })

  it('does not pin the assignments summary label in the app shell title slot', () => {
    renderClient()

    expect(screen.getByTestId('app-shell-page-title')).toBeEmptyDOMElement()
  })

  it('does not render a passive external sidebar for teacher assignment summary', () => {
    renderClient()

    expect(screen.queryByText('Use the assignment workspace to review student work.')).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('clears the assignments summary label while assignment edit mode is active', () => {
    renderClient()

    fireEvent.click(screen.getByRole('button', { name: 'Set assignment edit active' }))

    expect(screen.getByTestId('app-shell-page-title')).toBeEmptyDOMElement()
  })

  it('does not pin the daily label in the app shell title slot', () => {
    window.history.replaceState({}, '', '/classrooms/classroom-1?tab=attendance')

    renderClient({ initialTab: 'attendance', initialSearchParams: { tab: 'attendance' } })

    expect(screen.getByTestId('app-shell-page-title')).toBeEmptyDOMElement()
  })

  it('uses the accessible solid fill for the calendar sidebar save action', async () => {
    window.history.replaceState({}, '', '/classrooms/classroom-1?tab=calendar')

    renderClient({ initialTab: 'calendar', initialSearchParams: { tab: 'calendar' } })

    expect(await screen.findByRole('button', { name: 'Save' })).toHaveClass(
      'bg-primary-solid',
      'hover:bg-primary-solid-hover',
      'text-text-inverse'
    )
  })

  it('shows today and last class lesson plans in the student today sidebar', async () => {
    window.history.replaceState({}, '', '/classrooms/classroom-1?tab=today')
    mockFetchJSONWithCache.mockImplementation((key: string) => {
      if (key.startsWith('student-today:last-class-plan:')) {
        return Promise.resolve({
          lesson_plans: [
            {
              id: 'last-class-plan',
              classroom_id: 'classroom-1',
              date: '2026-05-11',
              content: {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Last class calendar entry' }],
                  },
                ],
              },
              content_markdown: null,
              created_at: '2026-05-11T00:00:00Z',
              updated_at: '2026-05-11T00:00:00Z',
            },
          ],
        })
      }

      return Promise.resolve({ assignments: [] })
    })

    renderStudentClient({ initialTab: 'today', initialSearchParams: { tab: 'today' } })

    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByText('Today calendar entry')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Yesterday' })).toBeInTheDocument()
    expect(screen.getByText('Mon May 11')).toBeInTheDocument()
    expect(await screen.findByText('Last class calendar entry')).toBeInTheDocument()
  })

  it('clears the student today sidebar plan when the classroom route changes', async () => {
    const secondClassroom = { ...classroom, id: 'classroom-2', title: 'Chemistry' }
    window.history.replaceState({}, '', '/classrooms/classroom-1?tab=today')

    const view = renderStudentClient({ classroom, initialTab: 'today', initialSearchParams: { tab: 'today' } })

    expect(await screen.findByText('Today calendar entry')).toBeInTheDocument()

    window.history.replaceState({}, '', '/classrooms/classroom-2?tab=today')
    view.rerender(
      <MarkdownPreferenceProvider>
        <ClassroomPageClient
          classroom={secondClassroom}
          user={{ id: 'student-1', email: 'student1@example.com', role: 'student' }}
          teacherClassrooms={[]}
          initialTab="today"
          initialSearchParams={{ tab: 'today' }}
        />
      </MarkdownPreferenceProvider>,
    )

    expect(screen.queryByText('Today calendar entry')).not.toBeInTheDocument()
    expect(screen.getByText('No lesson plan for today.')).toBeInTheDocument()
  })

  it('falls back from the legacy quizzes tab to the default teacher tab', async () => {
    window.history.replaceState({}, '', '/classrooms/classroom-1?tab=quizzes&quizId=quiz-1')

    renderClient({
      initialTab: 'quizzes',
      initialSearchParams: { tab: 'quizzes', quizId: 'quiz-1' },
    })

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search)
      expect(params.get('tab')).toBe('attendance')
      expect(params.has('quizId')).toBe(false)
    })
    expect(screen.getByTestId('app-shell-page-title')).toBeEmptyDOMElement()
  })

  it('falls back from the legacy quizzes tab to the default student tab', async () => {
    window.history.replaceState({}, '', '/classrooms/classroom-1?tab=quizzes&quizId=quiz-1')

    renderStudentClient({
      initialTab: 'quizzes',
      initialSearchParams: { tab: 'quizzes', quizId: 'quiz-1' },
    })

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search)
      expect(params.get('tab')).toBe('today')
      expect(params.has('quizId')).toBe(false)
    })
  })

  it('does not pin the tests summary label in the app shell title slot', () => {
    window.history.replaceState({}, '', '/classrooms/classroom-1?tab=tests')

    renderClient({ initialTab: 'tests', initialSearchParams: { tab: 'tests' } })

    expect(screen.getByTestId('app-shell-page-title')).toBeEmptyDOMElement()
  })

  it('does not pin the selected test title in the app shell title slot', () => {
    window.history.replaceState({}, '', '/classrooms/classroom-1?tab=tests&testId=test-1')

    renderClient({
      initialTab: 'tests',
      initialSearchParams: { tab: 'tests', testId: 'test-1' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Select test workspace' }))

    expect(screen.getByTestId('app-shell-page-title')).toBeEmptyDOMElement()
  })

  it('resets stale tests detail query params when the classroom route changes', async () => {
    const secondClassroom = { ...classroom, id: 'classroom-2', title: 'Chemistry' }
    window.history.replaceState(
      {},
      '',
      '/classrooms/classroom-1?tab=tests&testId=old-test&testMode=grading&testStudentId=old-student',
    )

    const view = renderClient({
      classroom,
      initialTab: 'tests',
      initialSearchParams: {
        tab: 'tests',
        testId: 'old-test',
        testMode: 'grading',
        testStudentId: 'old-student',
      },
    })

    await waitFor(() => {
      expect(mockTeacherTestsTabProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          classroom,
          selectedTestId: 'old-test',
          selectedTestMode: 'grading',
          selectedTestStudentId: 'old-student',
        }),
      )
    })

    mockTeacherTestsTabProps.mockClear()

    view.rerender(
      <MarkdownPreferenceProvider>
        <ClassroomPageClient
          classroom={secondClassroom}
          user={{ id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' }}
          teacherClassrooms={[secondClassroom]}
          initialTab="tests"
          initialSearchParams={{ tab: 'tests' }}
        />
      </MarkdownPreferenceProvider>,
    )

    expect(
      mockTeacherTestsTabProps.mock.calls.some(([props]) =>
        props.classroom?.id === secondClassroom.id &&
        (props.selectedTestId === 'old-test' ||
          props.selectedTestMode === 'grading' ||
          props.selectedTestStudentId === 'old-student')
      ),
    ).toBe(false)

    await waitFor(() => {
      expect(mockTeacherTestsTabProps).toHaveBeenLastCalledWith(
        expect.objectContaining({
          classroom: secondClassroom,
          selectedTestId: null,
          selectedTestMode: null,
          selectedTestStudentId: null,
        }),
      )
    })
  })

  it('does not open assignment markdown when assignment edit mode activates', async () => {
    renderClient()

    fireEvent.click(screen.getByRole('button', { name: 'Set assignment edit active' }))

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText(/Markdown editor:/)).not.toBeInTheDocument()
    expect(mockFetchJSONWithCache).not.toHaveBeenCalled()
  })

  it('clears assignment edit and markdown mode when route navigation leaves assignments', async () => {
    renderClient()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Markdown' }))

    await waitFor(() => {
      expect(screen.getByText('Markdown editor: ## Assignment One')).toBeInTheDocument()
    })

    window.history.pushState({}, '', '/classrooms/classroom-1?tab=resources')
    window.dispatchEvent(new Event('popstate'))

    await waitFor(() => {
      expect(screen.queryByText(/Markdown editor:/)).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Set assignment edit active' })).not.toBeInTheDocument()
  })

  it('does not open assignment markdown when the global markdown setting is hidden', async () => {
    window.localStorage.setItem('pika_show_markdown', 'false')
    renderClient()

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Edit Markdown' })).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Set assignment edit active' }))

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mockFetchJSONWithCache).not.toHaveBeenCalled()
    expect(screen.queryByText(/Markdown editor:/)).not.toBeInTheDocument()
  })
})
