import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeacherGradebookTab } from '@/app/classrooms/[classroomId]/TeacherGradebookTab'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import { createMockClassroom } from '../helpers/mocks'

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
})
