import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TeacherClassroomsIndex } from '@/app/classrooms/TeacherClassroomsIndex'
import {
  fetchTeacherArchivedClassroomState,
  fetchTeacherClassrooms,
} from '@/lib/teacher-classrooms-client'
import { TooltipProvider } from '@/ui'
import { createMockClassroom } from '../helpers/mocks'
import type { Classroom } from '@/types'
import { APP_HOME_SELECTED_EVENT } from '@/lib/events'

const push = vi.hoisted(() => vi.fn())
const createClassroomModalProps = vi.hoisted(() => ({ current: null as any }))
const archiveOperationId = vi.hoisted(() => vi.fn())

vi.mock('@/components/CreateClassroomModal', () => ({
  CreateClassroomModal: (props: {
    isOpen: boolean
    initialBlueprintId?: string | null
    onBlueprintCreated?: (classroom: Classroom) => void
  }) => {
    createClassroomModalProps.current = props
    const { isOpen, initialBlueprintId } = props
    return isOpen ? (
      <div role="dialog" data-testid="create-classroom-modal">
        Blueprint: {initialBlueprintId || 'none'}
      </div>
    ) : null
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/classrooms',
}))

vi.mock('@/lib/teacher-classrooms-client', () => ({
  fetchTeacherArchivedClassroomState: vi.fn(),
  fetchTeacherClassrooms: vi.fn(),
  invalidateTeacherClassrooms: vi.fn(),
}))

vi.mock('@/lib/classroom-archive-operation-id', () => ({
  classroomArchiveOperationId: archiveOperationId,
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
    createClassroomModalProps.current = null
    archiveOperationId.mockResolvedValue('00000000-0000-5000-8000-000000000099')
    vi.mocked(fetchTeacherClassrooms).mockResolvedValue([])
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValue({
      classrooms: [],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
      hotClassroomPurgeEnabledIds: [],
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uses the governed compact reading-width page frame', () => {
    renderTeacherClassroomsIndex([
      createMockClassroom({ id: 'c1', title: 'Math 101' }),
    ])

    const pageFrame = screen.getByTestId('classroom-card').closest('.max-w-reading')
    expect(pageFrame).toHaveClass('mx-auto', 'w-full', 'max-w-reading')
    expect(screen.queryByRole('button', { name: 'Delete permanently' })).not.toBeInTheDocument()
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

  it('shows the semester date range instead of the join code for active classrooms', () => {
    renderTeacherClassroomsIndex([
      createMockClassroom({
        id: 'c1',
        title: 'Math 101',
        class_code: 'MATH01',
        start_date: '2025-09-02',
        end_date: '2026-01-30',
      }),
    ])

    expect(screen.getByText('Sept 2025 - Jan 2026')).toBeInTheDocument()
    expect(screen.queryByText(/MATH01/)).not.toBeInTheDocument()
  })

  it('shows the semester date range instead of the join code for archived classrooms', async () => {
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValueOnce({
      classrooms: [
        createMockClassroom({
          id: 'archived-1',
          title: 'Archived',
          class_code: 'OLD101',
          start_date: '2025-09-02',
          end_date: '2026-01-30',
          archived_at: '2026-04-01T12:00:00Z',
        }),
      ],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
      hotClassroomPurgeEnabledIds: [],
    })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))

    expect(await screen.findByText('Sept 2025 - Jan 2026')).toBeInTheDocument()
    expect(screen.queryByText(/OLD101/)).not.toBeInTheDocument()
  })

  it('never shows the create button in archived view', async () => {
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValueOnce({
      classrooms: [
        createMockClassroom({ id: 'archived-1', title: 'Archived', archived_at: '2026-04-01T12:00:00Z' }),
      ],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
      hotClassroomPurgeEnabledIds: [],
    })

    renderTeacherClassroomsIndex([])

    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))

    expect(await screen.findByRole('button', { name: /^Archived/ })).toBeInTheDocument()
    expect(fetchTeacherArchivedClassroomState).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Create classroom' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete permanently' })).not.toBeInTheDocument()
  })

  it('offers permanent deletion only for hot archived classrooms without issuing direct DELETE requests', async () => {
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValueOnce({
      classrooms: [
        createMockClassroom({ id: 'archived-1', title: 'Archived', archived_at: '2026-04-01T12:00:00Z' }),
      ],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
      hotClassroomPurgeEnabledIds: ['archived-1'],
    })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))

    const unarchiveButton = await screen.findByRole('button', { name: 'Unarchive' })
    const reuseButton = screen.getByRole('button', { name: 'Reuse' })
    expect(reuseButton).toHaveTextContent('')
    expect(reuseButton.querySelector('svg')).toHaveClass('lucide-copy-plus')
    expect(unarchiveButton).toHaveTextContent('')
    expect(unarchiveButton.querySelector('svg')).toHaveClass('lucide-archive-restore')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.pointerMove(reuseButton)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Reuse')
    fireEvent.pointerLeave(reuseButton)
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())

    fireEvent.focus(unarchiveButton)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Unarchive')
    fireEvent.blur(unarchiveButton)
    const purgeButton = screen.getByRole('button', { name: 'Delete permanently' })
    expect(purgeButton).toHaveAttribute('title', 'Delete permanently')
    expect(purgeButton).toHaveTextContent('')
    expect(purgeButton.querySelector('svg')).toHaveClass('lucide-trash-2')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)

    fireEvent.click(unarchiveButton)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Unarchive Archived?')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Unarchive' })).toBeInTheDocument()
  })

  it('creates a verified recovery copy with one stable idempotency key across retries', async () => {
    const classroomId = '00000000-0000-4000-8000-000000000010'
    const operationId = '00000000-0000-4000-8000-000000000011'
    const archived = createMockClassroom({
      id: classroomId,
      title: 'Archived Biology',
      archived_at: '2026-04-01T12:00:00Z',
    })
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValue({
      classrooms: [archived],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
      hotClassroomPurgeEnabledIds: [],
      coldClassroomPurgeEnabledIds: [],
      hotArchiveRecovery: [{
        classroom_id: classroomId,
        current_revision: 7,
        export_available: true,
        latest_archive: null,
        latest_operation: null,
      }],
    })
    archiveOperationId.mockResolvedValue(operationId)
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: 'Archive service is temporarily unavailable',
        retryable: true,
      }),
    })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))

    const createButton = await screen.findByRole('button', { name: 'Create recovery copy' })
    fireEvent.click(createButton)
    let dialog = await screen.findByRole('dialog', { name: 'Create a recovery copy of Archived Biology?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recovery copy' }))
    expect(await screen.findByText('Archive service is temporarily unavailable')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create recovery copy' }))
    dialog = await screen.findByRole('dialog', { name: 'Create a recovery copy of Archived Biology?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recovery copy' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe(`/api/teacher/classrooms/${classroomId}/archives`)
      expect(init).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': operationId,
        },
      })
      expect(JSON.parse(String(init?.body))).toEqual({
        retention: { mode: 'teacher_managed', delete_after: null },
        expected_source_revision: 7,
      })
    }
  })

  it('shows verified recovery evidence without offering a duplicate export', async () => {
    const classroomId = '00000000-0000-4000-8000-000000000020'
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValueOnce({
      classrooms: [createMockClassroom({
        id: classroomId,
        title: 'Archived Physics',
        archived_at: '2026-04-01T12:00:00Z',
      })],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
      hotClassroomPurgeEnabledIds: [],
      coldClassroomPurgeEnabledIds: [],
      hotArchiveRecovery: [{
        classroom_id: classroomId,
        current_revision: 7,
        export_available: true,
        latest_archive: {
          archive_id: '00000000-0000-4000-8000-000000000021',
          operation_id: '00000000-0000-4000-8000-000000000021',
          source_revision: 7,
          created_at: '2026-08-19T14:00:00.000Z',
          verified_at: '2026-08-19T14:01:00.000Z',
          compressed_byte_size: 2_489_962,
          retention: { mode: 'teacher_managed', delete_after: null },
        },
        latest_operation: null,
      }],
    })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))

    expect(await screen.findByText('Recovery copy verified')).toBeInTheDocument()
    expect(screen.getByText(/2\.4 MB/)).toBeInTheDocument()
    expect(screen.getByText(/Kept until you delete it/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create recovery copy' })).not.toBeInTheDocument()
  })

  it('resumes an interrupted recovery copy with its server operation id after reload', async () => {
    const classroomId = '00000000-0000-4000-8000-000000000030'
    const operationId = '00000000-0000-4000-8000-000000000031'
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValue({
      classrooms: [createMockClassroom({
        id: classroomId,
        title: 'Archived Chemistry',
        archived_at: '2026-04-01T12:00:00Z',
      })],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
      hotArchiveRecovery: [{
        classroom_id: classroomId,
        current_revision: 7,
        export_available: true,
        latest_archive: null,
        latest_operation: {
          operation_id: operationId,
          source_revision: 7,
          status: 'snapshot_ready',
          retryable: null,
          retention: { mode: 'teacher_managed', delete_after: null },
          updated_at: '2026-08-19T14:01:00.000Z',
        },
      }],
    })
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Still processing', retryable: true }),
    })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Resume recovery copy' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Create a recovery copy of Archived Chemistry?',
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recovery copy' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/teacher/classrooms/${classroomId}/archives`,
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': operationId }),
      }),
    ))
  })

  it('retains the operation id when export succeeds but status refresh fails', async () => {
    const classroomId = '00000000-0000-4000-8000-000000000040'
    const operationId = '00000000-0000-5000-8000-000000000041'
    const recoveryState = {
      classrooms: [createMockClassroom({
        id: classroomId,
        title: 'Archived Geography',
        archived_at: '2026-04-01T12:00:00Z',
      })],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
      hotArchiveRecovery: [{
        classroom_id: classroomId,
        current_revision: 7,
        export_available: true,
        latest_archive: null,
        latest_operation: null,
      }],
    }
    vi.mocked(fetchTeacherArchivedClassroomState)
      .mockResolvedValueOnce(recoveryState)
      .mockRejectedValueOnce(new Error('Status refresh failed'))
    archiveOperationId.mockResolvedValue(operationId)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, operation_id: operationId }),
    })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create recovery copy' }))
    let dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recovery copy' }))
    expect(await screen.findByText('Status refresh failed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create recovery copy' }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recovery copy' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls.map(([, init]) => init?.headers)).toEqual([
      expect.objectContaining({ 'Idempotency-Key': operationId }),
      expect.objectContaining({ 'Idempotency-Key': operationId }),
    ])
    expect(archiveOperationId).toHaveBeenCalledTimes(1)
  })

  it('drops a retained operation id when refreshed recovery state advances revision', async () => {
    const classroomId = '00000000-0000-4000-8000-000000000042'
    const oldOperationId = '00000000-0000-5000-8000-000000000043'
    const newOperationId = '00000000-0000-5000-8000-000000000044'
    const recovery = (revision: number, archivedAt: string) => ({
      classrooms: [createMockClassroom({
        id: classroomId,
        title: 'Archived Geography',
        archived_at: archivedAt,
      })],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
      hotArchiveRecovery: [{
        classroom_id: classroomId,
        current_revision: revision,
        export_available: true,
        latest_archive: null,
        latest_operation: null,
      }],
    })
    vi.mocked(fetchTeacherArchivedClassroomState)
      .mockResolvedValueOnce(recovery(7, '2026-04-01T12:00:00Z'))
      .mockRejectedValueOnce(new Error('Status refresh failed'))
      .mockResolvedValueOnce(recovery(8, '2026-04-02T12:00:00Z'))
    archiveOperationId
      .mockResolvedValueOnce(oldOperationId)
      .mockResolvedValueOnce(newOperationId)
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, operation_id: oldOperationId }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Still processing', retryable: true }),
      })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create recovery copy' }))
    let dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recovery copy' }))
    expect(await screen.findByText('Status refresh failed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Active' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    await waitFor(() => expect(fetchTeacherArchivedClassroomState).toHaveBeenCalledTimes(3))
    fireEvent.click(screen.getByRole('button', { name: 'Create recovery copy' }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recovery copy' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(fetchMock.mock.calls.map(([, init]) => ({
      key: (init?.headers as Record<string, string>)['Idempotency-Key'],
      revision: JSON.parse(String(init?.body)).expected_source_revision,
    }))).toEqual([
      { key: oldOperationId, revision: 7 },
      { key: newOperationId, revision: 8 },
    ])
  })

  it('shows a stale verified copy and offers a current recovery copy', async () => {
    const classroomId = '00000000-0000-4000-8000-000000000050'
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValueOnce({
      classrooms: [createMockClassroom({
        id: classroomId,
        title: 'Archived History',
        archived_at: '2026-04-01T12:00:00Z',
      })],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
      hotArchiveRecovery: [{
        classroom_id: classroomId,
        current_revision: 8,
        export_available: true,
        latest_archive: {
          archive_id: '00000000-0000-4000-8000-000000000051',
          operation_id: '00000000-0000-4000-8000-000000000051',
          source_revision: 7,
          created_at: '2026-08-19T14:00:00.000Z',
          verified_at: '2026-08-19T14:01:00.000Z',
          compressed_byte_size: 2_489_962,
          retention: { mode: 'teacher_managed', delete_after: null },
        },
        latest_operation: null,
      }],
    })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))

    expect(await screen.findByText('Recovery copy out of date')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create recovery copy' })).toBeInTheDocument()
  })

  it('refreshes a stale tab before retrying against a newer archive revision', async () => {
    const classroomId = '00000000-0000-4000-8000-000000000055'
    const oldOperationId = '00000000-0000-5000-8000-000000000056'
    const newOperationId = '00000000-0000-5000-8000-000000000057'
    const recovery = (revision: number, archivedAt: string) => ({
      classrooms: [createMockClassroom({
        id: classroomId,
        title: 'Archived Economics',
        archived_at: archivedAt,
      })],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
      hotArchiveRecovery: [{
        classroom_id: classroomId,
        current_revision: revision,
        export_available: true,
        latest_archive: null,
        latest_operation: null,
      }],
    })
    vi.mocked(fetchTeacherArchivedClassroomState)
      .mockResolvedValueOnce(recovery(7, '2026-04-01T12:00:00Z'))
      .mockResolvedValueOnce(recovery(8, '2026-04-02T12:00:00Z'))
    archiveOperationId
      .mockResolvedValueOnce(oldOperationId)
      .mockResolvedValueOnce(newOperationId)
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error_code: 'classroom_archive_source_revision_changed',
          error: 'Classroom archive status changed; refresh before creating a recovery copy',
          retryable: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Still processing', retryable: true }),
      })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create recovery copy' }))
    let dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recovery copy' }))

    expect(await screen.findByText(/status changed; refresh/)).toBeInTheDocument()
    await waitFor(() => expect(fetchTeacherArchivedClassroomState).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'Create recovery copy' }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recovery copy' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(fetchMock.mock.calls.map(([, init]) => ({
      key: (init?.headers as Record<string, string>)['Idempotency-Key'],
      revision: JSON.parse(String(init?.body)).expected_source_revision,
    }))).toEqual([
      { key: oldOperationId, revision: 7 },
      { key: newOperationId, revision: 8 },
    ])
  })

  it('replays the exact retention contract for a resumable operation', async () => {
    const classroomId = '00000000-0000-4000-8000-000000000060'
    const operationId = '00000000-0000-4000-8000-000000000061'
    const retention = { mode: 'scheduled' as const, delete_after: '2099-08-22T12:00:00.000Z' }
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValue({
      classrooms: [createMockClassroom({
        id: classroomId,
        title: 'Archived Civics',
        archived_at: '2026-04-01T12:00:00Z',
      })],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
      hotArchiveRecovery: [{
        classroom_id: classroomId,
        current_revision: 7,
        export_available: true,
        latest_archive: null,
        latest_operation: {
          operation_id: operationId,
          source_revision: 7,
          status: 'snapshot_ready',
          retryable: null,
          retention,
          updated_at: '2026-08-19T14:01:00.000Z',
        },
      }],
    })
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Still processing', retryable: true }),
    })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Resume recovery copy' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recovery copy' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/teacher/classrooms/${classroomId}/archives`,
      expect.objectContaining({
        body: JSON.stringify({ retention, expected_source_revision: 7 }),
      }),
    ))
  })

  it('preserves archive actions and offers status retry when recovery status is unavailable', async () => {
    const archived = createMockClassroom({
      id: '00000000-0000-4000-8000-000000000070',
      title: 'Archived Music',
      archived_at: '2026-04-01T12:00:00Z',
    })
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValue({
      classrooms: [archived],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
      hotArchiveRecoveryStatusAvailable: false,
      hotArchiveRecovery: [{
        classroom_id: archived.id,
        current_revision: null,
        export_available: false,
        latest_archive: null,
        latest_operation: null,
      }],
    })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))

    expect(await screen.findByText('Recovery-copy status is temporarily unavailable.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unarchive' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reuse' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create recovery copy' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry status' }))
    await waitFor(() => expect(fetchTeacherArchivedClassroomState).toHaveBeenCalledTimes(2))
  })

  it('prepares an archived classroom and opens creation with its Blueprint selected', async () => {
    const archived = createMockClassroom({
      id: 'archived-1',
      title: 'Archived',
      archived_at: '2026-04-01T12:00:00Z',
    })
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValueOnce({
      classrooms: [archived],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
    })
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '10000000-0000-4000-8000-000000000001',
    )
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        status: 'ready',
        blueprint_id: '20000000-0000-4000-8000-000000000002',
        blueprint_title: 'Reusable course',
      }),
    })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reuse' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/teacher/classrooms/archived-1/use-again',
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': '10000000-0000-4000-8000-000000000001',
        },
      },
    ))
    expect(await screen.findByTestId('create-classroom-modal')).toHaveTextContent(
      'Blueprint: 20000000-0000-4000-8000-000000000002',
    )

    const created = createMockClassroom({ id: 'created-1', title: 'Created from blueprint' })
    act(() => createClassroomModalProps.current.onBlueprintCreated(created))

    expect(screen.getByTestId('create-classroom-modal')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Active' }))
    expect(await screen.findByText('Created from blueprint')).toBeInTheDocument()
  })

  it('sends simultaneous classroom and Blueprint changes to review', async () => {
    const archived = createMockClassroom({
      id: 'archived-1',
      title: 'Archived',
      archived_at: '2026-04-01T12:00:00Z',
    })
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValueOnce({
      classrooms: [archived],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        status: 'review_required',
        blueprint_id: 'blueprint-1',
        blueprint_title: 'Reusable course',
        review_url: '/teacher/blueprints?blueprint=blueprint-1&reviewClassroom=archived-1',
      }),
    })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reuse' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(
      'Both versions changed. Review which course changes to keep.',
    )).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review changes' }))
    expect(push).toHaveBeenCalledWith(
      '/teacher/blueprints?blueprint=blueprint-1&reviewClassroom=archived-1',
    )
  })

  it('hides the create button after the first classroom unless edit mode is enabled', async () => {
    const classrooms = [createMockClassroom({ id: 'c1', title: 'Math 101' })]
    renderTeacherClassroomsIndex(classrooms)

    const editButton = screen.getByRole('button', { name: 'Organize classrooms' })
    const bottomControls = screen.getByTestId('classroom-bottom-controls')
    const card = screen.getByTestId('classroom-card')

    expect(bottomControls).toHaveClass('fixed', 'left-1/2', 'z-floating', 'rounded-lg')
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
    expect(screen.queryByRole('button', { name: 'Create classroom' })).not.toBeInTheDocument()

    fireEvent.click(editButton)

    const newButton = screen.getByRole('button', { name: 'Create classroom' })
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
    const bottomControls = screen.getByTestId('classroom-bottom-controls')

    expect(activeButton).toBeInTheDocument()
    expect(archivedButton).toBeInTheDocument()
    expect(bottomControls.firstElementChild).toHaveClass('min-h-[52px]')
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
    expect(screen.getByRole('button', { name: 'Create classroom' })).toBeInTheDocument()

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

  it('returns the archived classroom view to active when the Pika logo selects home', async () => {
    const activeClassroom = createMockClassroom({ id: 'active-1', title: 'Active classroom' })
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValueOnce({
      classrooms: [
        createMockClassroom({
          id: 'archived-1',
          title: 'Archived classroom',
          archived_at: '2026-04-01T12:00:00Z',
        }),
      ],
      coldArchives: [],
      coldArchiveRestoreEnabled: false,
    })

    renderTeacherClassroomsIndex([activeClassroom])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    expect(await screen.findByRole('button', { name: /^Archived classroom/ })).toBeInTheDocument()

    fireEvent(window, new Event(APP_HOME_SELECTED_EVENT))

    const classroomView = screen.getByRole('group', { name: 'Classroom view' })
    expect(within(classroomView).getByRole('button', { name: 'Active' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: /^Active classroom/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Archived classroom/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Organize classrooms' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('does not show a Blueprints button in the classroom action bar', async () => {
    renderTeacherClassroomsIndex([])

    expect(screen.queryByRole('button', { name: 'Blueprints' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create classroom' })).toBeInTheDocument()
  })

  it('shows immediate feedback while opening a classroom', async () => {
    const classrooms = [createMockClassroom({ id: 'c1', title: 'Math 101' })]
    renderTeacherClassroomsIndex(classrooms)

    const openButton = screen.getByRole('button', { name: /^Math 101/ })
    fireEvent.click(openButton)

    expect(push).toHaveBeenCalledWith('/classrooms/c1?tab=daily')
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
    expect(screen.queryByRole('button', { name: 'Delete permanently' })).not.toBeInTheDocument()
  })

  it('offers stored classroom deletion only behind the independent cold gate', async () => {
    vi.mocked(fetchTeacherArchivedClassroomState).mockResolvedValueOnce({
      classrooms: [],
      coldArchives: [coldArchive],
      coldArchiveRestoreEnabled: false,
      hotClassroomPurgeEnabledIds: [],
      coldClassroomPurgeEnabledIds: [coldArchive.classroom_id],
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        impact: {
          classroom_id: coldArchive.classroom_id,
          archive_id: coldArchive.archive_id,
          classroom_title: coldArchive.title,
          source_revision: 1,
          storage_inventory_sha256: 'a'.repeat(64),
          cold_resource_inventory_sha256: 'b'.repeat(64),
          cold_resource_count: 1,
          student_count: 0,
          managed_file_count: 1,
          managed_file_bytes: 1,
          missing_file_count: 0,
          non_ready_file_count: 0,
          unmanaged_reference_count: 0,
          archive_count: 1,
          gradex_extract_count: 0,
          storage_counts: { 'classroom-archives': 1 },
          resource_counts: { classroom_cold_tombstones: 1 },
          retention: { mode: 'teacher_managed', delete_after: null },
          conflicting_operation: null,
          deletion_available: true,
          unavailable_reason: null,
        },
        operation: null,
      }),
    })

    renderTeacherClassroomsIndex([])
    fireEvent.click(screen.getByRole('button', { name: 'Organize classrooms' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete permanently' }))

    expect(await screen.findByRole('dialog', {
      name: 'Delete stored classroom permanently?',
    })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
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
