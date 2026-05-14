import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TeacherClassroomsIndex } from '@/app/classrooms/TeacherClassroomsIndex'
import { TooltipProvider } from '@/ui'
import { createMockClassroom } from '../helpers/mocks'
import type { Classroom } from '@/types'

const push = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/classrooms',
}))

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
    fetchMock = vi.fn()
    push.mockReset()
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

  it('keeps the create button available in archived view when there are no active classrooms', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        classrooms: [createMockClassroom({ id: 'archived-1', title: 'Archived', archived_at: '2026-04-01T12:00:00Z' })],
      }),
    })

    renderTeacherClassroomsIndex([])

    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))

    expect(await screen.findByRole('button', { name: /^Archived/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument()
  })

  it('hides the create button after the first classroom unless edit mode is enabled', async () => {
    const classrooms = [createMockClassroom({ id: 'c1', title: 'Math 101' })]
    renderTeacherClassroomsIndex(classrooms)

    const editButton = screen.getByRole('button', { name: 'Edit' })
    const card = screen.getByTestId('classroom-card')

    expect(
      within(screen.getByTestId('classroom-bottom-controls')).getByRole('button', { name: 'Edit' })
    ).toBe(editButton)
    expect(card.compareDocumentPosition(editButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New' })).not.toBeInTheDocument()

    fireEvent.click(editButton)

    const newButton = screen.getByRole('button', { name: 'New' })
    expect(card.compareDocumentPosition(newButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('always shows the classroom view toggle while hiding row edit controls until edit is enabled', async () => {
    const classrooms = [createMockClassroom({ id: 'c1', title: 'Math 101' })]
    renderTeacherClassroomsIndex(classrooms)

    expect(screen.getByRole('button', { name: 'Active' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Archived' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Active' })).not.toHaveAttribute('title')
    expect(screen.getByRole('button', { name: 'Archived' })).not.toHaveAttribute('title')
    expect(screen.queryByRole('button', { name: 'Drag to reorder Math 101' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive Math 101' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    const activeButton = screen.getByRole('button', { name: 'Active' })
    const archivedButton = screen.getByRole('button', { name: 'Archived' })

    expect(activeButton).toBeInTheDocument()
    expect(archivedButton).toBeInTheDocument()
    expect(activeButton).not.toHaveAttribute('title')
    expect(archivedButton).not.toHaveAttribute('title')
    expect(screen.getByRole('button', { name: 'Drag to reorder Math 101' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Archive Math 101' })).toBeInTheDocument()
  })

  it('keeps the selected classroom view when edit mode is turned off', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        classrooms: [createMockClassroom({ id: 'archived-1', title: 'Archived', archived_at: '2026-04-01T12:00:00Z' })],
      }),
    })

    renderTeacherClassroomsIndex([])

    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    expect(await screen.findByRole('button', { name: /^Archived/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(
      within(screen.getByRole('group', { name: 'Classroom view' })).getByRole('button', { name: 'Archived' })
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('turns classroom edit mode off when Escape is pressed', async () => {
    const classrooms = [createMockClassroom({ id: 'c1', title: 'Math 101' })]
    renderTeacherClassroomsIndex(classrooms)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('button', { name: 'Archive Math 101' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('button', { name: 'Archive Math 101' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('turns classroom edit mode off when the page is restored', async () => {
    const classrooms = [createMockClassroom({ id: 'c1', title: 'Math 101' })]
    renderTeacherClassroomsIndex(classrooms)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('button', { name: 'Archive Math 101' })).toBeInTheDocument()

    fireEvent(window, new Event('pageshow'))

    expect(screen.queryByRole('button', { name: 'Archive Math 101' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-pressed', 'false')
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
})
