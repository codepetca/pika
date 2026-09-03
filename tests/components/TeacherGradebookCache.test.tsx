import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeacherGradebookTab } from '@/app/classrooms/[classroomId]/TeacherGradebookTab'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import { createMockClassroom } from '../helpers/mocks'

// Keep this suite's network counts specific to the real Gradebook cache.
vi.mock('@/hooks/useGradebookEmail2', () => ({
  useGradebookEmail2: () => ({ rows: [], loading: false, error: null, reload: vi.fn() }),
}))

describe('TeacherGradebookTab with the real request cache', () => {
  beforeEach(() => {
    invalidateCachedJSONMatching('gradebook:')
    window.localStorage.clear()
  })

  afterEach(() => {
    invalidateCachedJSONMatching('gradebook:')
    vi.unstubAllGlobals()
  })

  it('fetches canonical edits when reactivated within the cache TTL', async () => {
    const classroom = createMockClassroom()
    let title = 'Original title'
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        categories: [],
        assessment_columns: [{ assessment_id: 'a1', assessment_type: 'assignment', title, code: 'A1', possible: 10, weight: 10, include_in_final: true }],
        students: [],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const view = (isActive: boolean) => (
      <AppMessageProvider><TooltipProvider>
        <TeacherGradebookTab classroom={classroom} isActive={isActive} sectionParam="grades" onSectionChange={vi.fn()} />
      </TooltipProvider></AppMessageProvider>
    )
    const { rerender } = render(view(true))
    expect(await screen.findByRole('button', { name: 'Edit A1: Original title' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    rerender(view(false))
    title = 'Edited in Classwork'
    rerender(view(true))
    expect(await screen.findByRole('button', { name: 'Edit A1: Edited in Classwork' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fences a pending first load when reactivated before it resolves', async () => {
    const classroom = createMockClassroom()
    const response = (title: string) => ({
      ok: true,
      json: async () => ({
        categories: [],
        assessment_columns: [{ assessment_id: 'a1', assessment_type: 'assignment', title, code: 'A1', possible: 10, weight: 10, include_in_final: true }],
        students: [],
      }),
    })
    let resolveFirst!: (value: ReturnType<typeof response>) => void
    const pendingFirst = new Promise<ReturnType<typeof response>>((resolve) => { resolveFirst = resolve })
    const fetchMock = vi.fn().mockReturnValueOnce(pendingFirst).mockResolvedValue(response('Edited in Classwork'))
    vi.stubGlobal('fetch', fetchMock)
    const view = (isActive: boolean) => (
      <AppMessageProvider><TooltipProvider>
        <TeacherGradebookTab classroom={classroom} isActive={isActive} sectionParam="grades" onSectionChange={vi.fn()} />
      </TooltipProvider></AppMessageProvider>
    )
    const { rerender } = render(view(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    rerender(view(false))
    rerender(view(true))
    expect(await screen.findByRole('button', { name: 'Edit A1: Edited in Classwork' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => { resolveFirst(response('Stale initial title')) })
    expect(screen.getByRole('button', { name: 'Edit A1: Edited in Classwork' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit A1: Stale initial title' })).not.toBeInTheDocument()
  })
})
