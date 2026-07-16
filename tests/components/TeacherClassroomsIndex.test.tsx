import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TeacherClassroomsIndex } from '@/app/classrooms/TeacherClassroomsIndex'
import {
  fetchTeacherArchivedClassroomState,
  fetchTeacherClassrooms,
} from '@/lib/teacher-classrooms-client'
import { TooltipProvider } from '@/ui'
import { createMockClassroom } from '../helpers/mocks'
import type { Classroom } from '@/types'

const push = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/classrooms',
}))

vi.mock('@/lib/teacher-classrooms-client', () => ({
  fetchTeacherArchivedClassroomState: vi.fn(),
  fetchTeacherClassrooms: vi.fn(),
  invalidateTeacherClassrooms: vi.fn(),
}))

const coldArchive = {
  classroom_id: '00000000-0000-4000-8000-000000000001',
  archive_id: '00000000-0000-4000-8000-000000000002',
  title: 'Stored history classroom',
  archived_at: '2026-07-01T12:00:00.000Z',
  compacted_at: '2026-07-10T12:00:00.000Z',
}

function renderTeacherClassroomsIndex(initialClassrooms: Classroom[]) {
  return render(
    <TooltipProvider>
      <TeacherClassroomsIndex initialClassrooms={initialClassrooms} />
    </TooltipProvider>
  )
}

describe('TeacherClassroomsIndex', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn()
    push.mockReset()
    vi.mocked(fetchTeacherClassrooms).mockResolvedValue([])
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValue({
      classrooms: [],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not refetch classrooms on initial mount (#302)', async () => {
    const classrooms = [createMockClassroom({ id: 'c1', title: 'Math 101' })]
    renderTeacherClassroomsIndex(classrooms)

    // Show the server-provided data
    expect(await waitFor(() => document.querySelector('[data-testid="classroom-card"]'))).toBeTruthy()

    // Wait a tick — no fetch should have fired
    await new Promise((r) => setTimeout(r, 50))

    const classroomFetchCalls = fetchMock.mock.calls.filter(
      ([url]: [string]) => typeof url === 'string' && url === '/api/teacher/classrooms'
    )
    expect(classroomFetchCalls).toHaveLength(0)
  })

  it('themes the classroom card background without an accent border', async () => {
    const classrooms = [createMockClassroom({ id: 'c1', title: 'Math 101', theme_color: 'teal' })]
    renderTeacherClassroomsIndex(classrooms)

    const card = await screen.findByTestId('classroom-card')

    expect(card).toHaveAttribute('data-classroom-theme-color', 'teal')
    expect(card).toHaveClass('classroom-theme-card')
    expect(card).toHaveClass('classroom-theme-card-interactive')
    expect(card).toHaveClass('border')
    expect(card).not.toHaveClass('border-l-4')
  })

  it('never shows the create button in archived view', async () => {
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValueOnce({
      classrooms: [
        createMockClassroom({ id: 'archived-1', title: 'Archived', archived_at: '2026-04-01T12:00:00Z' }),
      ],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
    })

    renderTeacherClassroomsIndex([])

    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))

    expect(await screen.findByRole('button', { name: /^Archived/ })).toBeInTheDocument()
    expect(fetchTeacherArchivedClassroomState).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'New' })).not.toBeInTheDocument()
  })

  it('keeps archived classrooms restore-only and never issues classroom DELETE requests', async () => {
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValueOnce({
      classrooms: [
        createMockClassroom({ id: 'archived-1', title: 'Archived', archived_at: '2026-04-01T12:00:00Z' }),
      ],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
    })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))

    expect(await screen.findByRole('button', { name: 'Restore' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  })

  it('hides the create button after the first classroom unless edit mode is enabled', async () => {
    const classrooms = [createMockClassroom({ id: 'c1', title: 'Math 101' })]
    renderTeacherClassroomsIndex(classrooms)

    const editButton = screen.getByRole('button', { name: 'Organize classrooms' })
    const bottomControls = screen.getByTestId('classroom-bottom-controls')
    const card = screen.getByTestId('classroom-card')

    expect(bottomControls).toHaveClass('fixed', 'left-1/2', 'z-40', 'rounded-lg')
    expect(bottomControls).not.toHaveClass('bg-surface/95')
    expect(bottomControls).not.toHaveClass('py-2')
    expect(bottomControls).not.toHaveClass('pl-3')
    expect(bottomControls).not.toHaveClass('pr-1')
    expect(bottomControls).not.toHaveClass('shadow-elevated')
    expect(bottomControls).not.toHaveClass('backdrop-blur')
    expect(bottomControls.className).toContain('bottom-[calc(1rem+env(safe-area-inset-bottom))]')
    expect(bottomControls.className).toContain('max-w-[40.5rem]')
    expect(bottomControls).not.toHaveClass('rounded-card')
    expect(
      within(bottomControls).getByRole('button', { name: 'Organize classrooms' })
    ).toBe(editButton)
    expect(card.compareDocumentPosition(editButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New' })).not.toBeInTheDocument()

    fireEvent.click(editButton)

    const newButton = screen.getByRole('button', { name: 'New' })
    expect(card.compareDocumentPosition(newButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the classroom view toggle only while classroom edit mode is enabled', async () => {
    const classrooms = [createMockClassroom({ id: 'c1', title: 'Math 101' })]
    renderTeacherClassroomsIndex(classrooms)

    expect(screen.queryByRole('button', { name: 'Active' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archived' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Drag to reorder Math 101' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive Math 101' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))

    const activeButton = screen.getByRole('button', { name: 'Active' })
    const archivedButton = screen.getByRole('button', { name: 'Archived' })

    expect(activeButton).toBeInTheDocument()
    expect(archivedButton).toBeInTheDocument()
    expect(activeButton).not.toHaveAttribute('title')
    expect(archivedButton).not.toHaveAttribute('title')
    expect(screen.getByRole('button', { name: 'Drag to reorder Math 101' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Archive Math 101' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))

    expect(screen.queryByRole('button', { name: 'Active' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archived' })).not.toBeInTheDocument()
  })

  it('returns to active view when edit mode is turned off from archived view', async () => {
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValueOnce({
      classrooms: [
        createMockClassroom({ id: 'archived-1', title: 'Archived', archived_at: '2026-04-01T12:00:00Z' }),
      ],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
    })

    renderTeacherClassroomsIndex([])

    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    expect(await screen.findByRole('button', { name: /^Archived/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))

    expect(screen.queryByRole('group', { name: 'Classroom view' })).not.toBeInTheDocument()
    expect(screen.getByText('Create your first classroom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))

    expect(
      within(screen.getByRole('group', { name: 'Classroom view' })).getByRole('button', { name: 'Active' })
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('turns classroom edit mode off when Escape is pressed', async () => {
    const classrooms = [createMockClassroom({ id: 'c1', title: 'Math 101' })]
    renderTeacherClassroomsIndex(classrooms)

    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    expect(screen.getByRole('button', { name: 'Archive Math 101' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('button', { name: 'Archive Math 101' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Organize classrooms' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('turns classroom edit mode off when the page is restored', async () => {
    const classrooms = [createMockClassroom({ id: 'c1', title: 'Math 101' })]
    renderTeacherClassroomsIndex(classrooms)

    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    expect(screen.getByRole('button', { name: 'Archive Math 101' })).toBeInTheDocument()

    fireEvent(window, new Event('pageshow'))

    expect(screen.queryByRole('button', { name: 'Archive Math 101' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Organize classrooms' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('does not show a Blueprints button in the classroom action bar', async () => {
    renderTeacherClassroomsIndex([])

    expect(screen.queryByRole('button', { name: 'Blueprints' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument()
  })

  it('shows immediate feedback while opening a classroom', async () => {
    const classrooms = [createMockClassroom({ id: 'c1', title: 'Math 101' })]
    renderTeacherClassroomsIndex(classrooms)

    const openButton = screen.getByRole('button', { name: /^Math 101/ })
    fireEvent.click(openButton)

    expect(push).toHaveBeenCalledWith('/classrooms/c1?tab=attendance')
    expect(openButton).toBeDisabled()
    expect(screen.getByText('Opening classroom...')).toBeInTheDocument()
  })

  it('prevents opening another classroom while navigation is pending', async () => {
    const classrooms = [
      createMockClassroom({ id: 'c1', title: 'Math 101' }),
      createMockClassroom({ id: 'c2', title: 'Science 101' }),
    ]
    renderTeacherClassroomsIndex(classrooms)

    fireEvent.click(screen.getByRole('button', { name: /^Math 101/ }))

    expect(screen.getByRole('button', { name: /^Science 101/ })).toBeDisabled()
  })

  it('shows stored classrooms while keeping restore disabled when recovery is not enabled', async () => {
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValueOnce({
      classrooms: [],
      coldArchives: [coldArchive],
      coldArchiveRestoreEnabled: false,
    })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))

    expect(await screen.findByText('Stored history classroom')).toBeInTheDocument()
    expect(screen.getByText('Stored archive')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled()
  })

  it('restores a stored classroom with an idempotency key and refreshes the archived list', async () => {
    const operationId = '00000000-0000-4000-8000-000000000003'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(operationId)
    vi.mocked(fetchTeacherArchivedClassroomState)
      .mockResolvedValueOnce({
        classrooms: [],
        coldArchives: [coldArchive],
        coldArchiveRestoreEnabled: true,
      })
      .mockResolvedValueOnce({
        classrooms: [createMockClassroom({
          id: coldArchive.classroom_id,
          title: coldArchive.title,
          archived_at: coldArchive.archived_at,
        })],
        coldArchives: [],
        coldArchiveRestoreEnabled: true,
      })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/teacher/classrooms/${coldArchive.classroom_id}/archives/${coldArchive.archive_id}/restore`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': operationId },
      },
    ))
    await waitFor(() => expect(fetchTeacherArchivedClassroomState).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(coldArchive.title)).toBeInTheDocument()
  })

  it('reuses the same idempotency key when a stored restore is retried', async () => {
    const operationId = '00000000-0000-4000-8000-000000000004'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(operationId)
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValue({
      classrooms: [],
      coldArchives: [coldArchive],
      coldArchiveRestoreEnabled: true,
    })
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Temporary restore failure' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }))
    expect(await screen.findByText('Temporary restore failure')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      method: 'POST',
      headers: { 'Idempotency-Key': operationId },
    })
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({
      method: 'POST',
      headers: { 'Idempotency-Key': operationId },
    })
    expect(crypto.randomUUID).toHaveBeenCalledOnce()
  })

  it('retains the idempotency key until the restored archive list refreshes', async () => {
    const operationId = '00000000-0000-4000-8000-000000000005'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(operationId)
    vi.mocked(fetchTeacherArchivedClassroomState)
      .mockResolvedValueOnce({
        classrooms: [],
        coldArchives: [coldArchive],
        coldArchiveRestoreEnabled: true,
      })
      .mockRejectedValueOnce(new Error('Failed to refresh archived classrooms'))
      .mockResolvedValueOnce({
        classrooms: [createMockClassroom({
          id: coldArchive.classroom_id,
          title: coldArchive.title,
          archived_at: coldArchive.archived_at,
        })],
        coldArchives: [],
        coldArchiveRestoreEnabled: true,
      })
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }))
    expect(await screen.findByText('Failed to refresh archived classrooms')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(fetchTeacherArchivedClassroomState).toHaveBeenCalledTimes(3))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      method: 'POST',
      headers: { 'Idempotency-Key': operationId },
    })
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({
      method: 'POST',
      headers: { 'Idempotency-Key': operationId },
    })
    expect(crypto.randomUUID).toHaveBeenCalledOnce()
  })
})
