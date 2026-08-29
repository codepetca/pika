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
        <button key={action.id} type="button" onClick={action.onSelect} disabled={action.disabled}>
          {action.label}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@/components/CreateBlueprintModal', () => ({
  CreateBlueprintModal: ({
    isOpen,
    onSuccess,
  }: {
    isOpen: boolean
    onSuccess: (blueprint: typeof blueprintOneDetail) => void | Promise<void>
  }) => (
    isOpen ? (
      <div role="dialog" aria-label="Create Course Blueprint">
        <button type="button" onClick={() => onSuccess(blueprintOneDetail)}>
          Complete Blueprint creation
        </button>
      </div>
    ) : null
  ),
}))

vi.mock('@/components/CreateClassroomModal', () => ({
  CreateClassroomModal: ({ isOpen, onSuccess }: { isOpen: boolean; onSuccess: (classroom: any) => void }) => (
    isOpen ? (
      <div role="dialog" aria-label="Create Classroom">
        Create Classroom
        <button type="button" onClick={() => onSuccess({ id: 'classroom-new' })}>
          Complete Classroom creation
        </button>
      </div>
    ) : null
  ),
}))

vi.mock('@/components/CourseBlueprintPurgeDialog', () => ({
  CourseBlueprintPurgeDialog: ({
    courseBlueprintTitle,
    onCompleted,
  }: {
    courseBlueprintTitle: string
    onCompleted: () => void
  }) => (
    <div role="dialog" aria-label={`Delete ${courseBlueprintTitle}?`}>
      <p>
        Linked Classrooms are kept, but their Blueprint connection is removed.
        This cannot be undone.
      </p>
      <button type="button" onClick={onCompleted}>Confirm permanent deletion</button>
    </div>
  ),
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

function proposalFixture(id: string, revision: number) {
  return {
    id,
    source_kind: 'ai',
    target_kind: 'blueprint',
    target_classroom_id: null,
    status: 'ready',
    base_blueprint_revision: revision,
    base_classroom_revision: null,
    applied_blueprint_revision: null,
    applied_classroom_revision: null,
    operations_json: [],
    diff_json: { summary: { update: 1 } },
    created_at: '2026-08-17T00:00:00.000Z',
  }
}

function mergeSuggestionResponse(title: string): Response {
  return jsonResponse({
    suggestion_set: {
      classroom_id: 'c-9',
      classroom_title: 'Semester 2',
      classroom_revision: 2,
      blueprint_id: 'b-2',
      blueprint_revision: 4,
      generated_at: '2026-08-17T00:00:00.000Z',
      suggestions: [{
        area: 'overview',
        title,
        summary: `${title} summary`,
        items: [],
      }],
    },
  })
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

  it('reuses one import key when the same course package is retried', async () => {
    const view = render(<TeacherBlueprintsPage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument()
    })

    const fetchMock = vi.mocked(fetch)
    const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    const file = new File(['bundle'], 'course-package.tar', { type: 'application/x-tar' })
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('bundle').buffer,
    })

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Temporary import failure' }, false))
    fireEvent.change(fileInput!, { target: { files: [file] } })
    expect(await screen.findByText('Temporary import failure')).toBeInTheDocument()

    fetchMock.mockResolvedValueOnce(jsonResponse({ blueprint: blueprintDetail }))
    fireEvent.change(fileInput!, { target: { files: [file] } })

    await waitFor(() => {
      const importCalls = fetchMock.mock.calls.filter(([url]) => (
        String(url) === '/api/teacher/course-blueprints/import'
      ))
      expect(importCalls).toHaveLength(2)
    })
    const importCalls = fetchMock.mock.calls.filter(([url]) => (
      String(url) === '/api/teacher/course-blueprints/import'
    ))
    expect((importCalls[0][1]?.headers as Record<string, string>)['Idempotency-Key']).toBe(
      (importCalls[1][1]?.headers as Record<string, string>)['Idempotency-Key'],
    )
  })

  it('normalizes JSON retry identity and resets it after changed content and success', async () => {
    const view = render(<TeacherBlueprintsPage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument()
    })

    const fetchMock = vi.mocked(fetch)
    const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    const bundle = { manifest: { version: '5', title: 'Imported course' }, files: {} }
    const changedBundle = { manifest: { version: '5', title: 'Changed course' }, files: {} }
    const createJsonFile = (contents: unknown, formatted = false) => {
      const file = new File([], 'course-package.json', { type: 'application/json' })
      Object.defineProperty(file, 'text', {
        value: async () => JSON.stringify(contents, null, formatted ? 2 : undefined),
      })
      return file
    }
    const importCalls = () => fetchMock.mock.calls.filter(([url]) => (
      String(url) === '/api/teacher/course-blueprints/import'
    ))
    const importFile = async (file: File, response: Response, expectedCalls: number) => {
      fetchMock.mockResolvedValueOnce(response)
      fireEvent.change(fileInput!, { target: { files: [file] } })
      await waitFor(() => expect(importCalls()).toHaveLength(expectedCalls))
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Import Course Package' })).not.toBeDisabled()
      })
    }

    await importFile(
      createJsonFile(bundle, true),
      jsonResponse({ error: 'Temporary import failure' }, false),
      1,
    )
    await importFile(
      createJsonFile(bundle),
      jsonResponse({ error: 'Temporary import failure' }, false),
      2,
    )
    await importFile(
      createJsonFile(changedBundle),
      jsonResponse({ blueprint: blueprintDetail }),
      3,
    )
    await importFile(
      createJsonFile(changedBundle),
      jsonResponse({ blueprint: blueprintDetail }),
      4,
    )

    const calls = importCalls()
    const keys = calls.map(([, init]) => (
      (init?.headers as Record<string, string>)['Idempotency-Key']
    ))
    expect(calls[0][1]?.body).toBe(JSON.stringify(bundle))
    expect(calls[1][1]?.body).toBe(JSON.stringify(bundle))
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[1])
    expect(keys[3]).not.toBe(keys[2])
  })

  it('disables package import while the current request is pending', async () => {
    let resolveImport!: (response: Response) => void
    const pendingImport = new Promise<Response>((resolve) => {
      resolveImport = resolve
    })
    const view = render(<TeacherBlueprintsPage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument()
    })

    const fetchMock = vi.mocked(fetch)
    const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]')
    const file = new File(['bundle'], 'course-package.tar', { type: 'application/x-tar' })
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('bundle').buffer,
    })
    fetchMock.mockReturnValueOnce(pendingImport)

    fireEvent.change(fileInput!, { target: { files: [file] } })

    expect(await screen.findByRole('button', { name: 'Importing Course Package...' })).toBeDisabled()
    fireEvent.change(fileInput!, { target: { files: [file] } })
    expect(fetchMock.mock.calls.filter(([url]) => (
      String(url) === '/api/teacher/course-blueprints/import'
    ))).toHaveLength(1)

    await act(async () => {
      resolveImport(jsonResponse({ error: 'Temporary import failure' }, false))
    })
    expect(await screen.findByRole('button', { name: 'Import Course Package' })).not.toBeDisabled()
  })

  it('clears the previous editor until an imported Blueprint detail loads', async () => {
    let resolveImportedDetail!: (response: Response) => void
    const pendingImportedDetail = new Promise<Response>((resolve) => {
      resolveImportedDetail = resolve
    })
    const defaultFetch = vi.mocked(fetch).getMockImplementation()
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      if (url === '/api/teacher/course-blueprints/import' && method === 'POST') {
        return Promise.resolve(jsonResponse({ blueprint: blueprintOneDetail }))
      }
      if (url === '/api/teacher/course-blueprints/b-1' && method === 'GET') {
        return pendingImportedDetail
      }
      return defaultFetch!(input, init)
    })

    const view = render(<TeacherBlueprintsPage />)
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument())

    const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]')
    const file = new File(['bundle'], 'course-package.tar', { type: 'application/x-tar' })
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('bundle').buffer,
    })
    fireEvent.change(fileInput!, { target: { files: [file] } })

    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull())
    expect(screen.queryByRole('button', { name: 'Save Details' })).toBeNull()

    await act(async () => {
      resolveImportedDetail(jsonResponse({ blueprint: blueprintOneDetail }))
    })
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint One')).toBeInTheDocument())
  })

  it('ignores an older Blueprint list response after import reloads the list', async () => {
    let resolveInitialList!: (response: Response) => void
    const pendingInitialList = new Promise<Response>((resolve) => {
      resolveInitialList = resolve
    })
    let listRequestCount = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      if (url === '/api/auth/me') {
        return Promise.resolve(jsonResponse({ user: { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' } }))
      }
      if (url === '/api/teacher/course-blueprints' && method === 'GET') {
        listRequestCount += 1
        return listRequestCount === 1
          ? pendingInitialList
          : Promise.resolve(jsonResponse({ blueprints: blueprintList }))
      }
      if (url === '/api/teacher/course-blueprints/import' && method === 'POST') {
        return Promise.resolve(jsonResponse({ blueprint: blueprintOneDetail }))
      }
      if (url === '/api/teacher/course-blueprints/b-1' && method === 'GET') {
        return Promise.resolve(jsonResponse({ blueprint: blueprintOneDetail }))
      }
      if (url === '/api/teacher/course-blueprints/b-2' && method === 'GET') {
        return Promise.resolve(jsonResponse({ blueprint: blueprintDetail }))
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as any)

    const view = render(<TeacherBlueprintsPage />)
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Import Course Package' })).not.toBeDisabled()

    const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]')
    const file = new File(['bundle'], 'course-package.tar', { type: 'application/x-tar' })
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('bundle').buffer,
    })
    fireEvent.change(fileInput!, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByDisplayValue('Blueprint One')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Blueprint One/ })).toBeInTheDocument()

    await act(async () => {
      resolveInitialList(jsonResponse({ blueprints: [blueprintList[1]] }))
      await pendingInitialList
    })

    expect(screen.getByDisplayValue('Blueprint One')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Blueprint One/ })).toBeInTheDocument()
  })

  it('clears the previous editor until a newly created Blueprint detail loads', async () => {
    let resolveCreatedDetail!: (response: Response) => void
    const pendingCreatedDetail = new Promise<Response>((resolve) => {
      resolveCreatedDetail = resolve
    })
    const defaultFetch = vi.mocked(fetch).getMockImplementation()
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/teacher/course-blueprints/b-1' && (init?.method || 'GET') === 'GET') {
        return pendingCreatedDetail
      }
      return defaultFetch!(input, init)
    })

    render(<TeacherBlueprintsPage />)
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New Course Blueprint' }))
    fireEvent.click(screen.getByRole('button', { name: 'Complete Blueprint creation' }))

    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull())
    expect(screen.queryByRole('button', { name: 'Save Details' })).toBeNull()

    await act(async () => {
      resolveCreatedDetail(jsonResponse({ blueprint: blueprintOneDetail }))
    })
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint One')).toBeInTheDocument())
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

  it('ignores an older proposal response after returning to the same Blueprint', async () => {
    let resolveOlderProposals!: (response: Response) => void
    const olderProposals = new Promise<Response>((resolve) => {
      resolveOlderProposals = resolve
    })
    let blueprintTwoProposalRequests = 0
    const defaultFetch = vi.mocked(fetch).getMockImplementation()
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      if (url === '/api/teacher/course-blueprints/b-2/proposals' && method === 'GET') {
        blueprintTwoProposalRequests += 1
        return blueprintTwoProposalRequests === 1
          ? olderProposals
          : Promise.resolve(jsonResponse({ proposals: [proposalFixture('newer', 22)] }))
      }
      if (url === '/api/teacher/course-blueprints/b-1/proposals' && method === 'GET') {
        return Promise.resolve(jsonResponse({ proposals: [] }))
      }
      return defaultFetch!(input, init)
    })

    render(<TeacherBlueprintsPage />)
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Blueprint One/ }))
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint One')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Blueprint Two/ }))
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^Proposals/ }))

    expect(await screen.findByText(/based on Blueprint revision 22/)).toBeInTheDocument()

    await act(async () => {
      resolveOlderProposals(jsonResponse({ proposals: [proposalFixture('older', 11)] }))
      await olderProposals
    })

    expect(screen.getByText(/based on Blueprint revision 22/)).toBeInTheDocument()
    expect(screen.queryByText(/based on Blueprint revision 11/)).toBeNull()
  })

  it('ignores an older classroom comparison after starting a newer one', async () => {
    let resolveOlderSuggestions!: (response: Response) => void
    const olderSuggestions = new Promise<Response>((resolve) => {
      resolveOlderSuggestions = resolve
    })
    let suggestionRequests = 0
    const defaultFetch = vi.mocked(fetch).getMockImplementation()
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      if (
        url === '/api/teacher/course-blueprints/b-2/merge-suggestions?classroomId=c-9'
        && method === 'GET'
      ) {
        suggestionRequests += 1
        return suggestionRequests === 1
          ? olderSuggestions
          : Promise.resolve(mergeSuggestionResponse('Newer comparison'))
      }
      return defaultFetch!(input, init)
    })

    render(<TeacherBlueprintsPage />)
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Classroom Updates' }))

    const compareButton = screen.getByRole('button', {
      name: 'Save Classroom Changes to Blueprint',
    })
    fireEvent.click(compareButton)
    await waitFor(() => expect(compareButton).toBeDisabled())

    fireEvent.change(screen.getByRole('combobox', { name: 'Classroom' }), {
      target: { value: '' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Classroom' }), {
      target: { value: 'c-9' },
    })
    fireEvent.click(compareButton)

    expect(await screen.findByText('Newer comparison')).toBeInTheDocument()

    await act(async () => {
      resolveOlderSuggestions(mergeSuggestionResponse('Older comparison'))
      await olderSuggestions
    })

    expect(screen.getByText('Newer comparison')).toBeInTheDocument()
    expect(screen.queryByText('Older comparison')).toBeNull()
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

  it('preserves an unsaved Outline while saving course details', async () => {
    render(<TeacherBlueprintsPage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Outline' }))
    const outline = screen.getByRole('textbox', { name: 'Outline Markdown' })
    fireEvent.change(outline, { target: { value: 'Unsaved revised outline' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Updated Blueprint Two' },
    })

    expect(screen.getByRole('status')).toHaveTextContent('Unsaved')
    fireEvent.click(screen.getByRole('button', { name: 'Save Details' }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/teacher/course-blueprints/b-2',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('Updated Blueprint Two'),
        }),
      )
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Details' })).not.toBeDisabled())
    expect(screen.getByRole('textbox', { name: 'Outline Markdown' })).toHaveValue('Unsaved revised outline')
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved')
  })

  it('locks editor writes while a save can replace accepted server state', async () => {
    let resolveSave!: (response: Response) => void
    const pendingSave = new Promise<Response>((resolve) => {
      resolveSave = resolve
    })
    const defaultFetch = vi.mocked(fetch).getMockImplementation()
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/teacher/course-blueprints/b-2' && init?.method === 'PATCH') {
        return pendingSave
      }
      return defaultFetch!(input, init)
    })

    render(<TeacherBlueprintsPage />)
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Classroom Updates' }))

    const title = screen.getByRole('textbox', { name: 'Title' })
    fireEvent.change(title, { target: { value: 'Saving Blueprint Two' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Details' }))

    await waitFor(() => expect(title).toBeDisabled())
    expect(screen.getByRole('button', { name: /Blueprint One/ })).toBeDisabled()
    expect(screen.getByRole('button', {
      name: 'Update Classroom from Blueprint',
    })).toBeDisabled()

    await act(async () => {
      resolveSave(jsonResponse({ blueprint: blueprintDetail }))
    })
    await waitFor(() => expect(title).not.toBeDisabled())
  })

  it('clears the saved section without changing its accepted server value', async () => {
    let serverDetail = blueprintDetail
    const defaultFetch = vi.mocked(fetch).getMockImplementation()
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      if (url === '/api/teacher/course-blueprints/b-2' && method === 'PATCH') {
        const updates = JSON.parse(String(init?.body || '{}'))
        serverDetail = { ...serverDetail, ...updates }
        return Promise.resolve(jsonResponse({ blueprint: serverDetail }))
      }
      if (url === '/api/teacher/course-blueprints/b-2' && method === 'GET') {
        return Promise.resolve(jsonResponse({ blueprint: serverDetail }))
      }
      return defaultFetch!(input, init)
    })

    render(<TeacherBlueprintsPage />)
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument())

    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Updated Blueprint Two' },
    })
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved')

    fireEvent.click(screen.getByRole('button', { name: 'Save Details' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'))
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Updated Blueprint Two')
  })

  it('keeps editing or explicitly discards changes before switching Blueprints', async () => {
    render(<TeacherBlueprintsPage />)
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument())

    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Unsaved title' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Blueprint One/ }))

    expect(screen.getByRole('dialog', { name: 'Switch Course Blueprints?' })).toBeInTheDocument()
    expect(screen.getByText(/Unsaved sections: course details/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Unsaved title')

    fireEvent.click(screen.getByRole('button', { name: /Blueprint One/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard and switch' }))
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint One')).toBeInTheDocument())
  })

  it('requires confirmation before creating a classroom from the saved version', async () => {
    render(<TeacherBlueprintsPage />)
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument())

    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Unsaved title' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Use for Classroom' }))

    expect(screen.getByRole('dialog', { name: 'Use the saved Blueprint?' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Create Classroom' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Use saved version' }))
    expect(screen.getByRole('dialog', { name: 'Create Classroom' })).toBeInTheDocument()
  })

  it('opens a newly created classroom on the combined Daily surface', async () => {
    render(<TeacherBlueprintsPage />)
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Use for Classroom' }))
    fireEvent.click(screen.getByRole('button', { name: 'Complete Classroom creation' }))

    expect(mockPush).toHaveBeenCalledWith('/classrooms/classroom-new?tab=daily')
  })

  it('requires confirmation before preparing a classroom update from the saved version', async () => {
    const defaultFetch = vi.mocked(fetch).getMockImplementation()
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      if (
        url === '/api/teacher/course-blueprints/b-2/proposals/classrooms'
        && method === 'POST'
      ) {
        return Promise.resolve(jsonResponse({ proposal: proposalFixture('classroom-update', 4) }))
      }
      if (url === '/api/teacher/course-blueprints/b-2/proposals' && method === 'GET') {
        return Promise.resolve(jsonResponse({ proposals: [] }))
      }
      return defaultFetch!(input, init)
    })

    render(<TeacherBlueprintsPage />)
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument())

    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Unsaved title' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Classroom Updates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update Classroom from Blueprint' }))

    expect(screen.getByRole('dialog', {
      name: 'Update the Classroom from the saved Blueprint?',
    })).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalledWith(
      '/api/teacher/course-blueprints/b-2/proposals/classrooms',
      expect.objectContaining({ method: 'POST' }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Use saved version' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/teacher/course-blueprints/b-2/proposals/classrooms',
      expect.objectContaining({ method: 'POST' }),
    ))
  })

  it('prevents Blueprint switching while a classroom update proposal is pending', async () => {
    let resolveProposal!: (response: Response) => void
    const pendingProposal = new Promise<Response>((resolve) => {
      resolveProposal = resolve
    })
    const defaultFetch = vi.mocked(fetch).getMockImplementation()
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      if (
        url === '/api/teacher/course-blueprints/b-2/proposals/classrooms'
        && method === 'POST'
      ) {
        return pendingProposal
      }
      if (url === '/api/teacher/course-blueprints/b-2/proposals' && method === 'GET') {
        return Promise.resolve(jsonResponse({ proposals: [] }))
      }
      return defaultFetch!(input, init)
    })

    render(<TeacherBlueprintsPage />)
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Classroom Updates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update Classroom from Blueprint' }))

    const blueprintOne = screen.getByRole('button', { name: /Blueprint One/ })
    await waitFor(() => expect(blueprintOne).toBeDisabled())
    fireEvent.click(blueprintOne)
    expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument()

    await act(async () => {
      resolveProposal(jsonResponse({ proposal: proposalFixture('classroom-update', 4) }))
      await pendingProposal
    })

    await waitFor(() => expect(blueprintOne).not.toBeDisabled())
    expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument()
  })

  it('registers unload protection only while the Blueprint has unsaved changes', async () => {
    render(<TeacherBlueprintsPage />)
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument())

    const cleanUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(cleanUnload)
    expect(cleanUnload.defaultPrevented).toBe(false)

    const title = screen.getByRole('textbox', { name: 'Title' })
    fireEvent.change(title, { target: { value: 'Unsaved title' } })
    const dirtyUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirtyUnload)
    expect(dirtyUnload.defaultPrevented).toBe(true)

    fireEvent.change(title, { target: { value: 'Blueprint Two' } })
    const revertedUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(revertedUnload)
    expect(revertedUnload.defaultPrevented).toBe(false)
  })

  it('warns about linked classrooms before deleting the selected Blueprint', async () => {
    render(<TeacherBlueprintsPage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))

    expect(screen.getByRole('dialog', { name: 'Delete Blueprint Two?' })).toBeInTheDocument()
    expect(screen.getByText(
      'Linked Classrooms are kept, but their Blueprint connection is removed. This cannot be undone.',
    )).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm permanent deletion' }))
    expect(invalidateCachedJSONMatching).toHaveBeenCalledWith('teacher-blueprints:')
    expect(mockPush).toHaveBeenCalledWith('/teacher/blueprints')

    await waitFor(() => {
      expect(screen.getByDisplayValue('Blueprint One')).toBeInTheDocument()
    })
  })

  it('keeps editing or explicitly discards changes before opening permanent deletion', async () => {
    render(<TeacherBlueprintsPage />)
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument())

    const title = screen.getByRole('textbox', { name: 'Title' })
    fireEvent.change(title, { target: { value: 'Unsaved title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))

    expect(screen.getByRole('dialog', { name: 'Delete this Course Blueprint?' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Delete Blueprint Two?' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(title).toHaveValue('Unsaved title')

    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard and review deletion' }))
    expect(screen.getByRole('dialog', { name: 'Delete Blueprint Two?' })).toBeInTheDocument()
  })

  it('ignores a pre-purge list response after authoritative deletion reload', async () => {
    let resolvePrePurgeList!: (response: Response) => void
    const pendingPrePurgeList = new Promise<Response>((resolve) => {
      resolvePrePurgeList = resolve
    })
    let listRequestCount = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      if (url === '/api/auth/me') {
        return Promise.resolve(jsonResponse({ user: { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' } }))
      }
      if (url === '/api/teacher/course-blueprints' && method === 'GET') {
        listRequestCount += 1
        return listRequestCount === 1
          ? pendingPrePurgeList
          : Promise.resolve(jsonResponse({ blueprints: [blueprintList[0]] }))
      }
      if (url === '/api/teacher/course-blueprints/b-1' && method === 'GET') {
        return Promise.resolve(jsonResponse({ blueprint: blueprintOneDetail }))
      }
      if (url === '/api/teacher/course-blueprints/b-2' && method === 'GET') {
        return Promise.resolve(jsonResponse({ blueprint: blueprintDetail }))
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as any)

    render(<TeacherBlueprintsPage />)
    await waitFor(() => expect(screen.getByDisplayValue('Blueprint Two')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm permanent deletion' }))

    await waitFor(() => expect(screen.getByDisplayValue('Blueprint One')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Blueprint Two/ })).toBeNull()

    await act(async () => {
      resolvePrePurgeList(jsonResponse({ blueprints: blueprintList }))
      await pendingPrePurgeList
    })

    expect(screen.getByDisplayValue('Blueprint One')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Blueprint Two/ })).toBeNull()
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

    expect(screen.queryByRole('button', { name: 'Delete permanently' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()

    await act(async () => {
      resolveBlueprintOne?.(jsonResponse({ blueprint: blueprintOneDetail }))
      await delayedBlueprintOne
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Delete permanently' }))
    expect(screen.getByRole('dialog', { name: 'Delete Blueprint One?' })).toBeInTheDocument()
    expect(screen.getByText(
      'Linked Classrooms are kept, but their Blueprint connection is removed. This cannot be undone.',
    )).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm permanent deletion' }))
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
    expect(screen.queryByRole('button', { name: 'Delete permanently' })).toBeNull()
  })
})
