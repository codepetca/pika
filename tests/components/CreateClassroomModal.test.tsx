import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
import { fetchTeacherBlueprints, invalidateTeacherBlueprints } from '@/lib/teacher-blueprints-client'
import type { CourseBlueprint } from '@/types'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/lib/teacher-blueprints-client', () => ({
  fetchTeacherBlueprints: vi.fn(),
  invalidateTeacherBlueprints: vi.fn(),
}))

vi.mock('@/lib/teacher-classrooms-client', () => ({
  invalidateTeacherClassrooms: vi.fn(),
}))

const mockBlueprint: CourseBlueprint = {
  id: 'bp-1',
  teacher_id: 'teacher-1',
  title: 'Computer Science 11',
  subject: 'Computer Science',
  grade_level: 'Grade 11',
  course_code: 'ICS3U',
  term_template: 'Semester 1',
  overview_markdown: '',
  outline_markdown: '',
  resources_markdown: '',
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
  position: 0,
  created_at: '2026-04-21T12:00:00Z',
  updated_at: '2026-04-21T12:00:00Z',
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

describe('CreateClassroomModal', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ blueprints: [mockBlueprint] }),
    })
    vi.mocked(fetchTeacherBlueprints).mockResolvedValue([mockBlueprint])
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(fetchTeacherBlueprints).mockClear()
    vi.mocked(invalidateTeacherBlueprints).mockClear()
    mockPush.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function renderModal(props?: Partial<ComponentProps<typeof CreateClassroomModal>>) {
    return render(
      <CreateClassroomModal
        isOpen
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        {...props}
      />
    )
  }

  function getClassroomNameInput() {
    return screen.getByRole('textbox', { name: /classroom name/i })
  }

  function getBlueprintSelect() {
    return screen.getByRole('combobox', { name: /course blueprint/i })
  }

  async function openBlueprintSourceStep(title = 'Career Studies - Period 1') {
    fireEvent.change(getClassroomNameInput(), {
      target: { value: title },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Choose classroom creation path' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'From Course Blueprint' }))
  }

  it('keeps the primary Next path as a blank-classroom flow', async () => {
    renderModal()

    await waitFor(() => {
      expect(fetchTeacherBlueprints).toHaveBeenCalledOnce()
    })

    fireEvent.change(getClassroomNameInput(), {
      target: { value: 'Career Studies - Period 1' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Choose Calendar')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /course blueprint/i })).not.toBeInTheDocument()
  })

  it('routes From Blueprint through a separate source step before calendar selection', async () => {
    renderModal()

    await openBlueprintSourceStep()

    expect(await screen.findByRole('combobox', { name: /course blueprint/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    fireEvent.change(getBlueprintSelect(), {
      target: { value: mockBlueprint.id },
    })

    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Choose Calendar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).not.toBeDisabled()
  })

  it('switches to file loading when no saved blueprints exist', async () => {
    vi.mocked(fetchTeacherBlueprints).mockResolvedValueOnce([])

    renderModal()
    await openBlueprintSourceStep()

    expect(screen.getByRole('combobox', { name: /course blueprint/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('ignores stale blueprint loads after closing and reopening', async () => {
    const firstLoad = createDeferred<CourseBlueprint[]>()
    const secondLoad = createDeferred<CourseBlueprint[]>()
    vi.mocked(fetchTeacherBlueprints)
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise)

    const props = { onClose: vi.fn(), onSuccess: vi.fn() }
    const view = render(<CreateClassroomModal isOpen {...props} />)

    expect(fetchTeacherBlueprints).toHaveBeenCalledOnce()
    view.rerender(<CreateClassroomModal isOpen={false} {...props} />)
    view.rerender(<CreateClassroomModal isOpen {...props} />)
    expect(fetchTeacherBlueprints).toHaveBeenCalledTimes(2)

    await act(async () => {
      secondLoad.resolve([mockBlueprint])
    })

    await openBlueprintSourceStep()
    expect(await screen.findByRole('option', { name: mockBlueprint.title })).toBeInTheDocument()

    await act(async () => {
      firstLoad.resolve([])
    })
    expect(screen.getByRole('option', { name: mockBlueprint.title })).toBeInTheDocument()
  })

  it('keeps an imported blueprint when the initial blueprint load resolves late', async () => {
    const initialLoad = createDeferred<CourseBlueprint[]>()
    vi.mocked(fetchTeacherBlueprints).mockReturnValueOnce(initialLoad.promise)
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/teacher/course-blueprints/import') {
        return {
          ok: true,
          json: async () => ({ blueprint: mockBlueprint }),
        }
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    renderModal()
    await openBlueprintSourceStep()

    const fileInput = screen.getByLabelText('Import course package file')
    const file = new File(['bundle'], 'course-package.tar', { type: 'application/x-tar' })
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('bundle').buffer,
    })

    fireEvent.change(getBlueprintSelect(), { target: { value: '__choose-file__' } })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(getBlueprintSelect()).toHaveValue(mockBlueprint.id)
    })

    await act(async () => {
      initialLoad.resolve([])
    })

    expect(getBlueprintSelect()).toHaveValue(mockBlueprint.id)
    expect(screen.getByRole('option', { name: mockBlueprint.title })).toBeInTheDocument()
  })

  it('loads a blueprint file in the source step before moving to calendar', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/teacher/course-blueprints/import') {
        return {
          ok: true,
          json: async () => ({ blueprint: mockBlueprint }),
        }
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.mocked(fetchTeacherBlueprints).mockResolvedValueOnce([])

    renderModal()
    await openBlueprintSourceStep()

    const fileInput = screen.getByLabelText('Import course package file')
    const file = new File(['bundle'], 'course-package.tar', { type: 'application/x-tar' })
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('bundle').buffer,
    })
    expect(screen.getByRole('option', { name: 'Import course package...' })).toBeInTheDocument()

    fireEvent.change(getBlueprintSelect(), { target: { value: '__choose-file__' } })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(getBlueprintSelect()).toHaveValue(mockBlueprint.id)
    })
    expect(invalidateTeacherBlueprints).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Choose Calendar')).toBeInTheDocument()
  })

  it('sends a caller idempotency key when importing a JSON course package', async () => {
    const bundle = { manifest: { version: '5', title: 'Imported course' }, files: {} }
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ blueprint: mockBlueprint }),
    })

    renderModal()
    await openBlueprintSourceStep()

    const fileInput = screen.getByLabelText('Import course package file')
    const file = new File([JSON.stringify(bundle)], 'course-package.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', {
      value: async () => JSON.stringify(bundle, null, 2),
    })

    fireEvent.change(getBlueprintSelect(), { target: { value: '__choose-file__' } })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(getBlueprintSelect()).toHaveValue(mockBlueprint.id))
    expect(fetchMock).toHaveBeenCalledWith('/api/teacher/course-blueprints/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': expect.any(String),
      },
      body: JSON.stringify(bundle),
    })
  })

  it('reuses the import key for semantically unchanged JSON retries', async () => {
    const bundle = { manifest: { version: '5', title: 'Imported course' }, files: {} }
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Temporary import failure' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ blueprint: mockBlueprint }),
      })

    renderModal()
    await openBlueprintSourceStep()

    const fileInput = screen.getByLabelText('Import course package file')
    const formattedFile = new File([], 'course-package.json', { type: 'application/json' })
    Object.defineProperty(formattedFile, 'text', {
      value: async () => JSON.stringify(bundle, null, 2),
    })
    const compactFile = new File([], 'course-package.json', { type: 'application/json' })
    Object.defineProperty(compactFile, 'text', {
      value: async () => JSON.stringify(bundle),
    })

    for (const [file, expectedCalls] of [[formattedFile, 1], [compactFile, 2]] as const) {
      fireEvent.change(getBlueprintSelect(), { target: { value: '__choose-file__' } })
      fireEvent.change(fileInput, { target: { files: [file] } })
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(expectedCalls))
    }

    const importCalls = fetchMock.mock.calls.filter(([url]) => (
      String(url) === '/api/teacher/course-blueprints/import'
    ))
    expect((importCalls[0][1]?.headers as Record<string, string>)['Idempotency-Key']).toBe(
      (importCalls[1][1]?.headers as Record<string, string>)['Idempotency-Key'],
    )
  })

  it('reuses the import key for unchanged archive retries and replaces it for changed bytes', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Temporary import failure' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Temporary import failure' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ blueprint: mockBlueprint }),
      })

    renderModal()
    await openBlueprintSourceStep()

    const fileInput = screen.getByLabelText('Import course package file')
    const originalFile = new File(['original'], 'course-package.tar', { type: 'application/x-tar' })
    Object.defineProperty(originalFile, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('original').buffer,
    })
    const changedFile = new File(['changed'], 'course-package.tar', { type: 'application/x-tar' })
    Object.defineProperty(changedFile, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('changed').buffer,
    })

    for (const [file, expectedCalls] of [
      [originalFile, 1],
      [originalFile, 2],
      [changedFile, 3],
    ] as const) {
      fireEvent.change(getBlueprintSelect(), { target: { value: '__choose-file__' } })
      fireEvent.change(fileInput, { target: { files: [file] } })
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(expectedCalls))
    }

    await waitFor(() => expect(getBlueprintSelect()).toHaveValue(mockBlueprint.id))
    const importCalls = fetchMock.mock.calls.filter(([url]) => (
      String(url) === '/api/teacher/course-blueprints/import'
    ))
    const firstKey = (importCalls[0][1]?.headers as Record<string, string>)['Idempotency-Key']
    const secondKey = (importCalls[1][1]?.headers as Record<string, string>)['Idempotency-Key']
    const changedKey = (importCalls[2][1]?.headers as Record<string, string>)['Idempotency-Key']

    expect(firstKey).toBe(secondKey)
    expect(changedKey).not.toBe(secondKey)
  })

  it('clears the import key after a successful package import', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ blueprint: mockBlueprint }),
    })

    renderModal()
    await openBlueprintSourceStep()

    const fileInput = screen.getByLabelText('Import course package file')
    const file = new File(['bundle'], 'course-package.tar', { type: 'application/x-tar' })
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('bundle').buffer,
    })

    for (const expectedCalls of [1, 2]) {
      fireEvent.change(getBlueprintSelect(), { target: { value: '__choose-file__' } })
      fireEvent.change(fileInput, { target: { files: [file] } })
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(expectedCalls))
    }

    const importCalls = fetchMock.mock.calls.filter(([url]) => (
      String(url) === '/api/teacher/course-blueprints/import'
    ))
    expect((importCalls[0][1]?.headers as Record<string, string>)['Idempotency-Key']).not.toBe(
      (importCalls[1][1]?.headers as Record<string, string>)['Idempotency-Key'],
    )
  })

  it('clears the import key when the wizard is cancelled after a failure', async () => {
    const onClose = vi.fn()
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Temporary import failure' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ blueprint: mockBlueprint }),
      })

    renderModal({ onClose })
    await openBlueprintSourceStep()

    const fileInput = screen.getByLabelText('Import course package file')
    const file = new File(['bundle'], 'course-package.tar', { type: 'application/x-tar' })
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode('bundle').buffer,
    })

    fireEvent.change(fileInput, { target: { files: [file] } })
    expect(await screen.findByText('Temporary import failure')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()

    await openBlueprintSourceStep()
    fireEvent.change(screen.getByLabelText('Import course package file'), { target: { files: [file] } })
    await waitFor(() => expect(getBlueprintSelect()).toHaveValue(mockBlueprint.id))

    const importCalls = fetchMock.mock.calls.filter(([url]) => (
      String(url) === '/api/teacher/course-blueprints/import'
    ))
    expect((importCalls[0][1]?.headers as Record<string, string>)['Idempotency-Key']).not.toBe(
      (importCalls[1][1]?.headers as Record<string, string>)['Idempotency-Key'],
    )
  })

  it('shows the rollover review before completing a classroom created from a blueprint', async () => {
    const onSuccess = vi.fn()
    const onBlueprintCreated = vi.fn()
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      if (url === `/api/teacher/course-blueprints/${mockBlueprint.id}/instantiate` && method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            classroom: { id: 'classroom-1', title: 'Computer Science 11 - Period 2' },
            lesson_mapping: {
              applied_lesson_templates: 2,
              overflow_lesson_templates: ['Final project workshop'],
            },
          }),
        }
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    renderModal({ initialBlueprintId: mockBlueprint.id, onSuccess, onBlueprintCreated })

    fireEvent.change(getClassroomNameInput(), {
      target: { value: 'Computer Science 11 - Period 2' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('combobox', { name: /course blueprint/i })).toHaveValue(mockBlueprint.id)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Choose Calendar')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/teacher/course-blueprints/${mockBlueprint.id}/instantiate`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Idempotency-Key': expect.any(String),
          }),
        }),
      )
    })
    expect(invalidateTeacherBlueprints).toHaveBeenCalledOnce()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onBlueprintCreated).toHaveBeenCalledWith({
      id: 'classroom-1',
      title: 'Computer Science 11 - Period 2',
    })
    expect(screen.getByRole('heading', { name: 'Classroom Created' })).toHaveFocus()
    expect(screen.getByText(/assignments and tests are unpublished/i)).toBeInTheDocument()
    expect(screen.getByText('Final project workshop')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Review Classroom' }))
    expect(onSuccess).not.toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith('/classrooms/classroom-1?tab=assignments')
  })

  it('reuses the instantiate idempotency key when an unchanged request is retried', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Temporary failure' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          classroom: { id: 'classroom-1', title: 'Computer Science 11 - Period 2' },
          lesson_mapping: { applied_lesson_templates: 1, overflow_lesson_templates: [] },
        }),
      })

    renderModal({ initialBlueprintId: mockBlueprint.id })
    fireEvent.change(getClassroomNameInput(), {
      target: { value: 'Computer Science 11 - Period 2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('combobox', { name: /course blueprint/i })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Choose Calendar')

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Temporary failure')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('heading', { name: 'Classroom Created' })

    const instantiateCalls = fetchMock.mock.calls.filter(([url, init]) => (
      String(url) === `/api/teacher/course-blueprints/${mockBlueprint.id}/instantiate`
      && init?.method === 'POST'
    ))
    expect(instantiateCalls).toHaveLength(2)
    expect((instantiateCalls[0][1]?.headers as Record<string, string>)['Idempotency-Key']).toBe(
      (instantiateCalls[1][1]?.headers as Record<string, string>)['Idempotency-Key'],
    )
  })

  it('commits the created classroom without navigating when the review is dismissed', async () => {
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    const onBlueprintCreated = vi.fn()
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        classroom: { id: 'classroom-1', title: 'Computer Science 11 - Period 2' },
        lesson_mapping: { applied_lesson_templates: 1, overflow_lesson_templates: [] },
      }),
    })

    renderModal({ initialBlueprintId: mockBlueprint.id, onClose, onSuccess, onBlueprintCreated })
    fireEvent.change(getClassroomNameInput(), {
      target: { value: 'Computer Science 11 - Period 2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('combobox', { name: /course blueprint/i })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Choose Calendar')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('heading', { name: 'Classroom Created' })

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onBlueprintCreated).toHaveBeenCalledWith({
      id: 'classroom-1',
      title: 'Computer Science 11 - Period 2',
    })
    expect(onSuccess).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('cannot dismiss the modal while blueprint instantiation is pending', async () => {
    const instantiateResponse = createDeferred<{
      ok: boolean
      json: () => Promise<{
        classroom: { id: string; title: string }
        lesson_mapping: { applied_lesson_templates: number; overflow_lesson_templates: string[] }
      }>
    }>()
    const onClose = vi.fn()
    const onBlueprintCreated = vi.fn()
    fetchMock.mockReturnValueOnce(instantiateResponse.promise)

    renderModal({ initialBlueprintId: mockBlueprint.id, onClose, onBlueprintCreated })
    fireEvent.change(getClassroomNameInput(), {
      target: { value: 'Computer Science 11 - Period 2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('combobox', { name: /course blueprint/i })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Choose Calendar')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('button', { name: 'Creating...' })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Create Classroom' })).toBeInTheDocument()

    await act(async () => {
      instantiateResponse.resolve({
        ok: true,
        json: async () => ({
          classroom: { id: 'classroom-1', title: 'Computer Science 11 - Period 2' },
          lesson_mapping: { applied_lesson_templates: 1, overflow_lesson_templates: [] },
        }),
      })
    })

    expect(await screen.findByRole('heading', { name: 'Classroom Created' })).toBeInTheDocument()
    expect(onBlueprintCreated).toHaveBeenCalledOnce()
  })

  it('preserves the preselected blueprint flow when launched from the blueprints page', async () => {
    renderModal({ initialBlueprintId: mockBlueprint.id })

    fireEvent.change(getClassroomNameInput(), {
      target: { value: 'Computer Science 11 - Period 2' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    const blueprintSelect = await screen.findByRole('combobox', { name: /course blueprint/i })
    expect(blueprintSelect).toHaveValue(mockBlueprint.id)
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled()
  })
})
