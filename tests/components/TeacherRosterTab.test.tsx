import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TeacherRosterTab } from '@/app/classrooms/[classroomId]/TeacherRosterTab'
import type { Classroom } from '@/types'
import { AppMessageProvider, TooltipProvider } from '@/ui'

vi.mock('@/components/AddStudentsModal', () => ({
  AddStudentsModal: () => null,
}))

vi.mock('@/components/UploadRosterModal', () => ({
  UploadRosterModal: () => null,
}))

const classroom: Classroom = {
  id: 'classroom-1',
  teacher_id: 'teacher-1',
  title: 'Roster Classroom',
  class_code: 'ABC123',
  term_label: null,
  allow_enrollment: true,
  start_date: null,
  end_date: null,
  lesson_plan_visibility: 'hidden',
  archived_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const rosterRow = {
  id: 'roster-1',
  email: 'ada@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  student_number: '1001',
  counselor_email: 'counselor@example.com',
  created_at: '2026-01-02T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  joined: true,
  student_id: 'student-1',
  joined_at: '2026-01-03T00:00:00.000Z',
}

const secondRosterRow = {
  id: 'roster-2',
  email: 'grace@example.com',
  first_name: 'Grace',
  last_name: 'Hopper',
  student_number: '1002',
  counselor_email: null,
  created_at: '2026-01-02T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  joined: true,
  student_id: 'student-2',
  joined_at: '2026-01-03T00:00:00.000Z',
}

function mockJson(data: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(data),
  }) as any
}

function mockRosterFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url === `/api/teacher/classrooms/${classroom.id}/roster` && method === 'GET') {
      return mockJson({ roster: [rosterRow, secondRosterRow] })
    }

    if (url === `/api/teacher/classrooms/${classroom.id}/roster/bulk-delete` && method === 'POST') {
      return mockJson({ success: true })
    }

    throw new Error(`Unhandled fetch: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderRoster() {
  return render(
    <TooltipProvider>
      <AppMessageProvider>
        <TeacherRosterTab classroom={classroom} />
      </AppMessageProvider>
    </TooltipProvider>,
  )
}

function getIndividualDeleteCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    return (
      String(input).startsWith(`/api/teacher/classrooms/${classroom.id}/roster/`) &&
      (init as RequestInit | undefined)?.method === 'DELETE'
    )
  })
}

function getBulkDeleteCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    return (
      String(input) === `/api/teacher/classrooms/${classroom.id}/roster/bulk-delete` &&
      (init as RequestInit | undefined)?.method === 'POST'
    )
  })
}

function getRequestBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body))
}

describe('TeacherRosterTab', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('opens single-student removal from the floating roster actions dropdown with confirmation', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRosterFetch()

    renderRoster()

    await screen.findByText('Ada')

    await user.click(screen.getByText('Ada'))

    expect(screen.queryByRole('button', { name: /^Remove$/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Roster actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove student' }))

    expect(getBulkDeleteCalls(fetchMock)).toHaveLength(0)

    const dialog = screen.getByRole('dialog', { name: 'Remove student?' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText(/ada@example\.com/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(getBulkDeleteCalls(fetchMock)).toHaveLength(1)
    })
    expect(getRequestBody(getBulkDeleteCalls(fetchMock)[0]).roster_ids).toEqual([rosterRow.id])
    expect(getIndividualDeleteCalls(fetchMock)).toHaveLength(0)
  })

  it('shows and confirms removal for multiple checked students from the floating actions dropdown', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRosterFetch()

    renderRoster()

    await screen.findByText('Ada')

    await user.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' }))
    await user.click(screen.getByRole('button', { name: 'Roster actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove students' }))

    expect(getBulkDeleteCalls(fetchMock)).toHaveLength(0)

    const dialog = screen.getByRole('dialog', { name: 'Remove students?' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText(/ada@example\.com/)).toBeInTheDocument()
    expect(within(dialog).getByText(/grace@example\.com/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(getBulkDeleteCalls(fetchMock)).toHaveLength(1)
    })
    expect(getRequestBody(getBulkDeleteCalls(fetchMock)[0]).roster_ids).toEqual(
      expect.arrayContaining([rosterRow.id, secondRosterRow.id])
    )
    expect(getIndividualDeleteCalls(fetchMock)).toHaveLength(0)
  })

  it('keeps the full selected set pending when bulk removal fails', async () => {
    const user = userEvent.setup()
    let failBulkOnce = true
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url === `/api/teacher/classrooms/${classroom.id}/roster` && method === 'GET') {
        return mockJson({ roster: [rosterRow, secondRosterRow] })
      }

      if (url === `/api/teacher/classrooms/${classroom.id}/roster/bulk-delete` && method === 'POST') {
        if (failBulkOnce) {
          failBulkOnce = false
          return mockJson({ error: 'Failed to remove students' }, false)
        }
        return mockJson({ success: true })
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    renderRoster()

    await screen.findByText('Ada')

    await user.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' }))
    await user.click(screen.getByRole('button', { name: 'Roster actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove students' }))

    const multiDialog = screen.getByRole('dialog', { name: 'Remove students?' })
    await user.click(within(multiDialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(screen.getByText('Failed to remove students')).toBeInTheDocument()
    })

    const retryDialog = screen.getByRole('dialog', { name: 'Remove students?' })
    expect(within(retryDialog).getByText(/ada@example\.com/)).toBeInTheDocument()
    expect(within(retryDialog).getByText(/grace@example\.com/)).toBeInTheDocument()

    await user.click(within(retryDialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    expect(getBulkDeleteCalls(fetchMock)).toHaveLength(2)
    expect(getIndividualDeleteCalls(fetchMock)).toHaveLength(0)
  })
})
