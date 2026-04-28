import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TeacherClassroomsIndex } from '@/app/classrooms/TeacherClassroomsIndex'
import { createMockClassroom } from '../helpers/mocks'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/classrooms',
}))

describe('TeacherClassroomsIndex', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not refetch classrooms on initial mount (#302)', async () => {
    const classrooms = [createMockClassroom({ id: 'c1', title: 'Math 101' })]
    render(<TeacherClassroomsIndex initialClassrooms={classrooms} />)

    // Show the server-provided data
    expect(await waitFor(() => document.querySelector('[data-testid="classroom-card"]'))).toBeTruthy()

    // Wait a tick — no fetch should have fired
    await new Promise((r) => setTimeout(r, 50))

    const classroomFetchCalls = fetchMock.mock.calls.filter(
      ([url]: [string]) => typeof url === 'string' && url === '/api/teacher/classrooms'
    )
    expect(classroomFetchCalls).toHaveLength(0)
  })

  it('keeps the bottom create button available in archived view when there are no active classrooms', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        classrooms: [createMockClassroom({ id: 'archived-1', title: 'Archived', archived_at: '2026-04-01T12:00:00Z' })],
      }),
    })

    render(<TeacherClassroomsIndex initialClassrooms={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))

    expect(await screen.findByText('Archived')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ New' })).toBeInTheDocument()
  })

  it('does not show a Blueprints button in the bottom action bar', async () => {
    render(<TeacherClassroomsIndex initialClassrooms={[]} />)

    expect(screen.queryByRole('button', { name: 'Blueprints' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ New' })).toBeInTheDocument()
  })
})
