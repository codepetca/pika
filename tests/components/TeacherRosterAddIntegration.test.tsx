import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { TeacherRosterTab } from '@/app/classrooms/[classroomId]/TeacherRosterTab'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'
import type { Classroom } from '@/types'

const classroom = {
  id: 'roster-integration', teacher_id: 'teacher-1', title: 'Class', class_code: 'ABC123', theme_color: 'blue',
  term_label: null, allow_enrollment: true, start_date: null, end_date: null, lesson_plan_visibility: 'hidden',
  archived_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
} as Classroom

describe('roster add and refresh integration', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); invalidateCachedJSONMatching('teacher-roster:roster-integration') })

  it.each([
    { label: 'all valid', value: 'Ada Lovelace ada@example.com', remaining: '' },
    { label: 'mixed', value: 'Ada Lovelace ada@example.com\nJane Doe jane@example.com 123 guardian@bad', remaining: 'Jane Doe jane@example.com 123 guardian@bad' },
  ])('keeps the dialog and warns after a confirmed add when the real refresh fails ($label)', async ({ value, remaining }) => {
    let reads = 0
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === `/api/teacher/classrooms/${classroom.id}/roster` && !init?.method) {
        reads += 1
        return Promise.resolve(new Response(JSON.stringify(reads === 1 ? { roster: [] } : { error: 'Refresh failed' }), { status: reads === 1 ? 200 : 500 }))
      }
      if (url === `/api/teacher/classrooms/${classroom.id}/roster/add` && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ success: true, upsertedCount: 1 }), { status: 200 }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<TooltipProvider><AppMessageProvider><TeacherRosterTab classroom={classroom} /></AppMessageProvider></TooltipProvider>)
    const add = await screen.findByRole('button', { name: 'Add students' })
    await vi.waitFor(() => expect(add).toBeEnabled())
    fireEvent.click(add)
    const dialog = screen.getByRole('dialog', { name: 'Add Students' })
    const input = within(dialog).getByLabelText('Enter student information')
    fireEvent.change(input, { target: { value } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 1 Student' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Students were added, but the roster could not be refreshed.')
    expect(input).toHaveValue(remaining)
    expect(within(dialog).getByRole('button', { name: 'Add 0 Students' })).toBeDisabled()
    expect(reads).toBe(2)
  })
})
