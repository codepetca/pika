import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClassroomPageClient } from '@/app/classrooms/[classroomId]/ClassroomPageClient'
import { MarkdownPreferenceProvider } from '@/contexts/MarkdownPreferenceContext'
import type { Classroom } from '@/types'

const mockFetchJSONWithCache = vi.hoisted(() => vi.fn())
const mockAssignmentsToMarkdown = vi.hoisted(() => vi.fn())

vi.mock('@/app/classrooms/[classroomId]/TeacherClassroomView', () => ({
  TeacherClassroomView: ({ onEditModeChange }: any) => (
    <div>
      <button type="button" onClick={() => onEditModeChange?.(true)}>
        Set assignment edit active
      </button>
      <button type="button" onClick={() => onEditModeChange?.(false)}>
        Set assignment edit inactive
      </button>
    </div>
  ),
  TeacherAssignmentsMarkdownSidebar: ({ markdownContent }: any) => (
    <div>Markdown editor: {markdownContent}</div>
  ),
}))

vi.mock('@/components/AppShell', () => ({
  AppShell: ({ children }: any) => <div>{children}</div>,
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
    ThreePanelProvider: ({ children }: any) => {
      const [isRightOpen, setRightOpen] = React.useState(false)
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
    NavItems: () => <nav />,
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
}))

vi.mock('@/ui', () => ({
  ConfirmDialog: () => null,
  TabContentTransition: ({ children, isActive }: any) => (isActive ? <>{children}</> : null),
}))

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
  RichTextViewer: () => <div>Rich text</div>,
}))

vi.mock('@/components/Spinner', () => ({
  Spinner: () => <div data-testid="spinner" />,
}))

vi.mock('@/components/TeacherTestPreviewPage', () => ({
  TeacherTestPreviewPage: () => null,
}))

vi.mock('@/app/classrooms/[classroomId]/StudentTodayTab', () => ({
  StudentTodayTab: () => <div />,
}))
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
  TeacherSettingsTab: () => <div />,
}))
vi.mock('@/app/classrooms/[classroomId]/TeacherLessonCalendarTab', () => ({
  TeacherLessonCalendarTab: () => <div />,
  TeacherLessonCalendarSidebar: () => <div />,
}))
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
vi.mock('@/app/classrooms/[classroomId]/TeacherQuizzesTab', () => ({
  TeacherQuizzesTab: () => <div />,
}))
vi.mock('@/app/classrooms/[classroomId]/TeacherTestsTab', () => ({
  TeacherTestsTab: () => <div />,
}))
vi.mock('@/app/classrooms/[classroomId]/StudentQuizzesTab', () => ({
  StudentQuizzesTab: () => <div />,
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
  term_label: null,
  allow_enrollment: true,
  start_date: null,
  end_date: null,
  lesson_plan_visibility: 'hidden',
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function renderClient() {
  return render(
    <MarkdownPreferenceProvider>
      <ClassroomPageClient
        classroom={classroom}
        user={{ id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' }}
        teacherClassrooms={[classroom]}
        initialTab="assignments"
        initialSearchParams={{ tab: 'assignments' }}
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

  it('opens assignment markdown when assignment edit mode activates and closes it when edit mode turns off', async () => {
    renderClient()

    expect(screen.queryByText(/Markdown editor:/)).not.toBeInTheDocument()
    expect(mockFetchJSONWithCache).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Set assignment edit active' }))

    await waitFor(() => {
      expect(screen.getByText('Markdown editor: ## Assignment One')).toBeInTheDocument()
    })
    expect(mockFetchJSONWithCache).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Set assignment edit inactive' }))

    await waitFor(() => {
      expect(screen.queryByText(/Markdown editor:/)).not.toBeInTheDocument()
    })
  })

  it('does not reopen assignment markdown after the teacher manually closes the panel', async () => {
    renderClient()

    fireEvent.click(screen.getByRole('button', { name: 'Set assignment edit active' }))

    await waitFor(() => {
      expect(screen.getByText('Markdown editor: ## Assignment One')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))

    await waitFor(() => {
      expect(screen.queryByText(/Markdown editor:/)).not.toBeInTheDocument()
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText(/Markdown editor:/)).not.toBeInTheDocument()
    expect(mockFetchJSONWithCache).toHaveBeenCalledTimes(1)
  })

  it('clears assignment edit and markdown mode when route navigation leaves assignments', async () => {
    renderClient()

    fireEvent.click(screen.getByRole('button', { name: 'Set assignment edit active' }))

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

    fireEvent.click(screen.getByRole('button', { name: 'Set assignment edit active' }))

    await waitFor(() => {
      expect(mockFetchJSONWithCache).not.toHaveBeenCalled()
    })
    expect(screen.queryByText(/Markdown editor:/)).not.toBeInTheDocument()
  })
})
