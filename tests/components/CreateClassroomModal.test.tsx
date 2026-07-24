import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { CreateClassroomModal } from '@/components/CreateClassroomModal'
import { fetchTeacherBlueprints, invalidateTeacherBlueprints } from '@/lib/teacher-blueprints-client'
import type { CourseBlueprint } from '@/types'

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

  it('invalidates blueprint caches after creating a classroom from a blueprint', async () => {
    const onSuccess = vi.fn()
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      if (url === `/api/teacher/course-blueprints/${mockBlueprint.id}/instantiate` && method === 'POST') {
        return {
          ok: true,
          json: async () => ({ classroom: { id: 'classroom-1', title: 'Computer Science 11 - Period 2' } }),
        }
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    renderModal({ initialBlueprintId: mockBlueprint.id, onSuccess })

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
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(invalidateTeacherBlueprints).toHaveBeenCalledOnce()
    expect(onSuccess).toHaveBeenCalledWith({ id: 'classroom-1', title: 'Computer Science 11 - Period 2' })
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
