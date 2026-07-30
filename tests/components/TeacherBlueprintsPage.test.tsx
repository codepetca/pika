import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import TeacherBlueprintsPage from '@/app/teacher/blueprints/page'
import { fetchJSONWithCache, invalidateCachedJSONMatching } from '@/lib/request-cache'

const mockPush = vi.fn()
let searchParamsMap = new Map<string, string>()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({
    get: (key: string) => searchParamsMap.get(key) ?? null,
  }),
}))

vi.mock('@/components/PageLayout', () => ({
  PageLayout: ({ children }: any) => <div>{children}</div>,
  PageContent: ({ children }: any) => <div>{children}</div>,
  PageActionBar: ({ primary, actions = [] }: any) => (
    <div>
      {primary}
      {actions.map((action: any) => (
        <button key={action.id} type="button" onClick={action.onSelect}>
          {action.label}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@/components/CreateBlueprintModal', () => ({
  CreateBlueprintModal: () => null,
}))

vi.mock('@/components/CreateClassroomModal', () => ({
  CreateClassroomModal: ({
    isOpen,
    presetBlueprint,
  }: {
    isOpen: boolean
    presetBlueprint?: { id: string; title: string } | null
  }) => isOpen ? (
    <div role="dialog" data-testid="create-classroom-modal">
      Blueprint: {presetBlueprint?.id || 'none'} ({presetBlueprint?.title || 'untitled'})
    </div>
  ) : null,
}))

vi.mock('@/components/Spinner', () => ({
  Spinner: () => <div>Loading…</div>,
}))

vi.mock('@/lib/request-cache', () => ({
  fetchJSONWithCache: vi.fn((_key: string, load: () => Promise<unknown>) => load()),
  invalidateCachedJSON: vi.fn(),
  invalidateCachedJSONMatching: vi.fn(),
  prefetchJSON: vi.fn(),
}))

const blueprintList = [
  {
    id: 'b-1',
    title: 'Blueprint One',
    subject: '',
    grade_level: '',
    course_code: '',
  },
  {
    id: 'b-2',
    title: 'Blueprint Two',
    subject: 'Computer Science',
    grade_level: 'Grade 11',
    course_code: 'ICS3U',
  },
]

const blueprintDetail = {
  id: 'b-2',
  teacher_id: 'teacher-1',
  authority_mode: 'pika',
  title: 'Blueprint Two',
  subject: 'Computer Science',
  grade_level: 'Grade 11',
  course_code: 'ICS3U',
  term_template: '',
  overview_markdown: 'Overview',
  outline_markdown: 'Outline',
  resources_markdown: 'Resources',
  gradebook_use_weights: true,
  gradebook_assignments_weight: 65,
  gradebook_tests_weight: 35,
  planned_site_slug: null,
  planned_site_published: false,
  planned_site_config: {
    overview: true,
    outline: true,
    resources: true,
    assignments: true,
    tests: true,
    lesson_plans: true,
  },
  assignments: [],
  assessments: [],
  lesson_templates: [],
  materials: [],
  surveys: [],
  linked_classrooms: [
    {
      id: 'c-9',
      title: 'Semester 2',
      class_code: 'ABC123',
      theme_color: 'blue',
      term_label: null,
      actual_site_slug: null,
      actual_site_published: false,
      archived_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
}

const blueprintOneDetail = {
  ...blueprintDetail,
  id: 'b-1',
  title: 'Blueprint One',
  subject: '',
  grade_level: '',
  course_code: '',
  linked_classrooms: [],
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response
}

describe('TeacherBlueprintsPage', () => {
  beforeEach(() => {
    searchParamsMap = new Map([
      ['blueprint', 'b-2'],
      ['fromClassroom', 'c-9'],
    ])
    mockPush.mockClear()
    vi.mocked(fetchJSONWithCache).mockImplementation((_key, load) => load())
    vi.mocked(invalidateCachedJSONMatching).mockClear()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      if (url === '/api/auth/me') {
        return Promise.resolve(jsonResponse({ user: { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' } }))
      }
      if (url === '/api/teacher/course-blueprints' && method === 'GET') {
        return Promise.resolve(jsonResponse({ blueprints: blueprintList }))
      }
      if (url === '/api/teacher/course-blueprints/b-1' && method === 'GET') {
        return Promise.resolve(jsonResponse({ blueprint: blueprintOneDetail }))
      }
      if (url === '/api/teacher/course-blueprints/b-2' && method === 'GET') {
        return Promise.resolve(jsonResponse({ blueprint: blueprintDetail }))
      }
      if (url === '/api/teacher/course-blueprints/b-2' && method === 'PATCH') {
        return Promise.resolve(jsonResponse({ blueprint: blueprintDetail }))
      }
      if (url === '/api/teacher/course-blueprints/b-2' && method === 'DELETE') {
        return Promise.resolve(jsonResponse({ success: true }))
      }
      if (
        url === '/api/teacher/course-blueprints/b-2/merge-suggestions?classroomId=c-9'
        && method === 'GET'
      ) {
        return Promise.resolve(jsonResponse({
          suggestion_set: {
            classroom_id: 'c-9',
            classroom_title: 'Semester 2',
            classroom_revision: 2,
            blueprint_id: 'b-2',
            blueprint_revision: 4,
            generated_at: '2026-07-29T00:00:00.000Z',
            suggestions: [],
          },
        }))
      }
      if (url === '/api/teacher/course-blueprints/b-1' && method === 'DELETE') {
        return Promise.resolve(jsonResponse({ success: true }))
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as any)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('selects the blueprint from the query param and shows workflow-oriented package actions', async () => {
    render(<TeacherBlueprintsPage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument()
    })

    expect(screen.getByText('Course Blueprint')).toBeInTheDocument()
    expect(screen.getByText('Build, publish, export, and reuse course packages.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New Course Blueprint' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import Course Package' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use for Classroom' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export Course Package' })).toBeInTheDocument()
    expect(screen.getByText('Course blueprint saved from Semester 2. Review it here, then use it for another classroom or export the course package.')).toBeInTheDocument()
    expect(screen.getByText('Portable Course Package')).toBeInTheDocument()
    expect(screen.getByText(/Exports a .course-package.tar file with manifest.json and editable Markdown files./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Quizzes' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Materials' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Surveys' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Grading' }))
    expect(screen.getByText('Reusable Gradebook Setup')).toBeInTheDocument()
    expect(screen.getByDisplayValue('65')).toBeInTheDocument()
    expect(screen.getByDisplayValue('35')).toBeInTheDocument()
    expect(fetchJSONWithCache).toHaveBeenCalledWith(
      'teacher-blueprints:teacher-1:list',
      expect.any(Function),
      20_000,
    )
    expect(fetchJSONWithCache).toHaveBeenCalledWith(
      'teacher-blueprints:teacher-1:detail:b-2',
      expect.any(Function),
      20_000,
    )
  })

  it('opens classroom change review from the archived reuse handoff', async () => {
    searchParamsMap = new Map([
      ['blueprint', 'b-2'],
      ['reviewClassroom', 'c-9'],
    ])

    render(<TeacherBlueprintsPage />)

    expect(await screen.findByRole('button', {
      name: 'Save Classroom Changes to Blueprint',
    })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Semester 2')).toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/teacher/course-blueprints/b-2/merge-suggestions?classroomId=c-9',
    ))
  })

  it('ignores stale detail responses after selecting a different blueprint', async () => {
    let resolveDelayedDetail: ((response: Response) => void) | undefined
    const delayedDetail = new Promise<Response>((resolve) => {
      resolveDelayedDetail = resolve
    })
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      if (url === '/api/auth/me') {
        return Promise.resolve(jsonResponse({ user: { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' } }))
      }
      if (url === '/api/teacher/course-blueprints' && method === 'GET') {
        return Promise.resolve(jsonResponse({ blueprints: blueprintList }))
      }
      if (url === '/api/teacher/course-blueprints/b-2' && method === 'GET') {
        return delayedDetail
      }
      if (url === '/api/teacher/course-blueprints/b-1' && method === 'GET') {
        return Promise.resolve(jsonResponse({ blueprint: blueprintOneDetail }))
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as any)

    render(<TeacherBlueprintsPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Blueprint One/ }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('Blueprint One')).toBeInTheDocument()
    })

    await act(async () => {
      resolveDelayedDetail?.(jsonResponse({ blueprint: blueprintDetail }))
      await delayedDetail
    })

    expect(screen.getByDisplayValue('Blueprint One')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Blueprint Two')).toBeNull()
  })

  it('locks the selected Blueprint for classroom creation while detail is loading', async () => {
    let resolveDelayedDetail: ((response: Response) => void) | undefined
    const delayedDetail = new Promise<Response>((resolve) => {
      resolveDelayedDetail = resolve
    })
    const defaultFetch = vi.mocked(fetch).getMockImplementation()
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      if (url === '/api/teacher/course-blueprints/b-2' && method === 'GET') {
        return delayedDetail
      }
      return defaultFetch!(input, init)
    })

    render(<TeacherBlueprintsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Use for Classroom' }))

    expect(await screen.findByTestId('create-classroom-modal')).toHaveTextContent(
      'Blueprint: b-2 (Blueprint Two)',
    )

    await act(async () => {
      resolveDelayedDetail?.(jsonResponse({ blueprint: blueprintDetail }))
      await delayedDetail
    })
  })

  it('invalidates blueprint caches before reloading after saving metadata', async () => {
    render(<TeacherBlueprintsPage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save Details' }))

    await waitFor(() => {
      expect(invalidateCachedJSONMatching).toHaveBeenCalledWith('teacher-blueprints:')
    })
  })

  it('warns about linked classrooms before deleting the selected Blueprint', async () => {
    render(<TeacherBlueprintsPage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Course Blueprint' }))

    expect(screen.getByRole('dialog', { name: 'Delete Blueprint Two?' })).toBeInTheDocument()
    expect(screen.getByText(
      '1 linked classroom will stay intact, but its Blueprint connection will be removed. This cannot be undone.',
    )).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/teacher/course-blueprints/b-2',
        { method: 'DELETE' },
      )
    })
    expect(invalidateCachedJSONMatching).toHaveBeenCalledWith('teacher-blueprints:')
    expect(mockPush).toHaveBeenCalledWith('/teacher/blueprints')

    await waitFor(() => {
      expect(screen.getByDisplayValue('Blueprint One')).toBeInTheDocument()
    })
  })

  it('never offers deletion for stale detail during a Blueprint selection change', async () => {
    let resolveBlueprintOne: ((response: Response) => void) | undefined
    const delayedBlueprintOne = new Promise<Response>((resolve) => {
      resolveBlueprintOne = resolve
    })
    const defaultFetch = vi.mocked(fetch).getMockImplementation()
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      if (url === '/api/teacher/course-blueprints/b-1' && method === 'GET') {
        return delayedBlueprintOne
      }
      return defaultFetch!(input, init)
    })

    render(<TeacherBlueprintsPage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /Blueprint One/ }))

    expect(screen.queryByRole('button', { name: 'Delete Course Blueprint' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()

    await act(async () => {
      resolveBlueprintOne?.(jsonResponse({ blueprint: blueprintOneDetail }))
      await delayedBlueprintOne
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Course Blueprint' }))
    expect(screen.getByRole('dialog', { name: 'Delete Blueprint One?' })).toBeInTheDocument()
    expect(screen.getByText(
      'This permanently deletes the Course Blueprint and its saved Versions. This cannot be undone.',
    )).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/teacher/course-blueprints/b-1',
        { method: 'DELETE' },
      )
    })
  })

  it('does not offer deletion while repository authority is active', async () => {
    const defaultFetch = vi.mocked(fetch).getMockImplementation()
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      if (url === '/api/teacher/course-blueprints/b-2' && method === 'GET') {
        return Promise.resolve(jsonResponse({
          blueprint: { ...blueprintDetail, authority_mode: 'repository' },
        }))
      }
      return defaultFetch!(input, init)
    })

    render(<TeacherBlueprintsPage />)

    await waitFor(() => {
      expect(screen.getByText('Repository-managed')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Delete Course Blueprint' })).toBeNull()
  })
})
